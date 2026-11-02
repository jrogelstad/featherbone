/*jslint browser devel unordered*/
/*global console*/
function doPostInvAdj(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.data.ids || [obj.data.id];
        let pdate = obj.data.postDate || f.today();
        let adjustments;
        let traced = [];
        let eKey = f.createId();

        // The posting request rolls back on failure, so the error is
        // written, and the user alerted, from a separate request once
        // the rollback is done. Without this an adjustment that fails
        // its auto-post after save just stays unposted with no
        // explanation.
        function doReject(e) {
            let theUser = obj.client.currentUser();
            let theTenant = obj.client.tenant();
            let message = (
                typeof e === "object" && e !== null
                ? e.message
                : e
            );

            if (adjustments && adjustments.length) {
                obj.client.onRollback(async function () {
                    let adj;
                    let adjs = adjustments.slice();

                    f.datasource.request({
                        method: "POST",
                        name: "Alert",
                        user: theUser,
                        data: {
                            category: "Inventory Adjustment",
                            severity: "Warning",
                            message: (
                                "One or more inventory adjustments " +
                                "failed to post due to the following " +
                                "error: " + message
                            ),
                            relation: {
                                code: adjs[0].number,
                                id: adjs[0].id,
                                objectType: "InventoryAdjustment"
                            }
                        },
                        tenant: theTenant
                    }, true);

                    while (adjs.length) {
                        adj = adjs.shift();

                        await f.datasource.request({
                            method: "PATCH",
                            name: "InventoryAdjustment",
                            user: theUser,
                            id: adj.id,
                            data: [{
                                op: "replace",
                                path: "/error",
                                value: message
                            }],
                            tenant: theTenant
                        });
                    }
                });
            }
            reject(e);
        }

        // Wait for any other transaction working on these adjustments
        // before reading them. The wait is a transaction-scoped advisory
        // lock, the same one f.datasource.lock takes first, so it is
        // released when this transaction ends and leaves no record
        // locked behind. The read below is queued ahead of the locks, so
        // without it a second post of the same adjustment saw it
        // unposted before the first had committed and adjusted inventory
        // again. Sorted so overlapping posts cannot deadlock each other.
        async function waitForAdjustments() {
            let sorted = ids.slice().sort();
            let n = 0;

            while (n < sorted.length) {
                await obj.client.query(
                    "SELECT pg_advisory_xact_lock(_pk) " +
                    "FROM object WHERE id = $1",
                    [sorted[n]]
                );
                n += 1;
            }
        }

        function fetchAdj() {
            let requests = [
                f.datasource.request({
                    method: "GET",
                    name: "InventoryAdjustment",
                    user: obj.client.currentUser(),
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }, {
                            property: "isPosted",
                            value: false
                        }]
                    }
                }, true)
            ];

            // Lock involved adjustments
            ids.forEach(function (id) {
                requests.push(
                    f.datasource.lock(
                        id,
                        obj.client.currentUser(),
                        eKey,
                        "Post adjustment",
                        obj.client
                    )
                );
            });

            return Promise.all(requests);
        }

        function fetchInv(resp) {
            adjustments = resp[0];
            let requests = [];

            function getInv(adj) {
                return new Promise(function (resolve, reject) {
                    function callback(resp) {
                        if (resp.length !== 1) {
                            reject("Inventory record not found");
                            return;
                        }
                        adj.inventory = resp[0];
                        resolve();
                    }

                    f.datasource.request({
                        method: "GET",
                        name: "Inventory",
                        user: obj.client.currentUser(),
                        client: obj.client,
                        properties: ["id", "allocated", "quantity"],
                        filter: {
                            criteria: [{
                                property: "item.id",
                                value: adj.item.id
                            }, {
                                property: "site.id",
                                value: adj.site.id
                            }]
                        }
                    }, true).then(callback).catch(reject);
                });
            }

            adjustments.forEach(function (adj) {
                if (adj.type === "O") {
                    // If adjusting out, need inventory record
                    // to evaluate if allocations impacted
                    requests.push(getInv(adj));
                }
            });

            return Promise.all(requests);
        }

        function fetchTrc() {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let next;

                adjustments.forEach(function (adj) {
                    adj.details.forEach(function (dtl) {
                        if (dtl.trace) {
                            requests.push({
                                method: "GET",
                                name: "Trace",
                                client: obj.client,
                                filter: {
                                    criteria: [{
                                        property: "number",
                                        value: dtl.trace
                                    }]
                                }
                            });
                        }
                    });
                });

                function callback(resp) {
                    if (resp.length) {
                        traced.push(resp[0]);
                    }

                    next();
                }

                next = function () {
                    if (!requests.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        requests.shift(),
                        true
                    ).then(callback).catch(reject);
                };

                next();
            });
        }

        function process() {
            return new Promise(function (resolve, reject) {
                let trans = [];
                let err;

                adjustments.forEach(function (adj) {
                    let qty = 0;
                    let unalc = 0;

                    if (adj.quantity <= 0) {
                        err = "Adjustment quantity must be greater than zero";
                        return;
                    }

                    if (adj.site.locationControlled || adj.item.trace !== "N") {
                        if (!adj.details.length) {
                            err = "Adjustment requires detail records";
                            return;
                        }

                        adj.details.forEach(function (row) {
                            qty = qty.plus(row.quantity);
                        });

                        if (qty !== adj.quantity) {
                            err = "Adjustment quantity must match detail";
                            return;
                        }
                    }

                    if (
                        adj.type === "O" &&
                        adj.inventory.allocated
                    ) {
                        unalc = adj.inventory.quantity.minus(
                            adj.inventory.allocated
                        );
                        if (unalc >= adj.quantity) {
                            unalc = 0;
                        } else {
                            unalc = Math.min(
                                adj.quantity.minus(unalc),
                                adj.inventory.allocated
                            );
                        }

                        if (unalc) {
                            trans.push({
                                client: obj.client,
                                method: "POST",
                                name: "doTransactAllocated",
                                user: obj.client.currentUser(),
                                data: {
                                    id: adj.inventory.id,
                                    quantity: unalc,
                                    type: "supply",
                                    isLifo: true,
                                    adjustId: adj.id
                                }
                            });
                        }
                    }
                    if (!adj.details.length) {
                        trans.push({
                            method: "POST",
                            name: "InventoryTransaction",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            data: {
                                id: f.createId(),
                                document: adj.number,
                                reference: adj.number,
                                type: "Adjustment",
                                date: pdate,
                                item: adj.item,
                                site: adj.site,
                                quantity: (
                                    adj.type === "I"
                                    ? adj.quantity
                                    : adj.quantity.times(-1)
                                ),
                                comments: adj.comments
                            }
                        });
                    } else {
                        adj.details.forEach(function (row) {
                            let found;
                            let tx = {
                                method: "POST",
                                name: "InventoryTransaction",
                                client: obj.client,
                                user: obj.client.currentUser(),
                                data: {
                                    id: f.createId(),
                                    document: adj.number,
                                    reference: adj.number,
                                    type: "Adjustment",
                                    date: pdate,
                                    item: adj.item,
                                    site: adj.site,
                                    quantity: (
                                        adj.type === "I"
                                        ? row.quantity
                                        : row.quantity.times(-1)
                                    ),
                                    comments: adj.comments
                                }
                            };

                            if (row.location) {
                                tx.data.location = row.location;
                            }

                            if (row.trace) {
                                found = traced.find(
                                    (t) => t.number === row.trace
                                );

                                if (!found) {
                                    found = {
                                        id: f.createId(),
                                        number: row.trace,
                                        type: adj.item.trace,
                                        item: adj.item,
                                        date: pdate,
                                        isOnHand: true
                                    };
                                    traced.push(found);
                                    trans.push({
                                        method: "POST",
                                        name: "Trace",
                                        client: obj.client,
                                        user: obj.client.currentUser(),
                                        data: found
                                    });
                                }

                                if (!found.isOnHand) {
                                    trans.push({
                                        method: "PATCH",
                                        name: "Trace",
                                        client: obj.client,
                                        user: obj.client.currentUser(),
                                        id: found.id,
                                        data: [{
                                            op: "replace",
                                            path: "/isOnHand",
                                            value: true
                                        }]
                                    });
                                }

                                tx.data.trace = found;
                            }

                            trans.push(tx);
                        });
                    }

                    trans.push({
                        method: "PATCH",
                        name: "InventoryAdjustment",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        id: adj.id,
                        eventKey: eKey,
                        data: [{
                            op: "replace",
                            path: "/isPosted",
                            value: true
                        }, {
                            op: "replace",
                            path: "/postedDate",
                            value: pdate
                        }, {
                            op: "replace",
                            path: "/error",
                            value: ""
                        }]
                    }, {
                        method: "POST",
                        name: "doRecalcInventoryOrders",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            itemId: adj.item.id,
                            siteId: adj.site.id
                        }
                    });
                });

                function next() {
                    if (!trans.length) {
                        resolve();
                        return;
                    }

                    f.datasource.request(
                        trans.shift(),
                        true
                    ).then(next).catch(reject);
                }

                if (err) {
                    reject(err);
                    return;
                }

                next();
            });
        }

        Promise.resolve().then(
            waitForAdjustments
        ).then(
            fetchAdj
        ).then(
            fetchInv
        ).then(
            fetchTrc
        ).then(
            process
        ).then(
            resolve
        ).catch(
            doReject
        );
    });
}

f.datasource.registerFunction(
    "POST",
    "doPostInventoryAdjustment",
    doPostInvAdj
);