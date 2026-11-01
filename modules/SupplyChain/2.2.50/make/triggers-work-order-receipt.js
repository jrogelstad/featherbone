function doAfterInsert(obj) {
    let username = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let theid = obj.newRec.id;

    obj.client.onCommit(function () {
        return f.datasource.request({
            data: {id: theid},
            method: "POST",
            name: "doPostWorkOrderReceipts",
            tenant: theTenant,
            user: username
        }, true);
    });

    return Promise.resolve();
}

f.datasource.registerFunction(
    "POST",
    "WorkOrderReceipt",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);