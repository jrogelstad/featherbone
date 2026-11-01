/*jslint devel browser unordered*/
/*global printJS*/

const catalog = f.catalog();
const success = catalog.register("functions").success;
const error = catalog.register("functions").error;
const invValue = catalog.store().models().inventoryValue;

let defUnit;
function defaultUnit() {
    if (!defUnit) {
        defUnit = catalog.store().data().itemUnits().find(
            (u) => u.data.isDefault()
        );
    }
    return defUnit;
}

/**
    Demand
*/
function demand(data, feather) {
    feather = feather || catalog.getFeather("Demand");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleStyles() {
        if (d.priority() === "1") {
            d.priority.style("HIGH");
        } else {
            d.priority.style("");
        }

        if (
            d.dueDate() &&
            d.dueDate.toJSON() < f.today()
        ) {
            d.dueDate.style("HIGH");
        } else if (
            d.dueDate() &&
            d.dueDate.toJSON() === f.today()
        ) {
            d.dueDate.style("WARNING");
        } else {
            d.dueDate.style("");
        }
    }

    model.onChanged("priority", handleStyles);
    model.onChanged("dueDate", handleStyles);
    model.onCanDelete(function () {
        if (model.parent()) {
            return true;
        }
        return false;
    });
    model.onLoad(handleStyles);
    model.onCanDelete(function () {
        return model.name !== "Demand";
    });

    return model;
}

catalog.registerModel("Demand", demand);

/**
    Item
*/
function item(data, feather) {
    feather = feather || catalog.getFeather("Item");
    feather.properties.unit.default = defaultUnit();
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onChanged("conversions", function () {
        let cons = d.conversions();
        let last = cons.length - 1;
        let con = cons[last];
        if (
            con && con.state().current() !== "/Delete" &&
            !con.data.fromUnit() && con.parent() &&
            con.parent().data.unit()
        ) {
            con.data.fromUnit(con.parent().data.unit.toJSON());
        }
    });

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
            case "I":
                return "block";
            }
        }
    });

    model.data.statusIcon.title = function () {
        switch (d.status()) {
        case "P":
            return "Pending";
        case "A":
            return "Active";
        case "I":
            return "Inactive";
        }
    };

    model.data.statusIcon.style = function () {
        switch (d.status()) {
        case "P":
            return "WARNING";
        case "A":
            return "ALT-EMPHASIS";
        case "I":
            return "HIGH";
        }
    };

    model.data.status.style = model.data.statusIcon.style;

    model.onCopy(function () {
        d.number.isReadOnly(false);
        d.status("P");
    });

    model.onValidate(function () {
        if (
            d.source() === "P" &&
            d.sites && d.sites().some((s) => s.data.planningPolicy() === "M")
        ) {
            throw (
                "Purchased items may not have site planning " +
                "policy set as make to order"
            );
        }
    });

    return model;
}

catalog.registerModel("Item", item);

item.calculated().statusIcon = {
    type: "string",
    description: "Icon incidator of pending, active or inactive",
    format: "icon"
};

function conversionMixin(model) {
    let d = model.data;

    model.onValidate(function () {
        if (!d.ratio() || d.ratio() <= 0) {
            throw "Ratio must be greater than zero";
        }

        if (d.fromUnit().id() === d.toUnit().id()) {
            throw "From and to unit of measure must be different";
        }
    });

    return model;
}

/**
    Item conversion
*/
function ic(data, feather) {
    feather = feather || catalog.getFeather("ItemConversion");
    let model = f.createModel(data, feather);
    let d = model.data;

    conversionMixin(model);

    model.onValidate(function () {
        let parent = model.parent();
        let cons = (
            parent
            ? parent.data.conversions().filter((c) => c.id() !== model.id())
            : []
        );
        function areDup(conv) {
            return (
                conv.data.fromUnit() && conv.data.toUnit() &&
                (
                    (
                        conv.data.fromUnit().id() === d.fromUnit().id() &&
                        conv.data.toUnit().id() === d.toUnit().id()
                    ) ||
                    (
                        conv.data.toUnit().id() === d.fromUnit().id() &&
                        conv.data.fromUnit().id() === d.toUnit().id()
                    )
                )
            );
        }

        if (cons.some(areDup)) {
            throw (
                "Conversion between \"" + d.fromUnit().data.code() +
                "\" and \"" + d.toUnit().data.code() +
                "\" exists more than once"
            );
        }
    });

    return model;
}

catalog.registerModel("ItemConversion", ic);

function defIss() {
    let designSettings = catalog.store().models().designSettings();

    return (
        designSettings.data.defaultIssueMethod()
        ? designSettings.data.defaultIssueMethod()
        : "B"
    );
}

/**
    Item Site
*/
function itemSite(data, feather) {
    feather = feather || catalog.getFeather("ItemSite");
    if (feather.properties.issueMethod) {
        feather.properties.issueMethod.default = defIss();
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        let mto = d.planningPolicy() === "M";
        let notloc = !d.site() || !d.site().data.locationControlled();

        d.reorderPoint.isReadOnly(mto);
        d.safetyStock.isReadOnly(mto);
        d.orderIncrement.isReadOnly(mto);
        d.minimumOrderQuantity.isReadOnly(mto);
        d.maximumOrderQuantity.isReadOnly(mto);
        d.defaultLocation.isReadOnly(notloc);
        d.wipLocation.isReadOnly(notloc);
    }

    model.onChanged("planningPolicy", handleReadOnly);
    model.onChanged("planningPolicy", function () {
        if (d.planningPolicy() === "M") {
            d.reorderPoint(0);
            d.safetyStock(0);
            d.orderIncrement(1);
            d.minimumOrderQuantity(1);
            d.maximumOrderQuantity(0);
        }
    });
    model.onChanged("site", function () {
        if (!d.site() || !d.site().data.locationControlled()) {
            d.defaultLocation(null);
            d.wipLocation(null);
        }
        handleReadOnly();
    });

    model.onLoad(handleReadOnly);

    return model;
}

catalog.registerModel("ItemSite", itemSite);

/**
    Item unit conversion
*/
function iuc(data, feather) {
    feather = feather || catalog.getFeather("ItemUnitConversion");
    let model = f.createModel(data, feather);
    let d = model.data;

    conversionMixin(model);

    function handleFilter(aUnit, bUnit) {
        if (d[aUnit]()) {
            model.data[bUnit].filter().criteria = [{
                property: "dimension",
                value: d[aUnit]().data.dimension()
            }];
        } else {
            model.data[bUnit].filter().criteria = [];
        }
    }

    model.onChanged("fromUnit", handleFilter.bind(null, "fromUnit", "toUnit"));
    model.onChanged("toUnit", handleFilter.bind(null, "toUnit", "fromUnit"));
    model.onLoad(function () {
        handleFilter("fromUnit", "toUnit");
        handleFilter("toUnit", "fromUnit");
    });

    model.onValidate(function () {
        if (
            d.fromUnit().data.dimension() !==
            d.toUnit().data.dimension()
        ) {
            throw (
                "Global conversions must have the same dimension"
            );
        }
    });

    return model;
}

catalog.registerModel("ItemUnitConversion", iuc);

/**
    Inventory model
*/
function inv(data, feather) {
    feather = feather || catalog.getFeather("Inventory");
    let model = f.createModel(data, feather);
    let d = model.data;
    let oldQty;
    let adjQty = 0;
    let newQty = 0;
    let theType = "I";
    let msg = "New quantity must be positive";

    function doPreprocess(context) {
        newQty = d.quantity.toJSON();
        adjQty = newQty.minus(oldQty);

        if (adjQty < 0) {
            theType = "O";
            adjQty = adjQty.times(-1);
        } else {
            theType = "I";
        }
        // Need to unlock so adjustment can update record
        model.state().goto("/Ready/Fetched/Unlocking");
        context.resolve(d);
    }

    async function doAdjustInv() {
        if (!adjQty) {
            return;
        }
        try {
            if (newQty < 0) {
                model.set({quantity: oldQty}, true);
                Promise.reject(msg);
                error(msg);
                return;
            }
            await f.datasource().request({
                method: "POST",
                path: "/data/inventory-adjustment",
                body: {
                    comments: "Adjustment by direct editing of inventory",
                    id: f.createId(),
                    item: {id: d.item().id()},
                    quantity: adjQty,
                    site: {id: d.site().id()},
                    type: theType
                }
            });
            model.set({quantity: newQty}, true);
            adjQty = 0;
            newQty = 0;
        } catch (e) {
            model.state().goto("/Ready/Fetched/Dirty");
            error(e);
        }
    }

    function handleReadOnly() {
        Object.keys(d).filter(
            (key) => key !== "quantity"
        ).forEach(function (key) {
            d[key].isReadOnly(true);
        });

        if (d.item()) {
            d.quantity.isReadOnly(
                d.item().data.trace() !== "N" ||
                d.site().data.locationControlled() ||
                d.item().data.status() !== "A"
            );
        }
    }

    model.onChange("quantity", function (p) {
        if (!d.item().data.isFractional()) {
            p.newValue(Math.ceil(p.newValue()));
        }
    });

    model.onLoad(handleReadOnly);
    model.onLoad(function () {
        oldQty = d.quantity.toJSON();
    });

    model.onValidate(function () {
        let currState = model.state().current()[0];
        if (
            currState === "/Ready/Fetched/Dirty" &&
            d.quantity.toJSON() < 0
        ) {
            return msg;
        }
    });

    handleReadOnly();

    let patching = model.state().resolve("/Busy/Saving/Patching");
    patching.enters.shift();
    patching.enter(doPreprocess);
    model.state().resolve("/Ready/Fetched/Unlocking").exit(doAdjustInv);

    return model;
}

catalog.registerModel("Inventory", inv);

/**
    Inventory Adjustment
*/
function invAdj(data, feather) {
    feather = feather || catalog.getFeather("InventoryAdjustment");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        if (d.isPosted()) {
            model.isReadOnly(true);
            model.state().send("freeze");
        }
    }

    function handleDefaultRow() {
        let site = d.site();

        if (
            site && !d.details().length &&
            (
                (d.item() && d.item().data.trace() !== "N") ||
                (site.data.locationControlled())
            )
        ) {
            d.details().add({
                location: site.data.defaultLocation()
            });
        }
    }

    function handleDetailsQty() {
        if (d.details().length === 1) {
            d.details()[0].data.quantity(d.quantity.toJSON());
        }
    }

    function handleDetailsReadOnly() {
        let hasTrace = d.item() && d.item().data.trace() !== "N";
        let hasLoc = d.site() && d.site().data.locationControlled();
        let hasDetails = Boolean(d.details().length);

        d.item.isReadOnly(hasDetails);
        d.site.isReadOnly(hasDetails);
        d.quantity.isReadOnly(d.details().length > 1);

        d.details().forEach(function (row) {
            row.data.trace.isReadOnly(!hasTrace);
            row.data.trace.isRequired(hasTrace);
            row.data.location.isReadOnly(!hasLoc);
            row.data.location.isRequired(hasLoc);
        });

        if (
            !d.isPosted() &&
            (
                (
                    d.site() &&
                    d.site().data.locationControlled()
                ) ||
                (
                    d.item() &&
                    d.item().data.trace() !== "N"
                )
            )
        ) {
            d.details().canAdd(true);
        } else {
            d.details().canAdd(false);
        }
    }
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        if (d.quantity.toJSON() <= 0) {
            throw "Quantity must be greater than zero";
        }
    });

    if (d.details) { // Lists won't have details unless edit mode
        d.details().canAdd(false);
        model.onChanged("item", handleDetailsReadOnly);
        model.onChanged("item", async function () {
            let s;

            if (d.item() && d.item().data.site()) {
                s = await f.datasource().request({
                    body: {id: d.item().data.site().id()},
                    method: "POST",
                    path: "/stock/get-site-data"
                });
                d.site(s);
            }
            handleDefaultRow();
        });
        model.onChanged("site", handleDetailsReadOnly);
        model.onChanged("site", handleDefaultRow);
        model.onChanged("details", handleDetailsReadOnly);
        model.onChanged("details", handleDetailsQty);
        model.onChanged("quantity", handleDetailsQty);
        model.onLoad(handleDetailsReadOnly);

        model.onChanged("details.quantity", function () {
            let qty = 0;

            d.details().forEach(function (row) {
                qty = qty.plus(row.data.quantity.toJSON());
            });

            d.quantity(qty);
        });

        model.onValidate(function () {
            if (
                !d.details().length &&
                (
                    (
                        d.site() &&
                        d.site().data.locationControlled()
                    ) ||
                    (
                        d.item() &&
                        d.item().data.trace() !== "N"
                    )
                )
            ) {
                throw "Adjustment must include detail records";
            }

            d.details().forEach(function (row) {
                if (row.data.quantity.toJSON() <= 0) {
                    throw "Detail records must have positive quantity.";
                }
            });
        });
    }
    d.item.filter().criteria.push({
        property: "status",
        value: "A"
    });

    return model;
}

catalog.registerModel("InventoryAdjustment", invAdj);

invAdj.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let ary = viewModel.selections().filter(
        (s) => !s.data.isPosted()
    ).map((s) => s.id());
    let payload = {
        method: "POST",
        path: "/stock/post-inventory-adjustments",
        body: {ids: ary}
    };

    f.datasource().request(payload).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

invAdj.static().postCheck = function (selections) {
    return selections.some((sel) => !sel.data.isPosted());
};

/**
    Move inventory model
*/
function moveInv(data, feather) {
    feather = feather || catalog.getFeather("MoveInventory");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        if (d.status() === "C") {
            model.isReadOnly(true);
        } else {
            d.quantity.isReadOnly(!d.item());
            d.trace.isReadOnly(
                !d.item() || d.item().data.trace() === "N"
            );
        }
    }

    model.onChanged("item", function () {
        let itm = d.item();

        if (itm && itm.data.site()) {
            d.site(itm.data.site.toJSON());
        }
        handleReadOnly();
    });

    model.onChange("quantity", function (p) {
        if (p.newValue() < 0 || !d.item()) {
            p.newValue(p.oldValue());
        }

        if (!d.item().data.isFractional()) {
            p.newValue(Math.ceil(p.newValue()));
        }
    });

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let status = (
            d.item()
            ? d.item().data.status()
            : false
        );

        if (d.status() === "P" && status !== "A") {
            throw (
                "Item status must be active"
            );
        }

        if (
            d.item() && d.site() &&
            !d.item().data.sites().find(
                (r) => r.data.site().id() === d.site().id()
            )
        ) {
            throw "Invalid site for item";
        }

        if (d.site() && !d.site().data.locationControlled) {
            throw "Site is not location controlled";
        }
    });

    handleReadOnly();

    return model;
}

catalog.registerModel("MoveInventory", moveInv);

moveInv.static().post = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let ary = viewModel.selections().filter(
        (s) => s.data.status() === "P"
    ).map((s) => s.id());
    let payload = {
        method: "POST",
        path: "/stock/post-move-inventory",
        body: {ids: ary}
    };

    f.datasource().request(payload).then(function (resp) {
        viewModel.refresh();
        success(dialog, resp);
    }).catch(
        error.bind(null, dialog)
    );
};

moveInv.static().postCheck = function (selections) {
    return selections.some((sel) => sel.data.status() === "P");
};

/**
    Shipment
*/
function shipment(data, feather) {
    feather = feather || catalog.getFeather("Shipment");
    // Default emp. to current user if applicable
    let emp = catalog.store().data().employees().find(
        (s) => s.data.userAccount() === f.currentUser().name
    );
    if (emp) {
        feather.properties.shippedBy.default = emp;
    }
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        d.shipMethod.isReadOnly(
            Boolean(d.labelId()) &&
            !d.labelVoid()
        );
    }

    function handleRequired() {
        let shipMethod = d.shipMethod();

        if (shipMethod && d.contents && d.nonDelivery) {
            if (shipMethod.data.international()) {
                d.contents.isRequired(true);
                d.nonDelivery.isRequired(true);
            } else {
                d.contents.isRequired(false);
                d.nonDelivery.isRequired(false);
            }
        }
    }

    function handleShipMethod() {
        let shipMethod = d.shipMethod();

        if (shipMethod && shipMethod.data.packageType()) {
            d.packageType(shipMethod.data.packageType.toJSON());
        }
    }

    function handleContainers() {
        let ids = d.lines().map((l) => l.data.item().id());
        d.containers().forEach(function (cont) {
            cont.data.quantities().forEach(function (qty) {
                qty.data.item.filter().criteria = [{
                    property: "id",
                    operator: "IN",
                    value: ids
                }];
            });
        });
    }

    model.addCalculated({
        name: "packStatusIcon",
        type: "string",
        format: "icon",
        function: function () {
            switch (d.packStatus()) {
            case "N":
                return "radio_button_unchecked";
            case "P":
                return "check_circle_outline";
            case "C":
                return "check_circle";
            }
        }
    });
    model.data.packStatusIcon.title = function () {
        switch (d.packStatus()) {
        case "N":
            return "Not started";
        case "P":
            return "Partially packed";
        case "C":
            return "Complete";
        }
    };

    model.onChanged("shipMethod", handleShipMethod);
    model.onChanged("shipMethod", handleRequired);
    model.onChanged("labelId", handleReadOnly);

    function calcWeight() {
        let wgt = d.containers().filter((c) => (
            c.state().current()[0] !== "/Delete"
        )).reduce(function (prv, nxt) {
            return prv.plus(nxt.data.weight.toJSON());
        }, 0);
        d.shipWeight(wgt);
    }
    model.onChanged("containers", calcWeight);
    model.onChanged("containers.weight", calcWeight);
    model.onChanged("containers", function () {
        d.containerCount(d.containers.length);
    });
    model.onChanged("containers.quantities", handleContainers);
    model.onChanged("lines.quantity", handleContainers);

    model.onLoad(handleRequired);
    model.onLoad(function () {
        if (d.status() === "S" && d.isPrinted()) {
            Object.keys(d).forEach(function (key) {
                d[key].isReadOnly(true);
            });
        } else if (d.status() === "S" && model.data.lines) {
            model.data.lines().forEach(function (ln) {
                ln.state().send("freeze");
            });
        } else {
            handleReadOnly();
        }
    });

    d.shippedBy.filter().criteria.push({
        property: "isActive",
        value: true
    });


    model.onValidate(function () {
        if (!d.containers) {
            return;
        }
        // Determine if quantity detail has been used
        let qtys = d.containers().reduce(
            (acc, curr) => acc + curr.data.quantity(),
            0
        );

        // If so confirm they add up to lines
        if (qtys) {
            qtys = [];
            d.containers().forEach(function (cont) {
                qtys = qtys.concat(cont.data.quantities());
            });
            d.lines().forEach(function (line) {
                let pid = line.data.item().id();
                let rows = qtys.filter((r) => r.data.item().id() === pid);
                let pqty = rows.reduce(
                    (acc, curr) => acc.plus(curr.data.quantity.toJSON()),
                    0
                );
                if (pqty !== line.data.quantity.toJSON()) {
                    throw (
                        "Container quantities of " + pqty + " for " +
                        line.data.item().data.number() +
                        " do not equal the shipped quantity of " +
                        line.data.quantity()
                    );
                }
            });
        }
    });

    return model;
}

catalog.registerModel("Shipment", shipment);

shipment.calculated().packStatusIcon = {
    type: "string",
    description: "Icon incidator of not started, partial or complete",
    format: "icon"
};

/**
    Receipt
*/
function rcpt(data, feather) {
    feather = feather || catalog.getFeather("Receipt");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleStatus() {
        if (d.status() === "R") {
            d.statusIcon.title("Received");
            d.statusIcon.style("ALT-EMPHASIS");
        } else if (d.error()) {
            d.statusIcon.title(d.error());
            d.statusIcon.style("HIGH");
        } else {
            d.statusIcon.title("Not posted");
            d.statusIcon.style("ALT-EMPHASIS");
        }
    }
    model.onChanged("error", handleStatus);
    model.onChanged("status", handleStatus);
    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (d.status() === "R") {
                return "check_circle";
            }
            if (d.error()) {
                return "error";
            }
            return "radio_button_unchecked";
        }
    });
    model.onLoad(handleStatus);

    return model;
}

rcpt.calculated = f.prop({
    statusIcon: {
        type: "string",
        description: "Status indicator",
        format: "icon"
    }
});

catalog.registerModel("Receipt", rcpt);

/**
    Shipment Line
*/
function shipLine(data, feather) {
    feather = feather || catalog.getFeather("ShipmentLine");
    let model = f.createModel(data, feather);
    let d = model.data;

    model.onChanged("quantity", function () {
        let shipMethod = model.parent().data.shipMethod();
        let qty = d.quantity.toJSON();
        let cis = model.parent().data.customsItems();
        let ci = cis.find(
            (ci) => (
                ci.state().current()[0] !== "/Delete" &&
                ci.data.shipmentLineId() === d.id()
            )
        );
        let itemd = d.item().data;

        if (shipMethod && shipMethod.data.international() && qty) {
            if (ci) {
                ci.data.quantity(d.quantity());
            } else {
                cis.add({
                    sku: itemd.number(),
                    skuDescription: itemd.description(),
                    harmonizedTariffCode: itemd.harmonizedTariffCode(),
                    countryOfOrigin: itemd.countryOfOrigin(),
                    quantity: d.quantity(),
                    value: itemd.customsValue(),
                    shipmentLineId: d.id(),
                    description: itemd.description()
                });
            }
        } else {
            if (ci) {
                cis.remove(ci);
            }
        }
    });

    return model;
}

catalog.registerModel("ShipmentLine", shipLine);

/**
    Site
*/
function site(data, feather) {
    feather = feather || catalog.getFeather("Site");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        if (d.defaultLocation) {
            d.defaultLocation.isReadOnly(!d.locationControlled());
            d.defaultLocation.isRequired(d.locationControlled());
        }
        if (d.defaultReceiveLocation) {
            d.defaultReceiveLocation.isReadOnly(!d.locationControlled());
        }
        if (d.defaultShipLocation) {
            d.defaultShipLocation.isReadOnly(!d.locationControlled());
        }
        if (d.defaultWipLocation) {
            d.defaultWipLocation.isReadOnly(!d.locationControlled());
        }
    }

    model.onChanged("locationControlled", function () {
        if (!d.locationControlled()) {
            d.defaultLocation(null);
        }
    });
    model.onChanged("locationControlled", handleReadOnly);
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        if (
            d.defaultLocation() &&
            d.defaultLocation().data.type() !== "N"
        ) {
            throw "The default location must be nettable";
        }
    });
    handleReadOnly();

    return model;
}

catalog.registerModel("Site", site);

/**
    Supply
*/
function supply(data, feather) {
    feather = feather || catalog.getFeather("Supply");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleStyles() {
        if (d.priority() === "1") {
            d.priority.style("HIGH");
        } else {
            d.priority.style("");
        }
        if (
            d.dueDate() &&
            d.dueDate.toJSON() < f.today()
        ) {
            d.dueDate.style("HIGH");
        } else if (
            d.dueDate() &&
            d.dueDate.toJSON() === f.today()
        ) {
            d.dueDate.style("WARNING");
        } else {
            d.dueDate.style("");
        }
    }

    model.onChanged("priority", handleStyles);
    model.onChanged("dueDate", handleStyles);
    model.onCanDelete(function () {
        return model.name !== "Supply";
    });

    model.onLoad(handleStyles);

    return model;
}

catalog.registerModel("Supply", supply);

invValue.static().calculate = function (viewModel) {
    let dialog = viewModel.confirmDialog();
    let theModel = f.createModel({}, {
        name: "InventoryValueOptions",
        description: "Options when calculating inventory value",
        isSystem: true,
        properties: {
            id: {
                description: "Unique id.",
                type: "string",
                default: "createId()"
            },
            asOf: {
                description: "Calculate based on transactions up to this date.",
                format: "date",
                type: "string",
                default: "today()",
                isRequired: true
            },
            site: {
                default: null,
                description: "Site; leave empty for every site",
                type: {
                    relation: "Site",
                    properties: [
                        "code",
                        "description"
                    ]
                },
                isRequired: false
            },
            notes: {
                default: "",
                description: "Notes",
                format: "textArea",
                type: "string"
            }
        }
    });
    let vm = f.createViewModel("FormWidget", {
        config: {
            attrs: [{
                attr: "asOf"
            }, {
                attr: "site"
            }, {
                attr: "notes"
            }]
        },
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

    function onOk() {
        let theSiteId = (
            theModel.data.site()
            ? theModel.data.site().id()
            : null
        );
        let payload = {
            method: "POST",
            path: "/stock/calculate-inventory-report/",
            /*
                Kept at close: the value as reported, never recalculated,
                so what is posted late with an earlier date shows up as
                Inventory Late Postings on the dashboard rather than
                quietly changing a closed period.
            */
            body: {
                asOf: theModel.data.asOf(),
                isClosing: true,
                notes: theModel.data.notes(),
                siteId: theSiteId
            }
        };

        return f.datasource().request(
            payload
        ).then(function (resp) {
            viewModel.refresh();
            m.route.set("/edit/:feather/:key", {
                feather: "InventoryValue",
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

    dialog.title("Keep inventory value at close");
    dialog.icon("calculate");
    dialog.onOk(onOk);
    dialog.buttonOk().label("Keep");
    dialog.buttonOk().isDisabled = () => !vm.model().canSave();
    dialog.buttonOk().title = function () {
        if (!vm.model().canSave()) {
            return vm.model().lastError();
        }
        return "Calculate inventory value";
    };
    dialog.show();
};

/* -------------------------------------------------------------------------
    Dashboard: inventory tiles and Key Metrics.

    Tiles read bi.inventory_daily through the shared tile service
    (common/do-get-bi-tile-data.js); Refresh rebuilds it. The KPI comes from
    /stock/get-inventory-kpis.

    Inventory is a balance rather than a flow, so there is no period to
    choose: a tile says what is on hand at the reporting date. Everything
    else -- the dimensions, the comparison, top N, ordering, units alongside
    -- is offered exactly as the sales, purchasing and production tiles
    offer it.
------------------------------------------------------------------------- */
const DASH_STOCK_MEASURES = {
    quantity: "Quantity",
    value: "Value"
};

const DASH_STOCK_DIMENSIONS = {
    item: "product",
    itemCategory: "product category",
    itemGroup: "product group",
    itemSource: "product source"
};

const DASH_STOCK_COMPARISONS = {
    none: "",
    priorPeriod: "a month ago",
    priorYear: "a year ago"
};

let dashStockMoney;
let dashStockCompact;

// Base currency: the rollup sums base amounts. Read late, once loaded.
function dashStockCurrency() {
    try {
        return f.baseCurrency().data.code();
    } catch (ignore) {
        return "USD";
    }
}

function dashStockAmount(value) {
    if (!dashStockMoney) {
        dashStockMoney = new Intl.NumberFormat(undefined, {
            currency: dashStockCurrency(),
            maximumFractionDigits: 0,
            style: "currency"
        });
    }
    return dashStockMoney.format(Number(value));
}

function dashStockShort(value) {
    if (!dashStockCompact) {
        dashStockCompact = new Intl.NumberFormat(undefined, {
            currency: dashStockCurrency(),
            maximumFractionDigits: 1,
            notation: "compact",
            style: "currency"
        });
    }
    return dashStockCompact.format(Number(value));
}

function dashStockUnits(value) {
    return Number(value).toLocaleString(undefined, {
        maximumFractionDigits: 0
    });
}

// Quantity tiles are counts, not money, so the same tile has to be read in
// whichever the measure is -- unlike the flow tiles, where the amount is
// always money and `units` is always a count.
function dashStockFormats(tile) {
    if ((tile && tile.measure) === "quantity") {
        return {
            amount: dashStockUnits,
            compact: dashStockUnits,
            units: dashStockUnits
        };
    }
    return {
        amount: dashStockAmount,
        compact: dashStockShort,
        units: dashStockUnits
    };
}

const DASH_STOCK_FORMAT = {
    amount: dashStockAmount,
    compact: dashStockShort,
    units: dashStockUnits
};

function dashStockChoices(labels) {
    return Object.keys(labels).sort().map(function (key) {
        let said = labels[key];

        return {
            value: key,
            label: said.slice(0, 1).toUpperCase() + said.slice(1)
        };
    });
}

function dashStockOptions() {
    return [{
        key: "measure",
        label: "Measure",
        choices: dashStockChoices(DASH_STOCK_MEASURES),
        default: "value"
    }, {
        key: "dimension",
        label: "Grouped by",
        choices: dashStockChoices(DASH_STOCK_DIMENSIONS),
        default: "item"
    }, {
        key: "comparison",
        label: "Compared with",
        choices: [
            {value: "priorYear", label: "A year ago"},
            {value: "priorPeriod", label: "A month ago"},
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

function dashStockHeading(tile) {
    let dimension = (
        DASH_STOCK_DIMENSIONS[tile.dimension] ||
        DASH_STOCK_DIMENSIONS.item
    );
    let measure = (
        DASH_STOCK_MEASURES[tile.measure] ||
        DASH_STOCK_MEASURES.value
    );
    let limit = Number(tile.limit) || 0;
    // No window in the name: there isn't one, and "Inventory Value by
    // product" is what the tile shows.
    let said = "Inventory " + measure.toLowerCase() + " by " + dimension;

    if (limit > 0) {
        said = "Top " + limit + ": " + said;
    }
    return said;
}

function dashStockLoad(tile) {
    return f.datasource().request({
        method: "POST",
        path: "/common/get-bi-tile-data",
        body: {
            asOf: tile.asOf || null,
            comparison: tile.comparison || "priorYear",
            dimension: tile.dimension || "item",
            fact: "inventory",
            limit: tile.limit || 0,
            measure: tile.measure || "value",
            sort: tile.sort || "amount",
            sparkline: (
                (tile.showSpark || tile.display === "multiples")
                ? 12
                : 0
            ),
            // The engine wants one; a balance ignores it.
            window: "YTD"
        }
    }).then(function (data) {
        return Object.assign({}, data, {
            comparisonLabel: DASH_STOCK_COMPARISONS[data.comparison]
        });
    });
}

// One request per reporting date answers every inventory KPI; the slot
// clears when it settles, so it de-dupes a tick and caches nothing.
let dashStockKpiAsOf;
let dashStockKpiPending;

function dashStockKpiFetch(asOf) {
    let key = asOf || "";

    if (dashStockKpiPending && dashStockKpiAsOf === key) {
        return dashStockKpiPending;
    }
    dashStockKpiAsOf = key;
    dashStockKpiPending = f.datasource().request({
        method: "POST",
        path: "/stock/get-inventory-kpis",
        body: {asOf: asOf || null}
    }).then(function (answer) {
        dashStockKpiPending = undefined;
        return answer;
    }, function (err) {
        dashStockKpiPending = undefined;
        return Promise.reject(err);
    });
    return dashStockKpiPending;
}

function dashStockKpiLoad(key) {
    return function (context) {
        let at = (context && context.asOf) || null;
        let said = (
            (at && typeof at.toISOString === "function")
            ? at.toISOString().slice(0, 10)
            : at
        );

        return dashStockKpiFetch(said).then(function (answer) {
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
    Drill-down: the balances behind an inventory figure, and the
    transactions behind a balance.

    A balance is not a record anywhere -- it is the ledger summed to a
    date -- so the board asks the server to build one (an InventoryValue,
    see do-calculate-inventory-report.js) when the figure is clicked, and
    lists its lines. Built from the ledger as it stands, it is right for
    any date, including after somebody posts late with an earlier date;
    and reused while nothing has been posted since.

    From a balance line, "What changed" lists that product's transactions
    at that site since the end of the previous month: the movement that
    brought it to the balance. Their footer is that movement.

    The list footers add up to the figure clicked once the inventory
    figures have been refreshed: the figure is read from the rollup, the
    list from the ledger.
------------------------------------------------------------------------- */
const DASH_STOCK_BALANCE_COLUMNS = [
    {attr: "item", label: "Product", width: 120},
    {attr: "item.description", label: "Description", width: 220},
    {attr: "site", width: 82},
    {attr: "quantity", width: 100},
    {attr: "totalValue", label: "Value", width: 120}
];

const DASH_STOCK_MOVEMENT_COLUMNS = [
    {attr: "date", width: 105},
    {attr: "number", width: 90},
    {attr: "type", width: 180},
    {attr: "document", width: 110},
    {attr: "reference", width: 110},
    {attr: "quantity", width: 90},
    {attr: "totalCost", width: 110},
    {attr: "created", label: "Entered", width: 160}
];

// Which property of a balance line each tile dimension filters on.
const DASH_STOCK_BALANCE_BY = {
    item: "item.id",
    itemCategory: "item.category.id",
    itemGroup: "item.group.id",
    itemSource: "item.source"
};

function dashStockColumns(columns) {
    return columns.map(function (col) {
        return Object.assign({label: ""}, col);
    });
}

// Today, as the board writes a date.
function dashStockToday() {
    let now = new Date();
    let month = String(now.getMonth() + 1).padStart(2, "0");
    let day = String(now.getDate()).padStart(2, "0");

    return now.getFullYear() + "-" + month + "-" + day;
}

// The day after the last month end before a date: the first of its
// month, so September 30 looks back to September 1 and October 7 to
// October 1.
function dashStockMonthStart(asOf) {
    return asOf.slice(0, 8) + "01";
}

function dashStockDate(said) {
    return new Date(said + "T00:00:00").toLocaleDateString();
}

/*
    "What changed": a balance line's transactions since the month began.
    The record is the line the list had selected.
*/
function dashStockMovement(asOf) {
    return function (line) {
        let product = line.item || {};
        let where = line.site || {};
        let from = dashStockMonthStart(asOf);

        if (!product.id || !where.id) {
            return null;
        }
        return {
            config: {
                aggregates: [
                    {method: "SUM", property: "quantity"},
                    {method: "SUM", property: "totalCost.amount"}
                ],
                columns: dashStockColumns(DASH_STOCK_MOVEMENT_COLUMNS),
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: product.id
                    }, {
                        property: "site.id",
                        value: where.id
                    }, {
                        operator: ">=",
                        property: "date",
                        value: from
                    }, {
                        operator: "<=",
                        property: "date",
                        value: asOf
                    }],
                    sort: [{property: "date"}, {property: "number"}]
                }
            },
            feather: "InventoryTransaction",
            icon: "timeline",
            title: (
                (product.number || "") + " at " + (where.code || "") + ": " +
                dashStockDate(from) + " to " + dashStockDate(asOf)
            )
        };
    };
}

/*
    The balances at the date a tile is showing, narrowed to one row of it
    when there is one. A function, so the snapshot is built on the click.
*/
function dashStockBalances(tile, narrow) {
    let asOf = tile.asOf || dashStockToday();

    return function () {
        return f.datasource().request({
            method: "POST",
            path: "/stock/calculate-inventory-report",
            body: {asOf}
        }).then(function (id) {
            let criteria = [{property: "inventoryValue.id", value: id}];

            if (narrow) {
                criteria.push(narrow.criterion);
            }
            return {
                config: {
                    aggregates: [
                        {method: "SUM", property: "quantity"},
                        {method: "SUM", property: "totalValue.amount"}
                    ],
                    columns: dashStockColumns(DASH_STOCK_BALANCE_COLUMNS),
                    filter: {
                        criteria,
                        sort: [
                            {order: "DESC", property: "totalValue"},
                            {property: "item.number"}
                        ]
                    }
                },
                drillFor: dashStockMovement(asOf),
                drillIcon: "timeline",
                drillLabel: "What changed",
                feather: "InventoryValueDetail",
                icon: "inventory_2",
                title: (
                    "Inventory at " + dashStockDate(asOf) + (
                        narrow
                        ? ": " + narrow.label
                        : ""
                    )
                )
            };
        });
    };
}

function dashStockDrill(tile, row) {
    let property = DASH_STOCK_BALANCE_BY[tile.dimension || "item"];

    // The rollup's own "(none)" bucket has no key to filter on.
    if (!property || !row.key || row.key === "(none)") {
        return null;
    }
    return dashStockBalances(tile, {
        criterion: {property, value: row.key},
        label: row.label || row.key
    });
}

/*
    Late postings: what was entered after the latest closing snapshot with
    a date on or before it. The figure's own answer says which snapshot,
    so the drill asks for the same answer and lists those transactions.
*/
function dashStockLateDrill(tile) {
    let asOf = tile.asOf || null;

    return function () {
        return dashStockKpiFetch(asOf).then(function (answer) {
            let kpis = answer.kpis || {};
            let late = kpis.latePostings;
            let close = late && late.close;
            let criteria;
            let ids;

            if (!close) {
                return null;
            }
            ids = late.ids || [];
            // The figure names the transactions: entered after the close
            // is told by key, which a list filter cannot compare.
            criteria = [{
                operator: "IN",
                property: "id",
                value: ids
            }];
            return {
                config: {
                    aggregates: [
                        {method: "COUNT", property: "number"},
                        {method: "SUM", property: "totalCost.amount"}
                    ],
                    columns: dashStockColumns(DASH_STOCK_MOVEMENT_COLUMNS),
                    filter: {
                        criteria,
                        sort: [{property: "date"}, {property: "number"}]
                    }
                },
                feather: "InventoryTransaction",
                icon: "history",
                title: (
                    "Posted since the close at " +
                    dashStockDate(close.asOf) + (
                        close.siteCode
                        ? " (" + close.siteCode + ")"
                        : ""
                    ) + (
                        late.count > ids.length
                        ? ": the first " + ids.length + " of " +
                        late.count.toLocaleString()
                        : ""
                    )
                )
            };
        });
    };
}

function dashStockRegister() {
    let globals = catalog.store().global();

    if (globals.dashboardSources) {
        globals.dashboardSources.register({
            key: "inventory",
            module: "SupplyChain",
            name: "Inventory",
            format: DASH_STOCK_FORMAT,
            // More stock is neither good nor bad on its own, so no alert
            // either way -- same call as the purchasing tiles.
            betterFor: function () {
                return "neither";
            },
            formatFor: dashStockFormats,
            headingFor: dashStockHeading,
            options: dashStockOptions(),
            load: dashStockLoad,
            drillFor: dashStockDrill
        });
    }

    if (globals.dashboardKpis) {
        globals.dashboardKpis.register({
            key: "stockInventoryValue",
            module: "SupplyChain",
            group: "Inventory",
            isStandard: false,
            name: "Inventory Value",
            better: "neither",
            unit: "money",
            format: function (n) {
                if (n === null || n === undefined) {
                    return "—";
                }
                return dashStockAmount(n);
            },
            load: dashStockKpiLoad("inventoryValue"),
            drillFor: function (tile) {
                return dashStockBalances(tile);
            }
        });

        // Should be nothing: anything here was posted after the books
        // closed, with a date that puts it in the closed period.
        globals.dashboardKpis.register({
            key: "stockLatePostings",
            module: "SupplyChain",
            group: "Inventory",
            isStandard: false,
            name: "Inventory Late Postings",
            better: "lower",
            unit: "money",
            format: function (n) {
                if (n === null || n === undefined) {
                    return "—";
                }
                return dashStockAmount(n);
            },
            load: dashStockKpiLoad("latePostings"),
            drillFor: dashStockLateDrill
        });
    }

    if (globals.dashboardRefreshers) {
        globals.dashboardRefreshers.register({
            key: "inventoryBi",
            module: "SupplyChain",
            label: "inventory figures",
            run: function () {
                return f.datasource().request({
                    method: "POST",
                    path: "/stock/refresh-inventory-bi",
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

dashStockRegister();
