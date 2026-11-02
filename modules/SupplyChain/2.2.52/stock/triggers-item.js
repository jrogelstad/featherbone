/*jslint unordered devel*/

/**
  Item handler
*/
function doInsertItemBefore(obj) {
    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        newRec.type = newRec.type || "I";

        function callback(resp) {
            let uom = resp[0];

            if (!newRec.unit) {
                if (!uom) {
                    reject("No unit set and no default unit of measure found");
                    return;
                }

                newRec.unit = {id: uom.id};
            }

            resolve();
        }

        if (newRec.unit) {
            resolve();
            return;
        }
        f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "ItemUnit",
            filter: {
                criteria: [{
                    property: "isDefault",
                    value: true
                }]
            }
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "Item",
    doInsertItemBefore,
    f.datasource.TRIGGER_BEFORE
);

async function doUpdateItemBefore(obj) {
    let oldRec = obj.oldRec;
    let newRec = obj.newRec;
    let resp;

    try {
        if (oldRec.number !== newRec.number) {
            resp = await f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "ShipmentLine",
                properties: ["id", "line"],
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.newRec.id
                    }]
                }
            }, true);
            if (resp.length) {
                return Promise.reject(
                    "Number can not be changed on an item that " +
                    "has been shipped"
                );
            }
        }

        if (oldRec.unit.id !== newRec.unit.id) {
            resp = await f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Demand",
                properties: ["id"],
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.newRec.id
                    }]
                }
            }, true);
            if (resp.length) {
                return Promise.reject(
                    "Unit of measure cannot be changed " +
                    "when there is demand history"
                );
            }
            resp = await f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Supply",
                properties: ["id"],
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.newRec.id
                    }]
                }
            }, true);
            if (resp.length) {
                return Promise.reject(
                    "Unit of measure cannot be changed " +
                    "when there is supply history"
                );
            }
        }

        if (newRec.status !== "A" || (
            oldRec.type === "I" && newRec.type !== "I"
        )) {
            resp = await f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Supply",
                properties: ["id"],
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.newRec.id
                    }, {
                        property: "status",
                        operator: "!=",
                        value: "C"
                    }, {
                        property: "quantity",
                        operator: "!=",
                        value: "0"
                    }]
                }
            }, true);

            if (resp.length) {
                if (newRec.status !== "A") {
                    return Promise.reject(
                        "Status cannot be changed when " +
                        "there is active supply"
                    );
                }
                return Promise.reject(
                    "Item type cannot be changed " +
                    "when there is active supply"
                );
            }
            if (newRec.status !== "A") {
                resp = await f.datasource.request({
                    method: "GET",
                    client: obj.client,
                    name: "Demand",
                    properties: ["id"],
                    filter: {
                        criteria: [{
                            property: "item.id",
                            value: obj.newRec.id
                        }, {
                            property: "status",
                            operator: "!=",
                            value: "C"
                        }]
                    }
                }, true);
                if (resp.length) {
                    return Promise.reject(
                        "Status cannot be changed when there " +
                        "is active demand"
                    );
                }
            }
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "PATCH",
    "Item",
    doUpdateItemBefore,
    f.datasource.TRIGGER_BEFORE
);

function doUpsertItemBefore(obj) {
    return new Promise(function (resolve, reject) {
        function callback(resp) {
            let found;
            let oldSiteId;
            let newSiteId;
            let newRec = obj.newRec;
            let oldRec = obj.oldRec;
            let matlCst = 0;
            let labrCst = 0;
            let ovrhCst = 0;
            let servCst = 0;
            let curr = resp[0];
            let defCurr;

            if (!curr) {
                reject("No base currency found");
                return;
            }

            defCurr = {
                currency: curr.code,
                amount: 0
            };

            if (newRec.materialCost) {
                matlCst = newRec.materialCost.amount;
            } else {
                newRec.materialCost = f.copy(defCurr);
            }

            if (newRec.laborCost) {
                labrCst = newRec.laborCost.amount;
            } else {
                newRec.laborCost = f.copy(defCurr);
            }

            if (newRec.overheadCost) {
                ovrhCst = newRec.overheadCost.amount;
            } else {
                newRec.overheadCost = f.copy(defCurr);
            }

            if (newRec.serviceCost) {
                servCst = newRec.serviceCost.amount;
            } else {
                newRec.serviceCost = f.copy(defCurr);
            }

            newRec.cost = {
                amount: matlCst.plus(
                    labrCst
                ).plus(
                    ovrhCst
                ).plus(
                    servCst
                ),
                baseAmount: null,
                currency: curr.code,
                effective: null
            };

            newRec.sites = (
                Array.isArray(newRec.sites)
                ? newRec.sites
                : []
            );

            if (oldRec && oldRec.site) {
                oldSiteId = oldRec.site.id;
            }

            if (newRec && newRec.site && newRec.site.id) {
                newSiteId = newRec.site.id;
            }

            if (!oldRec || oldSiteId !== newSiteId) {
                newRec.sites.forEach(function (row) {
                    row.isPrimary = false;
                });

                if (newRec.site) {
                    found = newRec.sites.find(
                        (row) => row.site.id === newRec.site.id
                    );

                    if (found) {
                        found.isPrimary = true;
                    } else {
                        newRec.sites.push({
                            id: f.createId(),
                            site: {
                                id: newRec.site.id
                            },
                            isPrimary: true
                        });
                    }
                }
            }

            resolve();
        }

        f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Currency",
            filter: {
                criteria: [{
                    property: "isBase",
                    value: true
                }]
            }
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "Item",
    doUpsertItemBefore,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "Item",
    doUpsertItemBefore,
    f.datasource.TRIGGER_BEFORE
);

async function doUpsertItemAfter(obj) {
    try {
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;
        let found;
        let cnt = 0;

        if (!newRec.sites.length) {
            return;
        }

        let inv = await f.datasource.request({
            method: "GET",
            name: "Inventory",
            properties: ["id", "site", "quantity"],
            client: obj.client,
            filter: {
                criteria: [{
                    property: "item.id",
                    value: newRec.id
                }]
            }
        }, true);
        // Create/delete inventory records if necessary

        // Calculate sites being deleted
        let delIds = inv.filter(function (i) {
            found = obj.newRec.sites.find(
                (s) => s !== null && s.site.id === i.site.id
            );
            return !Boolean(found);
        }).map((i) => i.id);
        let err;

        if (
            obj.oldRec && obj.oldRec.trace !== obj.newRec.trace &&
            inv.some((i) => i.quantity > 0)
        ) {
            return Promise.reject(
                "Inventory must be zero to change tracability"
            );
        }

        // Add new inventory records if applicable
        let curr;
        let osite;
        if (newRec.type === "I" && newRec.status === "A") {
            let s;
            while (cnt < newRec.sites.length) {
                s = newRec.sites[cnt];
                cnt += 1;

                if (!s) {
                    return; // Deleted
                }

                found = inv.find((r) => r.site.id === s.site.id);
                curr = newRec.materialCost.currency;

                if (oldRec) {
                    osite = oldRec.sites.find((o) => o.id === s.id);
                }

                if (!found) {
                    await f.datasource.request({
                        method: "POST",
                        name: "Inventory",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            item: {id: newRec.id},
                            site: {id: s.site.id},
                            itemSite: {id: s.id},
                            materialValue: {currency: curr, amount: 0},
                            laborValue: {currency: curr, amount: 0},
                            serviceValue: {currency: curr, amount: 0},
                            overheadValue: {currency: curr, amount: 0},
                            totalValue: {currency: curr, amount: 0},
                            shortage: s.safetyStock > 0,
                            reorder: s.reorderPoint > 0
                        }
                    }, true);

                    await f.datasource.request({
                        method: "POST",
                        name: "doRecalcInventoryOrders",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            itemId: newRec.id,
                            siteId: s.site.id
                        }
                    }, true);
                } else {
                    if (
                        osite && (
                            osite.planningPolicy !== s.planningPolicy ||
                            osite.reorderPoint !== s.reorderPoint ||
                            osite.safetyStock !== s.safetyStock
                        )
                    ) {
                        await f.datasource.request({
                            method: "POST",
                            name: "doRecalcInventoryOrders",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            data: {
                                itemId: newRec.id,
                                siteId: s.site.id
                            }
                        }, true);
                    }
                    // Update costs if applicable
                    if (oldRec && found.quantity && (
                        oldRec.laborCost.amount !==
                        newRec.laborCost.amount ||
                        oldRec.materialCost.amount !==
                        newRec.materialCost.amount ||
                        oldRec.serviceCost.amount !==
                        newRec.serviceCost.amount ||
                        oldRec.overheadCost.amount !==
                        newRec.overheadCost.amount
                    )) {
                        await f.datasource.request({
                            method: "POST",
                            name: "InventoryTransaction",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            data: {
                                date: f.today(),
                                item: {id: newRec.id},
                                site: {id: s.site.id},
                                quantity: 0,
                                type: "Standard Cost Update",
                                document: newRec.number,
                                reference: newRec.number
                            }
                        }, true);
                    }

                    if (oldRec.number !== newRec.number) {
                        await f.datasource.request({
                            method: "PATCH",
                            name: "Inventory",
                            client: obj.client,
                            id: found.id,
                            data: [{
                                op: "replace",
                                path: "/number",
                                value: (
                                    "(" + s.site.code + ") " + newRec.number
                                )
                            }]
                        }, true);
                    }
                }
            }

            // If not inventory anymore, delete inventory record
        } else if (
            (
                oldRec && oldRec.type === "I" && newRec.type !== "I"
            ) || newRec.status !== "A"
        ) {
            let i;
            while (cnt < inv.length) {
                i = inv[cnt];
                cnt += 1;
                await f.datasource.request({
                    method: "DELETE",
                    name: "Inventory",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: i.id
                }, true);
            }
        }

        // Handle site deletions
        if (delIds.length && newRec.type === "I") {
            if (delIds.some(function (id) {
                found = inv.find((i) => i.id === id);
                if (found.quantity > 0) {
                    err = (
                        "Cannot delete site " + found.site.code +
                        " because there is inventory quantity on hand "
                    );
                    return true;
                }
                return false;
            })) {
                return Promise.reject(err);
            }

            cnt = 0;
            let pId;
            while (cnt < delIds.length) {
                pId = delIds[cnt];
                cnt += 1;
                await f.datasource.request({
                    method: "DELETE",
                    name: "Inventory",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: pId
                }, true);
            }
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "Item",
    doUpsertItemAfter,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "Item",
    doUpsertItemAfter,
    f.datasource.TRIGGER_AFTER
);

// Remove allocations if changed to reorder point
async function doAfterUpdate(obj) {
    let n = 0;
    let nis;
    let ois;
    let allocs;
    let alloc;
    let womatls = [];
    let solines = [];
    let soreqs = [];

    while (n < obj.newRec.sites.length) {
        nis = obj.newRec.sites[n];
        ois = obj.oldRec.sites.find((o) => o.id === nis.id);
        n += 1;
        if (
            ois &&
            ois.planningPolicy !== "R" &&
            nis.planningPolicy === "R"
        ) {
            allocs = await f.datasource.request({
                client: obj.client,
                method: "GET",
                name: "Allocation",
                filter: {criteria: [{
                    property: "demand.item.id",
                    value: obj.oldRec.id
                }, {
                    property: "demand.site.id",
                    value: ois.site.id
                }]}
            }, true);

            while (allocs.length) {
                alloc = allocs.shift();
                switch (alloc.demand.objectType) {
                case "SalesOrderLine":
                    solines.push(alloc.demand.id);
                    break;
                case "SalesOrderRequirement":
                    soreqs.push(alloc.demand.id);
                    break;
                case "WorkOrderRequirement":
                    womatls.push(alloc.demand.id);
                    break;
                }
                await f.datasource.request({
                    client: obj.client,
                    id: alloc.id,
                    method: "DELETE",
                    name: "Allocation"
                }, true);
            }
        }
    }

    if (womatls.length) {
        await f.datasource.request({
            client: obj.client,
            data: {requirementIds: womatls},
            method: "POST",
            name: "doUpdateWorkOrderPlanStatus"
        }, true);
    }
    if (solines.length || soreqs.length) {
        await f.datasource.request({
            client: obj.client,
            data: {lineIds: solines, requirementIds: soreqs},
            method: "POST",
            name: "doUpdateSalesOrderPlanStatus"
        }, true);
    }
}

f.datasource.registerFunction(
    "PATCH",
    "Item",
    doAfterUpdate,
    f.datasource.TRIGGER_AFTER
);

function doDeleteItemBefore(obj) {
    return new Promise(function (resolve, reject) {
        function callback(resp) {
            let demand = resp[0];
            let supply = resp[1];
            let trans = resp[2];
            let inv = resp[3];
            let bom = resp[4];
            let req = [];

            if (demand.length) {
                reject("Item cannot be deleted when there is demand history");
                return;
            }

            if (supply.length) {
                reject(
                    "Item cannot be deleted when there is " +
                    "supply order history"
                );
                return;
            }

            if (trans.length) {
                reject(
                    "Item cannot be deleted when there is " +
                    "transaction history"
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

            inv.forEach(function (i) {
                req.push(
                    f.datasource.request({
                        method: "DELETE",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        name: "Inventory",
                        id: i.id
                    }, true)
                );
            });

            Promise.all(req).then(resolve).catch(reject);
        }

        Promise.all([
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Demand",
                limit: 1,
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Supply",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "item.id",
                        value: obj.oldRec.id
                    }, {
                        property: "objectType",
                        operator: "!=",
                        value: "Inventory"
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "InventoryTransaction",
                filter: {
                    limit: 1,
                    criteria: [{
                        property: "item.id",
                        value: obj.oldRec.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Inventory",
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.id
                    }]
                }
            }, true),
            f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "BillOfMaterialItem",
                filter: {
                    criteria: [{
                        property: "item.id",
                        value: obj.id
                    }]
                }
            }, true)
        ]).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "Item",
    doDeleteItemBefore,
    f.datasource.TRIGGER_BEFORE
);