/*jslint devel browser this*/
/*global printJS*/
const catalog = f.catalog();
const store = catalog.store();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const printPdf = catalog.register("functions").printPdf;
const bol = store.models().billOfLading;
const purchaseOrder = store.models().purchaseOrder;
const salesOrder = store.models().salesOrder;

let print = async function (url, viewModel) {
    let models = viewModel.selections();
    let model;
    let i = 0;

    try {
        // Save if necessary
        while (i < models.length) {
            model = models[i];
            i += 1;
            if (model.canSave()) {
                await model.save();
            }
        }

        // Print
        let file = await f.datasource().request({
            body: {ids: models.map((mdl) => mdl.id())},
            method: "POST",
            path: url
        });

        printPdf(file);
    } catch (err) {
        error(viewModel.confirmDialog(), err);
    }
};

bol.static().checkPrintBillOfLading = function (selections) {
    return Boolean(selections.length);
};

bol.static().printBillOfLading = print.bind(
    null,
    "/ship/print-bill-of-lading"
);

/**
    Sales order shipment model
*/
function salesOrderShipment(data, feather) {
    feather = feather || catalog.getFeather("SalesOrderShipment");
    let model = f.createModel(data, feather);
    let d = model.data;

    let so = f.prop();

    function handleReadOnly() {
        d.salesOrder.isReadOnly(true);
    }

    function populateLines() {
        let siteId = (
            d.site()
            ? d.site().id()
            : undefined
        );
        let n = 1;

        d.lines().clear();

        if (so() && siteId) {
            so().lines.forEach(function (line) {
                if (
                    line.site.id === siteId &&
                    line.quantityDue > 0
                ) {
                    d.lines().add({
                        item: line.item,
                        line: n,
                        salesOrderLine: line
                    });
                    n += 1;
                }
            });
        }
    }

    function loadSalesOrder() {
        so(undefined);

        if (!d.salesOrder()) {
            return;
        }

        function callback(resp) {
            if (!resp) {
                return;
            }
            so(resp);

            if (resp) {
                if (
                    so().status !== "A" &&
                    so().status !== "B"
                ) {
                    return;
                }

                d.site(so().site);
                d.shipMethod(so().shipMethod);
                d.incoTerms(so().incoTerms);
                if (so().shipTo) {
                    if (d.shipTo()) {
                        so().shipTo.id = d.shipTo.id();
                    } else {
                        so().shipTo.id = f.createId();
                    }
                }
                d.shipTo(so().shipTo);
                d.purchaseOrder(so().purchaseOrder);
                d.contact(so().contact);
                if (so().requestedDate > f.today()) {
                    d.shipDate(so().requestedDate);
                }
                populateLines();
            }
        }

        f.datasource().request({
            body: {id: d.salesOrder().id()},
            method: "POST",
            path: "/ship/get-sales-order-ship-data"
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.addCalculated({
        format: "icon",
        function: function () {
            if (
                d.salesOrder() &&
                d.salesOrder().data.onHold()
            ) {
                return "front_hand";
            }
            return "";
        },
        name: "onHoldIcon",
        style: "HIGH",
        type: "string"
    });

    model.onChanged("salesOrder", loadSalesOrder);
    model.onChanged("site", populateLines);

    model.onLoad(handleReadOnly);

    model.onCanDelete(function () {
        return d.status() === "P";
    });

    model.onValidate(function () {
        let status = (
            (d.salesOrder && d.salesOrder())
            ? d.salesOrder().data.status()
            : false
        );

        if (
            (
                model.state().current()[0] === "/Ready/New" ||
                model.state().current()[0] === "/Ready/Fetched/Dirty"
            ) &&
            d.salesOrder && d.salesOrder() && d.salesOrder().data.onHold()
        ) {
            throw ("Sales order is on hold ");
        }

        if (model.state().current()[0] === "/Ready/New") {
            if (status === "S") {
                throw (
                    "Sales order already has a pending shipment."
                );
            }

            if (status === "C") {
                throw (
                    "Sales order is closed."
                );
            }
        }
    });

    d.salesOrder.filter().criteria.push({
        operator: "~*",
        property: "status",
        value: "A|B"
    }, {
        operator: "IS",
        property: "requestedDate",
        value: "ON_OR_BEFORE_TODAY"
    }, {
        property: "onHold",
        value: false
    });

    return model;
}

salesOrderShipment.calculated = f.prop({
    onHoldIcon: {
        description: "Hold indicator",
        format: "icon",
        type: "string"
    }
});

catalog.registerModel("SalesOrderShipment", salesOrderShipment);

function doShipPrint(models, dialog, settings) {
    return new Promise(function (resolve, reject) {
        settings = settings || "shipSettings";
        let shipSettings = catalog.store().models()[settings]();
        let form = shipSettings.data.packingSlip();
        let payload;

        if (!form) {
            error(dialog, {message: (
                "Form name for packing slip " +
                "must be defined in settings."
            )});
            return;
        }

        payload = {
            body: {
                form: form.data.name(),
                ids: models.map((i) => i.id())
            },
            method: "POST",
            path: "/do/print-pdf/form/"
        };

        function updatePrintStatus() {
            let requests = [];
            models.forEach(function (model) {
                model.data.isPrinted(true);
                model.data.printTime(new Date());
                model.data.printedBy(f.currentUser().name);
                requests.push(model.save());
            });
            Promise.all(requests).then(resolve).catch(reject);
        }

        function noPrint() {
            reject({message: "Ship cancelled due to incomplete print"});
        }

        function confirm() {
            dialog.message("Did the packing slip(s) print correctly?");
            dialog.title("Confirm print");
            dialog.icon("help_outline");
            dialog.onOk(updatePrintStatus);
            dialog.onCancel(noPrint);
            dialog.buttonOk().label("Yes");
            dialog.buttonCancel().label("No");
            dialog.show();
        }

        function printThePdf(resp) {
            printPdf({
                file: resp,
                onPrintDialogClose: confirm
            });
        }

        f.datasource().request(
            payload
        ).then(
            printThePdf
        ).catch(reject);
    });
}

salesOrderShipment.static().checkPrintLabel = function (selections) {
    return (
        Boolean(selections.length) &&
        selections.some((s) => (
            s.data.shipMethod() &&
            s.data.shipMethod().data.objectType() === "ShipEngineService"
        ))
    );
};

async function printLabels(viewModel) {
    let wd = (
        viewModel.waitDialog
        ? viewModel.waitDialog()
        : {cancel: () => true, show: () => true}
    );
    let shipments = viewModel.selections().filter(
        (s) => s.data.shipMethod()
    );

    if (!shipments.length) {
        return;
    }

    let requests = [];
    let file;

    try {
        wd.show();
        // Save if necessary
        shipments.forEach(function (model) {
            if (model.canSave()) {
                requests.push(model.save());
            }
        });

        await Promise.all(requests);

        // Print
        file = await f.datasource().request({
            body: {shipmentIds: shipments.map((s) => s.id())},
            method: "POST",
            path: "/ship/print-shipment-labels"
        });

        if (file) {
            printPdf(file);
        }
    } catch (err) {
        error(viewModel.confirmDialog(), err);
    } finally {
        wd.cancel();
    }
}
salesOrderShipment.static().printLabel = printLabels;

salesOrderShipment.static().ship = async function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections().filter(function (model) {
        if (model.data.status() === "P") {
            return model;
        }
    });
    let msg;
    let requests = [];
    let seSettings;
    let shSettings;

    try {
        // Save if necessary
        models.forEach(function (model) {
            if (model.canSave()) {
                requests.push(model.save());
            }
        });

        await Promise.all(requests);

        // Ship
        msg = await f.datasource().request({
            body: {ids: models.map((i) => i.id())},
            method: "POST",
            path: "/ship/ship-sales-order-shipments"
        });

        // Print if necessary
        shSettings = catalog.store().models().shipSettings();
        if (shSettings && shSettings.data.printOnShip()) {
            await doShipPrint(models, dialog);
        }

        // Print labels if necessary
        seSettings = catalog.store().models().shipEngineSettings();
        if (seSettings && seSettings.data.createLabelOnShip()) {
            await printLabels(viewModel);
        }

        success(dialog, msg);
    } catch (err) {
        error(dialog, err);
    }
};

salesOrderShipment.static().print = async function (viewModel) {
    let requests = [];

    // Save if necessary
    viewModel.selections().forEach(function (model) {
        if (model.canSave()) {
            requests.push(model.save());
        }
    });

    await Promise.all(requests);

    doShipPrint(viewModel.selections(), viewModel.confirmDialog());
};

salesOrderShipment.static().checkPrint = function (selections) {
    return (
        selections.length > 0 &&
        selections.some((sel) => (
            sel.isReadOnly() || sel.isReadyClean() || sel.canSave()
        ))
    );
};

salesOrderShipment.static().checkShip = function (selections) {
    return selections.some((sel) => (
        (
            sel.data.status() === "P" ||
            sel.data.status() === "R"
        ) &&
        (sel.isReadyClean() || sel.canSave())
    ));
};

salesOrderShipment.static().checkVoidLabel = function (selections) {
    return selections.some(function (shpmt) {
        return (
            !shpmt.canSave() &&
            shpmt.data.labelId() &&
            !shpmt.data.labelVoid()
        );
    });
};

salesOrderShipment.static().voidLabel = function (viewModel) {
    let shipment = viewModel.selections()[0];
    let wd = (
        viewModel.waitDialog
        ? viewModel.waitDialog()
        : {cancel: () => true, show: () => true}
    );
    wd.show();

    f.datasource().request({
        body: {shipmentId: shipment.id()},
        method: "POST",
        path: "/sell/void-sales-order-shipment-label"
    }).then(function () {
        success(viewModel.confirmDialog(), "Shipping label voided");
    }).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    }).finally(wd.cancel);
};

salesOrderShipment.static().checkCreateBillOfLading = (s) => s.length;
salesOrderShipment.static().createBillOfLading = function (viewModel) {
    let dialog = viewModel.confirmDialog();

    return f.datasource().request({
        body: {ids: viewModel.selections().map((s) => s.id())},
        method: "POST",
        path: "/ship/create-bill-of-lading/"
    }).then(function (resp) {
        viewModel.refresh();
        m.route.set("/edit/:feather/:key", {
            feather: "BillOfLading",
            key: resp
        }, {state: true});
    }).catch(
        error.bind(null, dialog)
    );
};

salesOrder.static().ship = function (viewModel) {
    let instances = catalog.register("instances");
    let shipm = store.models().salesOrderShipment();
    let so = viewModel.selections()[0];

    // Create new shipment model
    shipm.data.salesOrder({
        id: so.id(),
        number: so.data.number(),
        purchaseOrder: so.data.purchaseOrder()
    });
    // Register so next page knows about it
    instances[shipm.id()] = shipm;
    // Launch shipment page
    m.route.set("/edit/:feather/:key", {
        feather: "SalesOrderShipment",
        key: shipm.id()
    }, {
        state: {create: false}
    });
};
salesOrder.static().checkShip = function (selections) {
    return (
        selections.length === 1 &&
        (
            selections[0].isReadyClean() &&
            (
                selections[0].data.status() === "A" ||
                selections[0].data.status() === "B"
            )
        )
    );
};

/**
   Sales Order Shipment line
*/
function soShipLine(data, feather) {
    feather = feather || catalog.getFeather("SalesOrderShipmentLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleDefaultRow() {
        let site = model.parent().data.site();
        let item = d.item();
        if (
            item.data.trace() !== "N" ||
            site.data.locationControlled()
        ) {
            if (
                !d.details().length &&
                d.quantity.toJSON() > 0
            ) {
                d.details().add({
                    location: site.data.defaultShipLocation()
                });
            } else if (
                d.details().length &&
                d.quantity.toJSON() === 0
            ) {
                // Shallow copy so removing doesn't git mixed up on self
                d.details().slice().forEach(function (detail) {
                    d.details().remove(detail);
                });
            }
        }
    }

    function handleShipQty() {
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
        let sol = d.salesOrderLine();
        let site;
        let item;
        let hasTrace;
        let hasLoc;

        if (!sol) {
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
    model.onChanged("salesOrderLine", handleDetailsReadOnly);
    model.onChanged("salesOrderLine", handleDefaultRow);
    model.onChanged("details", handleDetailsReadOnly);
    model.onChanged("details", handleDetailsQty);
    model.onChanged("quantity", handleDefaultRow);
    model.onChanged("quantity", handleShipQty);
    model.parent.state().substateMap.Changing.exit(handleDetailsReadOnly);
    model.onLoad(handleDetailsReadOnly);
    model.onChanged("details.quantity", handleDetailsQty);

    model.onValidate(function () {
        let sol = d.salesOrderLine();

        if (!sol) {
            return;
        }

        if (
            d.quantity.toJSON() > 0 &&
            !d.details().length &&
            (
                model.parent().data.site().data.locationControlled() ||
                d.item().data.trace() !== "N"
            )
        ) {
            throw "Shipment line must include detail records";
        }

        d.details().forEach(function (row) {
            if (row.data.quantity() <= 0) {
                throw "Detail records must have positive quantity.";
            }
        });
    });

    return model;
}

catalog.registerModel("SalesOrderShipmentLine", soShipLine);

soShipLine.static().checkShipAll = () => true;

soShipLine.static().shipAll = function (viewModel) {
    viewModel.parentViewModel().model().data.lines().forEach(function (l) {
        l.data.quantity(
            l.data.salesOrderLine().data.ordered.toJSON().minus(
                l.data.salesOrderLine().data.shipped.toJSON()
            )
        );
    });
};

/**
    Shipment Container
*/
function shipCont(data, feather) {
    feather = feather || catalog.getFeather("ShipmentContainer");
    let model = f.createModel(data, feather);
    let d = model.data;

    function calcWeight() {
        let wgt = d.quantities().filter((c) => (
            c.state().current()[0] !== "/Delete"
        )).reduce(function (prv, nxt) {
            return prv.plus(nxt.data.weight.toJSON());
        }, 0);
        d.weight(wgt);
    }

    model.onChanged("quantities.weight", calcWeight);
    model.addCalculated({
        description: "Total quantity in container",
        function: function () {
            return d.quantities().reduce(function (p, q) {
                return q.data.quantity.toJSON().plus(p);
            }, 0);
        },
        name: "quantity",
        type: "number"
    });

    d.container.filter().criteria.push({property: "status", value: "A"});
    d.container.filter().criteria.push({property: "isContainer", value: true});

    return model;
}

shipCont.calculated = f.prop({
    quantity: {
        description: "Total quantity of items in container",
        type: "number"
    }
});

catalog.registerModel("ShipmentContainer", shipCont);

/**
    Shipment Container Quantity
*/
function shipContQty(data, feather) {
    feather = feather || catalog.getFeather("ContainerQuantity");
    let model = f.createModel(data, feather);
    let d = model.data;

    function calcWeight() {
        if (!d.item() || !d.quantity.toJSON()) {
            d.weight(0);
            return;
        }
        d.weight(d.item().data.weight.toJSON().times(d.quantity.toJSON()));
    }

    model.onChange("quantity", function (p) {
        let chg = p.newValue.toJSON().minus(p.oldValue.toJSON());
        let ship = model.parent().parent();
        let line = ship.data.lines().find(
            (l) => l.data.item().id() === d.item().id()
        );
        line.data.quantity(line.data.quantity.toJSON().plus(chg));
    });
    model.onChanged("quantity", calcWeight);
    model.onChanged("item", calcWeight);

    return model;
}

catalog.registerModel("ContainerQuantity", shipContQty);

/**
    Outside process shipment model
*/
function opShipment(data, feather) {
    feather = feather || catalog.getFeather("OutsideProcessShipment");
    let model = f.createModel(data, feather);
    let d = model.data;

    let po = f.prop();

    function handleReadOnly() {
        d.purchaseOrder.isReadOnly(true);
    }

    function populateLines() {
        let siteId = (
            d.site()
            ? d.site().id()
            : undefined
        );
        let n = 1;

        d.lines().clear();

        if (po() && siteId) {
            po().lines.forEach(function (line) {
                if (
                    line.site.id === siteId &&
                    line.quantity > 0 &&
                    line.item.objectType === "Service"
                ) {
                    d.lines().add({
                        item: line.item,
                        line: n,
                        purchaseOrderLine: line
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
                if (po().shipTo) {
                    po().shipTo.id = f.createId();
                }
                d.shipTo(po().shipTo);
                d.reference(po().reference);
                d.contact(po().contact);
                populateLines();
            }
        }

        f.datasource().request({
            body: {id: d.purchaseOrder().id()},
            method: "POST",
            path: "/ship/get-purchase-order-ship-data"
        }).then(callback).catch(function (err) {
            console.error(err);
        });
    }

    model.onChanged("purchaseOrder", loadPurchaseOrder);
    model.onChanged("site", populateLines);

    model.onLoad(handleReadOnly);

    model.onCanDelete(function () {
        return d.status() === "P";
    });

    model.onValidate(function () {
        let status = (
            (d.purchaseOrder && d.purchaseOrder())
            ? d.purchaseOrder().data.status()
            : false
        );

        if (model.state().current()[0] === "/Ready/New") {
            if (status === "S") {
                throw (
                    "Purchase order already has a pending shipment."
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
        operator: "~*",
        property: "status",
        value: "A|B"
    }, {
        property: "hasOutsideProcess",
        value: true
    });

    return model;
}

catalog.registerModel("OutsideProcessShipment", opShipment);

const opShipStat = opShipment.static();
opShipStat.checkPrintLabel = salesOrderShipment.static().checkPrintLabel;
opShipStat.printLabel = printLabels;
opShipStat.ship = async function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let models = viewModel.selections().filter(function (model) {
        if (model.data.status() === "P") {
            return model;
        }
    });
    let msg;
    let requests = [];
    let seSettings;
    let shSettings;

    try {
        // Save if necessary
        models.forEach(function (model) {
            if (model.canSave()) {
                requests.push(model.save());
            }
        });

        await Promise.all(requests);

        // Ship
        msg = await f.datasource().request({
            body: {ids: models.map((i) => i.id())},
            method: "POST",
            path: "/ship/ship-outside-process-shipments"
        });

        // Print if necessary
        shSettings = catalog.store().models().shipSettings();
        if (shSettings && shSettings.data.printOnShip()) {
            await doShipPrint(models, dialog, "buySettings");
        }

        // Print labels if necessary
        seSettings = catalog.store().models().shipEngineSettings();
        if (seSettings && seSettings.data.createLabelOnShip()) {
            await printLabels(viewModel);
        }

        success(dialog, msg);
    } catch (err) {
        error(dialog, err);
    }
};

opShipStat.print = async function (viewModel) {
    let requests = [];

    // Save if necessary
    viewModel.selections().forEach(function (model) {
        if (model.canSave()) {
            requests.push(model.save());
        }
    });

    await Promise.all(requests);

    doShipPrint(
        viewModel.selections(),
        viewModel.confirmDialog(),
        "buySettings"
    );
};

opShipStat.checkPrint = salesOrderShipment.static().checkPrint;
opShipStat.checkShip = salesOrderShipment.static().checkShip;
opShipStat.checkVoidLabel = salesOrderShipment.static().checkVoidLabel;
// TODO: REDO THIS
opShipStat.voidLabel = function (viewModel) {
    let shipment = viewModel.selections()[0];

    f.datasource().request({
        body: {shipmentId: shipment.id()},
        method: "POST",
        path: "/sell/void-sales-order-shipment-label"
    }).then(function () {
        success(viewModel.confirmDialog(), "Shipping label voided");
    }).catch(function (err) {
        error(viewModel.confirmDialog(), err);
    });
};


/**
   Outside Process Shipment line
*/
function opShipLine(data, feather) {
    feather = feather || catalog.getFeather("OutsideProcessShipmentLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    model.addCalculated({
        alias: "Qty. Due",
        function: () => d.purchaseOrderLine().data.quantity.toJSON().minus(
            d.purchaseOrderLine().data.shipped.toJSON()
        ),
        isReadOnly: true,
        name: "unshipped",
        type: "number"
    });

    return model;
}

opShipLine.calculated = f.prop({
    unshipped: {
        alias: "Qty. Due",
        description: "Quantity remaining to be shipped",
        type: "number"
    }
});

catalog.registerModel("OutsideProcessShipmentLine", opShipLine);

opShipLine.static().checkShipAll = () => true;

opShipLine.static().shipAll = function (viewModel) {
    viewModel.parentViewModel().model().data.lines().forEach(function (l) {
        l.data.quantity(
            l.data.purchaseOrderLine().data.ordered.toJSON().minus(
                l.data.purchaseOrderLine().data.shipped.toJSON()
            )
        );
    });
};

purchaseOrder.static().ship = function (viewModel) {
    let instances = catalog.register("instances");
    let shipm = store.models().outsideProcessShipment();
    let po = viewModel.selections()[0];

    // Create new shipment model
    shipm.data.purchaseOrder({
        id: po.id(),
        number: po.data.number(),
        reference: po.data.reference()
    });
    // Register so next page knows about it
    instances[shipm.id()] = shipm;
    // Launch shipment page
    m.route.set("/edit/:feather/:key", {
        feather: "OutsideProcessShipment",
        key: shipm.id()
    }, {
        state: {create: false}
    });
};
purchaseOrder.static().checkShip = function (selections) {
    return (
        selections.length === 1 &&
        selections[0].data.hasOutsideProcess() &&
        selections[0].isReadyClean() &&
        (
            selections[0].data.status() === "A" ||
            selections[0].data.status() === "B"
        )
    );
};