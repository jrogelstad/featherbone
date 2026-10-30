/*jslint devel unordered*/
function doPOInsert(obj) {
    return new Promise(function (resolve, reject) {
        if (obj.newRec.number) {
            resolve();
            return;
        }

        function callback(resp) {
            let nextseq = (
                resp.length
                ? resp[0].sequence
                : 0
            );
            nextseq += 1;
            obj.newRec.sequence = nextseq;
            obj.newRec.number = "PL-" + nextseq;
            resolve();
        }

        f.datasource.request({
            method: "GET",
            name: "PlannedOrder",
            client: obj.client,
            properties: ["sequence"],
            filter: {
                sort: [{
                    property: "sequence",
                    order: "DESC"
                }],
                limit: 1
            }
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "PlannedOrder",
    doPOInsert,
    f.datasource.TRIGGER_BEFORE
);

function doPOUpsert(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "POST",
            name: "doRecalcInventoryOrders",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {
                itemId: obj.newRec.item.id,
                siteId: obj.newRec.site.id
            }
        }, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "PlannedOrder",
    doPOUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "PlannedOrder",
    doPOUpsert,
    f.datasource.TRIGGER_AFTER
);

function doPOUpdate(obj) {
    return new Promise(function (resolve, reject) {
        let tqty = obj.oldRec.quantity.minus(obj.newRec.quantity);
        if (tqty > 0) {
            f.datasource.request({
                client: obj.client,
                data: {
                    id: obj.newRec.id,
                    quantity: tqty,
                    type: "supply"
                },
                method: "POST",
                name: "doTransactAllocated"
            }, true).then(resolve).catch(reject);
            return;
        }
        resolve();
    });
}

f.datasource.registerFunction(
    "PATCH",
    "PlannedOrder",
    doPOUpdate,
    f.datasource.TRIGGER_AFTER
);

async function doPOBeforeDelete(obj) {
    try {
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant();
        let allocs = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                property: "supply.id",
                value: obj.oldRec.id
            }]},
            method: "GET",
            name: "Allocation"
        });
        let otype = obj.oldRec.objectType;

        // Notify demand of planned order of deletion
        while (allocs.length) {
            // const per pass: the onCommit callback runs after the loop,
            // so a shared variable would be the last allocation every time
            const alc = allocs.shift();
            obj.client.onCommit(async function () {
                await f.datasource.request({
                    data: {
                        allocation: alc,
                        quantity: alc.quantity,
                        reason: "delete",
                        type: otype
                    },
                    method: "POST",
                    name: "doCreateDeallocationHistory",
                    tenant: theTenant,
                    user: theUser
                });
            });
        }

        obj.isHard = true; // Always delete permanently

        await f.datasource.request({
            client: obj.client,
            data: {
                id: obj.oldRec.id,
                quantity: obj.oldRec.allocated,
                type: "supply"
            },
            eventKey: obj.eventKey,
            method: "POST",
            name: "doTransactAllocated"
        }, true);
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "DELETE",
    "PlannedOrder",
    doPOBeforeDelete,
    f.datasource.TRIGGER_BEFORE
);

function doPODelete(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "POST",
            name: "doRecalcInventoryOrders",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {
                itemId: obj.oldRec.item.id,
                siteId: obj.oldRec.site.id
            }
        }, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "PlannedOrder",
    doPODelete,
    f.datasource.TRIGGER_AFTER
);