/*jslint browser devel unordered*/
/*global console*/
async function doPost(obj) {
    let ids = obj.data.ids || [obj.data.id];
    let pdate = obj.shipDate || f.today();
    let receipts;
    let traced = [];
    let eKey = f.createId();
    let wos;

    // Update downstream work order records
    async function updateDownstream(pwo, qty) {
        let dwos;
        let dwo;
        let dw = [];
        let avail = 0;
        let dalcs;
        let found;

        function calcAvail(mtl) {
            let malcs = dalcs.filter(
                (a) => a.demand.id === mtl.id
            );
            let malc;
            let mavail;

            // Assume unallocated available
            mavail = mtl.quantityDue.minus(mtl.allocated);
            // For allocations, exclude upstream work orders
            while (malcs.length) {
                malc = malcs.shift();
                // Now only counting upstream work order supply as
                // unavailable
                if (malc.supply.objectType !== "WorkOrder") {
                    mavail += malc.quantity;
                }
            }
            if (!mtl.fixedQuantity) {
                mavail = mavail.div(mtl.quantityPer).div(mtl.ratio);
                if (mavail < avail) {
                    avail = mavail;
                }
                // TODO: Take yield into account
            } else if (
                mtl.fixedQuantity &&
                !mtl.quantityPer &&
                mavail >= mtl.fixedQuantity &&
                mavail < avail
            ) {
                avail = mavail;
            }
        }

        // First find if this is allocated to downstream requirements
        let salcs = await f.datasource.request({
            method: "GET",
            name: "Allocation",
            client: obj.client,
            filter: {criteria: [{
                property: "supply.id",
                value: pwo.id
            }, {
                property: "demand.objectType",
                value: "WorkOrderRequirement"
            }]},
            properties: ["id", "demand", "supply"]
        }, true);

        if (salcs.length) {
            // Get the requirements so we know the work order
            // they belong to
            let reqs = await f.datasource.request({
                method: "GET",
                name: "WorkOrderRequirement",
                client: obj.client,
                filter: {criteria: [{
                    property: "id",
                    operator: "IN",
                    value: salcs.map((a) => a.demand.id)
                }]},
                properties: ["id", "workOrder"]
            }, true);

            // Get the work order records that would be updated
            dwos = await f.datasource.request({
                method: "GET",
                name: "WorkOrder",
                client: obj.client,
                filter: {criteria: [{
                    property: "id",
                    operator: "IN",
                    value: reqs.map((r) => r.workOrder.id)
                }, {
                    property: "status",
                    operator: "IN",
                    value: ["P", "A"]
                }]},
                properties: ["id", "operations", "materials", "ordered"]
            }, true);

            // Loop through work order records
            let op;
            let mtls = [];
            let alc;
            while (dwos.length) {
                dwo = dwos.shift();
                // If first operation needs this material,
                // recalc available
                op = dwo.operations[0];
                if (op) {
                    mtls = dwo.materials.filter(
                        (m) => (
                            m.operation === op.sequence &&
                            m.quantityDue > 0
                        )
                    );
                }
                // Find specific requirement with matching allocation
                found = mtls.find(function (m) {
                    alc = salcs.find((a) => a.demand.id === m.id);
                    if (alc) {
                        return true;
                    }
                    return false;
                });

                if (found) {
                    avail = dwo.ordered;

                    // Remove allocation, unallocated are considered
                    // available
                    found.allocated = found.allocated.minus(qty);

                    // Check through materials again to see what we have
                    // available. May still be waiting on other upstream
                    // products
                    dalcs = await f.datasource.request({
                        method: "GET",
                        name: "Allocation",
                        client: obj.client,
                        filter: {criteria: [{
                            property: "demand.id",
                            operator: "IN",
                            value: mtls.map((m) => m.id)
                        }]},
                        properties: [
                            "id",
                            "demand",
                            "supply",
                            "quantity"
                        ]
                    }, true);
                    mtls.forEach(calcAvail);

                    if (avail) {
                        dw.push({
                            method: "PATCH",
                            name: "WorkOrder",
                            client: obj.client,
                            user: obj.client.currentUser(),
                            id: dwo.id,
                            data: [{
                                op: "replace",
                                path: "/operations/0/available",
                                value: avail
                            }]
                        });
                    }
                }
            }
        }

        while (dw.length) {
            await f.datasource.request(dw.shift(), true);
        }
    }

    // Wait for any other transaction working on these records before
    // reading them. The wait is a transaction-scoped advisory lock, the
    // same one f.datasource.lock takes first, so it is released when this
    // transaction ends and leaves no record locked behind. Without it a
    // second post read the receipt as "P" (and the work order as it was)
    // before the first had committed, then waited at the lock and posted
    // again. Sorted so overlapping posts cannot deadlock each other.
    async function waitForRecords(recordIds) {
        let sorted = recordIds.filter(
            (id, i, all) => all.indexOf(id) === i
        ).sort();
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

    async function fetchReceipts() {
        return await f.datasource.request({
            method: "GET",
            name: "WorkOrderReceipt",
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
        }, true);
    }

    function fetchTrc(resp) {
        return new Promise(function (resolve, reject) {
            let requests = [];
            let next;

            receipts = resp;

            receipts.forEach(function (rcpt) {
                rcpt.details.forEach(function (dtl) {
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

    async function fetchWos() {
        // Wait before the read below, which is queued ahead of the locks
        await waitForRecords(receipts.map((r) => r.workOrder.id));

        let requests = [
            f.datasource.request({
                method: "GET",
                name: "WorkOrder",
                client: obj.client,
                filter: {
                    criteria: [{
                        property: "id",
                        operator: "IN",
                        value: receipts.map((r) => r.workOrder.id)
                    }]
                }
            }, true)
        ];

        // Lock involved receipts and work orders
        receipts.forEach(function (rcpt) {
            if (obj.data.lock !== false) {
                requests.push(
                    f.datasource.lock(
                        rcpt.id,
                        obj.client.currentUser(),
                        eKey,
                        "Post work order receipt",
                        obj.client
                    )
                );
            }
            requests.push(
                f.datasource.lock(
                    rcpt.workOrder.id,
                    obj.client.currentUser(),
                    eKey,
                    "Post work order receipt",
                    obj.client
                )
            );
        });

        return Promise.all(requests);
    }

    function fetchItemSites(resp) {
        let itemIds = [];
        let siteIds = [];
        wos = resp[0];

        wos.forEach(function (wo) {
            wo.materials.forEach(function (mtl) {
                if (itemIds.indexOf(mtl.item.id) === -1) {
                    itemIds.push(mtl.item.id);
                }
            });
            if (siteIds.indexOf(wo.site.id) === -1) {
                siteIds.push(wo.site.id);
            }
        });

        return f.datasource.request({
            method: "GET",
            name: "ItemSite",
            properties: [
                "id",
                "item",
                "site",
                "wipLocation",
                "defaultLocation",
                "planningPolicy",
                "issueMethod"
            ],
            client: obj.client,
            user: obj.client.currentUser(),
            filter: {criteria: [{
                property: "item.id",
                operator: "IN",
                value: itemIds
            }, {
                property: "site.id",
                operator: "IN",
                value: siteIds
            }]}
        }, true);
    }

    async function process(resp) {
        let itemSites = resp;
        let trans = [];
        let err;
        let idx = 0;
        let rcpt;
        let wo;

        // This is after thought. Whole body of
        // code should be redone with async
        while (idx < receipts.length) {
            rcpt = receipts[idx];
            idx += 1;
            wo = wos.find((w) => w.id === rcpt.workOrder.id);
            if (wo.allocated) {
                await updateDownstream(wo, rcpt.quantity);
            }
        }

        // 'Every' loop will stop on error
        receipts.every(function (receipt) {
            wo = wos.find((w) => w.id === receipt.workOrder.id);
            let woTx = {
                method: "PATCH",
                name: "WorkOrder",
                client: obj.client,
                user: obj.client.currentUser(),
                id: receipt.workOrder.id,
                eventKey: eKey,
                data: []
            };
            let lbrcst = wo.actualLaborCost.amount;
            let ovrcst = wo.actualOverheadCost.amount;
            let matcst = wo.actualMaterialCost.amount;
            let svccst = wo.actualServiceCost.amount;
            let ttlcst = wo.actualTotalCost.amount;
            let prevRcvd = wo.received;

            // Handle receipts
            // 'Every' loop will stop on error
            let qty = 0;
            let unalc = 0;
            idx = 0;

            if (receipt.quantity <= 0) {
                err = "Quantity must be positive";
                return false;
            }

            if (receipt.workOrder.allocated > 0) {
                if (receipt.quantity > wo.allocated) {
                    unalc = wo.allocated;
                } else {
                    unalc = receipt.quantity;
                }
            }

            if (
                receipt.quantity > 0 &&
                (
                    receipt.site.locationControlled ||
                    wo.item.trace !== "N"
                )
            ) {
                if (!receipt.details.length) {
                    err = "Receipt requires detail records";
                    return false;
                }

                receipt.details.forEach(function (row) {
                    qty = qty.plus(row.quantity);
                });

                if (qty !== receipt.quantity) {
                    err = (
                        "Receipt line quantity must match detail"
                    );
                    return false;
                }
            } else {
                qty = receipt.quantity;
            }

            if (!qty) {
                return;
            }

            wo.received = wo.received.plus(qty);
            wo.quantity = Math.max(wo.quantity.minus(qty), 0);

            woTx.data.push({
                op: "replace",
                path: "/received",
                value: wo.received
            }, {
                op: "replace",
                path: "/quantity",
                value: wo.quantity
            });

            // Reduce allocations
            if (unalc) {
                trans.push({
                    client: obj.client,
                    method: "POST",
                    name: "doTransactAllocated",
                    user: obj.client.currentUser(),
                    eventKey: eKey,
                    data: {
                        id: wo.id,
                        quantity: unalc,
                        type: "supply",
                        reallocate: true
                    }
                });
            }

            if (!receipt.details.length) {
                trans.push({
                    method: "POST",
                    name: "InventoryTransaction",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {
                        id: f.createId(),
                        document: receipt.number,
                        reference: wo.number,
                        type: "Work Order Receipt",
                        date: pdate,
                        item: wo.item,
                        site: receipt.site,
                        quantity: qty
                    }
                });
            } else {
                receipt.details.forEach(function (row) {
                    trans.push({
                        method: "POST",
                        name: "InventoryTransaction",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            id: f.createId(),
                            document: receipt.number,
                            reference: wo.number,
                            type: "Work Order Receipt",
                            date: pdate,
                            item: wo.item,
                            site: receipt.site,
                            quantity: row.quantity,
                            location: row.location,
                            trace: traced.find(
                                (t) => row.trace === t.number
                            )
                        }
                    });
                });
            }

            trans.push({
                method: "PATCH",
                name: "WorkOrderReceipt",
                client: obj.client,
                user: obj.client.currentUser(),
                id: receipt.id,
                eventKey: eKey,
                data: [{
                    op: "replace",
                    path: "/status",
                    value: "R"
                }, {
                    op: "replace",
                    path: "/receiptDate",
                    value: pdate
                }]
            });

            // Handle operation completions
            let complQty;
            let nextOp;
            let oldOps = f.copy(wo.operations); // Deep copy
            let ops = wo.operations.slice(); // Shallow copy

            ops.sort(function (a, b) {
                return b.sequence - a.sequence;
            });

            complQty = (
                ops.length
                ? Math.max(
                    wo.received.minus(ops[0].completed),
                    0
                )
                : wo.received
            );

            ops.every(function (op) {
                let yld = op.yield.times(0.01);
                idx = wo.operations.indexOf(op);

                if (op.status === "C") {
                    if (nextOp && nextOp.completed > op.completed) {
                        err = (
                            "Can not report completion quantity " +
                            "greater than previous closed operation"
                        );
                    }
                    return false; // Stop 'every' loop
                }

                if (nextOp && op.sequence < nextOp.sequence) {
                    if (complQty <= op.completed) {
                        return false; // Already reported, stop loop
                    }

                    // Report completion expected up to this point
                    complQty = complQty.minus(op.completed);
                }

                // Apply setup cost if applicable
                if (!op.completed && op.setupTime) {
                    lbrcst = lbrcst.plus(
                        op.setupTime.times(op.laborCost.amount)
                    );
                    ovrcst = ovrcst.plus(
                        op.setupTime.times(op.overheadCost.amount)
                    );
                }

                // Run cost
                lbrcst = lbrcst.plus(
                    op.laborCost.amount.times(
                        op.runTime.div(op.planned) // unit time
                    ).times(
                        complQty
                    )
                );
                ovrcst = ovrcst.plus(
                    op.overheadCost.amount.times(
                        op.runTime.div(op.planned) // unit time
                    ).times(
                        complQty
                    )
                );

                op.completed = op.completed.plus(complQty);
                op.remaining = Math.max(
                    op.planned.minus(op.completed),
                    0
                );

                woTx.data.push({
                    op: "replace",
                    path: "/operations/" + idx + "/completed",
                    value: op.completed
                }, {
                    op: "replace",
                    path: "/operations/" + idx + "/remaining",
                    value: op.remaining
                }, {
                    op: "replace",
                    path: "/operations/" + idx + "/status",
                    value: (
                        op.planned.minus(op.completed) <= 0
                        ? "C"
                        : "I"
                    )
                });
                nextOp = op;
                // Recalculate where preceding operation "should" be
                complQty = op.completed.div(yld);
                return true;
            });

            if (err) {
                return false;
            }

            // Handle materials
            let matls = wo.materials.filter(
                (m) => m.status !== "C" && m.item.type === "I"
            );

            matls.forEach(function (matl) {
                let is;
                let loc;
                let toIss;
                let doneQty;
                let op;
                let oldOp;
                unalc = 0;
                idx = wo.materials.indexOf(matl);

                if (matl.item.trace !== "N") {
                    return;  // Don't backflush traced
                }

                is = itemSites.find(
                    (r) => (
                        r.site.id === matl.site.id &&
                        r.item.id === matl.item.id
                    )
                );

                if (is.issueMethod === "M") {
                    return;  // Don't backflush manual
                }

                if (receipt.site.locationControlled) {
                    loc = (
                        is.wipLocation ||
                        receipt.site.defaultWipLocation ||
                        is.defaultLocation ||
                        receipt.site.defaultLocation
                    );
                }

                if (!matl.operation) {
                    doneQty = wo.received.minus(prevRcvd);
                } else {
                    op = wo.operations.find(
                        (o) => o.sequence === matl.operation
                    );

                    if (op) {
                        oldOp = oldOps.find(
                            (oo) => oo.sequence === op.sequence
                        );

                        doneQty = op.completed.minus(
                            oldOp.completed
                        );
                    }
                }

                toIss = doneQty.times(
                    matl.quantityPer
                ).times(matl.ratio);

                if (matl.fixedQuantity && !matl.issued) {
                    toIss = toIss.plus(
                        matl.fixedQuantity
                    ).times(matl.ratio);
                }

                if (!matl.item.isFractional) {
                    toIss = Math.ceil(toIss);
                }

                if (toIss) {
                    matl.issued = matl.issued.plus(toIss);
                    matl.actualCost.amount = matl.actualCost.amount.plus(
                        toIss.times(matl.item.cost.amount)
                    );
                    // Each bucket takes the component's matching bucket.
                    // The component's total cost used to be added to
                    // material here as well, counting it twice.
                    matcst = matcst.plus(
                        toIss.times(is.item.materialCost.amount)
                    );
                    lbrcst = lbrcst.plus(
                        toIss.times(is.item.laborCost.amount)
                    );
                    ovrcst = ovrcst.plus(
                        toIss.times(is.item.overheadCost.amount)
                    );
                    svccst = svccst.plus(
                        toIss.times(is.item.serviceCost.amount)
                    );

                    // Reduce allocations
                    if (is.planningPolicy !== "R") {
                        trans.push({
                            client: obj.client,
                            method: "POST",
                            name: "doTransactAllocated",
                            user: obj.client.currentUser(),
                            eventKey: eKey,
                            data: {
                                id: matl.id,
                                quantity: toIss,
                                type: "demand"
                            }
                        });
                    }

                    trans.push({
                        method: "POST",
                        name: "InventoryTransaction",
                        client: obj.client,
                        user: obj.client.currentUser(),
                        data: {
                            id: f.createId(),
                            reference: matl.number,
                            document: receipt.number,
                            type: "Work Order Issue",
                            date: pdate,
                            item: matl.item,
                            site: receipt.site,
                            quantity: toIss.times(-1),
                            location: loc
                        }
                    });
                    woTx.data.push({
                        op: "replace",
                        path: `/materials/${idx}/issued`,
                        value: matl.issued
                    });
                    woTx.data.push({
                        op: "replace",
                        path: (
                            `/materials/${idx}/actualCost/amount`
                        ),
                        value: matl.actualCost.amount
                    });
                    woTx.data.push({
                        op: "replace",
                        path: `/materials/${idx}/status`,
                        value: (
                            matl.issued >= matl.required
                            ? "C"
                            : "I"
                        )
                    });
                }
            });

            // Update actual cost. The total is always the sum of the four
            // buckets. It used to start from the existing total and add
            // each changed bucket in full, counting what was already in
            // the total again.
            ttlcst = lbrcst.plus(ovrcst).plus(matcst).plus(svccst);
            if (wo.actualLaborCost.amount !== lbrcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualLaborCost",
                    value: {
                        currency: wo.actualLaborCost.currency,
                        amount: lbrcst
                    }
                });
            }
            if (wo.actualOverheadCost.amount !== ovrcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualOverheadCost",
                    value: {
                        currency: wo.actualOverheadCost.currency,
                        amount: ovrcst
                    }
                });
            }
            if (wo.actualMaterialCost.amount !== matcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualMaterialCost",
                    value: {
                        currency: wo.actualMaterialCost.currency,
                        amount: matcst
                    }
                });
            }
            if (wo.actualServiceCost.amount !== svccst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualServiceCost",
                    value: {
                        currency: wo.actualServiceCost.currency,
                        // This wrote the material cost into service cost
                        amount: svccst
                    }
                });
            }
            if (wo.actualTotalCost.amount !== ttlcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualTotalCost",
                    value: {
                        currency: wo.actualTotalCost.currency,
                        amount: ttlcst
                    }
                });
            }
            trans.push(woTx);

            return true;
        });

        if (err) {
            return Promise.reject(err);
        }

        while (trans.length) {
            await f.datasource.request(trans.shift(), true);
        }
    }

    let resp;
    try {
        // Callers that pass `lock: false` already hold the receipts
        if (obj.data.lock !== false) {
            await waitForRecords(ids);
        }
        resp = await fetchReceipts();
        resp = await fetchTrc(resp);
        resp = await fetchWos(resp);
        resp = await fetchItemSites(resp);
        return await process(resp);
    } catch (e) {
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant();
        let theId;
        let rcpt;
        let msg = (
            typeof e === "string"
            ? e
            : e.message
        );

        // receipts is unset if the wait failed before they were read
        while (receipts && receipts.length) {
            rcpt = receipts.shift();
            theId = rcpt.id;

            obj.client.onRollback(async function () {
                await f.datasource.request({
                    method: "PATCH",
                    name: "WorkOrderReceipt",
                    user: theUser,
                    id: theId,
                    data: [{
                        op: "replace",
                        path: "/error",
                        value: msg
                    }],
                    tenant: theTenant
                }, true);
            });
            obj.client.onRollback(async function () {
                await f.datasource.request({
                    method: "POST",
                    name: "Alert",
                    user: theUser,
                    data: {
                        category: "Work Order Receipt",
                        severity: "Critical",
                        message: msg,
                        relation: {
                            code: rcpt.number,
                            id: theId,
                            objectType: "WorkOrderReceipt"
                        }
                    },
                    tenant: theTenant
                }, true);
            });
        }
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doPostWorkOrderReceipts",
    doPost
);