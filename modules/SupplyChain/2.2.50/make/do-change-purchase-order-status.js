/*jslint unordered*/
async function doChangePoStatus(obj) {
    let ids = (obj.data.ids || [obj.data.id]);
    let i = 0;
    let theId;
    let eKey = f.createId();

    while (i < ids.length) {
        theId = ids[i];
        i += 1;
        await f.datasource.lock(
            theId,
            obj.client.currentUser(),
            eKey,
            "Changing purchase order status",
            obj.client
        );
    }

    while (ids.length) {
        theId = ids.shift();
        await f.datasource.request({
            method: "PATCH",
            name: "PurchaseOrder",
            client: obj.client,
            id: theId,
            eventKey: eKey,
            data: [{
                op: "replace",
                path: "/status",
                value: obj.data.status
            }]
        }, true);
    }
}

f.datasource.registerFunction(
    "POST",
    "doChangePurchaseOrderStatus",
    doChangePoStatus
);
