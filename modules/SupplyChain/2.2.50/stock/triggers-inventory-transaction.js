/*jslint unordered*/
function doInsertBeforeInvTrans(obj) {
    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let requests = [];

        function process(res) {
            let item = res[0];
            let curr = res[1][0];
            let inv = res[2][0];

            if (!item) {
                reject("Invalid item");
                return;
            }

            if (item.status !== "A") {
                reject(
                    "Item " + item.number +
                    " must be Active to be transacted"
                );
                return;
            }

            if (!inv) {
                reject(
                    "Inventory record does not exist for " + item.number +
                    " at " + obj.newRec.site.code
                );
                return;
            }

            if (inv.isActiveCount) {
                reject(
                    "Cannot transact item " + item.number +
                    " in an active inventory count at " +
                    inv.site.code
                );
                return;
            }

            if (item.trace !== "N" && !newRec.trace && newRec.quantity) {
                reject("Lot or serial trace required");
                return;
            }

            if (
                item.trace === "S" &&
                newRec.quantity !== 1 &&
                newRec.quantity !== -1 &&
                newRec.quantity !== 0
            ) {
                reject("Serial transaction quantity must be plus or minus one");
                return;
            }

            if (!curr) {
                reject("No base currency found");
                return;
            }

            if (
                newRec.quantity > 0 &&
                inv.site.locationControlled &&
                !newRec.location
            ) {
                reject("Location required");
                return;
            }

            if (!item.isFractional) {
                newRec.quantity = Math.ceil(newRec.quantity);
            }

            let qty = newRec.quantity || 0;

            if (qty) { // Zero quantity are only cost changes
                newRec.materialCost = {
                    currency: curr.code,
                    amount: item.materialCost.amount.times(qty)
                };
                newRec.laborCost = {
                    currency: curr.code,
                    amount: item.laborCost.amount.times(qty)
                };
                newRec.serviceCost = {
                    currency: curr.code,
                    amount: item.serviceCost.amount.times(qty)
                };
                newRec.overheadCost = {
                    currency: curr.code,
                    amount: item.overheadCost.amount.times(qty)
                };
            } else {
                newRec.materialCost = {
                    currency: curr.code,
                    amount: item.materialCost.amount.times(inv.quantity).minus(
                        inv.materialValue.amount
                    )
                };
                newRec.laborCost = {
                    currency: curr.code,
                    amount: item.laborCost.amount.times(inv.quantity).minus(
                        inv.laborValue.amount
                    )
                };
                newRec.serviceCost = {
                    currency: curr.code,
                    amount: item.serviceCost.amount.times(inv.quantity).minus(
                        inv.serviceValue.amount
                    )
                };
                newRec.overheadCost = {
                    currency: curr.code,
                    amount: item.overheadCost.amount.times(inv.quantity).minus(
                        inv.overheadValue.amount
                    )
                };
            }
            newRec.totalCost = {
                currency: curr.code,
                amount: newRec.materialCost.amount.plus(
                    newRec.laborCost.amount
                ).plus(
                    newRec.serviceCost.amount
                ).plus(
                    newRec.overheadCost.amount
                )
            };

            /*
                A posted transaction is a completed one: its costs are in
                the base currency already and do not move, so they are
                settled -- dated the transaction's date, base amount the
                amount. Every figure and list that adds them up then takes
                them as they are (money_base) instead of looking the base
                currency up for each one (John, Oct 2026).
            */
            [
                newRec.materialCost,
                newRec.laborCost,
                newRec.serviceCost,
                newRec.overheadCost,
                newRec.totalCost
            ].forEach(function (cost) {
                cost.effective = newRec.date || f.today();
                cost.baseAmount = cost.amount;
            });

            newRec.quantityBefore = inv.quantity;
            newRec.quantityAfter = inv.quantity.plus(newRec.quantity);

            resolve();
        }

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Item",
            id: newRec.item.id
        }, true));

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Currency",
            filter: {
                criteria: [{
                    property: "isBase",
                    value: true
                }]
            }
        }, true));

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Inventory",
            filter: {
                criteria: [{
                    property: "item.id",
                    value: newRec.item.id
                }, {
                    property: "site.id",
                    value: newRec.site.id
                }, {
                    property: "status",
                    value: "A"
                }]
            },
            isForUpdate: true
        }, true));

        Promise.all(requests).then(process).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "InventoryTransaction",
    doInsertBeforeInvTrans,
    f.datasource.TRIGGER_BEFORE
);

function doInsertAfterInvTrans(obj) {
    "use strict";

    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let requests = [];

        function process(res) {
            let item = res[0];
            let curr = res[1][0];
            let inv = res[2][0];
            let loc = res[3];
            let trc = res[4];
            let locRec;
            let trcRec;

            requests.length = 0;

            inv.quantity = newRec.quantityAfter;
            inv.materialValue = {
                currency: curr.code,
                amount: newRec.materialCost.amount.plus(
                    inv.materialValue.amount
                )
            };
            inv.laborValue = {
                currency: curr.code,
                amount: newRec.laborCost.amount.plus(
                    inv.laborValue.amount
                )
            };
            inv.serviceValue = {
                currency: curr.code,
                amount: newRec.serviceCost.amount.plus(
                    inv.serviceValue.amount
                )
            };
            inv.overheadValue = {
                currency: curr.code,
                amount: newRec.overheadCost.amount.plus(
                    inv.overheadValue.amount
                )
            };
            inv.totalValue = {
                currency: curr.code,
                amount: newRec.totalCost.amount.plus(
                    inv.totalValue.amount
                )
            };

            // Handle location
            if (loc) {
                locRec = inv.locations.find((l) => l.location.id === loc.id);

                if (locRec) {
                    locRec.quantity = locRec.quantity.plus(newRec.quantity);
                } else {
                    locRec = {
                        location: loc,
                        quantity: newRec.quantity
                    };
                    inv.locations.push(locRec);
                }

                inv.locations.sort(function (a, b) {
                    return a.location.code - b.location.code;
                });

                // Remove if no more quantity in location
                if (locRec.quantity === 0) {
                    inv.locations.splice(inv.locations.indexOf(locRec), 1);
                }

                switch (loc.type) {
                case "N":
                    inv.available = inv.available.plus(
                        newRec.quantity
                    );
                    break;
                case "I":
                    inv.atInspection = inv.atInspection.plus(
                        newRec.quantity
                    );
                    break;
                case "B":
                    inv.blocked = inv.blocked.plus(
                        newRec.quantity
                    );
                    break;
                }
            } else {
                inv.available = newRec.quantityAfter;
            }

            // Handle tracability
            if (newRec.trace) {
                if (loc) {
                    trcRec = inv.traced.find(
                        (r) => r.trace.id === trc.id && r.location.id === loc.id
                    );
                } else {
                    trcRec = inv.traced.find((r) => r.trace.id === trc.id);
                }

                if (trcRec) {
                    if (trcRec.quantity.plus(newRec.quantity) < 0) {
                        reject(
                            "Insufficient quantity " +
                            item.number +
                            " of traced item " +
                            trc.number +
                            " for transaction." +
                            " Only " + trcRec.quantity + " available."
                        );
                        return;
                    }

                    trcRec.quantity = trcRec.quantity.plus(newRec.quantity);
                } else {
                    trcRec = {
                        trace: trc,
                        quantity: newRec.quantity
                    };

                    if (loc) {
                        trcRec.location = loc;
                    }

                    inv.traced.push(trcRec);
                }

                inv.traced.sort(function (a, b) {
                    return a.trace.number - b.trace.number;
                });

                // Remove if no more quantity in location
                if (trcRec.quantity === 0) {
                    inv.traced.splice(inv.traced.indexOf(trcRec), 1);

                    requests.push(
                        f.datasource.request({
                            method: "PATCH",
                            name: "Trace",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            id: trcRec.trace.id,
                            data: [{
                                op: "replace",
                                path: "/isOnHand",
                                value: false
                            }]
                        }, true)
                    );
                }
            }

            // Update inventory value
            requests.push(
                f.datasource.request({
                    method: "POST",
                    name: "Inventory",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    id: inv.id,
                    data: inv
                }, true)
            );

            Promise.all(requests).then(resolve).catch(reject);
        }

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Item",
            id: newRec.item.id
        }));

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Currency",
            filter: {
                criteria: [{
                    property: "isBase",
                    value: true
                }]
            }
        }, true));

        requests.push(f.datasource.request({
            method: "GET",
            client: obj.client,
            name: "Inventory",
            filter: {
                criteria: [{
                    property: "item.id",
                    value: newRec.item.id
                }, {
                    property: "site.id",
                    value: newRec.site.id
                }, {
                    property: "status",
                    value: "A"
                }]
            },
            isForUpdate: true
        }, true));

        if (newRec.location) {
            requests.push(f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Location",
                id: newRec.location.id
            }, true));
        } else {
            requests.push(Promise.resolve(false));
        }

        if (newRec.trace) {
            requests.push(f.datasource.request({
                method: "GET",
                client: obj.client,
                name: "Trace",
                id: newRec.trace.id
            }, true));
        } else {
            requests.push(Promise.resolve(false));
        }

        Promise.all(requests).then(process).catch(reject);
    });
}


f.datasource.registerFunction(
    "POST",
    "InventoryTransaction",
    doInsertAfterInvTrans,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "InventoryTransaction",
    function () {
        return new Promise(function (ignore, reject) {
            reject("Inventory transactions are read only");
        });
    },
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "InventoryTransaction",
    function () {
        return new Promise(function (ignore, reject) {
            reject("Inventory transactions cannot be deleted");
        });
    },
    f.datasource.TRIGGER_BEFORE
);
