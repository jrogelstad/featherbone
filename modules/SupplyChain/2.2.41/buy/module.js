/*jslint devel browser unordered*/
/*global printJS*/
const catalog = f.catalog();
const store = catalog.store();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const mixinItemConversion = catalog.register("mixins").mixinItemConversion;

/**
   Supplier model
*/
function supplierModel(data, feather) {
    feather = feather || catalog.getFeather("Supplier");
    if (feather.properties.currency) {
        feather.properties.currency.default = f.baseCurrency().toJSON();
    }
    return f.createModel(data, feather);
}

catalog.registerModel("Supplier", supplierModel);

/*Convert planned purchase options */
const convOpts = Object.freeze({
    name: "ConvertPlannedPurchaseOptions",
    description: "Convert planned purchase dialog options",
    isSystem: true,
    properties: {
        supplier: {
            description: "Supplier",
            type: {
                relation: "Supplier",
                properties: [
                    "number",
                    "name"
                ]
            },
            isRequired: true
        },
        useExistingOrder: {
            description: "Use existing purchase order",
            type: "boolean",
            default: false
        },
        purchaseOrder: {
            description: "Open purchase orders",
            type: {
                relation: "PurchaseOrder",
                properties: [
                    "number",
                    "supplier",
                    "status",
                    "orderDate",
                    "plannedDelivery",
                    "confirmedDelivery"
                ]
            },
            isReadOnly: true
        }
    }
});

catalog.register("feathers", "ConvertPlannedPurchaseOptions", convOpts);
catalog.registerModel("ConvertPlannedPurchaseOptions", function () {
    let feather = catalog.getFeather("ConvertPlannedPurchaseOptions");
    let model = f.createModel({}, feather);
    let d = model.data;

    function handleFilter() {
        if (d.supplier()) {
            d.purchaseOrder.filter({criteria: [{
                property: "status",
                operator: "!=",
                value: "C"
            }, {
                property: "supplier.id",
                value: d.supplier().id()
            }]});
        }
    }

    function handleReadOnly() {
        d.purchaseOrder.isReadOnly(
            !d.useExistingOrder() ||
            !d.supplier()
        );
    }

    model.onChanged("useExistingOrder", handleReadOnly);
    model.onChanged("supplier", handleReadOnly);
    model.onChanged("supplier", handleFilter);

    model.onValidate(function () {
        if (d.useExistingOrder() && !d.purchaseOrder()) {
            throw "A purchase order must be selected";
        }
    });

    return model;
});

const convOptsForm = {
    attrs: [{
        attr: "supplier"
    }, {
        attr: "useExistingOrder"
    }, {
        attr: "purchaseOrder"
    }]
};

function mixinPurchaseItem(model, attr) {
    let d = model.data;
    let itemSupp = f.prop();
    let isPlanned = Boolean(attr);
    let itemSites = f.createList("ItemSite", {fetch: false});

    attr = attr || "ordered";
    function calculatePrice() {
        let item = d.item();
        let amt;
        let itmsup = itemSupp();
        let ord = d[attr].toJSON();
        let curr = (
            !isPlanned
            ? model.parent().data.currency().data.code()
            : undefined
        );
        let prices;

        if (item) {
            if (itmsup && itmsup.prices.length) {
                itmsup.prices.sort(function (a, b) {
                    return a.quantity - b.quantity;
                });
                prices = itmsup.prices.filter((p) => p.quantity <= ord).slice();
                if (prices.length) {
                    d.price(f.copy(prices.pop().price));
                    return;
                }
            }
            amt = item.data.materialCost.toJSON().amount.times(d.ratio());
            d.price(f.money(amt, curr));
        }
    }
    function getItemSite() {
        if (d.item() && d.site()) {
            return itemSites.find(function (s) {
                return s.data.site().id() === d.site().id();
            });
        }
    }
    function defaultQty() {
        let is = getItemSite(model);
        let end;

        if (is) {
            let qty = Math.max(
                is.data.minimumOrderQuantity.toJSON(),
                d[attr].toJSON()
            ).div(
                d.ratio.toJSON()
            );
            if (!d.item().data.isFractional()) {
                qty = Math.ceil(qty);
            }
            d[attr](qty);

            // Add leadtime to planned orders
            if (isPlanned) {
                end = f.parseDate(d.startDate());
                end.setDate(end.getDate().plus(is.data.leadTime.toJSON()));
                end = end.toLocalDate();
                d.dueDate(end);
            }
        }
    }
    function checkOrderQty() {
        let is = getItemSite(model);
        let ord = d[attr].toJSON().times(d.ratio.toJSON());
        let min;
        let max;
        let inc;

        if (is && d.status() === "P") {
            min = is.data.minimumOrderQuantity.toJSON();
            max = is.data.maximumOrderQuantity.toJSON();
            inc = is.data.orderIncrement.toJSON();
            if (ord < min) {
                throw ("Minimum order quantity is " + min);
            }
            if (max && ord > max) {
                throw ("Maximum order quantity is " + max);
            }
            if (inc && ord.div(inc) !== Math.ceil(ord.div(inc))) {
                throw ("Order must be multiple of " + inc);
            }
        }
    }
    function loadItemSupplier(arg) {
        itemSupp(undefined);

        if (!d.item() || (!isPlanned && !model.parent())) {
            return;
        }

        function callback(resp) {
            if (!resp) {
                return;
            }
            itemSupp(resp);

            if (arg) {
                d.unit(resp.unit);
                if (d.supplier) {
                    d.supplier.state().send("silence"); // Avoid recursion
                    d.supplier(resp.supplier);
                    d.supplier.state().send("report");
                }
                if (resp.supplierItem) {
                    d.supplierItem(resp.supplierItem);
                }
                if (resp.manufacturer) {
                    d.manufacturer(resp.manufacturer);
                }
                if (resp.manufacturerItem) {
                    d.manufacturerItem(resp.manufacturerItem);
                }
                if (resp.supplierDescription) {
                    d.description(resp.supplierDescription);
                }

                defaultQty();
                calculatePrice();
            }
        }

        f.datasource().request({
            method: "POST",
            path: "/buy/get-item-supplier",
            body: {
                itemId: d.item().id(),
                supplierId: (
                    isPlanned
                    ? (
                        model.data.supplier()
                        ? model.data.supplier().id()
                        : undefined
                    )
                    : model.parent().data.supplier().id()
                )
            }
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    function loadSites() {
        if (!d.item()) {
            itemSites.reset();
            return;
        }

        function callback(resp) {
            if (!resp) {
                itemSites.reset();
                return;
            }
            resp.forEach(function (data) {
                let mdl = f.createModel("ItemSite", data);
                itemSites.add(mdl);
            });
            let item = d.item();
            let psite = (
                typeof model.parent() === "object"
                ? model.parent().data.site()
                : (
                    item
                    ? itemSites.find((s) => s.data.isPrimary())
                    : undefined
                )
            );

            if (item) {
                calculatePrice();
                // If site is on item list use that
                if (psite) {
                    itemSites.some(function (site) {
                        if (site.data.site().id() === psite.id()) {
                            d.site(site.data.site.toJSON());
                            return true;
                        }
                    });
                }
                loadItemSupplier(true);
            }
            defaultQty();
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-sites",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("item", loadSites);
    model.onChanged("site", defaultQty);
    model.onChanged(attr, function () {
        // Only recalculate price if we might have price
        // break opportunity, otherwise, don't want to
        // overwrite manually set prices
        if (itemSupp()) {
            calculatePrice();
        }
    });
    model.onChanged("ratio", calculatePrice);
    if (isPlanned) {
        model.onChanged("quantity", function () {
            d.orderQuantity.state().send("silence");
            d.orderQuantity(d.quantity.toJSON());
            calculatePrice();
            d.orderQuantity.state().send("report");
        });
    }
    model.onChanged("supplier", function () {
        if (d.supplier()) {
            loadItemSupplier(true);
        }
    });
    model.onLoad(loadItemSupplier);
    model.onValidate(checkOrderQty);
}

 /**
    Item supplier
*/
function itemSupplier(data, feather) {
    feather = feather || catalog.getFeather("ItemSupplier");
    let model = f.createModel(data, feather);
    let d = model.data;

    function conversions(item) {
        let convs;
        let glbCnv = catalog.store().data().itemUnitConversions().slice();
        let itemUnit = item.data.unit();

        function hasStockUnit(gc) {
            return (
                gc.data.fromUnit().id() === itemUnit.id() ||
                gc.data.toUnit().id() === itemUnit.id()
            );
        }

        convs = glbCnv.filter(hasStockUnit);
        convs = convs.concat(item.data.conversions());

        return convs;
    }

    model.onValidate(function () {
        // find matching unit ratio
        let conv;
        let unit = d.unit();
        let item = model.parent();

        if (!item || !unit) {
            return;
        }

        if (item.data.unit().id() !== unit.id()) {
            conv = conversions(item).find(
                (cu) => (
                    cu.data.fromUnit().id() === unit.id() ||
                    cu.data.toUnit().id() === unit.id()
                )
            );
            if (!conv) {
                throw "No unit of measure conversion found.";
            }
        }

        if (d.isPrimary()) {
            let list = item.data.suppliers().slice();
            list = list.filter((l) => l.data.isPrimary());
            if (list.length > 1) {
                throw "There can only be one primary supplier.";
            }
        }
    });

    return model;
}

catalog.registerModel("ItemSupplier", itemSupplier);

/**
    Planned purchase model
*/
function plannedPurch(data, feather) {
    feather = feather || catalog.getFeather("PlannedPurchase");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        d.quantity.isReadOnly(d.ratio() !== 1);
    }
    function calcQuantity() {
        let qty = d.orderQuantity.toJSON().times(d.ratio.toJSON());
        if (d.item() && !d.item().data.isFractional()) {
            qty = Math.ceil(qty);
        }
        d.quantity.state().send("silence");
        d.quantity(qty);
        d.quantity.state().send("report");
    }
    mixinItemConversion(model);
    mixinPurchaseItem(model, "orderQuantity");
    model.onChanged("orderQuantity", calcQuantity);
    model.onChanged("ratio", handleReadOnly);
    model.onChanged("ratio", calcQuantity);
    model.onLoad(handleReadOnly);

    return model;
}

catalog.registerModel("PlannedPurchase", plannedPurch);

plannedPurch.static().checkConvert = (s) => s.length;
plannedPurch.static().convert = function (viewModel, pFeather) {
    let dialog = viewModel.confirmDialog();
    let theModel = f.createModel("ConvertPlannedPurchaseOptions");
    let vm = f.createViewModel("FormWidget", {
        config: convOptsForm,
        containerId: dialog.ids().dialog,
        id: f.createId(),
        isScrollable: false,
        model: theModel,
        outsideElementIds: [
            dialog.ids().header,
            dialog.ids().buttonOk
        ],
        style: {minHeight: "260px"}
    });
    let widget = f.getComponent("FormWidget");
    pFeather = (
        typeof pFeather === "string"
        ? pFeather
        : "PurchaseOrder"
    );

    viewModel.selections().some(function (s) {
        if (s.data.supplier()) {
            theModel.data.supplier(s.data.supplier.toJSON());
            return true;
        }
    });

    function onOk() {
        let poId = (
            theModel.data.purchaseOrder()
            ? theModel.data.purchaseOrder().id()
            : null
        );
        let payload = {
            method: "POST",
            path: "/buy/convert-planned-purchase/",
            body: {
                ids: viewModel.selections().map((s) => s.id()),
                supplierId: theModel.data.supplier().id(),
                purchaseOrderId: poId,
                feather: pFeather
            }
        };

        return f.datasource().request(
            payload
        ).then(function (resp) {
            viewModel.refresh();
            m.route.set("/edit/:feather/:key", {
                feather: pFeather,
                key: resp
            }, {state: true});
        }).catch(
            error.bind(null, dialog)
        );
    }

    dialog.content = function () {
        return m(widget, {
            viewModel: vm
        });
    };

    dialog.title("Convert planned purchase");
    dialog.icon("next_plan");
    dialog.onOk(onOk);
    dialog.buttonOk().label("Convert");
    dialog.buttonOk().isDisabled = function () {
        return !vm.model().canSave();
    };
    dialog.buttonOk().title = function () {
        if (!vm.model().canSave()) {
            return vm.model().lastError();
        }
        return "Convert planned purchase(s) to purchase order";
    };
    dialog.show();
};

// Can be used for purchase order, supplier return
function purchaseHeaderMixin(model) {
    let d = model.data;
    let buyer;

    function currencyCode(d) {
        return (
            d.currency()
            ? d.currency().data.code()
            : undefined
        );
    }

    function calculateTotal() {
        let amount;
        let result = f.money(0, currencyCode(d));
        let subtotal = d.subtotal.toJSON().amount;
        let freight = d.freight.toJSON().amount;
        let tax = d.tax.toJSON().amount;

        amount = subtotal.plus(freight).plus(tax);
        result.amount = amount;
        d.total(result);
    }

    function handleReadOnly() {
        let supplier = d.supplier();
        let site = d.site();
        let curr = d.currency();
        let hasLines = true;
        let lines = (
            d.lines
            ? d.lines()
            : false
        );

        if (lines) {
            hasLines = d.lines().reduce(function (total, item) {
                if (item.state().current()[0] !== "/Delete") {
                    return total + 1;
                }

                return total;
            }, 0) > 0;

            lines.canAdd(
                curr &&
                site &&
                supplier
            );
        }

        // Can't change certain info once lines created
        if (supplier) {
            d.supplier.isReadOnly(hasLines);
        }

        if (site) {
            d.site.isReadOnly(hasLines);
        }

        if (curr) {
            d.currency.isReadOnly(hasLines);
        }
    }

    function handleCurrency() {
        let money;
        let curr = currencyCode(d);

        if (curr) {
            money = [
                d.subtotal,
                d.freight,
                d.total
            ];

            money.forEach(function (fn) {
                let ret = f.copy(fn());

                ret.currency = curr;
                fn(ret);
            });
        }

        handleReadOnly();
    }

    function populateSupplierDefaults() {
        let supp = d.supplier().data;

        if (supp) {
            d.currency(supp.currency.toJSON());
            d.terms(supp.terms.toJSON());
            if (supp.contact()) {
                d.contact(supp.contact.toJSON());
            }
        }

        handleReadOnly();
    }

    function renumber() {
        let nr = 0;

        d.lines().forEach(function (row) {
            nr += 1;
            row.data.line.state().send("silence");
            row.data.line(nr);
            row.data.line.state().send("report");
        });
    }

    model.onChanged("subtotal", calculateTotal);
    model.onChanged("freight", calculateTotal);
    model.onChanged("tax", calculateTotal);
    model.onChanged("currency", handleCurrency);
    model.onChanged("site", handleReadOnly);
    model.onChanged("lines", renumber);
    model.onChanged("lines.line", renumber);
    model.onChange("lines.amount", function (prop) {
        let result = f.money(0, currencyCode(d));

        result.amount = d.subtotal.toJSON().amount.minus(
            prop.oldValue.toJSON().amount
        ).plus(
            prop.newValue.toJSON().amount
        );

        d.subtotal(result);
    });

    model.onChanged("lines", handleReadOnly);

    model.onValidate(function () {
        if (d.lines && !d.lines().length) {
            throw "At least one line item is required";
        }

        if (d.lines && d.lines().some(function (line) {
            return line.data.ordered.toJSON() <= 0;
        })) {
            throw "Line quantities must be greater than zero.";
        }
    });

    model.onChanged("supplier", populateSupplierDefaults);
    model.onLoad(handleReadOnly);
    model.onLoad(function () {
        if (d.status() === "C") {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
    });

    // Initialize
    handleReadOnly();

        // Default buyer to current user if applicable
    buyer = catalog.store().data().employees().find(
        (b) => b.data.userAccount() === f.currentUser().name
    );
    if (buyer) {
        model.data.buyer(buyer);
    }

    d.buyer.filter().criteria.push({
        property: "isBuyer",
        value: true
    }, {
        property: "isActive",
        value: true
    });
}

catalog.register("mixins", "purchaseHeaderMixin", purchaseHeaderMixin);

/**
    Purchase order model
*/
function purchaseOrder(data, feather) {
    feather = feather || catalog.getFeather("PurchaseOrder");
    let model = f.createModel(data, feather);
    let d = model.data;

    purchaseHeaderMixin(model);

    function handleMovable() {
        if (d.lines) {
            d.lines().canMove(
                d.lines().every((l) => (
                    l &&
                    !l.data.allocated.toJSON() &&
                    !l.data.received.toJSON() &&
                    l.data.status() !== "C"
                ))
            );
        }
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "P":
                return "pending";
            case "A":
                return "start";
            case "R":
                return "package_2";
            case "B":
                return "arrow_forward";
            case "C":
                return "check_circle";
            }
        }
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "B":
            return "Back ordered";
        case "R":
            return "Receiving";
        case "C":
            return "Closed";
        }
    };

    model.onChanged("supplier", function () {
        let supp = model.data.supplier();

        if (supp) {
            d.shipMethod(supp.data.shipMethod.toJSON());
            d.incoTerms(supp.data.incoTerms.toJSON());
        }
    });

    model.onChanged("site", function () {
        let site = model.data.site();

        if (site) {
            if (site.data.address()) {
                let shipTo = site.data.address.toJSON();
                shipTo.id = f.createId();
                d.shipTo(shipTo);
            }
            if (site.data.billTo()) {
                let billTo = site.data.billTo.toJSON();
                billTo.id = f.createId();
                d.billTo(billTo);
            }
        }
    });
    model.onChanged("plannedDelivery", function () {
        if (!d.plannedDelivery()) {
            return;
        }
        d.lines().forEach(function (ln) {
            ln.data.plannedDelivery(d.plannedDelivery.toJSON());
        });
    });
    model.onChanged("confirmedDelivery", function () {
        if (!d.confirmedDelivery()) {
            return;
        }
        d.lines().forEach(function (ln) {
            ln.data.confirmedDelivery(d.confirmedDelivery.toJSON());
        });
    });
    model.onChanged("changedDelivery", function () {
        if (!d.changedDelivery()) {
            return;
        }
        d.lines().forEach(function (ln) {
            ln.data.changedDelivery(d.changedDelivery.toJSON());
        });
    });
    model.onLoad(function () {
        if (d.status() === "S") {
            d.site.isReadOnly(true);
            if (d.lines) {
                d.lines().forEach(function (line) {
                    line.data.item.isReadOnly(true);
                    line.data.site.isReadOnly(true);
                });
            }
        } else if (d.status() === "C") {
            model.state().send("freeze");
        }
        handleMovable();
    });

    model.onCopy(function () {
        d.status("P");
        d.orderDate(f.today());
        d.plannedDelivery(f.today());
        d.confirmedDelivery(null);
        d.changedDelivery(null);
        d.isPrinted(false);
        d.printTime(null);
        d.printedBy("");
        d.lines().forEach(function (ln) {
            ln.data.status("P");
            ln.data.received(0);
            ln.data.backOrdered(0);
            ln.data.quantity(
                ln.data.ordered.toJSON().times(ln.data.ratio.toJSON())
            );
            ln.data.components().forEach(function (co) {
                co.data.status("P");
                co.data.received(0);
                co.data.backOrdered(0);
                co.data.quantity(co.data.ordered.toJSON());
            });
        });
    });

    model.onCanDelete(function () {
        return d.status() === "P";
    });

    return model;
}

purchaseOrder.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("PurchaseOrder", purchaseOrder);

purchaseOrder.static({
    checkActive: function (selections) {
        return selections.some(
            (model) => (
                model.isReadyClean() &&
                model.data.status() === "A"
            )
        );
    },
    checkPending: function (selections) {
        let buySettings = catalog.store().models().buySettings();
        let action = buySettings.data.onRelease();
        let found = selections.filter(
            (model) => (
                model.isReadyClean() &&
                model.data.status() === "P"
            )
        );
        if (action === "O") { // Browser disallows opening multiple tabs
            return found.length === 1;
        }
        return found.length > 0;
    },
    checkNotClosed: function (selections) {
        return selections.some(
            (model) => (
                model.isReadyClean() &&
                model.data.status() !== "C"
            )
        );
    },
    unrelease: function (viewModel) {
        let ary = viewModel.selections().filter(
            (s) => (s.isReadyClean() && s.data.status() === "A")
        ).map((s) => s.id());

        f.datasource().request({
            method: "POST",
            path: "/buy/change-purchase-order-status",
            body: {ids: ary, status: "P"}
        }).then(success).catch(error);
    },
    close: function (viewModel) {
        let ary = viewModel.selections().filter(
            (s) => (s.isReadyClean() && s.data.status() !== "C")
        ).map((s) => s.id());

        f.datasource().request({
            method: "POST",
            path: "/buy/change-purchase-order-status",
            body: {ids: ary, status: "C"}
        }).then(success).catch(error);
    },
    checkReceive: function (selections) {
        return (
            selections.length === 1 &&
            selections.every(
                (s) => (
                    s.isReadyClean() &&
                    (
                        s.data.status() === "A" ||
                        s.data.status() === "B"
                    )
                )
            )
        );
    },
    receive: function (viewModel) {
        let instances = catalog.register("instances");
        let recv = catalog.store().models().purchaseOrderReceipt();
        let po = viewModel.selections()[0];

        recv.data.purchaseOrder({
            id: po.id(),
            number: po.data.number(),
            status: po.data.status(),
            lines: po.data.lines.toJSON(),
            site: po.data.site(),
            supplier: po.data.supplier()
        });

        // Register so next page knows about it
        instances[recv.id()] = recv;
        // Launch shipment page
        m.route.set("/edit/:feather/:key", {
            feather: "PurchaseOrderReceipt",
            key: recv.id()
        }, {
            state: {create: false}
        });
    }
});

function doPrint(models, dialog, mode) {
    return new Promise(function (resolve, reject) {
        let buySettings = catalog.store().models().buySettings();
        let form = buySettings.data.purchaseOrder();
        let payload;
        let requests = [];
        let now = new Date();
        let file = (
            models.length === 1
            ? models[0].data.number() + " " + f.now()
            : undefined
        );

        if (!form) {
            error(dialog, {message: (
                "Form name for purchase order " +
                "must be defined in settings."
            )});
            return;
        }

        payload = {
            method: "POST",
            path: "/do/print-pdf/form/",
            body: {
                ids: models.map((i) => i.id()),
                form: form.data.name(),
                filename: file
            }
        };

        function updatePrintStatus() {
            return new Promise(function (resolve, reject) {
                let prequests = [];
                models.forEach(function (model) {
                    model.data.isPrinted(true);
                    model.data.printTime(new Date());
                    model.data.printedBy(f.currentUser().name);
                    prequests.push(model.save());
                });
                Promise.all(prequests).then(resolve).catch(reject);
            });
        }

        function confirm() {
            return new Promise(function (resolve, reject) {
                dialog.message("Did the purchase order(s) print correctly?");
                dialog.title("Confirm print");
                dialog.icon("help_outline");
                dialog.onOk(resolve);
                dialog.onCancel(function () {
                    reject(new Error("Print cancelled"));
                });
                dialog.buttonOk().label("Yes");
                dialog.buttonCancel().label("No");
                dialog.show();
            });
        }

        function printPdf(resp) {
            return new Promise(function (resolve, reject) {
                let url = (
                    location.protocol + "//" +
                    location.hostname + ":" +
                    location.port +
                    location.pathname
                );
                let e;

                switch (mode) {
                case "O":
                    url += "pdf/" + resp;
                    window.open(url);
                    resolve();
                    break;
                case "D":
                    e = document.createElement("a");
                    e.setAttribute("href", "files/downloads/" + resp);
                    e.setAttribute("download", resp);
                    e.style.display = "none";
                    document.body.appendChild(e);
                    e.click();
                    document.body.removeChild(e);
                    resolve();
                    break;
                default:
                    url += "pdf/" + resp;
                    printJS({
                        onPrintDialogClose: function () {
                            confirm().then(resolve).catch(reject);
                        },
                        printable: url
                    });
                }
            });
        }

        function handleOneByOne(resp) {
            return new Promise(function (resolve, reject) {

                function next() {
                    if (resp.length) {
                        printPdf(resp.shift()).then(next).catch(reject);
                        return;
                    }
                    resolve();
                }
                next();
            });
        }

        if (mode === "E") { // Email
            let ord = models[0];
            let doc = "Purchase Order";
            let d = models[0].data;
            let mailText = buySettings.data.mailText();

            if (
                !ord.data.contact() ||
                !ord.data.contact().data.email()
            ) {
                reject(new Error("No contact email to send " + doc + " to"));
                return;
            }

            f.sendMail({
                message: {
                    to: d.contact().data.email(),
                    subject: doc + ": " + d.number(),
                    text: mailText
                },
                pdf: {
                    form: form.data.name(),
                    ids: ord.id(),
                    filename: (
                        ord.data.number() + " " +
                        now.toLocalDate() + " " +
                        now.getHours() +
                        now.getMinutes()
                    )
                }
            }, dialog).then(resolve).catch(function (err) {
                error(dialog, err);
                reject();
            });
        } else if (mode === "D" || mode === "O") { // Separate file for each P/O
            models.forEach(function (mdl) {
                let lpay = f.copy(payload);
                lpay.body.ids = [mdl.id()];
                lpay.body.filename = (
                    mdl.data.number() + " " +
                    now.toLocalDate() + " " +
                    now.getHours() +
                    now.getMinutes()
                );
                requests.push(f.datasource().request(lpay));
            });

            Promise.all(requests).then(
                handleOneByOne
            ).then(
                updatePrintStatus
            ).then(
                resolve
            ).catch(reject);
        } else {
            f.datasource().request(payload).then(
                printPdf
            ).then(
                updatePrintStatus
            ).then(
                resolve
            ).catch(reject);
        }
    });
}

purchaseOrder.static().release = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections().filter(function (model) {
        if (model.isReadyClean() && model.data.status() === "P") {
            return model;
        }
    });

    function print() {
        return new Promise(function (resolve, reject) {
            let buySettings = catalog.store().models().buySettings();
            let action = buySettings.data.onRelease();

            if (action && action !== "N") {
                doPrint(
                    models,
                    dialog,
                    action
                ).then(resolve).catch(function () {
                    reject({message: (
                        "Release cancelled due to incomplete print"
                    )});
                });
                return;
            }

            resolve();
        });
    }

    function release() {
        let ary = models.map((s) => s.id());

        f.datasource().request({
            method: "POST",
            path: "/buy/change-purchase-order-status",
            body: {ids: ary, status: "A"}
        }).then(success).catch(error);
    }

    print().then(
        release
    ).catch(
        error.bind(null, viewModel.confirmDialog())
    );
};

purchaseOrder.static().send = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        "E"
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

purchaseOrder.static().download = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        "D"
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

purchaseOrder.static().openPdf = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        "O"
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

purchaseOrder.static().print = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog()
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

purchaseOrder.static().checkPrint = function (selections) {
    return (
        selections.length > 0 &&
        selections.every(
            (model) => (
                model.isReadyClean() &&
                !model.data.lock()
            )
        )
    );
};

purchaseOrder.static().checkSend = function (selections) {
    return (
        selections.length === 1 &&
        selections.every(
            (model) => (
                model.isReadyClean() &&
                !model.data.lock()
            )
        )
    );
};

 /**
    Purchase order line model
*/
function purchaseOrderLine(data, feather) {
    feather = feather || catalog.getFeather("PurchaseOrderLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    function currencyCode(d) {
        return (
            d.currency()
            ? d.currency().data.code()
            : undefined
        );
    }

    function calculateAmount() {
        d.amount({
            currency: currencyCode(model.parent().data),
            amount: d.ordered.toJSON().times(d.price.toJSON().amount)
        });
    }

    function calculateQuantity() {
        let qty = d.ordered.toJSON().times(d.ratio.toJSON()).minus(
            d.received.toJSON()
        );

        if (d.item() && !d.item().data.isFractional()) {
            qty = Math.ceil(qty);
        }

        d.quantity(qty);
        d.components().forEach(function (c) {
            let ord = d.ordered.toJSON().times(
                c.data.quantityPer.toJSON()
            ).plus(
                c.data.fixedQuantity.toJSON()
            );
            let cqty = ord.times(
                c.data.ratio.toJSON()
            ).minus(
                c.data.received.toJSON()
            );
            if (c.data.item().data.isFractional()) {
                cqty = Math.ceil(cqty);
            }
            c.data.ordered(ord);
            c.data.quantity(cqty);
        });
    }

    function handleAliases() {
        let item = d.item();
        let uom = item.data.unit().data.code();

        if (item) {
            d.shipped.alias(`Shipped (${uom})`);
            d.quantity.alias(`Remaining (${uom})`);
            d.received.alias(`Received (${uom})`);
            d.backOrdered.alias(`Back Ordered (${uom})`);
        }
    }

    function handleReadOnly() {
        let item = d.item();
        let ordered = d.ordered();
        let canChg;

        if (item) {
            canChg = d.received.toJSON() ||
            d.allocated.toJSON() ||
            (d.components && d.components().length && (
                d.components().some(
                    (mtl) => (
                        mtl &&
                        (
                            mtl.data.allocated.toJSON() ||
                            mtl.data.issued.toJSON()
                        )
                    )
                )
            ));
            d.item.isReadOnly(canChg);
        }
        if (ordered) {
            d.ordered.isReadOnly(d.status() === "C");
        }
    }

    function handleMovable() {
        if (d.components) {
            d.components().canMove(
                d.components().every(
                    (l) => (
                        l &&
                        !l.data.allocated.toJSON() &&
                        !l.data.received.toJSON() &&
                        l.data.status() !== "C"
                    )
                )
            );
        }
    }

    mixinItemConversion(model);
    mixinPurchaseItem(model);
    model.parent.state().resolve("/Changing").exit(function () {
        if (
            model.data.status() === "U" &&
            model.parent() &&
            model.parent().data.status()
        ) {
            let sts = model.parent().data.status();
            if (sts === "B") {
                model.data.status("A");
            } else {
                model.data.status(sts);
            }
        }
    });

    function loadBom() {
        d.components().clear();

        if (!d.item() || d.item().data.type() !== "K") {
            return;
        }

        function callback(bom) {
            if (!bom) {
                return;
            }
            bom.forEach(function (row) {
                d.components().add({
                    item: row.item,
                    site: model.parent().data.site.toJSON(),
                    ordered: d.ordered.toJSON().times(
                        row.quantityPer
                    ).plus(
                        row.fixedQuantity
                    ),
                    unit: row.unit,
                    quantityPer: row.quantityPer,
                    fixedQuantity: row.fixedQuantity,
                    ratio: row.ratio,
                    quantity: d.ordered.toJSON().times(
                        row.quantityPer
                    ).plus(
                        row.fixedQuantity
                    ).times(
                        row.ratio
                    ),
                    startDate: f.today(),
                    dueDate: d.dueDate(),
                    status: d.status(),
                    priority: d.priority()
                });
            });
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-bom",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "P":
                return "pending";
            case "A":
                return "start";
            case "B":
                return "arrow_forward";
            case "C":
                return "check_circle";
            }
        }
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "B":
            return "Back ordered";
        case "C":
            return "Closed";
        }
    };

    model.onLoad(function () {
        handleAliases();
        handleReadOnly();
        handleMovable();
        if (d.status() === "C") {
            model.state().send("freeze");
        }
    });
    model.onChanged("item", handleAliases);
    model.onChanged("item", loadBom);

    model.onChange("ordered", function (p) {
        if (p.newValue() < 0 || !d.item()) {
            p.newValue(p.oldValue());
        }

        if (!d.item().data.isFractional()) {
            p.newValue(Math.ceil(p.newValue()));
        }
    });

    model.onChanged("ordered", calculateQuantity);
    model.onChanged("ratio", calculateQuantity);
    model.onChanged("ordered", calculateAmount);
    model.onChanged("price", calculateAmount);
    model.onValidate(function () {
        if (!d.site()) {
            throw "Item is not available at purchase order site";
        }

        if (d.ordered.toJSON() < d.received.toJSON()) {
            throw "Ordered quantity cannot be less than already received";
        }
    });

    model.state().resolve("/Delete").enter(function () {
        d.amount.state().send("enable");
        d.amount({
            currency: currencyCode(model.parent().data),
            amount: 0
        });
        d.amount.state().send("disable");
    });
    model.state().resolve("/Delete").exit(calculateAmount);

    model.onCanDelete(() => !d.received.toJSON());

    d.item.filter().criteria.push({
        property: "status",
        value: "A"
    }, {
        property: "source",
        value: "P"
    });
    d.item.filter().sort.push({
        property: "number"
    });

    return model;
}

purchaseOrderLine.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("PurchaseOrderLine", purchaseOrderLine);

/**
    Purchase order receipt model
*/
function purchaseOrderReceipt(data, feather) {
    feather = feather || catalog.getFeather("PurchaseOrderReceipt");
    let model = f.createModel(data, feather);
    let d = model.data;
    let po = f.prop();

    function handleReadOnly() {
        d.purchaseOrder.isReadOnly(true);
        if (d.status() === "R") {
            model.state().send("freeze");
        }
    }

    function populateLines() {
        let n = 1;

        d.lines().clear();

        if (po()) {
            po().lines.forEach(function (line) {
                if (
                    line.quantity > 0
                ) {
                    d.lines().add({
                        line: n,
                        purchaseOrderLine: line,
                        item: line.item
                    });
                    n += 1;
                }
            });
        }
    }


    function loadPurchaseOrder() {
        po(undefined);

        if (!d.purchaseOrder()) {
            return;
        }

        function callback(resp) {
            if (!resp) {
                return;
            }
            po(resp);

            if (resp) {
                if (
                    po().status !== "A" &&
                    po().status !== "B"
                ) {
                    return;
                }

                d.site(po().site);
                populateLines();
            }
        }

        f.datasource().request({
            body: {id: d.purchaseOrder().id()},
            method: "POST",
            path: "/buy/get-purchase-order-receipt-data"
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("purchaseOrder", loadPurchaseOrder);
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let status = (
            d.purchaseOrder()
            ? d.purchaseOrder().data.status()
            : false
        );

        if (status === "P") {
            throw (
                "Purchase order is in status " +
                "\"Pending\" and cannot be received"
            );
        }

        if (model.state().current()[0] === "/Ready/New") {
            if (status === "R") {
                throw (
                    "Purchase order already has a pending receipt."
                );
            }

            if (status === "C") {
                throw (
                    "Purchase order is closed."
                );
            }
        }
    });

    d.purchaseOrder.filter().criteria.push({
        property: "status",
        operator: "IN",
        value: ["A", "B"]
    });

    return model;
}

catalog.registerModel("PurchaseOrderReceipt", purchaseOrderReceipt);

purchaseOrderReceipt.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let ary = viewModel.selections().filter(
        (s) => s.data.status() === "P"
    ).map((s) => s.id());
    let payload = {
        method: "POST",
        path: "/buy/post-purchase-order-receipts",
        body: {ids: ary}
    };

    f.datasource().request(payload).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

purchaseOrderReceipt.static().postCheck = function (selections) {
    return selections.some((sel) => sel.data.status() === "P");
};

/**
   Purchase Order Receipt line
*/
function poReceiptLine(data, feather) {
    feather = feather || catalog.getFeather("PurchaseOrderReceiptLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    /*
        A list that shows a few columns of receipt lines on its own, as
        the purchasing drill-down does, builds this model without the
        properties the receipt form works with -- no details, no order
        line -- and there is nothing to wire up for a row that is only
        being read.
    */
    if (!d.details || !d.purchaseOrderLine) {
        return model;
    }

    function handleDefaultRow() {
        let site = model.parent().data.site();
        let item = d.item();
        if (
            (
                item.data.trace() !== "N" ||
                site.data.locationControlled()
            ) &&
            !d.details().length &&
            d.quantity.toJSON() > 0
        ) {
            d.details().add({
                location: site.data.defaultReceiveLocation.toJSON()
            });
        }
    }

    function handleReceiptQty() {
        if (d.details().length === 1) {
            d.details()[0].data.quantity(d.quantity());
        }
    }

    function handleDetailsQty() {
        let qty = 0;

        d.details().forEach(function (row) {
            if (row.state().current()[0] !== "/Delete") {
                qty = qty.plus(row.data.quantity.toJSON());
            }
        });

        d.quantity(qty);
    }

    function handleDetailsReadOnly() {
        let pol = d.purchaseOrderLine();
        let site;
        let item;
        let hasTrace;
        let hasLoc;

        if (!pol) {
            return;
        }

        site = model.parent().data.site();
        item = d.item();
        hasTrace = item.data.trace() !== "N";
        hasLoc = site.data.locationControlled();
        d.quantity.isReadOnly(d.details().length > 1);

        d.details().forEach(function (row) {
            row.data.trace.isReadOnly(!hasTrace);
            row.data.trace.isRequired(hasTrace);
            row.data.location.isReadOnly(!hasLoc);
            row.data.location.isRequired(hasLoc);
        });

        if (
            model.parent().data.status() === "P" &&
            (
                site.data.locationControlled() ||
                item.data.trace() !== "N"
            )
        ) {
            d.details().canAdd(true);
        } else {
            d.details().canAdd(false);
        }
    }

    d.details().canAdd(false);
    model.onChange("quantity", function (p) {
        let item = d.item();

        if (p.newValue() < 0 || !item) {
            p.newValue(p.oldValue());
        }

        if (item && !item.data.isFractional()) {
            p.newValue(Math.ceil(p.newValue()));
        }
    });
    model.onChanged("purchaseOrderLine", handleDetailsReadOnly);
    model.onChanged("purchaseOrderLine", handleDefaultRow);
    model.onChanged("details", handleDetailsReadOnly);
    model.onChanged("details", handleDetailsQty);
    model.onChanged("quantity", handleDefaultRow);
    model.onChanged("quantity", handleReceiptQty);
    model.parent.state().substateMap.Changing.exit(handleDetailsReadOnly);
    model.onLoad(handleDetailsReadOnly);
    model.onChanged("details.quantity", handleDetailsQty);

    model.onValidate(function () {
        let item = d.item();

        if (!item) {
            return;
        }

        if (
            d.quantity.toJSON() > 0 &&
            !d.details().length &&
            (
                model.parent().data.site().data.locationControlled() ||
                item.data.trace() !== "N"
            )
        ) {
            throw "Receipt line must include detail records";
        }

        d.details().forEach(function (row) {
            if (row.data.quantity() <= 0) {
                throw "Detail records must have positive quantity.";
            }
        });
    });

    model.addCalculated({
        name: "toReceive",
        description: "Remaining to receive in purchase unit of measure",
        type: "number",
        function: function () {
            let pol = d.purchaseOrderLine();
            if (pol) {
                return pol.data.ordered.toJSON().minus(
                    pol.data.received.toJSON()
                );
            }
            return 0;
        }
    });

    return model;
}

poReceiptLine.calculated = f.prop({
    toReceive: {
        type: "number",
        description: "Remaining to receive in purchase unit of measure"
    }
});

catalog.registerModel("PurchaseOrderReceiptLine", poReceiptLine);

poReceiptLine.static().checkRecieveAll = function (ignore, viewModel) {
    return viewModel.parentViewModel().model().data.purchaseOrder();
};

poReceiptLine.static().receiveAll = function (viewModel) {
    viewModel.parentViewModel().model().data.lines().forEach(function (l) {
        l.data.quantity(
            l.data.purchaseOrderLine().data.ordered.toJSON().minus(
                l.data.purchaseOrderLine().data.received.toJSON()
            )
        );
    });
};

/* -------------------------------------------------------------------------
    Dashboard: purchasing tiles, Key Metrics and due dates.

    Tiles read bi.purchase_daily through the shared tile service
    (common/do-get-bi-tile-data.js); Refresh rebuilds it. KPIs come from
    /buy/get-purchase-kpis, the histogram from /buy/get-purchase-schedule.
------------------------------------------------------------------------- */
const DASH_BUY_MEASURES = {
    ordered: "Ordered",
    purchased: "Purchased"
};

const DASH_BUY_DIMENSIONS = {
    item: "product",
    itemCategory: "product category",
    itemGroup: "product group",
    site: "site",
    supplier: "supplier"
};

const DASH_BUY_WINDOWS = {
    MTD: "Month to date",
    QTD: "Quarter to date",
    WTD: "Week to date",
    YTD: "Year to date"
};

const DASH_BUY_COMPARISONS = {
    none: "",
    priorPeriod: "prior period",
    priorYear: "prior year"
};

let dashBuyMoney;
let dashBuyCompact;

// Base currency: the rollup sums base amounts. Read late, once loaded.
function dashBuyCurrency() {
    try {
        return f.baseCurrency().data.code();
    } catch (ignore) {
        return "USD";
    }
}

function dashBuyAmount(value) {
    if (!dashBuyMoney) {
        dashBuyMoney = new Intl.NumberFormat(undefined, {
            currency: dashBuyCurrency(),
            maximumFractionDigits: 0,
            style: "currency"
        });
    }
    return dashBuyMoney.format(Number(value));
}

function dashBuyShort(value) {
    if (!dashBuyCompact) {
        dashBuyCompact = new Intl.NumberFormat(undefined, {
            currency: dashBuyCurrency(),
            maximumFractionDigits: 1,
            notation: "compact",
            style: "currency"
        });
    }
    return dashBuyCompact.format(Number(value));
}

function dashBuyUnits(value) {
    return Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 0
    });
}

const DASH_BUY_FORMAT = {
    amount: dashBuyAmount,
    compact: dashBuyShort,
    units: dashBuyUnits
};

function dashBuyChoices(labels) {
    return Object.keys(labels).sort().map(function (key) {
        let said = labels[key];

        return {
            value: key,
            label: said.slice(0, 1).toUpperCase() + said.slice(1)
        };
    });
}

function dashBuyOptions() {
    return [{
        key: "measure",
        label: "Measure",
        choices: dashBuyChoices(DASH_BUY_MEASURES),
        default: "purchased"
    }, {
        key: "dimension",
        label: "Grouped by",
        choices: dashBuyChoices(DASH_BUY_DIMENSIONS),
        default: "supplier"
    }, {
        key: "window",
        label: "Period",
        choices: dashBuyChoices(DASH_BUY_WINDOWS),
        default: "YTD"
    }, {
        key: "comparison",
        label: "Compared with",
        choices: [
            {value: "priorYear", label: "Prior year"},
            {value: "priorPeriod", label: "Prior period"},
            {value: "none", label: "Nothing"}
        ],
        default: "priorYear"
    }, {
        key: "limit",
        label: "Show",
        choices: [
            {value: "0", label: "All"},
            {value: "5", label: "Top 5"},
            {value: "10", label: "Top 10"},
            {value: "20", label: "Top 20"}
        ],
        default: "0"
    }, {
        key: "sort",
        label: "Order",
        choices: [
            {value: "amount", label: "Largest first"},
            {value: "name", label: "By name"}
        ],
        default: "amount"
    }, {
        key: "showUnits",
        label: "Also show",
        choices: [
            {value: "", label: "Nothing else"},
            {value: "true", label: "Units"}
        ],
        default: ""
    }];
}

function dashBuyHeading(tile) {
    let dimension = (
        DASH_BUY_DIMENSIONS[tile.dimension] ||
        DASH_BUY_DIMENSIONS.supplier
    );
    let measure = (
        DASH_BUY_MEASURES[tile.measure] ||
        DASH_BUY_MEASURES.purchased
    );
    let limit = Number(tile.limit) || 0;
    let said = measure + " " + (tile.window || "YTD") + " by " + dimension;

    if (limit > 0) {
        said = "Top " + limit + ": " + said;
    }
    return said;
}

function dashBuyLoad(tile) {
    return f.datasource().request({
        method: "POST",
        path: "/common/get-bi-tile-data",
        body: {
            asOf: tile.asOf || null,
            comparison: tile.comparison || "priorYear",
            dimension: tile.dimension || "supplier",
            fact: "purchase",
            limit: tile.limit || 0,
            measure: tile.measure || "purchased",
            sort: tile.sort || "amount",
            sparkline: (
                (tile.showSpark || tile.display === "multiples")
                ? 12
                : 0
            ),
            window: tile.window || "YTD"
        }
    }).then(function (data) {
        return Object.assign({
            comparisonLabel: DASH_BUY_COMPARISONS[data.comparison]
        }, data);
    });
}

// One request per reporting date answers every purchasing KPI; the slot
// clears when it settles, so it de-dupes a tick and caches nothing.
let dashBuyKpiAsOf;
let dashBuyKpiPending;

function dashBuyKpiFetch(asOf) {
    let key = asOf || "";

    if (dashBuyKpiPending && dashBuyKpiAsOf === key) {
        return dashBuyKpiPending;
    }
    dashBuyKpiAsOf = key;
    dashBuyKpiPending = f.datasource().request({
        method: "POST",
        path: "/buy/get-purchase-kpis",
        body: {asOf: asOf || null}
    }).then(function (answer) {
        dashBuyKpiPending = undefined;
        return answer;
    }, function (err) {
        dashBuyKpiPending = undefined;
        return Promise.reject(err);
    });
    return dashBuyKpiPending;
}

function dashBuyKpiLoad(key) {
    return function (context) {
        let at = (context && context.asOf) || null;
        let said = (
            (at && typeof at.toISOString === "function")
            ? at.toISOString().slice(0, 10)
            : at
        );

        return dashBuyKpiFetch(said).then(function (answer) {
            let all = answer.kpis || {};

            // Figures for another date are worse than none.
            if (said && answer.asOf && answer.asOf !== said) {
                return {value: null};
            }
            return all[key] || {value: null};
        });
    };
}

/* -------------------------------------------------------------------------
    Drill-down: the records behind a purchasing figure.

    The two measures come from different records, so they list different
    things:

      Ordered    purchase order lines, by their order's order date. The
                 line amounts are what the rollup sums, so the footer
                 totals to the figure clicked.
      Purchased  the receipt lines posted in the window, by receipt
                 date. Each carries its own value, set when the receipt
                 posted and what the rollup adds up, so the footer
                 totals to the figure clicked.

    Shaped on the Sell workbook's "Sales Line Backlog" worksheet rather
    than referring to it: a drill-down that pointed at a worksheet would
    break the first time somebody reconfigured or deleted it.
------------------------------------------------------------------------- */
const DASH_BUY_LINE_COLUMNS = [
    {attr: "dueDate", width: 113},
    {attr: "number", width: 97},
    {attr: "item", width: 0},
    {attr: "site", width: 54},
    {attr: "purchaseOrder.supplier", width: 119},
    {attr: "amount", width: 96},
    {attr: "status", width: 94}
];

const DASH_BUY_RECEIPT_COLUMNS = [
    {
        attr: "purchaseOrderReceipt.receiptDate",
        label: "Receipt Date",
        width: 113
    },
    {attr: "purchaseOrderReceipt", label: "Receipt", width: 97},
    {attr: "item", width: 0},
    {attr: "quantity", width: 84},
    {attr: "amount", width: 110}
];

/*
    Which property stands for each dimension a tile can be grouped by. A
    dimension that is not here cannot be drilled into: a list that
    quietly showed the wrong records would be worse than a row that does
    not respond.
*/
const DASH_BUY_LINE_BY = {
    item: "item",
    itemCategory: "item.category",
    itemGroup: "item.group",
    site: "site",
    supplier: "purchaseOrder.supplier"
};

const DASH_BUY_RECEIPT_BY = {
    item: "item",
    itemCategory: "item.category",
    itemGroup: "item.group",
    site: "purchaseOrderReceipt.site",
    supplier: "purchaseOrderReceipt.purchaseOrder.supplier"
};

// The window the tile is showing, as the first and last day it counts.
// Same arithmetic as the rollup's date_trunc, done here so the list and
// the tile cannot drift apart.
function dashBuyRange(tile) {
    let asOf = (
        tile.asOf
        ? new Date(String(tile.asOf) + "T00:00:00")
        : new Date()
    );
    let year = asOf.getFullYear();
    let start;

    switch (tile.window || "YTD") {
    case "WTD":
        start = new Date(asOf);
        start.setDate(asOf.getDate() - asOf.getDay());
        break;
    case "MTD":
        start = new Date(year, asOf.getMonth(), 1);
        break;
    case "QTD":
        start = new Date(year, Math.floor(asOf.getMonth() / 3) * 3, 1);
        break;
    default:
        start = new Date(year, 0, 1);
    }

    function said(when) {
        let month = String(when.getMonth() + 1).padStart(2, "0");
        let day = String(when.getDate()).padStart(2, "0");

        return when.getFullYear() + "-" + month + "-" + day;
    }

    return {first: said(start), last: said(asOf)};
}

function dashBuyColumns(columns) {
    return columns.map(function (col) {
        return Object.assign({label: ""}, col);
    });
}

function dashBuyOrderedDrill(tile, row, span) {
    let property = DASH_BUY_LINE_BY[tile.dimension || "supplier"];

    if (!property) {
        return null;
    }
    return {
        feather: "PurchaseOrderLine",
        icon: "shopping_cart",
        title: (
            "Ordered " + (tile.window || "YTD") + ": " +
            (row.label || row.key)
        ),
        config: {
            aggregates: [
                {property: "amount.amount", method: "SUM"},
                {property: "number", method: "COUNT"}
            ],
            columns: dashBuyColumns(DASH_BUY_LINE_COLUMNS),
            filter: {
                criteria: [{
                    property: "purchaseOrder.orderDate",
                    operator: ">=",
                    value: span.first
                }, {
                    property: "purchaseOrder.orderDate",
                    operator: "<=",
                    value: span.last
                }, {
                    property: property + ".id",
                    value: row.key
                }],
                sort: [{property: "dueDate"}, {property: "number"}]
            }
        }
    };
}

function dashBuyPurchasedDrill(tile, row, span) {
    let property = DASH_BUY_RECEIPT_BY[tile.dimension || "supplier"];

    if (!property) {
        return null;
    }
    return {
        feather: "PurchaseOrderReceiptLine",
        icon: "inventory_2",
        title: (
            "Purchased " + (tile.window || "YTD") + ": " +
            (row.label || row.key)
        ),
        config: {
            aggregates: [
                {property: "amount.amount", method: "SUM"},
                {property: "quantity", method: "SUM"}
            ],
            columns: dashBuyColumns(DASH_BUY_RECEIPT_COLUMNS),
            filter: {
                criteria: [{
                    property: "purchaseOrderReceipt.status",
                    value: "R"
                }, {
                    property: "purchaseOrderReceipt.receiptDate",
                    operator: ">=",
                    value: span.first
                }, {
                    property: "purchaseOrderReceipt.receiptDate",
                    operator: "<=",
                    value: span.last
                }, {
                    property: property + ".id",
                    value: row.key
                }],
                sort: [
                    {property: "purchaseOrderReceipt.receiptDate"},
                    {property: "purchaseOrderReceipt.number"}
                ]
            }
        }
    };
}

function dashBuyDrill(tile, row) {
    let span = dashBuyRange(tile);

    /*
        A row with no key is the rollup's own "everything that did not
        map" bucket; there is no id to filter on, so it does not drill.
    */
    if (!row.key) {
        return null;
    }
    if ((tile.measure || "purchased") === "ordered") {
        return dashBuyOrderedDrill(tile, row, span);
    }
    return dashBuyPurchasedDrill(tile, row, span);
}

/*
    The purchase lines behind a backlog figure: still open (not closed),
    ordered by the reporting date, and for the overdue figure due before
    it. Same limits as the sales backlog list: the footer totals whole
    line amounts where the figure counts only what is still to arrive
    (the Received column shows lines part-received), and on a board
    pinned to a past date a line received since is closed now and not
    listed, though it was backlog on that date.
*/
function dashBuyBacklogDrill(overdueOnly) {
    return function (tile) {
        let asOf = tile.asOf || dashBuyToday();
        let criteria = [{
            property: "status",
            operator: "!=",
            value: "C"
        }, {
            property: "purchaseOrder.orderDate",
            operator: "<=",
            value: asOf
        }];
        let columns = DASH_BUY_LINE_COLUMNS.slice();

        if (overdueOnly) {
            criteria.push({
                property: "dueDate",
                operator: "<",
                value: asOf
            });
        }
        columns.splice(5, 0, {attr: "received", width: 90});

        return {
            feather: "PurchaseOrderLine",
            icon: "shopping_cart",
            title: (
                overdueOnly
                ? "Overdue purchase order lines"
                : "Open purchase order lines"
            ),
            config: {
                aggregates: [
                    {property: "amount.amount", method: "SUM"},
                    {property: "number", method: "COUNT"}
                ],
                columns: dashBuyColumns(columns),
                filter: {
                    criteria,
                    sort: [{property: "dueDate"}, {property: "number"}]
                }
            }
        };
    };
}

// Today, as the board writes a date.
function dashBuyToday() {
    let now = new Date();
    let month = String(now.getMonth() + 1).padStart(2, "0");
    let day = String(now.getDate()).padStart(2, "0");

    return now.getFullYear() + "-" + month + "-" + day;
}

function dashBuyRegister() {
    let globals = catalog.store().global();
    let kpis = [
        {
            key: "buyOnTimeReceipt",
            name: "On-Time Receipt",
            from: "onTimeReceipt",
            better: "higher",
            unit: "percent"
        },
        {
            key: "buyPurchasedYtd",
            name: "Purchased YTD",
            from: "purchasedYtd",
            better: "neither"
        },
        {
            key: "buyPurchasedMtd",
            name: "Purchased MTD",
            from: "purchasedMtd",
            better: "neither"
        },
        {
            key: "buyPurchasedWtd",
            name: "Purchased WTD",
            from: "purchasedWtd",
            better: "neither"
        },
        {
            key: "buyBacklog",
            name: "Purchase Backlog",
            from: "backlog",
            better: "neither",
            drillFor: dashBuyBacklogDrill(false)
        },
        {
            key: "buyOverdueBacklog",
            name: "Overdue Purchase Backlog",
            from: "overdueBacklog",
            better: "lower",
            drillFor: dashBuyBacklogDrill(true)
        }
    ];

    if (globals.dashboardSources) {
        globals.dashboardSources.register({
            key: "purchase",
            module: "SupplyChain",
            name: "Purchasing",
            format: DASH_BUY_FORMAT,
            betterFor: function () {
                return "neither";
            },
            drillFor: dashBuyDrill,
            headingFor: dashBuyHeading,
            options: dashBuyOptions(),
            load: dashBuyLoad
        });
    }

    if (globals.dashboardKpis) {
        kpis.forEach(function (kpi) {
            globals.dashboardKpis.register({
                key: kpi.key,
                module: "SupplyChain",
                group: "Purchasing",
                isStandard: false,
                name: kpi.name,
                better: kpi.better,
                unit: kpi.unit || "money",
                format: function (n) {
                    if (n === null || n === undefined) {
                        return "—";
                    }
                    if (kpi.unit === "percent") {
                        return Number(n).toLocaleString(undefined, {
                            maximumFractionDigits: 1
                        }) + "%";
                    }
                    return dashBuyAmount(n);
                },
                load: dashBuyKpiLoad(kpi.from),
                drillFor: kpi.drillFor
            });
        });
    }

    if (globals.dashboardSchedules) {
        globals.dashboardSchedules.register({
            key: "purchase",
            sequence: 2,
            module: "SupplyChain",
            name: "Purchasing",
            format: DASH_BUY_FORMAT,
            load: function (context) {
                return f.datasource().request({
                    method: "POST",
                    path: "/buy/get-purchase-schedule",
                    body: {
                        asOf: context.asOf || null,
                        bucket: context.bucket
                    }
                });
            }
        });
    }

    if (globals.dashboardRefreshers) {
        globals.dashboardRefreshers.register({
            key: "purchaseBi",
            module: "SupplyChain",
            label: "purchasing figures",
            run: function () {
                return f.datasource().request({
                    method: "POST",
                    path: "/buy/refresh-purchase-bi",
                    body: {}
                });
            },
            describe: function (done) {
                let count = (done && done.buckets) || 0;

                return Number(count).toLocaleString() + " daily totals";
            }
        });
    }
}

dashBuyRegister();
