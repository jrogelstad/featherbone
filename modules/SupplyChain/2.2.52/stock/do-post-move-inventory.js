/*jslint browser devel unordered*/
/*global console*/

function doPostMoveInv(obj) {
    return new Promise(function (resolve, reject) {
        let ids = obj.data.ids || [obj.data.id];
        let pdate = obj.postDate || f.today();
        let eKey = f.createId();
        let posting;

        // The posting request rolls back on failure, so the error is
        // written, and the user alerted, from a separate request once
        // the rollback is done. Without this a move that fails its
        // auto-post after save just stays pending with no explanation.
        function doReject(e) {
            let theUser = obj.client.currentUser();
            let theTenant = obj.client.tenant();
            let message = (
                typeof e === "object" && e !== null
                ? e.message
                : e
            );

            if (posting && posting.length) {
                obj.client.onRollback(async function () {
                    let move;
                    let moves = posting.slice();

                    f.datasource.request({
                        method: "POST",
                        name: "Alert",
                        user: theUser,
                        data: {
                            category: "Move Inventory",
                            severity: "Warning",
                            message: (
                                "One or more inventory moves failed " +
                                "to post due to the following error: " +
                                message
                            ),
                            relation: {
                                code: moves[0].number,
                                id: moves[0].id,
                                objectType: "MoveInventory"
                            }
                        },
                        tenant: theTenant
                    }, true);

                    while (moves.length) {
                        move = moves.shift();

                        await f.datasource.request({
                            method: "PATCH",
                            name: "MoveInventory",
                            user: theUser,
                            id: move.id,
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

        // Wait for any other transaction working on these moves before
        // reading them. The wait is a transaction-scoped advisory lock,
        // the same one f.datasource.lock takes first, so it is released
        // when this transaction ends and leaves no record locked behind.
        // The read below is queued ahead of the locks, so without it a
        // second post of the same move saw status "P" before the first
        // had committed and moved the inventory again. Sorted so
        // overlapping posts cannot deadlock each other.
        async function waitForMoves() {
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

        function fetchMoves() {
            let requests = [
                f.datasource.request({
                    method: "GET",
                    name: "MoveInventory",
                    user: obj.client.currentUser(),
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }, {
                            property: "status",
                            value: "P"
                        }]
                    }
                }, true)
            ];
            // Lock involved moves
            ids.forEach(function (id) {
                requests.push(
                    f.datasource.lock(
                        id,
                        obj.client.currentUser(),
                        eKey,
                        "Post move",
                        obj.client
                    )
                );
            });

            return Promise.all(requests);
        }

        function process(resp) {
            return new Promise(function (resolve, reject) {
                let moves = resp[0];
                let trans = [];
                let err;

                posting = moves;

                moves.forEach(function (move) {
                    if (move.quantity <= 0) {
                        err = "Move quantity must be greater than zero";
                        return;
                    }

                    if (move.item.trace !== "N" && !move.trace) {
                        err = "Move requires trace reference";
                        return;
                    }

                    if (!move.site.locationControlled) {
                        err = "Site is not locaton controlled";
                        return;
                    }

                    trans.push({
                        method: "POST",
                        name: "InventoryTransaction",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            id: f.createId(),
                            document: move.number,
                            reference: move.number,
                            type: "Move Inventory",
                            date: pdate,
                            item: move.item,
                            site: move.site,
                            quantity: move.quantity.times(-1),
                            location: move.fromLocation,
                            trace: move.trace
                        }
                    });

                    trans.push({
                        method: "POST",
                        name: "InventoryTransaction",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            id: f.createId(),
                            document: move.number,
                            reference: move.number,
                            type: "Move Inventory",
                            date: pdate,
                            item: move.item,
                            site: move.site,
                            quantity: move.quantity,
                            location: move.toLocation,
                            trace: move.trace
                        }
                    });

                    trans.push({
                        method: "PATCH",
                        name: "MoveInventory",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        id: move.id,
                        eventKey: eKey,
                        data: [{
                            op: "replace",
                            path: "/status",
                            value: "C"
                        }, {
                            op: "replace",
                            path: "/date",
                            value: pdate
                        }, {
                            op: "replace",
                            path: "/error",
                            value: ""
                        }]
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
            waitForMoves
        ).then(
            fetchMoves
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
    "doPostMoveInventory",
    doPostMoveInv
);