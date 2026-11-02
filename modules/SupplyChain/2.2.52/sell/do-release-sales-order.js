/*jslint browser devel unordered*/
/*global console*/

async function doReleaseSo(obj) {
    let eKey = f.createId();
    let i = 0;
    let theId;

    while (i < obj.data.ids.length) {
        theId = obj.data.ids[i];
        i += 1;
        await f.datasource.lock(
            theId,
            obj.client.currentUser(),
            eKey,
            "Releasing sales order",
            obj.client
        );
    }
    i = 0;
    try {
        while (i < obj.data.ids.length) {
            theId = obj.data.ids[i];
            i += 1;
            await f.datasource.request({
                method: "PATCH",
                name: "SalesOrder",
                client: obj.client,
                user: obj.client.currentUser(),
                eventKey: eKey,
                id: theId,
                data: [{
                    op: "replace",
                    path: "/status",
                    value: "A"
                }]
            }, true);
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doReleaseSalesOrders",
    doReleaseSo
);