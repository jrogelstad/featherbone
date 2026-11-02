/*jslint unordered*/
async function processOperationCompletion(obj) {
    let pdate = f.today();
    let oc;
    let eKey = f.createId();
    let opPath = "/operations/";
    let matlPath = "/materials/";
    let costPath = "";
    let txData = [];
    let ord;
    let woSite;
    let itemSites;
    let startOnly = obj.data.startOperation;

    oc = await f.datasource.request({
        method: "GET",
        name: "WorkOrderOperation",
        properties: [
            "number",
            "sequence",
            "objectType",
            "status",
            "sequence",
            "started",
            "workOrder"
        ],
        id: obj.data.operation.id,
        client: obj.client
    }, true);

    if (oc.status === "P" || oc.status === "C") {
        throw "Operation is not active or in process";
    }

    txData = [{
        op: "replace",
        path: "/status",
        value: "I"
    }];

    // Lock work order
    await f.datasource.lock(
        oc.workOrder.id,
        obj.client.currentUser(),
        eKey,
        "Post operation completions",
        obj.client
    );

    ord = await f.datasource.request({
        method: "GET",
        name: "WorkOrder",
        properties: [
            "id",
            "site",
            "materials",
            "operations",
            "actualMaterialCost",
            "actualLaborCost",
            "actualServiceCost",
            "actualOverheadCost",
            "actualTotalCost"
        ],
        client: obj.client,
        id: oc.workOrder.id
    }, true);

    woSite = await f.datasource.request({
        method: "GET",
        name: "Site",
        client: obj.client,
        properties: ["defaultLocation", "defaultWipLocation"],
        id: ord.site.id
    }, true);

    itemSites = await f.datasource.request({
        method: "GET",
        name: "ItemSite",
        properties: [
            "id",
            "item",
            "defaultLocation",
            "wipLocation",
            "planningPolicy",
            "issueMethod"
        ],
        client: obj.client,
        filter: {criteria: [{
            property: "item.id",
            operator: "IN",
            value: ord.materials.map((m) => m.item.id)
        }, {
            property: "site.id",
            value: ord.site.id
        }]}
    }, true);

    try {
        let trans = [];
        let ordTx = {
            method: "PATCH",
            name: "WorkOrder",
            client: obj.client,
            user: obj.client.currentUser(),
            id: ord.id,
            eventKey: eKey,
            data: txData
        };
        let lbrcst = ord.actualLaborCost.amount;
        let ovrcst = ord.actualOverheadCost.amount;
        let matcst = ord.actualMaterialCost.amount;
        let svccst = ord.actualServiceCost.amount;
        let ttlcst = ord.actualTotalCost.amount;
        let complQty;
        let nextOp;
        let oldOps = f.copy(ord.operations);
        let ops = ord.operations.filter(
            (o) => o.sequence <= oc.sequence
        );
        let matls = ord.materials.filter(
            (m) => (
                (!m.for || m.for === "A") &&
                m.status !== "C" &&
                m.operation
            )
        );
        let err;

        ops.sort(function (a, b) {
            return b.sequence - a.sequence;
        });
        // Handle operation completions
        complQty = obj.data.quantity;

        ops.every(function (op) {
            let yld = op.yield.times(0.01);
            let idx = ord.operations.indexOf(op);

            if (
                nextOp &&
                nextOp.completed > op.completed
            ) {
                if (op.status === "C") {
                    err = (
                        "Can not report quantity greater " +
                        "than previous closed operation"
                    );
                    return false; // Stop 'every' loop
                }

                if (op.outsideProcess && op.started) {
                    err = (
                        "Preceding operation with outside process " +
                        "started but with fewer receipts than current " +
                        "operation completion. Receive outside process " +
                        "first, then repost this operation completion."
                    );
                    return false; // Stop 'every' loop
                }
            }

            if (op.sequence < oc.sequence) {
                if (complQty <= op.completed) {
                    return false; // Already reported, stop loop
                }

                // Report completion expected up to this point
                complQty = complQty.minus(op.completed);
            }

            // Don't report completion on current operation if
            // we're only starting, but everything else goes
            // as normal
            if (startOnly && op.sequence === oc.sequence) {
                op.started = op.started.plus(obj.data.quantity);
                ordTx.data.push({
                    op: "replace",
                    path: opPath + idx + "/status",
                    value: "I"
                });
                ordTx.data.push({
                    op: "replace",
                    path: opPath + idx + "/started",
                    value: op.started
                });
                nextOp = op;
                // Recalculate where preceding operation "should" be
                complQty = op.started.div(yld);
            } else {
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
                svccst = svccst.plus(
                    op.serviceCost.amount.times(complQty)
                );

                op.completed = op.completed.plus(complQty);
                op.started = Math.max(op.completed, op.started);
                op.remaining = Math.max(op.planned.minus(op.completed), 0);

                ordTx.data.push({
                    op: "replace",
                    path: opPath + idx + "/completed",
                    value: op.completed
                });
                ordTx.data.push({
                    op: "replace",
                    path: opPath + idx + "/remaining",
                    value: op.remaining
                });
                ordTx.data.push({
                    op: "replace",
                    path: opPath + idx + "/status",
                    value: (
                        obj.data.closeOperation
                        ? "C"
                        : "I"
                    )
                });
                nextOp = op;
                // Recalculate where preceding operation "should" be
                complQty = op.completed.div(yld);
            }

            return true;
        });

        if (err) {
            return Promise.reject(err);
        }

        // Handle materials
        matls.forEach(function (matl) {
            let is;
            let loc;
            let toIss;
            let doneQty;
            let op;
            let oldOp;
            let idx = ord.materials.indexOf(matl);

            if (matl.item.trace !== "N") {
                return;  // Don't backflush traced
            }

            is = itemSites.find(
                (r) => r.item.id === matl.item.id
            );

            if (is.issueMethod === "M") {
                return;  // Don't backflush manual
            }

            if (ord.site.locationControlled) {
                loc = (
                    is.wipLocation ||
                    woSite.defaultWipLocation ||
                    is.defaultLocation ||
                    woSite.defaultLocation
                );
            }

            op = ord.operations.find(
                (o) => o.sequence === matl.operation
            );

            if (op) {
                oldOp = oldOps.find(
                    (oo) => oo.sequence === op.sequence
                );

                if (startOnly && op.sequence === oc.sequence) {
                    doneQty = op.started.minus(
                        oldOp.started
                    );
                } else {
                    doneQty = op.completed.minus(
                        oldOp.completed
                    );
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
                            document: obj.data.number,
                            type: "Work Order Issue",
                            date: pdate,
                            item: matl.item,
                            site: ord.site,
                            quantity: toIss.times(-1),
                            location: loc
                        }
                    });
                    ordTx.data.push({
                        op: "replace",
                        path: (
                            `/materials/${matl.sequence - 1}/actualCost/amount`
                        ),
                        value: matl.actualCost.amount
                    });
                    ordTx.data.push({
                        op: "replace",
                        path: matlPath + idx + "/issued",
                        value: matl.issued
                    });
                    ordTx.data.push({
                        op: "replace",
                        path: matlPath + idx + "/status",
                        value: (
                            (
                                obj.data.closeOperation ||
                                matl.issued >= matl.required
                            )
                            ? "C"
                            : "I"
                        )
                    });
                }
            }
        });

        // Update actual cost. The total is always the sum of the four
        // buckets. It used to start from the existing total and add each
        // changed bucket in full, counting what was already in the total
        // again.
        ttlcst = lbrcst.plus(ovrcst).plus(matcst).plus(svccst);
        if (ord.actualLaborCost.amount !== lbrcst) {
            ordTx.data.push({
                op: "replace",
                path: costPath + "/actualLaborCost",
                value: {
                    currency: ord.actualLaborCost.currency,
                    amount: lbrcst
                }
            });
        }
        if (ord.actualOverheadCost.amount !== ovrcst) {
            ordTx.data.push({
                op: "replace",
                path: costPath + "/actualOverheadCost",
                value: {
                    currency: ord.actualOverheadCost.currency,
                    amount: ovrcst
                }
            });
        }
        if (ord.actualMaterialCost.amount !== matcst) {
            ordTx.data.push({
                op: "replace",
                path: costPath + "/actualMaterialCost",
                value: {
                    currency: ord.actualMaterialCost.currency,
                    amount: matcst
                }
            });
        }
        if (ord.actualServiceCost.amount !== svccst) {
            ordTx.data.push({
                op: "replace",
                path: costPath + "/actualServiceCost",
                value: {
                    currency: ord.actualServiceCost.currency,
                    amount: svccst
                }
            });
        }
        if (ord.actualTotalCost.amount !== ttlcst) {
            ordTx.data.push({
                op: "replace",
                path: costPath + "/actualTotalCost",
                value: {
                    currency: ord.actualTotalCost.currency,
                    amount: ttlcst
                }
            });
        }
        trans.push(ordTx);

        while (trans.length) {
            await f.datasource.request(trans.shift(), true);
        }
    } catch (e) {
        f.datasource.unlock({eventKey: eKey});
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doProcessOperationCompletion",
    processOperationCompletion
);

async function postOperationCompletion(obj) {
    let oc = {};
    let eKey = f.createId();
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let theId = obj.data.id;

    // Lock sending document
    await f.datasource.lock(
        obj.data.id,
        obj.client.currentUser(),
        eKey,
        "Post operation completions",
        obj.client
    );

    try {
        oc = await f.datasource.request({
            method: "GET",
            name: "OperationCompletion",
            client: obj.client,
            id: obj.data.id
        }, true);

        await f.datasource.request({
            method: "POST",
            name: "doProcessOperationCompletion",
            client: obj.client,
            data: {
                closeOperation: oc.closeOperation,
                quantity: oc.quantity,
                employee: oc.employee,
                id: oc.id,
                number: oc.number,
                operation: oc.operation,
                eventKey: eKey,
                startOperation: oc.startOperation
            }
        }, true);

        await f.datasource.request({
            method: "PATCH",
            name: "OperationCompletion",
            client: obj.client,
            id: obj.data.id,
            eventKey: eKey,
            data: [{
                op: "replace",
                path: "/isPosted",
                value: true
            }, {
                op: "replace",
                path: "/postDate",
                value: f.today
            }, {
                op: "replace",
                path: "/error",
                value: ""
            }]
        }, true);
    } catch (err) {
        if (!obj.data.eventKey) {
            obj.client.onRollback(async function () {
                await f.datasource.request({
                    method: "PATCH",
                    name: "OperationCompletion",
                    user: theUser,
                    id: theId,
                    data: [{
                        op: "replace",
                        path: "/error",
                        value: err
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
                        category: "Operation Completion",
                        severity: "Critical",
                        message: err,
                        relation: {
                            code: oc.number,
                            id: theId,
                            objectType: "OperationCompletion"
                        }
                    },
                    tenant: theTenant
                }, true);
            });
        }
        return Promise.reject(err);
    }
}

f.datasource.registerFunction(
    "POST",
    "doPostOperationCompletion",
    postOperationCompletion
);