/*jslint unordered*/
function doAfterItemUnitUpsert(obj) {
    if (
        !obj.newRec.isDefault ||
        (
            obj.oldRec &&
            obj.newRec.isDefault &&
            obj.oldRec.isDefault
        )
    ) {
        return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
        function callback(resp) {
            Promise.all(
                resp.map(function (r) {
                    return f.datasource.request({
                        method: "PATCH",
                        name: "ItemUnit",
                        client: obj.client,
                        id: r.id,
                        data: [{
                            op: "replace",
                            path: "/isDefault",
                            value: false
                        }]
                    });
                })
            ).then(resolve).catch(reject);
        }

        return f.datasource.request({
            method: "GET",
            name: "ItemUnit",
            client: obj.client,
            filter: {criteria: [{
                property: "isDefault",
                value: true
            }, {
                property: "id",
                operator: "!=",
                value: obj.newRec.id
            }]}
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "ItemUnit",
    doAfterItemUnitUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "ItemUnit",
    doAfterItemUnitUpsert,
    f.datasource.TRIGGER_AFTER
);

function doDeleteItemUnitBefore(obj) {
    return new Promise(function (resolve, reject) {
        function callback(resp) {
            let item = resp[0];
            let conv1 = resp[1];
            let conv2 = resp[2];
            let bom = resp[3];
            let pur = resp[4];
            let ic1 = resp[5];
            let ic2 = resp[6];

            if (item.length) {
                reject("Item unit cannot be deleted used on an item");
                return;
            }

            if (conv1.length || conv2.length) {
                reject(
                    "Item unit cannot be deleted when a " +
                    "global conversion exists"
                );
                return;
            }

            if (pur.length) {
                reject(
                    "Item cannot be deleted that is on a purchase line"
                );
                return;
            }

            if (bom.length) {
                reject(
                    "Item cannot be deleted that is used " +
                    "in a bill of material"
                );
                return;
            }

            if (ic1.length) {
                reject(
                    "Item unit cannot be deleted because " +
                    "item conversion exists on " +
                    ic1[0].number
                );
                return;
            }

            if (ic2.length) {
                reject(
                    "Item unit cannot be deleted because " +
                    "item conversion exists on " +
                    ic2[0].number
                );
                return;
            }

            resolve();
        }

        Promise.all([
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Item",
                limit: 1,
                filter: {
                    criteria: [{
                        property: "unit.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "ItemUnitConversion",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "fromUnit.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "ItemUnitConversion",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "toUnit.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "BillOfMaterialItem",
                filter: {
                    criteria: [{
                        property: "unit.id",
                        value: obj.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "PurchaseOrderLine",
                filter: {
                    criteria: [{
                        property: "unit.id",
                        value: obj.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "ItemConversion",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "fromUnit.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "ItemConversion",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "toUnit.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true)
        ]).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "ItemUnit",
    doDeleteItemUnitBefore,
    f.datasource.TRIGGER_BEFORE
);