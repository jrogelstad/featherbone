/*jslint devel browser this unordered*/
/*global printJS*/
const catalog = f.catalog();
const store = catalog.store();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const printPdf = catalog.register("functions").printPdf;
const taxRate = catalog.store().models().taxRate;
const CURR_SCALE = 2;
const PCT_RATIO = 0.01;

/* Create internal feather for rendering gantt chart */
const ganttTimelineFeather = Object.freeze({
    name: "GantTimelinePlan",
    plural: "GantTimelinePlans",
    description: "Indented plan for Gantt chart timeline",
    isSystem: true,
    properties: {
        description: {
            description: "Description",
            type: "string"
        },
        detail: {
            description: "Plan child detail",
            type: "array"
        },
        dueDate: {
            description: "Due date of work order or material",
            type: "string",
            format: "date"
        },
        feather: {
            description: "Feather used for click through",
            type: "string"
        },
        id: {
            description: "Unique identifier",
            type: "string"
        },
        key: {
            description: "Key used for click through",
            type: "string"
        },
        parent: {
            description: "Parent id",
            type: "string"
        },
        level: {
            description: "Indentation level",
            type: "integer"
        },
        lock: {
            description: "Lock",
            type: "object",
            default: null
        },
        links: {
            description: "Work order dependency links",
            type: "array"
        },
        number: {
            description: "Work order number",
            type: {
                "properties": [
                    "id",
                    "number"
                ],
                relation: "WorkOrder"
            }
        },
        objectType: {
            description: "Object type",
            type: "string"
        },
        percent: {
            description: (
                "Percent of material received, operation " +
                "complete or requirement issued"
            ),
            type: "number"
        },
        route: {
            description: (
                "Navigation route"
            ),
            type: "string"
        },
        startDate: {
            description: "Start date of work order or material",
            type: "string",
            format: "date"
        },
        type: {
            description: "Group, task or milestone",
            type: "string"
        }
    }
});

catalog.register("feathers", "GanttTimeline", ganttTimelineFeather);

/**
    Gantt timeline model
*/
function gtModel(data) {
    return f.createModel(data, ganttTimelineFeather);
}

catalog.registerModel("ganttTimeline", gtModel);

/**
   Customer model
*/
function custModel(data, feather) {
    feather = feather || catalog.getFeather("Customer");
    if (feather.properties.currency) {
        feather.properties.currency.default = f.baseCurrency().toJSON();
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        if (d.shipTo) {
            d.shipTo.isReadOnly(d.billToIsShipto());
        }
    }

    function setShipToAsBillTo() {
        if (d.billToIsShipto()) {
            let sta = d.billTo.toJSON();
            if (d.shipTo()) {
                sta.id = d.shipTo().id();
            } else {
                sta.id = f.createId();
            }
            d.shipTo(sta);
        }
    }

    model.onChanged("billToIsShipto", handleReadOnly);
    model.onChanged("billToIsShipto", setShipToAsBillTo);
    model.onChanged("billTo", setShipToAsBillTo);
    model.onLoad(handleReadOnly);
    return model;
}

catalog.registerModel("Customer", custModel);

// Can be used for sales order, invoice or return
function salesHeaderMixin(model) {
    let d = model.data;
    let sr;
    let loadingTax = false;
    model.custData = f.prop();

    function currencyCode(d) {
        return (
            d.currency()
            ? d.currency().data.code()
            : undefined
        );
    }

    function calculateTaxes() {
        let taxes = d.taxes().filter(
            (t) => t.state().current()[0] !== "/Delete"
        );
        let lines = d.lines().filter((l) => l.data.taxable());
        let curr = d.total.toJSON().currency;
        let shipAmt = d.freight.toJSON().amount;

        taxes.forEach(function (tax) {
            let ttl = lines.reduce(function (t, line) {
                return line.data.amount.toJSON().amount.times(
                    tax.data.percent.toJSON()
                ).times(
                    PCT_RATIO
                ).plus(t);
            }, 0);
            if (tax.data.shippingTaxable()) {
                ttl = shipAmt.times(
                    tax.data.percent.toJSON()
                ).times(PCT_RATIO).plus(ttl);
            }

            tax.data.amount({
                // Math.round takes no scale: it rounded to whole units
                amount: ttl.round(CURR_SCALE),
                currency: curr
            });
        });
    }
    model.onChanged("freight", calculateTaxes);
    model.onChanged("taxes", calculateTaxes);
    model.onChanged("taxes.percent", calculateTaxes);
    model.onChanged("taxes.shippingTaxable", calculateTaxes);
    model.onChanged("lines.taxable", calculateTaxes);
    model.onChanged("lines.amount", calculateTaxes);

    // Handler to load taxes
    async function loadTaxes() {
        let shipTo = d.shipTo();
        let taxes = d.taxes();

        if (loadingTax) {
            return;
        }

        if (!d.taxable() || !shipTo) {
            while (taxes.length) {
                taxes.remove(taxes[0]);
            }
            return;
        }

        loadingTax = true;

        try {
            let resp = await f.datasource().request({
                body: {
                    city: shipTo.data.city(),
                    postalCode: shipTo.data.postalCode(),
                    state: shipTo.data.state()
                },
                method: "POST",
                path: "/sell/get-address-tax-rates"
            });
            while (taxes.length) {
                taxes.remove(taxes[0]);
            }
            resp.forEach(function (row) {
                taxes.add(row);
            });
        } catch (e) {
            console.error(e);
        } finally {
            loadingTax = false;
        }
    }
    model.onChanged("taxable", loadTaxes);
    model.onChanged("shipTo", loadTaxes);

    function calculateTotalTax() {
        let result = f.money(0, currencyCode(d));

        d.taxes().forEach(function (tax) {
            if (tax.state().current()[0] !== "/Delete") {
                result.amount = result.amount.plus(
                    tax.data.amount.toJSON().amount
                );
            }
        });

        d.tax(result);
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

    function handleCurrency() {
        let money;
        let curr = currencyCode(d);

        if (curr) {
            money = [
                d.subtotal,
                d.freight,
                d.tax,
                d.total
            ];

            money.forEach(function (fn) {
                let ret = f.copy(fn());

                ret.currency = curr;
                fn(ret);
            });
        }
    }

    function handleReadOnly() {
        let count;
        let customer = d.customer();
        let hasCurrency = Boolean(d.currency());
        let lines = (
            d.lines
            ? d.lines()
            : false
        );

        // Can't change customer once lines created
        if (customer) {
            if (lines) {
                count = d.lines().reduce(function (total, item) {
                    if (item.state().current()[0] !== "/Delete") {
                        return total + 1;
                    }

                    return total;
                }, 0);

                lines.canAdd(hasCurrency);
            }
            d.customer.isReadOnly(count > 0);
        } else {
            if (lines) {
                lines.canAdd(false);
            }
            d.customer.isReadOnly(false);
        }
    }

    function loadCustomer() {
        model.custData(undefined);

        if (!d.customer()) {
            return;
        }

        function callback(resp) {
            if (!resp || !resp.isActive) {
                return;
            }
            model.custData(resp);

            if (model.custData()) {
                d.currency(model.custData().currency);
                d.terms(model.custData().terms);
                d.contact(model.custData().contact);
                if (model.custData().billTo) {
                    if (d.billTo()) {
                        model.custData().billTo.id = d.billTo().id();
                    } else {
                        model.custData().billTo.id = f.createId();
                    }
                }
                d.billTo(model.custData().billTo);
                d.taxable(model.custData().taxable);
            }

            handleReadOnly();
        }

        f.datasource().request({
            method: "POST",
            path: "/sell/get-customer-data",
            body: {id: d.customer().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("subtotal", calculateTotal);
    model.onChanged("freight", calculateTotal);
    model.onChanged("tax", calculateTotal);
    model.onChanged("currency", handleCurrency);

    function renumber() {
        let nr = 0;

        d.lines().forEach(function (i) {
            nr += 1;
            i.data.line.state().send("silence");
            i.data.line(nr);
            i.data.line.state().send("report");
        });
    }

    if (d.lines) { // We don't manage lines on lists
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
            if (d.lines().length && d.lines().some(function (line) {
                return line.data.ordered.toJSON() <= 0;
            })) {
                throw "Line quantities must be greater than zero.";
            }
        });
    }

    if (d.taxes) { // We don't manage taxes on lists
        model.onChanged("taxes", calculateTotalTax);
        model.onChanged("taxes.amount", calculateTotalTax);
    }

    model.onChanged("customer", loadCustomer);
    model.onLoad(handleReadOnly);
    model.onLoad(function () {
        if (d.status() === "C") {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
    });

    // Initialize
    handleReadOnly();

    // Default sales rep. to current user if applicable
    sr = catalog.store().data().employees().find(
        (s) => s.data.userAccount() === f.currentUser().name
    );
    if (sr) {
        model.data.salesRep(sr);
    }

    d.salesRep.filter().criteria.push({
        property: "isSalesRep",
        value: true
    }, {
        property: "isActive",
        value: true
    });
}

catalog.register("mixins", "salesHeaderMixin", salesHeaderMixin);

function currencyCode(d) {
    return (
        d.currency()
        ? d.currency().data.code()
        : undefined
    );
}

function salesLineMixin(model, priceBasis) {
    let d = model.data;

    function calculateAmount() {
        let discRatio = d.discount.toJSON().times(0.01);
        let price = d.price.toJSON().amount;
        const ONE = 1;

        discRatio = ONE.minus(discRatio);

        d.discountPrice({
            amount: discRatio.times(
                price
            ),
            currency: currencyCode(model.parent().data)
        });
        d.amount({
            amount: d[priceBasis].toJSON().times(
                discRatio
            ).times(
                price
            ).round(CURR_SCALE),
            currency: currencyCode(model.parent().data)
        });
    }

    model.onChanged(priceBasis, calculateAmount);
    model.onChanged("price", calculateAmount);
    model.onChanged("discount", calculateAmount);

    model.state().resolve("/Delete").enter(function () {
        d.amount.state().send("enable");
        d.amount({
            amount: 0,
            currency: currencyCode(model.parent().data)
        });
        d.amount.state().send("disable");
    });
    model.state().resolve("/Delete").exit(calculateAmount);

    d.item.filter().criteria.push({
        property: "status",
        value: "A"
    }, {
        property: "isSold",
        value: true
    });
    d.item.filter().sort.push({
        property: "number"
    });
}

catalog.register("mixins", "salesLineMixin", salesLineMixin);

/**
    Sales order model
*/
function salesOrder(data, feather) {
    feather = feather || catalog.getFeather("SalesOrder");
    let model = f.createModel(data, feather);
    let d = model.data;
    let plan = false;
    let loadingPlan = false;

    salesHeaderMixin(model);

    function handleMovable() {
        if (d.lines) {
            d.lines().canMove(
                d.lines().every((l) => (
                    l &&
                    !l.data.allocated.toJSON() &&
                    !l.data.backOrdered.toJSON() &&
                    !l.data.inShipping.toJSON() &&
                    !l.data.shipped.toJSON() &&
                    l.data.status() !== "C"
                ))
            );
        }
    }

    // Handler to load gantt chart plan
    function loadPlan() {
        if (loadingPlan || model.state().current()[0] === "/Ready/New") {
            return;
        }

        let payload = {
            method: "POST",
            path: "/sell/get-sales-order-plan",
            body: {id: model.id()}
        };

        function callback(resp) {
            plan.reset();
            resp.forEach(function (i) {
                let item = f.createModel("GanttTimeline", i);
                item.state().goto("/Ready/Fetched/Clean");
                plan.add(item);
            });
            loadingPlan = false;
        }

        loadingPlan = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }
    model.addCalculated({
        name: "timeline",
        type: "object",
        format: "gantt",
        function: function () {
            if (!plan) {
                plan = f.createList("GanttTimeline", {
                    fetch: false,
                    indentOn: "level"
                });
                loadPlan();
            }

            let p = buildSoGantt(plan);
            return p;
        }
    });
    model.data.timeline.refresh = loadPlan;
    model.onLoad(function () {
        if (plan) {
            loadPlan();
        }
    });

    model.custData.state().resolve("/Changing").exit(function () {
        let cust = model.custData();

        if (cust) {
            d.site(cust.site);
            d.shipMethod(cust.shipMethod);
            d.incoTerms(cust.incoTerms);
            if (cust.shipTo) {
                if (d.shipTo()) {
                    cust.shipTo.id = d.shipTo().id();
                } else {
                    cust.shipTo.id = f.createId();
                }
            }
            d.shipTo(cust.shipTo);
        }
    });

    model.onChanged("requestedDate", function () {
        if (!d.requestedDate()) {
            return;
        }
        model.data.lines().forEach(function (line) {
            line.data.requestedDate(d.requestedDate());
        });
    });

    model.onChanged("promiseDate", function () {
        if (!d.promiseDate()) {
            return;
        }
        model.data.lines().forEach(function (line) {
            line.data.promiseDate(d.promiseDate());
        });
        model.data.picklistPrinted(false);
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

    function handleStyles() {
        if (
            d.status() === "I" ||
            d.status() === "P" ||
            d.status() === "H"
        ) {
            d.status.style("HIGH");
        } else {
            d.status.style("");
        }
        if (
            d.promiseDate() &&
            d.promiseDate.toJSON() < f.today()
        ) {
            d.promiseDate.style("HIGH");
        } else {
            d.promiseDate.style("");
        }
    }

    model.addCalculated({
        name: "onHoldIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.onHold()) {
                return "front_hand";
            }
            return "";
        },
        style: "HIGH"
    });

    model.addCalculated({
        name: "planStatusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.planStatus()) {
            case "U":
                return "rule";
            case "P":
            case "O":
                return "checklist_rtl";
            default:
                return "inventory_2";
            }
        }
    });

    d.planStatusIcon.style = function () {
        switch (d.planStatus()) {
        case "U":
            return "HIGH";
        case "P":
            return "WARNING";
        case "O":
            return "EMPHASIS";
        case "I":
            return "ALT-EMPHASIS";
        case "C":
            return "DISABLED";
        }
    };

    d.planStatusIcon.title = function () {
        let dl = d.planStatus.dataList;
        let found = dl.find((i) => i.value === d.planStatus());
        return found.label;
    };

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.onHold()) {
                return "front_hand";
            }

            switch (d.status()) {
            case "I":
                return "radio_button_unchecked";
            case "P":
                return "pending";
            case "A":
                return "start";
            case "S":
                return "local_shipping";
            case "B":
                return "arrow_forward";
            case "C":
                return "check_circle";
            }
        }
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "I":
            return "Incomplete";
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "B":
            return "Back ordered";
        case "S":
            return "Shipping";
        case "C":
            return "Closed";
        }
    };

    model.data.statusIcon.style = function () {
        if (d.onHold()) {
            return "HIGH";
        }
    };

    model.onChanged("status", handleStyles);
    model.onChanged("promiseDate", handleStyles);
    model.onLoad(handleStyles);

    function renumber() {
        let nr = 0;

        d.lines().forEach(function (i) {
            nr += 1;
            i.data.line.state().send("silence");
            i.data.line(nr);
            i.data.line.state().send("report");
        });
    }
    model.onChanged("lines", renumber);
    model.onChanged("lines.line", renumber);

    model.onCopy(function () {
        d.status("I");
        d.orderDate(f.today());
        d.requestedDate(f.today());
        d.promiseDate(null);
        d.purchaseOrder("");
        d.confirmationPrinted(false);
        d.confirmationPrintTime(null);
        d.confirmationPrintedBy("");
        d.picklistPrinted(false);
        d.picklistPrintTime(null);
        d.picklistPrintedBy("");
        d.lines().forEach(function (ln) {
            ln.data.orderDate(f.today());
            ln.data.status("P");
            ln.data.allocated(0);
            ln.data.shipped(0);
            ln.data.backOrdered(0);
            ln.data.originalPromiseDate(null);
            ln.data.actualMaterialCost(f.money(0));
            ln.data.actualLaborCost(f.money(0));
            ln.data.actualServiceCost(f.money(0));
            ln.data.actualOverheadCost(f.money(0));
            ln.data.actualTotalCost(f.money(0));
            ln.data.quantityDue(ln.data.ordered.toJSON());
            ln.data.materials().clear();
            ln.data.promiseDate(null);
            ln.loadItemData();
        });
        d.comments().clear();
    });

    model.onCanDelete(function () {
        return d.status() === "P" || d.status() === "I";
    });

    return model;
}

salesOrder.calculated = f.prop({
    planStatusIcon: {
        type: "string",
        description: "Plan status indicator",
        format: "icon"
    },
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    },
    timeline: {
        type: "object",
        description: "Supply chain timeline in gantt chart",
        format: "gantt"
    }
});

catalog.registerModel("SalesOrder", salesOrder);

salesOrder.static({
    checkActive: function (selections) {
        return selections.some(
            (model) => (
                model.isReadyClean() &&
                model.data.status() === "A" &&
                !model.data.lock()
            )
        );
    },
    checkRelease: function (selections) {
        let sellSettings = catalog.store().models().sellSettings();
        let action = sellSettings.data.onRelease();
        let found = selections.filter((model) => (
            (model.isReadyClean() || model.canSave()) &&
            (model.data.status() === "P" || model.data.status() === "I") &&
            !model.data.onHold() &&
            !model.data.lock()
        ));
        if (action === "O" || action === "E") { // disallowed opening multiple
            return found.length === 1;
        }
        return found.length > 0;
    },
    checkPlanSupply: function (selections) {
        return (
            selections.length === 1 &&
            selections[0].isReadyClean() &&
            selections[0].data.status() !== "C" &&
            selections[0].data.status() !== "I" &&
            !selections[0].data.lock() &&
            !selections[0].data.onHold()
        );
    },
    checkStart: function (selections) {
        return selections.length && selections.every(
            (model) => (
                (model.isReadyClean() || model.canSave()) &&
                model.data.status() === "I" &&
                !model.data.onHold() &&
                !model.data.lock()
            )
        );
    },
    checkClose: function (selections) {
        return selections.some(
            (model) => (
                model.isReadyClean() &&
                model.data.status() !== "C" &&
                !model.data.onHold()
            )
        );
    },
    start: async function (viewModel) {
        let soIds;
        let requests = [];

        viewModel.selections().forEach(function (so) {
            if (so.canSave() && so.data.status() === "I") {
                requests.push(so.save());
            }
        });

        try {
            await Promise.all(requests);

            soIds = viewModel.selections().filter(function (so) {
                return so.data.status() === "I";
            }).map((s) => s.id());
            await f.datasource().request({
                method: "POST",
                path: "/sell/start-sales-orders",
                body: {ids: soIds}
            });
        } catch (e) {
            error(e);
        }
    },
    unrelease: function (viewModel) {
        viewModel.selections().forEach(
            function (model) {
                if (
                    model.data.status() === "A" &&
                    !model.data.onHold()
                ) {
                    model.data.status("P");
                    model.save();
                }
            }
        );
    },
    close: function (viewModel) {
        let ary = viewModel.selections().filter(
            (s) => (s.data.status() !== "C")
        ).map((s) => s.id());
        let payload = {
            method: "POST",
            path: "/sell/close-sales-order",
            body: {ids: ary}
        };

        f.datasource().request(payload).then(function (resp) {
            success(resp);
        }).catch(
            error
        );
    },
    planSupply: function (viewModel) {
        let dialog = viewModel.confirmDialog();
        let payload = {
            method: "POST",
            path: "/sell/plan-sales-order-supply",
            body: {
                id: viewModel.selections()[0].id(),
                subscription: {
                    id: f.createId(),
                    eventKey: catalog.eventKey()
                }
            }
        };

        f.datasource().request(payload).catch(
            error.bind(null, dialog)
        );
    }
});

salesOrder.static().checkAllow = function (selections) {
    return selections.length === 1 && selections.some(function (model) {
        return (
            model.isReadyClean() &&
            model.data.onHold() &&
            !model.data.lock()
        );
    });
};

salesOrder.static().checkHold = function (selections) {
    return selections.length === 1 && selections.some(function (model) {
        return (
            model.isReadyClean() &&
            !model.data.onHold() &&
            !model.data.lock() &&
            (
                model.data.status() === "A" ||
                model.data.status() === "B"
            )
        );
    });
};

function doHold(isHold, viewModel) {
    let dialog = viewModel.confirmDialog();
    let isRecursive = f.prop(false);
    let chkbox = f.getComponent("Checkbox");
    let title;
    let icon;

    if (isHold) {
        title = "Put order on hold";
        icon = "front_hand";
    } else {
        title = "Take order off hold";
        icon = "waving_hand";
    }

    function onOk() {
        f.datasource().request({
            method: "POST",
            path: "/sell/hold",
            body: {
                salesOrderId: viewModel.selections()[0].id(),
                hold: isHold,
                recursive: isRecursive()
            }
        }).then(success.bind(null, dialog)).catch(error.bind(null, dialog));
    }

    dialog.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("form", {
                class: "pure-control-group"
            }, [
                m("label", {
                    style: {minWidth: "200px"}
                }, "Include child work orders:"),
                m(chkbox, {
                    onclick: (val) => isRecursive(val),
                    value: isRecursive(),
                    title: (
                        "Recursively put all allocated work orders " +
                        "upstream on hold also"
                    )
                })
            ])
        ]);
    };
    dialog.title(title);
    dialog.icon(icon);
    dialog.onOk(onOk);
    dialog.show();
}

salesOrder.static().hold = doHold.bind(null, true);
salesOrder.static().allow = doHold.bind(null, false);

function doPrint(models, dialog, opts) {
    return new Promise(function (resolve, reject) {
        let settings = catalog.store().models()[opts.settings]();
        let form = settings.data[opts.formName]();
        let payload;
        let mode = opts.mode || "P";
        let url;
        let now = new Date();

        if (!form) {
            error(dialog, {message: (
                "Form name for " + opts.formName.toName() +
                " must be defined in settings."
            )});
            return;
        }

        payload = {
            method: "POST",
            path: "/do/print-pdf/form/",
            body: {
                ids: models.map((i) => i.id()),
                form: form.data.name()
            }
        };

        function updatePrintStatus() {
            return new Promise(function (resolve, reject) {
                let prequests = [];
                models.forEach(function (model) {
                    model.data[opts.printedAttr](true);
                    model.data[opts.printTimeAttr](new Date());
                    model.data[opts.printedByAttr](f.currentUser().name);
                    prequests.push(model.save());
                });
                Promise.all(prequests).then(resolve).catch(reject);
            });
        }

        function confirm() {
            return new Promise(function (resolve, reject) {
                dialog.message(
                    "Did the " +
                    [opts.docName] +
                    " print correctly?"
                );
                dialog.title("Confirm print");
                dialog.icon("help_outline");
                dialog.onOk(resolve);
                dialog.onCancel(reject);
                dialog.buttonOk().label("Yes");
                dialog.buttonCancel().label("No");
                dialog.show();
            });
        }

        function soPrintPdf(resp) {
            return new Promise(function (resolve, reject) {
                let e;
                url = (
                    location.protocol + "//" +
                    location.hostname + ":" +
                    location.port +
                    location.pathname
                );

                switch (mode) {
                case "O":
                    url += "pdf/" + resp;
                    console.log("Opening", url);
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
                        soPrintPdf(resp.shift()).then(next).catch(reject);
                        return;
                    }
                    resolve();
                }
                next();
            });
        }

        async function theRequests(mdl) {
            let lpay = f.copy(payload);
            lpay.body.ids = [mdl.id()];
            lpay.body.filename = (
                mdl.data.number() + " " +
                now.toLocalDate() + " " +
                now.getHours() +
                now.getMinutes()
            );
            return await f.datasource().request(lpay);
        }

        if (mode === "E") { // Email
            let ord = models[0];
            let doc = opts.docName.slice(0, opts.docName.length - 3);
            let d = models[0].data;
            let mailText = settings.data.mailText();

            if (
                !ord.data.contact() ||
                !ord.data.contact().data.email()
            ) {
                error("No contact email to send " + doc + " to");
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
        } else if (mode === "D" || mode === "O") { // Separate file for each S/O
            Promise.all(models.map(theRequests)).then(
                handleOneByOne
            ).then(
                updatePrintStatus
            ).then(
                resolve
            ).catch(reject);
        } else {
            f.datasource().request(payload).then(
                soPrintPdf
            ).then(
                updatePrintStatus
            ).then(
                resolve
            ).catch(reject);
        }
    });
}

catalog.register("mixins", "doPrintMixin", doPrint);

const confirmOpts = {
    settings: "sellSettings",
    formName: "confirmation",
    docName: "Sales Order(s)",
    printedAttr: "confirmationPrinted",
    printTimeAttr: "confirmationPrintTime",
    printedByAttr: "confirmationPrintedBy"
};


const picklistOpts = {
    settings: "shipSettings",
    formName: "pickList",
    docName: "Pick List(s)",
    printedAttr: "picklistPrinted",
    printTimeAttr: "picklistPrintTime",
    printedByAttr: "picklistPrintedBy"
};

salesOrder.static().release = async function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections().filter(function (model) {
        if (model.data.status() === "P" || model.data.status() === "P") {
            return model;
        }
    });
    let requests = [];

    viewModel.selections().forEach(function (so) {
        if (so.canSave()) {
            requests.push(so.save());
        }
    });

    await Promise.all(requests);

    function printConfirm() {
        return new Promise(function (resolve, reject) {
            let sellSettings = catalog.store().models().sellSettings();
            let action = sellSettings.data.onRelease();
            let opts = f.copy(confirmOpts);
            opts.mode = action;

            if (action && action !== "N") {
                doPrint(
                    models,
                    dialog,
                    opts
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

    function printPicklist() {
        return new Promise(function (resolve, reject) {
            let shipSettings = catalog.store().models().shipSettings();
            let pick = shipSettings.data.printOnRelease();

            if (pick) {
                doPrint(
                    models,
                    dialog,
                    picklistOpts
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
        return f.datasource().request({
            method: "POST",
            path: "/sell/release-sales-orders",
            body: {
                ids: viewModel.selections().map((s) => s.id())
            }
        });
    }

    Promise.resolve().then(
        printConfirm
    ).then(
        printPicklist
    ).then(
        release
    ).catch(function (err) {
        error(dialog, err);
    });
};

salesOrder.static().downloadConfirmation = function (viewModel) {
    let opts = f.copy(confirmOpts);
    opts.mode = "D";
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

salesOrder.static().openConfirmation = function (viewModel) {
    let opts = f.copy(confirmOpts);
    opts.mode = "O";
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

salesOrder.static().sendConfirmation = function (viewModel) {
    let opts = f.copy(confirmOpts);
    opts.mode = "E";
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

salesOrder.static().printConfirmation = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        confirmOpts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

salesOrder.static().printPicklist = function (viewModel) {
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        picklistOpts
    ).then(function () {
        viewModel.refresh();
    }).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

salesOrder.static().checkPrint = function (selections) {
    return selections.length > 0 && selections.every((s) => s.isReadyClean());
};

salesOrder.static().checkSend = function (selections) {
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

function getFormId(fthr) {
    let form = f.catalog().store().data().forms().find(function (frm) {
        return frm.name === fthr.toName();
    }) || {};
    return form.id;
}

function buildWoGantt(list) {
    let plan = {data: []};
    if (!list || !list.length) {
        return plan;
    }
    let startDate;
    let dueDate;

    function addRow(d) {
        let fthr = d.feather() || d.objectType();
        if (d.startDate()) {
            startDate = f.parseDate(d.startDate());
        }
        if (d.dueDate()) {
            dueDate = f.parseDate(d.dueDate());
        }
        dueDate.setHours(11);
        dueDate.setMinutes(59);
        plan.data.push({
            id: d.id(),
            type: d.type(),
            text: d.description(),
            feather: fthr,
            key: d.key() || d.id(),
            formId: getFormId(fthr),
            parent: d.parent(),
            start: startDate,
            end: dueDate,
            percent: d.percent(),
            route: d.route(),
            links: d.links()
        });

        if (d.objectType() === "WorkOrder") {
            let ops = list.slice().filter(function (item) {
                return (
                    (
                        item.data.objectType() === "WorkOrderOperation" &&
                        item.data.number().data.id() === d.number().data.id()
                    ) ||
                    item.data.number().data.objectType() === "OutsideProcess"
                );
            });
            let n = 0;
            let opcurr;

            while (n < ops.length) {
                opcurr = ops[n];
                n += 1;
                if (
                    // Check if services link to next operation
                    opcurr.data.objectType() === "WorkOrderOperation" ||
                    (
                        ops[n] &&
                        opcurr.data.links() &&
                        opcurr.data.links()[0] &&
                        opcurr.data.links()[0].target === ops[n].id()
                    )
                ) {
                    fthr = opcurr.data.feather() || opcurr.data.objectType();
                    startDate = f.parseDate(opcurr.data.startDate());
                    dueDate = f.parseDate(opcurr.data.dueDate());
                    plan.data.push({
                        id: opcurr.id(),
                        text: opcurr.data.description(),
                        key: opcurr.id(),
                        feather: fthr,
                        formId: getFormId(fthr),
                        start: startDate,
                        end: dueDate,
                        percent: opcurr.data.percent(),
                        links: opcurr.data.links()
                    });
                }
            }
            let supplyPlan = f.createList("GanttTimeline", {
                fetch: false,
                indentOn: "level"
            });
            d.detail().forEach(function (i) {
                let item = f.createModel("GanttTimeline", i);
                item.state().goto("/Ready/Fetched/Clean");
                supplyPlan.add(item);
            });
            let formattedPlan = buildWoGantt(supplyPlan).data;
            plan.data = plan.data.concat(formattedPlan);
        }
    }

    let sos = list.slice().filter((r) => (
        r.data.objectType() !== "Inventory" &&
        r.data.objectType() !== "WorkOrderOperation" &&
        r.data.number().data.objectType() !== "OutsideProcess"
    ));
    let i = sos.length;

    while (i) {
        i -= 1;
        addRow(sos[i].data);
    }

    return plan;
}

catalog.register("functions", "buildWorkOrderGantt", buildWoGantt);

function buildSalesGantt(childGantt, list) {
    let plan = {data: []};
    let startDate;
    let dueDate;
    if (!list || !list.length) {
        return plan;
    }
    let i = 0;

    function addRow(d) {
        let fthr = d.feather() || d.objectType();
        if (d.startDate()) {
            startDate = f.parseDate(d.startDate());
        }
        if (d.dueDate()) {
            dueDate = f.parseDate(d.dueDate());
        }
        dueDate.setHours(11);
        dueDate.setMinutes(59);
        plan.data.push({
            id: d.id(),
            key: d.key() || d.id(),
            feather: fthr,
            formId: getFormId(fthr),
            parent: d.parent(),
            type: d.type(),
            text: d.description(),
            start: startDate,
            end: dueDate,
            percent: d.percent(),
            route: d.route(),
            links: d.links()
        });
        let supplyPlan = f.createList("GanttTimeline", {
            fetch: false,
            indentOn: "level"
        });
        d.detail().forEach(function (i) {
            let item = f.createModel("GanttTimeline", i);
            item.state().goto("/Ready/Fetched/Clean");
            supplyPlan.add(item);
        });
        let formattedPlan = childGantt(supplyPlan).data;
        plan.data = plan.data.concat(formattedPlan);
    }

    while (i < list.length) {
        addRow(list[i].data);
        i += 1;
    }

    return plan;
}

const buildSolGantt = buildSalesGantt.bind(null, buildWoGantt);
catalog.register("functions", "buildSalesOrderLineGantt", buildSolGantt);

const buildSoGantt = buildSalesGantt.bind(null, buildSolGantt);
catalog.register("functions", "buildSalesOrderGantt", buildSoGantt);

 /**
    Sales order line model
*/
function salesOrderLine(data, feather) {
    feather = feather || catalog.getFeather("SalesOrderLine");
    let model = f.createModel(data, feather);
    let d = model.data;
    let loadingPlan = false;
    let plan = false;

    salesLineMixin(model, "ordered");

    if (d.dueDate) {
        d.dueDate.isReadOnly(true);
    }
    model.parent.state().resolve("/Changing").exit(function () {
        let prt = model.parent();
        if (prt && !model.isValid()) {
            d.promiseDate(prt.data.promiseDate());
        }
    });

    function loadBom() {
        d.materials().clear();

        if (!d.item() || d.item().data.type() !== "K") {
            return;
        }

        function callback(bom) {
            if (!bom) {
                return;
            }
            bom.forEach(function (row) {
                let qty = d.ordered.toJSON().times(
                    row.quantityPer
                ).plus(
                    row.fixedQuantity
                ).times(row.ratio);

                if (!row.item.isFractional) {
                    qty = Math.ceil(qty);
                }

                d.materials().add({
                    sequence: row.sequence,
                    item: row.item,
                    site: model.parent().data.site.toJSON(),
                    unit: row.unit,
                    quantityPer: row.quantityPer,
                    fixedQuantity: row.fixedQuantity,
                    ratio: row.ratio,
                    quantityDue: qty,
                    required: qty,
                    startDate: f.today(),
                    dueDate: d.dueDate(),
                    status: d.status()
                });
            });
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-bom",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.log(err);
        });
    }

    function loadSites() {
        if (!d.item()) {
            return;
        }

        function callback(itemSites) {
            let csite = model.parent().data.site();

            if (!itemSites) {
                return;
            }

            // If customer site is on item list use that
            if (csite) {
                itemSites.some(function (is) {
                    if (is.site.id === csite.id()) {
                        d.site(is.site);
                        return true;
                    }
                });
            }

            // Otherwise use item's default site
            if (!d.site()) {
                d.site(d.item().data.site.toJSON());
            }
        }

        f.datasource().request({
            method: "POST",
            path: "/design/get-item-sites",
            body: {id: d.item().id()}
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }


    // Handler to load gantt chart plan
    function loadPlan() {
        if (loadingPlan || model.state().current()[0] === "/Ready/New") {
            return;
        }

        let payload = {
            method: "POST",
            path: "/sell/get-sales-order-line-plan",
            body: {id: model.id()}
        };

        function callback(resp) {
            plan.reset();
            resp.forEach(function (i) {
                let item = f.createModel("GanttTimeline", i);
                item.state().goto("/Ready/Fetched/Clean");
                plan.add(item);
            });
            loadingPlan = false;
        }

        loadingPlan = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }
    model.addCalculated({
        name: "timeline",
        type: "object",
        format: "gantt",
        function: function () {
            if (!plan) {
                plan = f.createList("GanttTimeline", {
                    fetch: false,
                    indentOn: "level"
                });
                loadPlan();
            }

            return buildSolGantt(plan);
        }
    });

    function calculateQuantity() {
        d.materials().forEach(function (c) {
            let req = d.ordered.toJSON().times(
                c.data.quantityPer.toJSON()
            ).plus(
                c.data.fixedQuantity.toJSON()
            ).times(
                c.data.ratio.toJSON()
            );
            let cqty = req.minus(
                c.data.issued.toJSON()
            ).plus(
                c.data.returned.toJSON()
            );
            if (c.data.item().data.isFractional()) {
                cqty = Math.ceil(cqty);
            }
            c.data.required(req);
            c.data.quantityDue(cqty);
        });
    }

    function handleMovable() {
        if (d.materials) {
            d.materials().canMove(
                d.materials().every(
                    (l) => (
                        l &&
                        !l.data.allocated.toJSON() &&
                        !l.data.issued.toJSON() &&
                        l.data.status() !== "C"
                    )
                )
            );
        }
    }

    function handleReadOnly() {
        d.item.isReadOnly(
            !d.allocated || d.allocated.toJSON() > 0 ||
            !d.shipped || d.shipped.toJSON() > 0 ||
            (d.materials && d.materials().length && (
                d.materials().some(
                    (mtl) => (
                        mtl &&
                        (
                            mtl.data.allocated.toJSON() ||
                            mtl.data.issued.toJSON()
                        )
                    )
                )
            ))
        );
    }

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "P":
                if (d.quantityDue.toJSON()) {
                    return "pending";
                }
                return "radio_button_unchecked";
            case "A":
                return "start";
            case "C":
                return "check_circle";
            }
        }
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "P":
            if (d.quantityDue.toJSON()) {
                return "Pending";
            }
            return "Pending and not planned";
        case "A":
            return "Active";
        case "C":
            return "Closed";
        }
    };

    model.onChanged("item", function () {
        let item = d.item();

        if (item) {
            d.price(item.data.price.toJSON());
            d.discount(model.parent().data.customer().data.discount.toJSON());
            d.taxable(item.data.taxable());
        }

        model.loadItemData(true);
    });

    model.loadItemData = function () {
        loadBom();
        loadSites();
    };
    model.onChanged("ordered", calculateQuantity);
    model.onChanged("requestedDate", function () {
        if (d.requestedDate() && !d.promiseDate()) {
            d.dueDate(d.requestedDate());
        }
    });
    model.onChanged("promiseDate", function () {
        if (d.promiseDate() && !d.originalPromiseDate()) {
            d.originalPromiseDate(d.promiseDate());
            d.dueDate(d.promiseDate());
        }
    });

    model.addCalculated({
        name: "onHoldIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (
                d.salesOrder &&
                d.salesOrder() &&
                d.salesOrder().data.onHold()
            ) {
                return "front_hand";
            }
            return "";
        },
        style: "HIGH"
    });

    function renumber() {
        let nr = 0;

        d.materials().forEach(function (i) {
            nr += 1;
            i.data.sequence.state().send("silence");
            i.data.sequence(nr);
            i.data.sequence.state().send("report");
        });
    }

    model.onChanged("materials", renumber);
    model.onChanged("materials.sequence", renumber);

    model.onCanDelete(() => (
        !d.shipped.toJSON() &&
        !d.inShipping.toJSON()
    ));

    model.onLoad(function () {
        if (d.status() === "C") {
            model.state().send("freeze");
        }
        handleReadOnly();
        handleMovable();
    });

    return model;
}

salesOrderLine.calculated = f.prop({
    onHoldIcon: {
        type: "string",
        description: "Hold indicator",
        format: "icon"
    },
    timeline: {
        type: "object",
        description: "Supply chain timeline in gantt chart",
        format: "gantt"
    },
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("SalesOrderLine", salesOrderLine);

/**
   Sales Order Requirement
*/
function soReq(data, feather) {
    feather = feather || catalog.getFeather("SalesOrderRequirement");
    let model = f.createModel(data, feather);
    let d = model.data;

    if (d.item) {
        d.item.isReadOnly(true);
    }
    if (d.site) {
        d.site.isReadOnly(true);
    }
    if (d.unit) {
        d.unit.isReadOnly(true);
    }
    if (d.estimatedCost) {
        d.estimatedCost.isReadOnly(true);
    }

    return model;
}

catalog.registerModel("SalesOrderRequirement", soReq);


/**
   Sales Order Comment
*/
function soCmt(data, feather) {
    feather = feather || catalog.getFeather("SalesOrderComment");
    let model = f.createModel(data, feather);

    model.onLoad(function () {
        if (model.data.isSystem()) {
            model.state().send("freeze");
        }
    });

    return model;
}

catalog.registerModel("SalesOrderComment", soCmt);

taxRate.static().importZip2Tax = function (viewModel) {
    let input = document.createElement("input");

    async function processFile() {
        let file = input.files[0];
        let formData = new FormData();

        try {
            formData.append("overwrite", true);
            formData.append("dataFile", file);

            await f.datasource().request({
                method: "POST",
                path: "/do/upload/",
                body: formData
            });

            await f.datasource().request({
                method: "POST",
                path: "/sell/import-zip2tax/",
                body: {
                    filename: file.name,
                    subscription: {
                        id: f.createId(),
                        eventKey: catalog.eventKey()
                    }
                }
            });
            viewModel.refresh();
        } catch (e) {
            error(e);
        }
    }

    input.setAttribute("type", "file");
    input.setAttribute("accept", ".csv");
    input.onchange = processFile;
    input.click();
};

/* -------------------------------------------------------------------------
    The dashboard's sales tile, and the rollup behind it.

    Two registrations with the framework's dashboard (see
    client/components/dashboard.js): a SOURCE, which answers a grouped
    measure tile's questions out of the `bi` aggregates, and a REFRESHER,
    which rebuilds those aggregates when somebody presses Refresh on the
    Home ribbon. Neither knows anything about how the tile is drawn, and the
    framework knows nothing about sales -- that is the seam.

    The source takes its options from the tile, so one registration serves
    revenue or bookings, by region or customer or product, over any of the
    four to-date windows. The tile on a fresh board is figure 8-1's first
    panel: revenue year to date by region, against the same period last
    year, with a year of monthly history beside each row.
------------------------------------------------------------------------- */
const DASH_SPARK_MONTHS = 12;

// Profit is revenue - cogs, derived by the service.
const DASH_MEASURES = {
    bookings: "Bookings",
    cogs: "Cost of goods sold",
    profit: "Profit",
    revenue: "Revenue"
};

const DASH_DIMENSIONS = {
    customer: "customer",
    customerCategory: "customer type",
    item: "product",
    itemCategory: "product category",
    itemGroup: "product group",
    region: "region",
    site: "site"
};

const DASH_COMPARISONS = {
    none: "",
    priorPeriod: "prior period",
    priorYear: "prior year"
};

const DASH_WINDOWS = {
    MTD: "Month to date",
    QTD: "Quarter to date",
    WTD: "Week to date",
    YTD: "Year to date"
};

/*
    What the dashboard's Add Tile dialog may ask about a sales tile.

    The framework knows none of this -- not that revenue exists, not what
    a region is -- and asks the source what questions it accepts. Each
    entry names the tile property it sets, which is the same property
    `dashSalesLoad` reads and posts, so adding a dimension here and in
    DIMENSIONS on the service is the whole of adding a dimension.
*/
function dashChoices(labels) {
    return Object.keys(labels).sort().map(function (key) {
        let said = labels[key];

        return {
            value: key,
            label: said.slice(0, 1).toUpperCase() + said.slice(1)
        };
    });
}

/*
    A top-N list is the same tile with fewer rows: the figures, the
    ordering and the share-of-total are unchanged, and only how many of
    them are drawn differs. So it is an option rather than a tile type,
    and the total beside the heading stays the WHOLE total -- "the top
    ten of $4.5M" rather than a total that quietly means something else
    from the one next to it.
*/
const DASH_LIMITS = [
    {value: "0", label: "All"},
    {value: "5", label: "Top 5"},
    {value: "10", label: "Top 10"},
    {value: "20", label: "Top 20"}
];

function dashOptions() {
    return [{
        key: "measure",
        label: "Measure",
        choices: dashChoices(DASH_MEASURES),
        default: "revenue"
    }, {
        key: "dimension",
        label: "Grouped by",
        choices: dashChoices(DASH_DIMENSIONS),
        default: "region"
    }, {
        key: "window",
        label: "Period",
        choices: dashChoices(DASH_WINDOWS),
        default: "YTD"
    }, {
        key: "comparison",
        label: "Compared with",
        choices: [{
            value: "priorYear",
            label: "Prior year"
        }, {
            value: "priorPeriod",
            label: "Prior period"
        }, {
            value: "none",
            label: "Nothing"
        }],
        default: "priorYear"
    }, {
        key: "limit",
        label: "Show",
        choices: DASH_LIMITS,
        default: "0"
    }, {
        // By name lines paired tiles up.
        key: "sort",
        label: "Order",
        choices: [{
            value: "amount",
            label: "Largest first"
        }, {
            value: "name",
            label: "By name"
        }],
        default: "amount"
    }, {
        // Units beside the money, as in Few's figure 8-1.
        key: "showUnits",
        label: "Also show",
        choices: [{
            value: "",
            label: "Nothing else"
        }, {
            value: "true",
            label: "Units sold"
        }],
        default: ""
    }];
}

let dashAmountFormat;
let dashCompactFormat;

/*
    The instance's own base currency, which is what the rollup sums into:
    `bi.sales_daily` holds base amounts, so showing them in any other
    currency would be a lie. Read late rather than at registration, because
    currencies are not loaded yet when this file runs.
*/
function dashCurrency() {
    try {
        return f.baseCurrency().data.code();
    } catch (ignore) {
        // Not loaded yet, or no base currency set
        return "USD";
    }
}

function dashAmount(value) {
    if (!dashAmountFormat) {
        dashAmountFormat = new Intl.NumberFormat(undefined, {
            currency: dashCurrency(),
            maximumFractionDigits: 0,
            style: "currency"
        });
    }
    return dashAmountFormat.format(Number(value));
}

// For axis labels, where the full figure printed six times does not fit and
// would not be read anyway.
function dashCompact(value) {
    if (!dashCompactFormat) {
        dashCompactFormat = new Intl.NumberFormat(undefined, {
            currency: dashCurrency(),
            maximumFractionDigits: 1,
            notation: "compact",
            style: "currency"
        });
    }
    return dashCompactFormat.format(Number(value));
}

function dashUnits(value) {
    return Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 0
    });
}

function dashSalesHeading(tile) {
    let dimension = DASH_DIMENSIONS[tile.dimension] || "region";
    let measure = DASH_MEASURES[tile.measure] || "Revenue";
    let limit = Number(tile.limit) || 0;
    let said = measure + " " + (tile.window || "YTD") + " by " + dimension;

    // A cut list that does not say it is cut is a list that lies about
    // being everything.
    if (limit > 0) {
        said = "Top " + limit + ": " + said;
    }
    return said;
}

function dashSalesLoad(tile) {
    let payload = {
        method: "POST",
        path: "/sell/get-sales-tile-data",
        body: {
            asOf: tile.asOf || null,
            comparison: tile.comparison || "priorYear",
            dimension: tile.dimension || "region",
            limit: tile.limit || 0,
            measure: tile.measure || "revenue",
            sort: tile.sort || "amount",
            // Small multiples need history.
            sparkline: (
                (tile.showSpark || tile.display === "multiples")
                ? DASH_SPARK_MONTHS
                : 0
            ),
            window: tile.window || "YTD"
        }
    };

    return f.datasource().request(payload).then(function (data) {
        let said = DASH_COMPARISONS[data.comparison];

        return Object.assign({comparisonLabel: said}, data);
    });
}

/*
    The Key Metrics tile asks each KPI for its number separately, and
    three round trips computing three sums over one table -- each
    re-resolving the same reporting date -- would be three chances for
    them to disagree as well as three times the work. So one request
    answers all of them, and whichever KPI asks first makes it; the rest
    in that same tick get the same in-flight promise.

    Keyed on the reporting date: a board pinned to another date is a
    different set of numbers, and must not be served the last lot. The
    slot clears as soon as that request settles, success or failure --
    it is a one-tick de-dupe, not a cache, so a later ask (Refresh, or
    data loaded straight into the database) gets a fresh answer rather
    than yesterday's (John, Oct 2026 -- loaded new demo data with
    imperfect on-time delivery and Refresh kept showing the old figure).
*/
let dashKpiAsOf;
let dashKpiPending;

function dashKpiFetch(asOf) {
    let key = asOf || "";

    if (dashKpiPending && dashKpiAsOf === key) {
        return dashKpiPending;
    }
    dashKpiAsOf = key;
    dashKpiPending = f.datasource().request({
        method: "POST",
        path: "/sell/get-sales-kpis",
        body: {asOf: asOf || null}
    }).then(function (answer) {
        dashKpiPending = undefined;
        return answer;
    }, function (err) {
        dashKpiPending = undefined;
        return Promise.reject(err);
    });

    return dashKpiPending;
}

/*
    Each KPI is one entry out of that answer. A KPI the rollup has not
    built yet reports no value rather than a zero: zero revenue and
    "nobody has run the rollup" are not the same thing, and only one of
    them is worth acting on.
*/
function dashKpiLoad(key) {
    return function (context) {
        let at = (context && context.asOf) || null;
        // The board hands down a Date; the service wants the day.
        let said = (
            (at && typeof at.toISOString === "function")
            ? at.toISOString().slice(0, 10)
            : at
        );

        return dashKpiFetch(said).then(function (answer) {
            let all = answer.kpis || {};
            let found = all[key];

            /*
                The answer says which date it was computed at. If that
                is not the date asked for, these are figures for another
                period and showing them beside tiles at the right one is
                worse than showing nothing -- they look like a
                disagreement about the business rather than about the
                calendar.
            */
            if (said && answer.asOf && answer.asOf !== said) {
                return {value: null};
            }

            if (!found) {
                return {value: null};
            }
            return found;
        });
    };
}

function dashRegisterKpis(globals) {
    let wanted = [{
        key: "salesRevenueYtd",
        name: "Revenue YTD",
        from: "revenueYtd"
    }, {
        key: "salesBookingsYtd",
        name: "Bookings YTD",
        from: "bookingsYtd"
    }, {
        key: "salesRevenueMtd",
        name: "Revenue MTD",
        from: "revenueMtd"
    }, {
        key: "salesRevenueQtd",
        name: "Revenue QTD",
        from: "revenueQtd"
    }, {
        key: "salesProfitYtd",
        name: "Profit YTD",
        from: "profitYtd"
    }, {
        key: "salesOnTimeDelivery",
        name: "On-Time Delivery",
        from: "onTimeDelivery",
        unit: "percent"
    }, {
        key: "salesAvgOrderSize",
        name: "Avg. Order Size",
        from: "avgOrderSize"
    }, {
        // A count, not money. Formatted as such, because "$3" new
        // customers is the kind of thing that makes people stop
        // trusting the rest of the board.
        key: "salesNewCustomers",
        name: "New Customers",
        from: "newCustomers",
        unit: "count"
    }, {
        // Open order value at the reporting date.
        key: "salesBacklog",
        name: "Sales Backlog",
        from: "backlog",
        isStandard: false,
        drillFor: dashBacklogDrill(false)
    }, {
        key: "salesOverdueBacklog",
        name: "Overdue Sales Backlog",
        from: "overdueBacklog",
        better: "lower",
        isStandard: false,
        drillFor: dashBacklogDrill(true)
    }];

    wanted.forEach(function (kpi) {
        globals.dashboardKpis.register({
            key: kpi.key,
            module: "SupplyChain",
            group: "Sales",
            isStandard: kpi.isStandard,
            name: kpi.name,
            better: kpi.better || "higher",
            unit: kpi.unit || "money",
            format: function (n) {
                if (n === null || n === undefined) {
                    return "—";
                }
                if (kpi.unit === "count") {
                    return Number(n).toLocaleString();
                }
                if (kpi.unit === "percent") {
                    return Number(n).toLocaleString(undefined, {
                        maximumFractionDigits: 1
                    }) + "%";
                }
                return dashAmount(n);
            },
            load: dashKpiLoad(kpi.from),
            drillFor: kpi.drillFor
        });
    });
}

/* -------------------------------------------------------------------------
    Drill-down: the order lines behind a backlog figure.

    Shaped on the Sell workbook's "Sales Line Backlog" worksheet, and a
    copy of it rather than a reference, same as the revenue drill-down.

    Lines, not orders: the figure is worked out line by line (what was
    ordered less what has shipped, at the line's unit price), so an
    order that has shipped part of itself is partly in the backlog and
    only its unshipped lines belong in the list. Listing whole orders
    would count the shipped lines as well (John, Oct 2026).

    Two things the footer cannot do, both because a list filter sees
    the order lines as they are now and the figure works them out as of
    the reporting date:

      * a line that has shipped some of its quantity counts in the
        figure for the unshipped part only, while the footer totals the
        whole line. The Qty Due column says where that happens.
      * on a board pinned to a past date, a line that has shipped
        since is closed now and so is not listed, but it was still
        backlog on that date and is in the figure.

    On a board showing today, and with lines that ship whole, the two
    agree. Closing the gap would take properties on the line itself (an
    open amount, a last ship date); a filter cannot do that sum.
------------------------------------------------------------------------- */
const DASH_BACKLOG_COLUMNS = [
    {attr: "dueDate", width: 113},
    {attr: "number", width: 97},
    {attr: "item", width: 0},
    {attr: "site", width: 54},
    {attr: "quantityDue", label: "Qty Due", width: 90},
    {attr: "amount", width: 96},
    {attr: "status", width: 94},
    {attr: "orderDate", width: 114}
];

function dashBacklogDrill(overdueOnly) {
    return function (tile) {
        let asOf = tile.asOf || dashToday();
        let criteria = [{
            property: "status",
            operator: "!=",
            value: "C"
        }, {
            property: "orderDate",
            operator: "<=",
            value: asOf
        }];

        // Overdue is the same backlog, promised before the reporting
        // date -- the same split the histogram draws as "late".
        if (overdueOnly) {
            criteria.push({
                property: "promiseDate",
                operator: "<",
                value: asOf
            });
        }

        return {
            feather: "SalesOrderLine",
            icon: "assignment",
            title: (
                overdueOnly
                ? "Overdue sales order lines"
                : "Open sales order lines"
            ),
            config: {
                aggregates: [
                    {property: "amount.amount", method: "SUM"},
                    {property: "number", method: "COUNT"}
                ],
                columns: DASH_BACKLOG_COLUMNS.map(function (col) {
                    return Object.assign({label: ""}, col);
                }),
                filter: {
                    criteria,
                    sort: [
                        {property: "dueDate"},
                        {property: "number"}
                    ]
                }
            }
        };
    };
}

/*
    Drill-down: the lines behind a bar of the due-date histogram -- open
    at the reporting date, promised in the bar's dates. Same list as the
    backlog figure's, narrowed to those dates; the bar counts what is
    still to ship on each, the footer whole line amounts (see the backlog
    comment above).
*/
function dashDueSaid(bar) {
    function said(day) {
        return new Date(day + "T00:00:00").toLocaleDateString();
    }

    return (
        (
            bar.late
            ? "past due "
            : "due "
        ) + (
            bar.from === bar.to
            ? said(bar.from)
            : said(bar.from) + " to " + said(bar.to)
        )
    );
}

function dashSalesDueDrill(bar) {
    let spec = dashBacklogDrill(false)({asOf: bar.asOf});

    spec.config.filter.criteria.push({
        property: "promiseDate",
        operator: ">=",
        value: bar.from
    }, {
        property: "promiseDate",
        operator: "<=",
        value: bar.to
    });
    spec.title = "Sales order lines " + dashDueSaid(bar);
    return spec;
}

// Today, as the board writes a date.
function dashToday() {
    let now = new Date();
    let month = String(now.getMonth() + 1).padStart(2, "0");
    let day = String(now.getDate()).padStart(2, "0");

    return now.getFullYear() + "-" + month + "-" + day;
}

function dashRefreshSales() {
    return f.datasource().request({
        method: "POST",
        path: "/sell/refresh-sales-bi",
        body: {}
    });
}

function dashDescribeRefresh(outcome) {
    let done = outcome || {};
    let note = Number(done.buckets || 0).toLocaleString() + " daily totals";

    /*
        Worth saying out loud: a state nobody has mapped to a region is not
        an error, but its revenue lands in "(unmapped)" rather than in the
        region somebody expects, and the only way anyone finds out is if the
        refresh mentions it.
    */
    if (done.unmappedStates) {
        note += (
            ", " + Number(done.unmappedStates).toLocaleString() +
            " with no sales region"
        );
    }
    return note;
}

function dashRegister() {
    let globals = store.global();

    if (globals.dashboardSources) {
        globals.dashboardSources.register({
            key: "sales",
            module: "SupplyChain",
            name: "Sales",
            format: {
                amount: dashAmount,
                compact: dashCompact,
                units: dashUnits
            },
            // Less cost is better.
            betterFor: function (tile) {
                return (
                    tile.measure === "cogs"
                    ? "lower"
                    : "higher"
                );
            },
            drillFor: dashSalesDrill,
            headingFor: dashSalesHeading,
            options: dashOptions(),
            defaultTile: {
                cols: 7,
                rows: 4,
                comparison: "priorYear",
                dimension: "region",
                measure: "revenue",
                sequence: 1,
                showSpark: true,
                window: "YTD"
            },
            load: dashSalesLoad
        });
    }

    if (globals.dashboardKpis) {
        dashRegisterKpis(globals);
    }

    // Open sales order lines by promise date, for the due-date histogram.
    if (globals.dashboardSchedules) {
        globals.dashboardSchedules.register({
            key: "sales",
            sequence: 1,
            module: "SupplyChain",
            name: "Sales",
            format: {
                amount: dashAmount,
                compact: dashCompact,
                units: dashUnits
            },
            drillFor: dashSalesDueDrill,
            load: function (context) {
                return f.datasource().request({
                    method: "POST",
                    path: "/sell/get-sales-schedule",
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
            key: "salesBi",
            module: "SupplyChain",
            label: "sales figures",
            run: dashRefreshSales,
            describe: dashDescribeRefresh
        });
    }
}

dashRegister();

/* -------------------------------------------------------------------------
    Drill-down: the invoice lines behind a revenue figure.

    The dashboard asks what records a row stands for and lists them in a
    modal (see the framework's drill-dialog.js). The list is a copy of
    Job Shop's "Sales Revenue" report worksheet -- same feather, same
    columns, same totals footer -- rather than a reference to it, so
    reconfiguring or deleting that worksheet cannot break drilling in.

    Only revenue for now. The other measures come from their own records
    (bookings from order lines, cogs from inventory transactions) and get
    their own descriptors once this one is proven.
------------------------------------------------------------------------- */
const DASH_DRILL_COLUMNS = [
    {attr: "invoice.invoiceDate", width: 132},
    {attr: "invoice", width: 106},
    {attr: "site", width: 53},
    {attr: "item", width: 187},
    {attr: "description", width: 213},
    {attr: "quantity", width: 87},
    {attr: "invoice.billTo.name", width: 0},
    {attr: "amount", width: 101}
];

/*
    Which SalesHistory property stands for each dimension the tile can be
    grouped by. A dimension that is not here cannot be drilled into: the
    rollup reaches it through joins SalesHistory does not carry (region
    comes from the ship-to address), and a list that quietly showed the
    wrong records would be worse than a row that does not respond.
*/
const DASH_DRILL_BY = {
    customer: "invoice.customer",
    item: "item",
    itemCategory: "item.category",
    itemGroup: "item.group",
    site: "site"
};

// The window the tile is showing, as the first and last day it counts.
// Same arithmetic as the rollup's date_trunc, done here so the list and
// the tile cannot drift apart.
function dashDrillRange(tile) {
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

function dashSalesDrill(tile, row) {
    let property = DASH_DRILL_BY[tile.dimension];
    let span;
    let criteria;

    if ((tile.measure || "revenue") !== "revenue" || !property) {
        return null;
    }
    span = dashDrillRange(tile);
    criteria = [{
        property: "invoice.invoiceDate",
        operator: ">=",
        value: span.first
    }, {
        property: "invoice.invoiceDate",
        operator: "<=",
        value: span.last
    }];

    /*
        A row with no key is the rollup's own "everything that did not
        map" bucket; there is no id to filter on, so it does not drill.
    */
    if (!row.key) {
        return null;
    }
    criteria.push({property: property + ".id", value: row.key});

    return {
        feather: "SalesHistory",
        icon: "receipt_long",
        title: (
            "Revenue " + (tile.window || "YTD") + ": " +
            (row.label || row.key)
        ),
        config: {
            aggregates: [{property: "amount.amount", method: "SUM"}],
            columns: DASH_DRILL_COLUMNS.map(function (col) {
                return Object.assign({label: ""}, col);
            }),
            filter: {
                criteria,
                sort: [
                    {property: "invoice.invoiceDate"},
                    {property: "invoice"}
                ]
            }
        }
    };
}
