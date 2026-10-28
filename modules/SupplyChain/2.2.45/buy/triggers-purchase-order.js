/*jslint unordered devel*/
/*global f*/
async function handleAllocations(obj, isDelete) {
    let delrows = (
        isDelete
        ? obj.oldRec.lines
        : obj.newRec.lines
    );
    let getrows = [];
    let txrows = [];
    let comps = [];
    let resp;

    // Look for lines specifically deleted by update
    if (obj.method === "PATCH" && isDelete) {
        delrows = obj.oldRec.lines.filter(function (ol) {
            let ret = !obj.newRec.lines.find((nl) => nl && nl.id === ol.id);
            if (ret) {
                comps = comps.concat(ol.components);
            }
            return ret;
        });
        delrows = delrows.concat(comps);
        getrows = delrows;

    // Other edits
    } else {
        // Add components to check
        obj.oldRec.lines.forEach(function (ln) {
            let found = (
                isDelete ||
                obj.newRec.lines.find((nl) => nl.id === ln.id)
            );
            if (found) {
                delrows = delrows.concat(found.components);
            }
        });

        // Look for edits where allocation exceeds quanity remaining
        // We'll update those by 'transact'
        if (!isDelete) {
            delrows.forEach(function (row) {
                let diff;

                if (row.status !== "C") {
                    diff = row.allocated.minus(row.quantity);
                    if (diff > 0) {
                        txrows.push({
                            id: row.id,
                            quantity: diff
                        });
                    }
                }
            });
        }

        // Delete allocations where row is closed or where entire order deleted
        delrows = delrows.filter(
            (r) => r && r.allocated && (isDelete || r.status === "C")
        );

        getrows = delrows.concat(txrows);
    }

    // Delete allocations to be deleted
    async function delAllocations() {
        let todel = resp.filter(
            (a) => delrows.some((dr) => a.supply.id === dr.id)
        );
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant();

        while (todel.length) {
            // const per pass: the onCommit callback runs after the loop,
            // so a shared variable would be the last allocation every time
            const del = todel.shift();
            await f.datasource.request({
                client: obj.client,
                id: del.id,
                isHard: true,
                method: "DELETE",
                name: "Allocation"
            });

            // Notify demand if purchase order deleteded or closed
            obj.client.onCommit(async function () {
                await f.datasource.request({
                    data: {
                        allocation: del,
                        quantity: del.quantity,
                        reason: (
                            isDelete
                            ? "delete"
                            : "closed"
                        ),
                        type: "PurchaseOrderLine"
                    },
                    method: "POST",
                    name: "doCreateDeallocationHistory",
                    tenant: theTenant,
                    user: theUser
                });
            });
        }
    }

    // Transact allocations to be reduced
    async function txAllocations() {
        let tx;
        while (txrows.length) {
            tx = txrows.shift();
            await f.datasource.request({
                client: obj.client,
                data: {
                    id: tx.id,
                    quantity: tx.quantity,
                    type: "supply"
                },
                method: "POST",
                name: "doTransactAllocated"
            }, true);
        }
    }

    // Lock allocations to change while getting
    resp = await f.datasource.request({
        client: obj.client,
        filter: {criteria: [{
            property: "supply.id",
            operator: "IN",
            value: getrows.map((c) => c.id)
        }]},
        method: "GET",
        name: "Allocation",
        properties: ["id", "supply", "demand", "quantity"],
        isForUpdate: true
    });
    await delAllocations(resp);
    await txAllocations();
}

function handleDueDates(lines) {
    lines.forEach(function (ln) {
        if (ln === null) {
            return; // deleted
        }
        if (ln.changedDelivery) {
            ln.dueDate = ln.changedDelivery;
        } else if (ln.confirmedDelivery) {
            ln.dueDate = ln.confirmedDelivery;
        } else {
            ln.dueDate = ln.plannedDelivery;
        }
    });
}

function getItems(pClient, lines) {
    let ids = [];
    lines.forEach(function (ln) {
        if (ln === null) {
            return; // Deleted
        }
        ids.push(ln.item.id);
        ln.components = ln.components || [];
        ln.components.forEach(function (c) {
            ids.push(c.item.id);
        });
    });
    return f.datasource.request({
        method: "GET",
        name: "Item",
        properties: ["id", "isFractional", "objectType"],
        client: pClient,
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: ids
        }]}
    }, true);
}

function doBeforeInsert(obj) {
    return new Promise(function (resolve, reject) {
        let n = 1;
        obj.newRec.hasOutsideProcess = false;
        obj.newRec.status = "P";

        function callback(items) {
            // Create placeholder numbers on demands
            obj.newRec.lines.forEach(function (ln) {
                let item = items.find((r) => r.id === ln.item.id);

                ln.line = n;
                n += 1;
                ln.number = f.createId();
                ln.quantity = ln.ordered.times(ln.ratio);
                if (!item.isFractional) {
                    ln.quantity = Math.ceil(ln.quantity);
                }
                if (item.objectType === "Service") {
                    obj.newRec.hasOutsideProcess = true;
                }
            });
            handleDueDates(obj.newRec.lines);
            resolve();
        }

        getItems(obj.client, obj.newRec.lines).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "PurchaseOrder",
    doBeforeInsert,
    f.datasource.TRIGGER_BEFORE
);

function doBeforeUpdate(obj) {
    return new Promise(function (resolve, reject) {
        let n = 1;
        obj.newRec.hasOutsideProcess = false;

        async function callback(items) {
            if (
                obj.newRec.status === "A" &&
                obj.oldRec.status !== "A" &&
                obj.oldRec.status !== "P"
            ) {
                reject(
                    "Purchase Order cannot be changed " +
                    "to Active when there is receiving history"
                );
            }
            if (
                obj.newRec.status === "P" &&
                obj.oldRec.status !== "P" &&
                obj.oldRec.status !== "A"
            ) {
                reject(
                    "Purchase Order cannot be changed " +
                    "to Pending when there is receiving history"
                );
            }

            obj.newRec.lines.forEach(function (ln) {
                let cn = 0;
                let item;

                if (ln === null) {
                    return; // Deleted
                }
                item = items.find((i) => i.id === ln.item.id);
                ln.line = n;
                n += 1;
                ln.number = obj.newRec.number + "\\" + ln.line;
                ln.received = ln.received || 0;
                ln.quantity = ln.ordered.times(ln.ratio).minus(ln.received);
                if (ln.quantity < 0) {
                    ln.quantity = 0;
                }
                if (!item.isFractional) {
                    ln.quantity = Math.ceil(ln.quantity);
                }
                if (item.objectType === "Service") {
                    obj.newRec.hasOutsideProcess = true;
                }
                if (
                    obj.newRec.status === "P" || obj.newRec.status === "A"
                ) {
                    ln.status = obj.newRec.status;
                } else if (obj.newRec.status === "C") {
                    ln.status = "C";
                } else if (ln.received) {
                    ln.backOrdered = ln.quantity;
                    if (ln.received >= ln.ordered) {
                        ln.status = "C";
                    } else {
                        ln.status = "B";
                    }
                }

                ln.components = ln.components || [];
                ln.components.forEach(function (c) {
                    let ord = ln.ordered.times(
                        c.quantityPer
                    ).plus(
                        c.fixedQuantity
                    );
                    let cqty = ord.times(
                        c.ratio
                    ).minus(
                        c.received
                    );
                    item = items.find((i) => i.id === c.item.id);
                    if (!c.item.isFractional) {
                        cqty = Math.ceil(cqty);
                    }
                    cn += 1;
                    c.number = ln.number + "." + cn;
                    c.status = ln.status;
                    c.ordered = ord;
                    c.quantity = cqty;
                    if (c.received) {
                        c.backOrdered = c.quantity;
                    }
                    c.dueDate = ln.dueDate;
                });
            });

            if (
                obj.newRec.lines.every((ln) => ln === null || ln.status === "C")
            ) {
                obj.newRec.status = "C";
            }

            handleDueDates(obj.newRec.lines);
            await handleAllocations(obj, true);
            resolve();
        }

        getItems(obj.client, obj.newRec.lines).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "PATCH",
    "PurchaseOrder",
    doBeforeUpdate,
    f.datasource.TRIGGER_BEFORE
);

/**
  Handle money stuff
*/
function doUpsertPo(obj) {
    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let subt = 0;
        let curr;

        function process(res) {
            if (!res) {
                reject("Currency not found");
                return;
            }

            curr = res.code;

            if (!newRec.freight) {
                newRec.freight = {
                    currency: curr,
                    amount: 0
                };
            }

            if (!newRec.tax) {
                newRec.tax = {
                    currency: curr,
                    amount: 0
                };
            }

            if (!Array.isArray(newRec.lines)) {
                throw new Error("Lines must be an array");
            }

            // Calculate amounts
            newRec.lines.forEach(function (line) {
                let qty;

                if (!line) { // Deleted
                    return;
                }

                if (line) {
                    qty = line.ordered || 0;
                    if (line.price) { // enforce currency propagation
                        line.price.currency = curr;
                    } else {
                        line.price = {
                            currency: curr,
                            amount: 0
                        };
                    }

                    line.amount = {
                        currency: curr,
                        amount: qty.times(
                            line.price.amount
                        )
                    };
                    subt = subt.plus(line.amount.amount);
                }
            });

            // Calculate amounts
            newRec.subtotal = {
                currency: curr,
                amount: subt
            };

            newRec.total = {
                currency: curr,
                amount: subt.plus(
                    newRec.freight.amount
                ).plus(newRec.tax.amount)
            };

            resolve();
        }

        if (!newRec.currency) {
            reject("Currency required");
            return;
        }

        if (
            obj.oldRec &&
            obj.oldRec.currency.id === newRec.currency.id
        ) {
            process({code: obj.oldRec.freight.currency});
            return;
        }

        f.datasource.request({
            method: "GET",
            name: "Currency",
            properties: ["code"],
            client: obj.client,
            id: newRec.currency.id
        }, true).then(process).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "PurchaseOrder",
    doUpsertPo,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "PurchaseOrder",
    doUpsertPo,
    f.datasource.TRIGGER_BEFORE
);

function doAfterInsert(obj) {
    // Update line numbers to match header
    return new Promise(function (resolve, reject) {
        let nr = obj.newRec.number;
        let n = -1;
        let patches = [];
        let requests = [];

        function next() {
            if (!requests.length) {
                resolve();
                return;
            }

            f.datasource.request(
                requests.shift(),
                true
            ).then(next).catch(reject);
        }

        obj.newRec.lines.forEach(function (ln) {
            let lnValue = nr + "\\" + ln.line;
            let cn = -1;

            n += 1;
            patches.push({
                op: "replace",
                path: "/lines/" + n + "/number",
                value: lnValue
            });

            obj.newRec.components = obj.newRec.components || [];
            obj.newRec.components.forEach(function () {
                cn += 1;
                patches.push({
                    op: "replace",
                    path: "/lines/" + n + "/components/" + cn + "number",
                    value: lnValue + "." + (cn + 1)
                });
            });

            requests.push({
                method: "POST",
                name: "doRecalcInventoryOrders",
                client: obj.client,
                user: obj.client.currentUser(),
                data: {
                    itemId: ln.item.id,
                    siteId: ln.site.id
                }
            });
        });

        requests.push({
            method: "PATCH",
            name: "PurchaseOrder",
            client: obj.client,
            user: obj.client.currentUser(),
            id: obj.newRec.id,
            data: patches
        });

        next();
    });
}

f.datasource.registerFunction(
    "POST",
    "PurchaseOrder",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);

function doAfterUpsert(obj) {
    // Update demand and supply
    return new Promise(function (resolve, reject) {
        let requests = [];
        let oldRec = obj.oldRec || {lines: []};
        let newRec = obj.newRec;
        let len1 = Math.max(oldRec.lines.length, newRec.lines.length);
        let n1 = 0;
        let len2;
        let n2 = 0;

        function next() {
            if (!requests.length) {
                resolve();
                return;
            }

            f.datasource.request(
                requests.shift(),
                true
            ).then(next).catch(reject);
        }

        function processRecalc(orec, nrec, dmd, act) {
            function recalcInv(pItemId, pSiteId) {
                requests.push({
                    method: "POST",
                    name: "doRecalcInventoryOrders",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {
                        itemId: pItemId,
                        siteId: pSiteId
                    }
                });
            }

            if (orec && !nrec) {
                recalcInv(orec.item.id, orec.site.id);
            } else if (nrec && !orec) {
                recalcInv(nrec.item.id, nrec.site.id);
            } else if (
                nrec.item.id !== orec.item.id ||
                nrec.site.id !== orec.site.id
            ) {
                recalcInv(nrec.item.id, nrec.site.id);
                recalcInv(orec.item.id, orec.site.id);
            } else if (
                nrec[dmd] !== orec[dmd] ||
                nrec[act] !== orec[act] ||
                nrec.status === "C"
            ) {
                recalcInv(nrec.item.id, nrec.site.id);
            }
        }

        // Detect changes in demands & recalc if applicable
        while (n1 < len1) {
            processRecalc(
                oldRec.lines[n1],
                newRec.lines[n1],
                "ordered",
                "received"
            );

            len2 = Math.max(
                (
                    oldRec.lines[n1]
                    ? oldRec.lines[n1].components.length
                    : 0
                ),
                (
                    newRec.lines[n1]
                    ? newRec.lines[n1].components.length
                    : 0
                )
            );
            while (n2 < len2) {
                processRecalc(
                    (
                        oldRec.lines[n1]
                        ? oldRec.lines[n1].components[n2]
                        : undefined
                    ),
                    (
                        newRec.lines[n1]
                        ? newRec.lines[n1].components[n2]
                        : undefined
                    ),
                    "ordered",
                    "received"
                );
                n2 += 1;
            }
            n1 += 1;
            n2 = 0;
        }

        next();
    });
}

f.datasource.registerFunction(
    "POST",
    "PurchaseOrder",
    doAfterUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "PurchaseOrder",
    doAfterUpsert,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "PurchaseOrder",
    handleAllocations,
    f.datasource.TRIGGER_AFTER
);

function doBeforeDelete(obj) {
    return new Promise(function (resolve, reject) {
        if (obj.oldRec.status === "R") {
            reject("Cannot delete a sales order in receiving");
            return;
        }
        if (obj.oldRec.status === "C") {
            reject("Cannot delete a closed purchase order");
            return;
        }

        handleAllocations(obj, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "PurchaseOrder",
    doBeforeDelete,
    f.datasource.TRIGGER_BEFORE
);

function doAfterDelete(obj) {
    return new Promise(function (resolve, reject) {
        let requests = [];

        function next() {
            if (!requests.length) {
                resolve();
                return;
            }

            f.datasource.request(
                requests.shift(),
                true
            ).then(next).catch(reject);
        }
        function callback(oldRec) {
            oldRec.lines.forEach(function (ln) {
                requests.push({
                    method: "POST",
                    name: "doRecalcInventoryOrders",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {
                        itemId: ln.item.id,
                        siteId: ln.site.id
                    }
                });
            });

            next();
        }

        // Hack: don't pass client so we get old record
        // before this all commits
        f.datasource.request({
            method: "GET",
            name: "PurchaseOrder",
            user: obj.client.currentUser(),
            id: obj.id,
            tenant: obj.client.tenant()
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "PurchaseOrder",
    doAfterDelete,
    f.datasource.TRIGGER_AFTER
);