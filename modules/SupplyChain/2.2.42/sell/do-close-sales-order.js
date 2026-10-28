/*jslint unordered*/
async function doCloseSo(obj) {
    let so;
    let ids = (obj.data.ids || [obj.data.id]);
    let i = 0;
    let theId;
    let eKey = f.createId();

    let sos = await f.datasource.request({
        method: "GET",
        name: "SalesOrder",
        client: obj.client,
        properties: ["id", "number", "status"],
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: ids
        }]}
    }, true);

    if (!sos.length) {
        throw "No sork orders found";
    }

    while (i < ids.length) {
        theId = obj.data.ids[i];
        i += 1;
        await f.datasource.lock(
            theId,
            obj.client.currentUser(),
            eKey,
            "Closing sales order",
            obj.client
        );
    }

    while (sos.length) {
        so = sos.shift();
        if (so.status === "C") {
            return Promise.reject(
                "Sales order " + so.number + " is already closed"
            );
        }
        await f.datasource.request({
            method: "PATCH",
            name: "SalesOrder",
            client: obj.client,
            properties: ["id", "number", "status"],
            id: so.id,
            eventKey: eKey,
            data: [{
                op: "replace",
                path: "/status",
                value: "C"
            }]
        }, true);
    }
}

f.datasource.registerFunction(
    "POST",
    "doCloseSalesOrder",
    doCloseSo
);
