/*jslint unordered*/
function doInsertMoveInventoryAfter(obj) {
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();

    // Auto post on save
    obj.client.onCommit(function () {
        return f.datasource.request({
            method: "POST",
            name: "doPostMoveInventory",
            // Asynchronous call
            user: theUser,
            data: {ids: [obj.newRec.id]},
            tenant: theTenant
        }, true);
    });
}

f.datasource.registerFunction(
    "POST",
    "MoveInventory",
    doInsertMoveInventoryAfter,
    f.datasource.TRIGGER_AFTER
);