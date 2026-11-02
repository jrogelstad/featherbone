/*jslint browser devel unordered*/
/*global console*/
const pending = [];

async function doWOIssue(obj) {
    let ids = obj.data.ids || [obj.data.id];
    let pdate = obj.date || f.today();
    let issues;
    let wos;
    let eKey = f.createId();
    let itemSites = [];
    let e;
    let theId;

    ids.forEach(function (id) {
        if (pending.indexOf(id) !== -1) {
            e = "Issue posting is already in progress";
        }
    });
    if (e) {
        throw e;
    }
    ids.forEach(function (id) {
        pending.push(id);
    });

    // Wait for any other transaction working on these issues before
    // reading them. The wait is a transaction-scoped advisory lock, the
    // same one f.datasource.lock takes first, so it is released when this
    // transaction ends and leaves no record locked behind. Without it a
    // second post of the same issue read status "P" before the first had
    // committed, then waited at the lock below and issued the materials
    // again. Sorted so overlapping posts cannot deadlock each other.
    async function waitForIssues() {
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

    function fetchIssues() {
        return f.datasource.request({
            method: "GET",
            name: "WorkOrderIssue",
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

    async function fetchWorkOrders() {
        // Lock involved issue and work orders
        let n = 0;
        let wi;
        while (n < issues.length) {
            wi = issues[n];
            n += 1;
            await f.datasource.lock(
                wi.id,
                obj.client.currentUser(),
                eKey,
                "Post work order issue",
                obj.client
            );
            await f.datasource.lock(
                wi.workOrder.id,
                obj.client.currentUser(),
                eKey,
                "Post work order issues",
                obj.client
            );
        }

        return f.datasource.request({
            method: "GET",
            name: "WorkOrder",
            user: obj.client.currentUser(),
            client: obj.client,
            properties: [
                "id",
                "materials",
                "operations",
                "onHold",
                "status",
                "actualLaborCost",
                "actualMaterialCost",
                "actualOverheadCost",
                "actualServiceCost",
                "actualTotalCost"
            ],
            filter: {
                criteria: [{
                    property: "id",
                    operator: "IN",
                    value: issues.map((i) => i.workOrder.id)
                }]
            }
        }, true);
    }

    function fetchItemSites() {
        let itemIds = [];
        let siteIds = [];

        function addIds(row) {
            let mr = row.materialRequirement;
            if (itemIds.indexOf(mr.item.id) === -1) {
                itemIds.push(mr.item.id);
            }
            if (siteIds.indexOf(mr.site.id) === -1) {
                siteIds.push(mr.site.id);
            }
        }

        issues.forEach(function (iss) {
            iss.materials.forEach(addIds);
        });

        return f.datasource.request({
            method: "GET",
            name: "ItemSite",
            properties: [
                "id",
                "item",
                "site",
                "defaultLocation",
                "wipLocation",
                "planningPolicy"
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

    async function process() {
        let trans = [];
        let err;

        issues.forEach(function (iss) {
            theId = iss.id;
            let woStatus = "C";
            let woTx = {
                method: "PATCH",
                name: "WorkOrder",
                client: obj.client,
                id: iss.workOrder.id,
                eventKey: eKey,
                data: []
            };
            let wo = wos.find((w) => w.id === iss.workOrder.id);
            let lbrcst = wo.actualLaborCost.amount;
            let matcst = wo.actualMaterialCost.amount;
            let ovhcst = wo.actualOverheadCost.amount;
            let svccst = wo.actualServiceCost.amount;
            let ttlcst = 0;

            iss.materials.every(function (mtl) {
                let toIss = 0;
                let womatl = mtl.materialRequirement;
                let is = itemSites.find(
                    (r) => (
                        r.site.id === womatl.site.id &&
                        r.item.id === womatl.item.id
                    )
                );
                let sense = 1;
                let txtype = "issued";
                let txname = "Issue";

                if (mtl.quantity < 0) {
                    sense = -1;
                    txtype = "returned";
                    txname = "Return";
                    /*
                    err = "Line quantity must be positive";
                    // TODO Allow returns
                    return false;
                    */
                }

                if (mtl.quantity) {
                    if (
                        iss.workOrder.site.locationControlled ||
                        womatl.item.trace !== "N"
                    ) {
                        if (!mtl.details.length) {
                            err = "Material to issue requires detail records";
                            return false;
                        }

                        mtl.details.forEach(function (row) {
                            toIss = toIss.plus(row.quantity);
                        });

                        if (toIss !== mtl.quantity) {
                            err = (
                                "Material quantity must " +
                                "match detail"
                            );
                            return false;
                        }
                    } else {
                        toIss = mtl.quantity;
                    }
                }

                if (!toIss) {
                    return true;
                }

                if (
                    !womatl.item.isFractional &&
                    Math.ceil(toIss) !== toIss
                ) {
                    toIss = Math.ceil(Math.abs(toIss)).times(sense);
                }

                if (toIss) {
                    womatl[txtype] = womatl[txtype].plus(Math.abs(toIss));
                    womatl.actualCost.amount = womatl.actualCost.amount.plus(
                        toIss.times(womatl.item.cost.amount)
                    );
                    matcst = matcst.plus(
                        toIss.times(is.item.materialCost.amount)
                    );
                    lbrcst = lbrcst.plus(
                        toIss.times(is.item.laborCost.amount)
                    );
                    ovhcst = ovhcst.plus(
                        toIss.times(is.item.overheadCost.amount)
                    );
                    svccst = svccst.plus(
                        toIss.times(is.item.serviceCost.amount)
                    );

                    woTx.data.push({
                        op: "replace",
                        path: `/materials/${womatl.sequence - 1}/${txtype}`,
                        value: womatl[txtype]
                    });
                    woTx.data.push({
                        op: "replace",
                        path: `/materials/${womatl.sequence - 1}/status`,
                        value: (
                            womatl.issued.minus(
                                womatl.returned
                            ) < womatl.required
                            ? "I"
                            : "C"
                        )
                    });
                    woTx.data.push({
                        op: "replace",
                        path: (
                            `/materials/${
                                womatl.sequence - 1
                            }/actualCost/amount`
                        ),
                        value: womatl.actualCost.amount
                    });

                    // Transact issued product if it's inventory
                    if (womatl.item.type === "I") {
                        // Reduce allocations
                        // txtype is "issued" or "returned"; this compared
                        // it to "issue", so it never relieved allocations
                        if (
                            is.planningPolicy !== "R" &&
                            txtype === "issued"
                        ) {
                            trans.push({
                                client: obj.client,
                                method: "POST",
                                name: "doTransactAllocated",
                                user: obj.client.currentUser(),
                                data: {
                                    id: womatl.id,
                                    quantity: toIss,
                                    type: "demand",
                                    updatePlanStatus: false
                                }
                            });
                        }

                        if (!mtl.details.length) {
                            trans.push({
                                method: "POST",
                                name: "InventoryTransaction",
                                client: obj.client,
                                user: obj.client.currentUser(),
                                data: {
                                    id: f.createId(),
                                    document: iss.number,
                                    reference: womatl.number,
                                    type: "Work Order " + txname,
                                    date: pdate,
                                    item: womatl.item,
                                    site: womatl.site,
                                    quantity: toIss.times(-1)
                                }
                            });
                        } else {
                            mtl.details.forEach(function (row) {
                                trans.push({
                                    method: "POST",
                                    name: "InventoryTransaction",
                                    client: obj.client,
                                    user: obj.client.currentUser(),
                                    data: {
                                        id: f.createId(),
                                        reference: womatl.number,
                                        document: iss.number,
                                        type: (
                                            "Work Order " + txname
                                        ),
                                        date: pdate,
                                        item: womatl.item,
                                        site: womatl.site,
                                        quantity: row.quantity.times(-1),
                                        location: row.location,
                                        trace: row.trace
                                    }
                                });
                            });
                        }
                    }
                }

                return true;
            });

            // Determine work order status
            wo.materials.some(function (mtl) {
                let womatl = iss.materials.find((m) => m.id === mtl.id);
                if (womatl) {
                    if (womatl.issued < mtl.required) {
                        woStatus = "I";
                        return false;
                    }
                } else {
                    if (mtl.issued < mtl.required) {
                        woStatus = "I";
                        return false;
                    }
                }
            });
            if (woStatus !== "I") {
                wo.operations.some(function (op) {
                    if (op.status !== "C") {
                        woStatus = "I";
                        return false;
                    }
                });
            }
            woTx.data.push({
                op: "replace",
                path: "/status",
                value: woStatus
            });

            // Update work order actual cost. The total is always the sum
            // of the four buckets. It used to start at zero and add only
            // the buckets that changed in this posting, so a posting that
            // changed just material left a total of material alone.
            ttlcst = lbrcst.plus(ovhcst).plus(matcst).plus(svccst);
            if (wo.actualLaborCost.amount !== lbrcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualLaborCost/amount",
                    value: lbrcst
                });
            }
            if (wo.actualOverheadCost.amount !== ovhcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualOverheadCost/amount",
                    value: ovhcst
                });
            }
            if (wo.actualMaterialCost.amount !== matcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualMaterialCost/amount",
                    value: matcst
                });
            }
            if (wo.actualServiceCost.amount !== svccst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualServiceCost/amount",
                    value: svccst
                });
            }
            if (wo.actualTotalCost.amount !== ttlcst) {
                woTx.data.push({
                    op: "replace",
                    path: "/actualTotalCost/amount",
                    value: ttlcst
                });
            }
            trans.push(woTx);
            trans.push({
                client: obj.client,
                data: {id: woTx.id},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            });

            // Complete work order issue document
            trans.push({
                method: "PATCH",
                name: "WorkOrderIssue",
                client: obj.client,
                user: obj.client.currentUser(),
                id: iss.id,
                eventKey: eKey,
                data: [{
                    op: "replace",
                    path: "/status",
                    value: "I"
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

        if (err) {
            return Promise.reject(err);
        }

        try {
            // Execute it all
            while (trans.length) {
                /*
                console.log(
                    trans[0].method,
                    trans[0].name,
                    trans[0].data
                );
                */
                await f.datasource.request(
                    trans.shift(),
                    true
                );
            }
        } catch (terr) {
            return Promise.reject(terr);
        }
    }

    try {
        await waitForIssues();
        issues = await fetchIssues();
        let onHold = issues.find((i) => i.workOrder.onHold);
        if (onHold) {
            theId = onHold.id;
            // Throw, not return a rejection: a returned promise is not
            // awaited, so it would skip the catch below, and with it
            // the error on the issue and the alert.
            throw "Work order " + onHold.workOrder.number + " is on hold";
        }
        wos = await fetchWorkOrders();
        itemSites = await fetchItemSites();
        await process();
        return "Materials issued successfully";
    } catch (err) {
        // issues is unset if the wait or the read failed
        let theIssue = (issues || []).find((i) => i.id === theId);
        let theTenant = obj.client.tenant();
        let theUser = obj.client.currentUser();
        // theId is unset when the wait or the read failed, so there is
        // no issue yet to put the error on
        if (theId) {
            obj.client.onRollback(async function () {
                await f.datasource.request({
                    method: "PATCH",
                    name: "WorkOrderIssue",
                    user: theUser,
                    id: theId,
                    data: [{
                        op: "replace",
                        path: "/error",
                        value: (
                            typeof err === "object"
                            ? err.message
                            : err
                        )
                    }],
                    tenant: theTenant
                }, true);
            });
        }

        f.datasource.request({
            method: "POST",
            name: "Alert",
            user: obj.client.currentUser(),
            data: {
                category: "Work Order Issue",
                severity: "Critical",
                message: (
                    "One or more work order issues(s) failed to post " +
                    "due to the following error: " +
                    err
                ),
                relation: (
                    (theIssue)
                    ? {
                        code: theIssue.number,
                        id: theIssue.id,
                        objectType: "WorkOrderIssue"
                    }
                    : undefined
                )
            },
            tenant: theTenant
        }, true);
        return Promise.reject(err);
    } finally {
        ids.forEach(function (id) {
            pending.splice(pending.indexOf(id), 1);
        });
    }
}

f.datasource.registerFunction(
    "POST",
    "doPostWorkOrderIssues",
    doWOIssue
);