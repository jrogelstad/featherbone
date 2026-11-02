/*jslint unordered*/
function doInsertInventoryAdjustmentAfter(obj) {
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();

    // Auto post on save
    obj.client.onCommit(function () {
        return f.datasource.request({
            method: "POST",
            name: "doPostInventoryAdjustment",
            // Asynchronous call
            user: theUser,
            data: {ids: [obj.newRec.id]},
            tenant: theTenant
        }, true);
    });
}

f.datasource.registerFunction(
    "POST",
    "InventoryAdjustment",
    doInsertInventoryAdjustmentAfter,
    f.datasource.TRIGGER_AFTER
);