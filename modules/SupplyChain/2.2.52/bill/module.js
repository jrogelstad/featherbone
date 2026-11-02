/*jslint browser devel this*/
const catalog = f.catalog();
const store = catalog.store();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const printPdf = catalog.register("functions").printPdf;
const doPrint = catalog.register("mixins").doPrintMixin;
const salesHeaderMixin = catalog.register("mixins").salesHeaderMixin;
const salesLineMixin = catalog.register("mixins").salesLineMixin;
const salesOrder = store.models().salesOrder;
const salesOrderShipment = store.models().salesOrderShipment;
const CURR_SCALE = 2;
const Qs = window.Qs;

/**
    Invoice model
*/
function invoice(data, feather) {
    feather = feather || catalog.getFeather("Invoice");
    let model = f.createModel(data, feather);
    let d = model.data;

    salesHeaderMixin(model);

    model.custData.state().resolve("/Changing").exit(function () {
        let cust = model.custData();

        if (cust) {
            d.shipMethod(cust.shipMethod);
            d.incoTerms(cust.incoTerms);
            if (cust.shipTo) {
                cust.shipTo.id = f.createId();
            }
            d.shipTo(cust.shipTo);
        }
    });

    model.onLoad(function () {
        if (d.status() === "C") {
            model.state().send("freeze");
        }
    });

    model.addCalculated({
        format: "icon",
        function: function () {
            switch (d.status()) {
            case "A":
                return "start";
            case "C":
                return "check_circle";
            }
        },
        name: "statusIcon",
        type: "string"
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "A":
            return "Active";
        case "C":
            return "Closed";
        }
    };

    model.onCopy(function () {
        d.status("I");
        d.invoiceDate(f.today());
        d.purchaseOrder("");
        d.printed(false);
        d.printTime(null);
        d.printedBy("");
        d.lines().forEach(function (ln) {
            ln.data.shipped(0);
            ln.data.backOrdered(0);
        });
        d.paid({amount: 0, currency: d.currency().data.code()});
        d.balance(d.total.toJSON());
        d.payments().clear();
    });

    model.onCanDelete(function () {
        return d.status() === "A";
    });

    model.onValidate(function () {
        if (d.total.toJSON().amount <= 0) {
            throw "Total amount must be greater than zero";
        }
    });

    return model;
}

invoice.calculated = f.prop({
    statusIcon: {
        description: "Status indicator",
        format: "icon",
        type: "string"
    }
});

invoice.static = f.prop({
    createPrepaidInvoice: function () {
        m.route.set("/edit/:feather/:key", {
            feather: "prepaid-invoice",
            key: f.createId()
        }, {
            state: {create: true}
        });
    }
});

catalog.registerModel("Invoice", invoice);

salesOrder.static().createPrepaidInvoice = function (viewModel) {
    let instances = catalog.register("instances");
    let inv = store.models().prepaidInvoice();
    let so = viewModel.selection().toJSON();

    // Create new invoice model
    inv.data.billTo(so.billTo);
    inv.data.notes(so.billingNotes);
    inv.data.shipTo(so.shipTo);
    inv.data.shipMethod(so.shipMethod);
    inv.data.contact(so.contact);
    inv.data.purchaseOrder(so.purchaseOrder);
    inv.data.salesOrder({
        id: so.id,
        number: so.number,
        purchaseOrder: so.purchaseOrder
    });
    inv.data.customer(so.customer);
    inv.data.lines(so.lines.filter(
        (ln) => ln.status !== "C"
    ).map(function (ln) {
        return {
            discountPrice: ln.discountPrice,
            item: ln.item,
            notes: ln.notes,
            ordered: ln.ordered,
            price: ln.price,
            taxable: ln.taxable
        };
    }));
    inv.data.freight(so.freight);
    inv.data.terms(so.terms);
    inv.data.taxable(so.taxable);

    // Register so next page knows about it
    instances[inv.id()] = inv;
    // Launch shipment page
    m.route.set("/edit/:feather/:key", {
        feather: "PrepaidInvoice",
        key: inv.id()
    }, {
        state: {create: false}
    });
};

salesOrder.static().checkCreatePrepaidInvoice = function (selections) {
    return (
        selections.length === 1 &&
        (
            selections[0].isReadyClean() &&
            selections[0].data.status() !== "C"
        )
    );
};


const printOpts = {
    docName: "Invoice(s)",
    formName: "standardInvoice",
    printTimeAttr: "printTime",
    printedAttr: "printed",
    printedByAttr: "printedBy",
    settings: "billSettings"
};

salesOrderShipment.static().checkCreateInvoice = function (selections) {
    return (
        selections.length === 1 &&
        !selections[0].data.isInvoiced() &&
        selections[0].data.status() === "S"
    );
};

salesOrderShipment.static().createInvoice = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let model = viewModel.selection();

    async function postProcess(resp) {
        let billSettings = catalog.store().models().billSettings();
        let action = billSettings.data.onCreate();
        let opts = f.copy(printOpts);
        opts.mode = action;
        opts.formName = "shipmentInvoice";

        if (action && action === "I") {
            m.route.set("/edit/:feather/:key", {
                feather: "ShipmentInvoice",
                key: resp
            }, {state: true});
        } else if (action && action !== "N") {
            try {
                model = catalog.store().models().shipmentInvoice({id: resp});
                await model.fetch();
                await doPrint(
                    [model],
                    dialog,
                    opts
                );
            } catch {
                return Promise.reject({message: (
                    "Print incomplete"
                )});
            }
        }
    }

    function createInvoice() {
        return f.datasource().request({
            body: {id: viewModel.selection().id()},
            method: "POST",
            path: "/bill/do-create-shipment-invoice"
        });
    }

    Promise.resolve().then(
        createInvoice
    ).then(
        postProcess
    ).catch(function (err) {
        error(dialog, err);
    });
};

invoice.static().checkApplyPayment = function (selections) {
    if (!selections.length) {
        return false;
    }
    let cust = selections[0].data.customer();

    return selections.every((s) => (
        s.isReadyClean() &&
        s.data.customer().id() === cust.id() &&
        s.data.status() === "A"
    ));
};

let applyModel;

invoice.static().applyPayment = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let iid = f.createId();
    let rid = f.createId();
    let applyAmount = f.prop(0.00);
    let theReference = f.prop();
    applyAmount.fromType = function () {
        return applyAmount().toLocaleString(undefined, {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2
        });
    };

    function applyPayment() {
        return f.datasource().request({
            body: {
                amount: {
                    amount: applyAmount(),
                    currency: viewModel.selection().data.currency().data.code()
                },
                ids: viewModel.selections().map((s) => s.id()),
                reference: theReference()
            },
            method: "POST",
            path: "/bill/do-apply-invoice-payment"
        }).then(success).catch(error);
    }

    dialog.content = function () {
        return m("div", {
            class: "pure-form pure-form-aligned"
        }, [
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: rid,
                    style: {marginBottom: "15px"}
                }, "Reference:"),
                m("input", {
                    onchange: (e) => theReference(e.target.value),
                    style: {marginBottom: "15px"},
                    value: theReference()
                }),
                m("label", {
                    for: iid
                }, "Amount:"),
                m("input", {
                    onchange: function (e) {
                        let val = f.types.number.toType(e.target.value);
                        val = val.round(2);
                        dialog.okDisabled(val <= 0);
                        if (val <= 0) {
                            dialog.okTitle("Number must be positive");
                        } else {
                            dialog.okTitle("Click to apply");
                        }
                        applyAmount(val);
                    },
                    value: applyAmount.fromType()
                })
            ])
        ]);
    };

    dialog.title("Apply Invoice Payment");
    dialog.icon("price_check");
    dialog.onOk(applyPayment);
    dialog.okDisabled(true);
    dialog.okTitle("Number must be positive");
    dialog.show();
};

function resolveType(model, options) {
    if (model.data.objectType() !== "Invoice") {
        options.formName = model.data.objectType().toCamelCase();
    }
}
invoice.static().downloadPdf = function (viewModel) {
    let opts = f.copy(printOpts);
    opts.mode = "D";
    resolveType(viewModel.selection(), opts);
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

invoice.static().openPdf = function (viewModel) {
    let opts = f.copy(printOpts);
    opts.mode = "O";
    resolveType(viewModel.selection(), opts);
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

invoice.static().sendPdf = function (viewModel) {
    let opts = f.copy(printOpts);
    opts.mode = "E";
    resolveType(viewModel.selection(), opts);
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

invoice.static().printPdf = function (viewModel) {
    let opts = f.copy(printOpts);
    resolveType(viewModel.selection(), opts);
    doPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        opts
    ).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};

invoice.static().checkPrint = function (selections) {
    return (
        selections.length > 0 &&
        selections.every((s) => s.isReadyClean()) &&
        selections.every(function (s) {
            return s.data.objectType() === selections[0].data.objectType();
        })
    );
};

invoice.static().checkSend = salesOrder.static().checkSend;

/**
    Prepaid Invoice model
*/
function prepaidInvoice(data, feather) {
    feather = f.copy(feather || catalog.getFeather("PrepaidInvoice"));
    if (feather.properties.salesOrder) {
        feather.properties.salesOrder.isRequired = true;
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onCopy(function () {
        d.unapplied(d.total.toJSON());
        d.applications().clear();
    });

    return model;
}

catalog.registerModel("PrepaidInvoice", prepaidInvoice);

/**
    Shipment Invoice model
*/
function shipmentInvoice(data, feather) {
    feather = f.copy(feather || catalog.getFeather("ShipmentInvoice"));
    if (feather.properties.salesOrder) {
        feather.properties.salesOrder.isRequired = true;
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onCopy(function () {
        d.prepayments().clear();
        d.paid({amount: 0, currency: d.currency().data.code()});
    });

    return model;
}

catalog.registerModel("ShipmentInvoice", shipmentInvoice);

 /**
    Invoice line model
*/
function invoiceLine(data, feather) {
    feather = feather || catalog.getFeather("InvoiceLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    salesLineMixin(model, "billed");

    model.onChanged("item", function () {
        let item = d.item();

        if (item) {
            d.price(item.data.price.toJSON());
            d.discount(model.parent().data.customer().data.discount.toJSON());
            d.taxable(item.data.taxable());
        }
    });
    model.onChanged("ordered", function () {
        if (!d.billed.toJSON()) {
            d.billed(d.ordered.toJSON());
        }
    });

    model.onValidate(function () {
        if (d.billed.toJSON() > d.ordered.toJSON()) {
            throw "Billed quantity cannot be greater than order quantity";
        }
    });

    return model;
}

catalog.registerModel("InvoiceLine", invoiceLine);


/* Create internal feather for rendering sales history */
const soHistFeather = Object.freeze({
    description: "Shipment and invoice history of a specific sales order",
    isSystem: true,
    name: "SalesOrderHistory",
    plural: "SalesOrderHistories",
    properties: {
        amount: {
            description: "Sale amount",
            format: "money",
            type: "object"
        },
        created: {
            description: "Create time",
            format: "dateTime",
            type: "string"
        },
        createdBy: {
            description: "Created by user",
            type: "string"
        },
        description: {
            description: "Description",
            type: "string"
        },
        id: {
            description: "Unique identifier",
            type: "string"
        },
        isDeleted: {
            description: "Is deleted",
            type: "boolean"
        },
        level: {
            description: "Indentation level",
            type: "integer"
        },
        lock: {
            default: null,
            description: "Lock",
            type: "object"
        },
        product: {
            description: "Product",
            type: {
                properties: [
                    "description",
                    "id",
                    "number",
                    "objectType"
                ],
                relation: "Item"
            }
        },
        quantity: {
            description: "Quantity shipped",
            type: "number"
        },
        shipDate: {
            description: "Ship date",
            formate: "date",
            type: "string"
        },
        shipment: {
            description: "Shipment number",
            type: {
                properties: [
                    "id",
                    "number",
                    "objectType",
                    "shipMethod",
                    "shippedBy",
                    "trackingNumber"
                ],
                relation: "SalesOrderShipment"
            }
        },
        updated: {
            description: "Updated time",
            formate: "dateTime",
            type: "string"
        },
        updatedBy: {
            description: "Updated by user",
            type: "string"
        }
    }
});

catalog.register("feathers", "SalesOrderHistory", soHistFeather);

/**
    Sales order shipment history model
*/
function soHist(data) {
    let model = f.createModel(data, soHistFeather);

    model.onLoad(function () {
        if (model.data.level() === 0) {
            model.style("BOLD");
        }
    });

    return model;
}

catalog.registerModel("SalesOrderHistory", soHist);

/**
    Sales order model
*/
function so(data, feather) {
    let model = salesOrder(data, feather);
    let loadingSosh = false;
    let shipHist = false;
    let sosh = f.catalog().store().models().salesOrderHistory;

    // Handler to load history
    function loadHistory() {
        if (loadingSosh) {
            return;
        }

        let payload = {
            body: {id: model.id()},
            method: "POST",
            path: "/bill/sales-order-history"
        };

        function callback(resp) {
            shipHist.reset();
            resp.forEach(function (i) {
                let item = sosh(i);
                item.state().goto("/Ready/Fetched/Clean");
                shipHist.add(item);
            });
            loadingSosh = false;
        }

        loadingSosh = true;

        f.datasource().request(
            payload
        ).then(callback).catch(console.error);
    }

    // Public ship history property
    model.addCalculated({
        format: "salesOrderHistory",
        function: function () {
            if (!shipHist) {
                shipHist = f.createList("SalesOrderHistory", {
                    fetch: false,
                    indentOn: "level"
                });
                loadHistory();
            }

            return shipHist;
        },
        name: "history",
        type: "object"
    });
    model.data.history.refresh = loadHistory;

    return model;
}

catalog.registerModel("SalesOrder", so);

so.calculated(salesOrder.calculated());
so.calculated().history = {
    description: "Shipment history list",
    format: "salesOrderHistory",
    type: "object"
};
so.static(salesOrder.static());

/*  Sales order ship history widget */
const histForm = {
    columns: [{
        attr: "shipment",
        width: 100
    }, {
        attr: "shipDate",
        width: 100
    }, {
        attr: "product",
        label: "Invoice\\Product",
        width: 250
    }, {
        attr: "description",
        width: 250
    }, {
        attr: "quantity",
        width: 80
    }, {
        attr: "amount",
        width: 100
    }, {
        attr: "shipment.shipMethod"
    }, {
        attr: "shipment.trackingNumber",
        width: 200
    }, {
        attr: "shipment.shippedBy.fullName",
        label: "Shipped By"
    }]
};

const salesOrderHistory = {};
/**
    @class SalesOrderHistory
    @namespace ViewModels
    @constructor
    @param {Object} Options
    @param {Array} options.models List of child models
*/
salesOrderHistory.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id);
    vm.buttonRefresh = f.prop();
    vm.buttonCollapseAll = f.prop();
    vm.buttonExpandAll = f.prop();
    vm.tableWidget = f.prop();
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: histForm,
        feather: soHistFeather,
        models: options.prop()
    }));
    vm.tableWidget().isQuery(false);
    vm.buttonRefresh(f.createViewModel("Button", {
        class: "fb-icon-button",
        icon: "sync",
        onclick: options.prop.refresh,
        style: {backgroundColor: "white"},
        title: "Refresh"
    }));
    vm.buttonCollapseAll(f.createViewModel("Button", {
        class: "fb-icon-button",
        icon: "keyboard_double_arrow_up",
        onclick: vm.tableWidget().models().collapseAll,
        style: {backgroundColor: "white"},
        title: "Collapse all"
    }));
    vm.buttonExpandAll(f.createViewModel("Button", {
        class: "fb-icon-button",
        icon: "keyboard_double_arrow_down",
        onclick: vm.tableWidget().models().expandAll,
        style: {backgroundColor: "white"},
        title: "Expand all"
    }));

    return vm;
};

salesOrderHistory.component = {
    oninit: function (vnode) {
        this.viewModel = salesOrderHistory.viewModel(vnode.attrs);
    },

    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let tw = f.getComponent("TableWidget");

        return m("div", [
            m(btn, {viewModel: vm.buttonRefresh()}),
            m(btn, {viewModel: vm.buttonCollapseAll()}),
            m(btn, {viewModel: vm.buttonExpandAll()}),
            m(tw, {viewModel: vm.tableWidget()})
        ]);
    }
};

catalog.register(
    "components",
    "salesOrderHistory",
    salesOrderHistory.component
);

f.formats().salesOrderHistory = {
    editor: function (obj) {
        return m(salesOrderHistory.component, {
            id: obj.id,
            key: obj.key,
            model: obj.model,
            prop: obj.prop
        });
    }
};
