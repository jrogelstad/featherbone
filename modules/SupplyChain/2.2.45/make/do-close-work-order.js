/*jslint unordered*/
async function doCloseWo(obj) {
    let wo;
    let ids = (obj.data.ids || [obj.data.id]);
    let i = 0;
    let theId;
    let eKey = f.createId();

    let wos = await f.datasource.request({
        method: "GET",
        name: "WorkOrder",
        client: obj.client,
        properties: ["id", "number", "status"],
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: ids
        }]}
    }, true);

    if (!wos.length) {
        throw "No work orders found";
    }

    while (i < ids.length) {
        theId = obj.data.ids[i];
        i += 1;
        await f.datasource.lock(
            theId,
            obj.client.currentUser(),
            eKey,
            "Closing work order",
            obj.client
        );
    }

    while (wos.length) {
        wo = wos.shift();
        if (wo.status === "C") {
            return Promise.reject(
                "Work order " + wo.number + " is already closed"
            );
        }
        await f.datasource.request({
            method: "PATCH",
            name: "WorkOrder",
            client: obj.client,
            properties: ["id", "number", "status"],
            id: wo.id,
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
    "doCloseWorkOrder",
    doCloseWo
);
