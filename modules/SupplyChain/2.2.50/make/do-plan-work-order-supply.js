/*jslint unordered*/
async function doPlanWoSupply(obj) {
    let requests = [];
    let eKey = f.createId();
    let wo;
    let itemIds = [];

    try {
        // These kinds of transactions must be sequential;
        await obj.client.query("SELECT pg_advisory_xact_lock(1);");

        wo = await f.datasource.request({
            method: "GET",
            name: "WorkOrder",
            client: obj.client,
            id: obj.data.id,
            properties: ["id", "materials", "operations", "site"]
        }, true);

        if (!wo) {
            if (obj.data.silentFail) {
                return;
            }

            return Promise.reject(
                "Work order wth id " + obj.data.id + " not found"
            );
        }

        await f.datasource.lock(
            obj.data.id,
            obj.client.currentUser(),
            eKey,
            "Planning work order",
            obj.client
        );

        wo.materials.forEach(function (matl) {
            if (itemIds.indexOf(matl.item.id) === -1) {
                itemIds.push(matl.item.id);
            }
        });

        wo.materials.forEach(function (mtl) {
            if (mtl.status !== "C" && mtl.quantityDue > mtl.allocated) {
                requests.push({
                    client: obj.client,
                    data: {demandId: mtl.id, eventKey: eKey},
                    method: "POST",
                    name: "doPlanSupply"
                });
            }
        });

        wo.operations.filter(
            (op) => op.outsideProcessId
        ).forEach(function (op) {
            requests.push({
                client: obj.client,
                data: {demandId: op.outsideProcessId, eventKey: eKey},
                method: "POST",
                name: "doPlanSupply"
            });
        });

        requests.push({
            client: obj.client,
            data: {id: obj.data.id},
            method: "POST",
            name: "doUpdateWorkOrderPlanStatus"
        });

        while (requests.length) {
            await f.datasource.request(requests.shift(), true);
        }

        // Unlock everything affected
        await f.datasource.unlock({
            username: obj.client.currentUser(),
            eventKey: eKey
        }, obj.client);

        return "Work order supply planned";
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doPlanWorkOrderSupply",
    doPlanWoSupply
);
