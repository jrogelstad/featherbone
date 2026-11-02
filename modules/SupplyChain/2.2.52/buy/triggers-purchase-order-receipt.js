/*jslint unordered*/

function doAfterInsert(obj) {
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();

    // Autopost on save
    obj.client.onCommit(function () {
        return f.datasource.request({
            method: "POST",
            name: "doPostPurchaseOrderReceipts",
            // Asynchronous call
            user: theUser,
            data: {ids: [obj.newRec.id]},
            tenant: theTenant
        }, true);
    });
}

f.datasource.registerFunction(
    "POST",
    "PurchaseOrderReceipt",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);