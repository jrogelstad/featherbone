/*jslint unordered*/
/**
  Proposed cost handler
*/
function doAfterUpsert(obj) {
    if (
        obj.oldRec &&
        obj.oldRec.status === "U"
    ) {
        return Promise.reject("Cost is updated, record is frozen");
    }

    if (obj.newRec.status !== "U") {
        return Promise.resolve();
    }

    return f.datasource.request({
        method: "PATCH",
        name: "Item",
        client: obj.client,
        user: obj.client.currentUser(),
        id: obj.newRec.item.id,
        data: [{
            op: "replace",
            path: "/materialCost/amount",
            value: obj.newRec.materialCost.amount
        }, {
            op: "replace",
            path: "/laborCost/amount",
            value: obj.newRec.laborCost.amount
        }, {
            op: "replace",
            path: "/serviceCost/amount",
            value: obj.newRec.serviceCost.amount
        }, {
            op: "replace",
            path: "/overheadCost/amount",
            value: obj.newRec.overheadCost.amount
        }]
    });
}

f.datasource.registerFunction(
    "POST",
    "ProposedCost",
    doAfterUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "ProposedCost",
    doAfterUpsert,
    f.datasource.TRIGGER_AFTER
);
