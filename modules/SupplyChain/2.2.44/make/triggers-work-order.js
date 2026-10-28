/*jslint devel unordered*/
async function handleAllocations(obj, isDelete) {
    let delrows = (
        isDelete
        ? f.copy(obj.oldRec.materials)
        : f.copy(obj.newRec.materials)
    );
    let getrows = [];
    let txrows = [];
    let resp1 = [];
    let resp2;
    let drows;
    let srows;

    // Look for materials specifically deleted by update
    if (obj.method === "PATCH" && isDelete) {
        delrows = obj.oldRec.materials.filter(function (om) {
            return !obj.newRec.materials.find((nm) => nm && nm.id === om.id);
        });
        getrows = delrows;

    // Other edits
    } else {
        // Look for edits where allocation exceeds quanity remaining
        // We'll update those by 'transact'
        if (isDelete) {
            // Include header to check
            delrows.push(obj.oldRec);
        } else {
            delrows.push(obj.newRec);
            delrows.forEach(function (row) {
                let diff;
                let qty = (
                    row.quantity === undefined
                    ? row.quantityDue
                    : row.quantity
                );

                if (row.status !== "C") {
                    diff = row.allocated.minus(qty);
                    if (diff > 0) {
                        txrows.push({
                            id: row.id,
                            objectType: row.objectType,
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
        let todel = resp1.filter(
            (a) => delrows.some((dr) => (
                a.supply.id === dr.id ||
                a.demand.id === dr.id
            ))
        );
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant();

        while (todel.length) {
            // const per pass: the onCommit callback runs after the loop,
            // so a shared variable would be the last allocation every time
            const del = todel.shift();
            await f.datasource.request({
                client: obj.client,
                eventKey: obj.eventKey,
                id: del.id,
                isHard: true,
                method: "DELETE",
                name: "Allocation"
            }, true);

            // Notify demand if work order deleteded or closed
            if (del.supply.objectType === "WorkOrder") {
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
                            type: "WorkOrder"
                        },
                        method: "POST",
                        name: "doCreateDeallocationHistory",
                        tenant: theTenant,
                        user: theUser
                    });
                });
            }
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
                    type: (
                        tx.objectType === "WorkOrder"
                        ? "supply"
                        : "demand"
                    )
                },
                method: "POST",
                name: "doTransactAllocated"
            }, true);
        }
    }

    // Lock allocations to change while getting
    srows = getrows.filter(
        (r) => r.objectType === "WorkOrder"
    ).map((c) => c.id);
    if (srows.length) {
        resp1 = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                property: "supply.id",
                operator: "IN",
                value: srows
            }]},
            method: "GET",
            name: "Allocation",
            properties: ["id", "supply", "demand", "quantity"],
            isForUpdate: true
        }, true);
    }

    drows = getrows.filter(
        (r) => r.objectType === "WorkOrderRequirement"
    ).map((c) => c.id);
    if (drows.length) {
        resp2 = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                property: "demand.id",
                operator: "IN",
                value: drows
            }]},
            method: "GET",
            name: "Allocation",
            properties: ["id", "supply", "demand", "quantity"],
            isForUpdate: true
        }, true);
        resp1 = resp1.concat(resp2);
    }

    await delAllocations();
    await txAllocations();
}

function quantityChanged(chld, attr, obj) {
    return obj.oldRec[chld].some(function (orec) {
        if (!orec) {
            return false;
        }
        let nrec = obj.newRec[chld].find((c) => c.sequence === orec.sequence);
        if (nrec && nrec[attr] !== orec[attr]) {
            return true;
        }
    });
}

/**
  Work order handler
*/
async function doUpsertWo(obj) {
    let settings = await f.datasource.request({
        client: obj.client,
        data: {name: "makeSettings"},
        method: "GET",
        name: "getSettings"
    }, true);

    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;
        let ops;
        let mts;
        let requests = [];

        if (!obj.oldRec) {
            newRec.onHold = false; // Must do on hold as update
        } else {
            if (oldRec.onHold && newRec.onHold) {
                if (
                    oldRec.received !== newRec.received ||
                    quantityChanged("operations", "completed", obj) ||
                    quantityChanged("materials", "issued", obj)
                ) {
                    reject("Order is on hold and cannot be transacted against");
                    return;
                }

                if (oldRec.status !== newRec.status) {
                    reject(
                        "Status cannot be changed because the order is on hold"
                    );
                    return;
                }
            }
        }

        if (!newRec.site) {
            reject("Site is required");
            return;
        }

        if (!newRec.ordered || newRec.ordered < 0) {
            reject("Ordered quanity must be greater than zero");
            return;
        }

        if (!newRec.item) {
            reject("Product is required");
            return;
        }

        newRec.operations = newRec.operations || [];
        newRec.received = newRec.received || 0;
        newRec.quantity = Math.max(newRec.ordered.minus(newRec.received), 0);

        // Close if all qty received
        if (
            newRec.received >= newRec.ordered &&
            settings.automaticClose !== false
        ) {
            newRec.status = "C";
        }

        // Only deal with non-null materials
        newRec.materials = newRec.materials || [];
        mts = newRec.materials.filter((mtl) => mtl);

        // Only deal with non-null operations
        obj.newRec.operations = obj.newRec.operations || [];
        ops = obj.newRec.operations.filter((o) => o);

        if (obj.newRec.operationEndDate !== obj.newRec.dueDate) {
            obj.newRec.operationEndDate = obj.newRec.dueDate;
        }
        ops.forEach(function (op) {
            op.number = obj.newRec.number + "#" + op.sequence;
            op.isLast = ops.indexOf(op) === ops.length - 1;
            if (op.isLast) {
                obj.newRec.operationEndDate = op.plannedEndTime.slice(0, 10);
            }
        });

        mts.forEach(function (matl) {
            let reqQty;
            let plnQty;
            let op;

            matl.issued = matl.issued || 0;
            matl.returned = matl.returned || 0;
            matl.ratio = matl.ratio || 1;

            if (!matl.sequence) {
                throw "Sequence must be set";
            }

            matl.number = obj.newRec.number + "." + matl.sequence;

            if (!matl.item.type) {
                throw "Item type is unknown";
            }

            if (!matl.item.isFractional === undefined) {
                throw "Item 'isFractional' is unknown";
            }

            if (matl.operation) {
                op = newRec.operations.filter((o) => o).find(
                    (o) => o.sequence === matl.operation
                );
                if (op) {
                    matl.dueDate = op.plannedStartTime.slice(0, 10);
                } else {
                    matl.operation = 0;
                }
            } else {
                matl.dueDate = obj.newRec.startDate;
            }

            if (op) {
                plnQty = op.planned;
            } else if (newRec.operations.length) {
                plnQty = newRec.operations.find((o) => o).planned;
            } else {
                plnQty = newRec.ordered;
            }
            reqQty = matl.quantityPer.times(
                plnQty
            ).plus(
                matl.fixedQuantity
            ).times(
                matl.ratio
            );

            if (!matl.item.isFractional) {
                reqQty = Math.ceil(reqQty);
            }
            matl.required = reqQty;

            if (matl.item.type === "I") {
                matl.quantityDue = Math.max(
                    matl.required.minus(matl.issued).plus(matl.returned),
                    0
                );
            } else {
                matl.quantityDue = 0;
            }
            matl.allocated = matl.allocated || 0;
            matl.priority = newRec.priority;
            matl.links = {
                salesDemandId: (
                    newRec.salesDemand
                    ? newRec.salesDemand.id
                    : ""
                ),
                salesOrderId: (
                    newRec.salesOrder
                    ? newRec.salesOrder.id
                    : ""
                )
            };
        });

        if (oldRec) {
            if (oldRec.item.id !== newRec.item.id) {
                reject("Product may not be changed");
            }

            if (oldRec.site.id !== newRec.site.id) {
                reject("Site may not be changed");
            }

            // Propagate release/unrelease
            if (
                (
                    oldRec.status === "P" && newRec.status === "A"
                ) || (
                    oldRec.status === "A" && newRec.status === "P"
                ) || newRec.status === "C"
            ) {
                mts.forEach(function (matl) {
                    matl.status = newRec.status;
                    if (newRec.status === "C") {
                        matl.quantityDue = 0;
                    }
                });
                ops.forEach(function (op) {
                    if (
                        op !== null && // not deleted
                        newRec.status !== oldRec.status &&
                        newRec.status !== "I"
                    ) {
                        op.status = newRec.status;
                    }
                });
            }

            ops.forEach(function (op) {
                if (op && op.completed >= op.planned) {
                    op.status = "C";
                }
            });
        }

        Promise.all(requests).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "WorkOrder",
    doUpsertWo,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "WorkOrder",
    doUpsertWo,
    f.datasource.TRIGGER_BEFORE
);

async function doBeforeInsert(obj) {
    if (!obj.newRec.number) {
        obj.newRec.number = await f.datasource.request({
            method: "POST",
            name: "autoNumber",
            client: obj.client,
            user: obj.client.currentUser(),
            data: {name: "WorkOrder"}
        }, true);
    }

    obj.newRec.operations = obj.newRec.operations || [];

    obj.newRec.operations.forEach(function (op) {
        if (op.service) {
            op.outsideProcessId = f.createId();
        }
    });
}

f.datasource.registerFunction(
    "POST",
    "WorkOrder",
    doBeforeInsert,
    f.datasource.TRIGGER_BEFORE
);

const insOpSql = (
    "INSERT INTO outside_process VALUES (" +
    "(SELECT NEXTVAL('object__pk_seq'))," +
    "$1, NOW(), $2, NOW(), $2, " +
    "false, null, $3, " +
    "(SELECT _pk FROM item WHERE id=$4)," +
    "(SELECT _pk FROM site WHERE id=$5)," +
    "$6, $7, $8, $9, $10, $11," +
    "(SELECT _pk FROM sales_order_line WHERE id=$12)," +
    "(SELECT _pk FROM sales_order WHERE id=$13)," +
    "0, 0, " +
    "(SELECT _pk FROM work_order_operation WHERE id=$14)," +
    "(SELECT _pk FROM work_order WHERE id=$15), $16); "
);
async function doAfterInsert(obj) {
    // Update line numbers to match header
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let theId = obj.newRec.id;
    let wo = obj.newRec;
    let op;
    let n = 0;

    // Auto-explode if unexploded
    if (obj.newRec.status === "U") {
        obj.client.onCommit(function () {
            return f.datasource.request({
                method: "POST",
                name: "doExplodeWorkOrder",
                // Asynchronous call
                user: theUser,
                data: {id: theId},
                tenant: theTenant
            }, true);
        });
    } else if (obj.newRec.materials.length) {
        obj.client.onCommit(function () {
            return f.datasource.request({
                method: "POST",
                name: "doPlanWorkOrderSupply",
                // Asynchronous call
                user: theUser,
                data: {id: theId},
                tenant: theTenant
            }, true);
        });
    }

    await f.datasource.request({
        method: "POST",
        name: "doRecalcInventoryOrders",
        client: obj.client,
        data: {
            itemId: obj.newRec.item.id,
            siteId: obj.newRec.site.id
        }
    }, true);

    while (n < obj.newRec.operations.length) {
        op = obj.newRec.operations[n];
        if (op.outsideProcessId) {
            await obj.client.query(insOpSql, [
                op.outsideProcessId,
                obj.client.currentUser(),
                wo.number + String("#") + op.sequence,
                op.service.id,
                wo.site.id,
                op.planned,
                f.parseDate(op.plannedEndTime.slice(0, 10)),
                wo.status,
                0,
                wo.priority,
                {},
                (
                    wo.salesDemand
                    ? wo.salesDemand.id
                    : ""
                ),
                (
                    wo.salesOrder
                    ? wo.salesOrder.id
                    : ""
                ),
                op.id,
                obj.newRec.id,
                op.planned
            ]);
        }
        n += 1;
    }
}

f.datasource.registerFunction(
    "POST",
    "WorkOrder",
    doAfterInsert,
    f.datasource.TRIGGER_AFTER
);

function stringifyMatl(rec) {
    return JSON.stringify(rec.materials.map(function (mtl) {
        if (mtl) {
            return {item: mtl.item.id, qty: mtl.quantityDue};
        }
        return {item: false, qty: -1};
    }));
}

async function checkOpenOsp(obj, op, id) {
    let params = [obj.oldRec.id];
    let part = ";";
    let doc = "Work Order";
    if (id) {
        params.push(id);
        part = "AND op.id=$2;";
        doc = "Outside Process ";
    }
    let checkSql = (
        "SELECT pol.number " +
        "FROM purchase_order_line pol, " +
        "  allocation alc, outside_process op, " +
        "  work_order_operation woop, " +
        "  work_order wo " +
        "WHERE wo.id=$1 " +
        "  AND wo._pk=woop._work_order_work_order_pk " +
        "  AND woop._pk=op._work_order_operation_work_order_operation_pk " +
        "  AND alc._demand_demand_pk=op._pk" +
        "  AND alc._supply_supply_pk=pol._pk " + part
    );
    let resp = await obj.client.query(checkSql, params);
    let row;

    if (resp.rows.length) {
        return Promise.reject(
            doc + " cannot be " + op + " while it is linked " +
            "to an active serivce on purchase order line " +
            resp.rows[0].number + ". Please delete or close the " +
            "purchase order or delete the affected line"
        );
    }

    checkSql = (
        "SELECT op._pk AS op_pk, plp._pk AS plp_pk " +
        "FROM work_order wo, " +
        "  work_order_operation woop, " +
        "  outside_process op " +
        "  LEFT JOIN allocation alc ON " +
        "    alc._demand_demand_pk=op._pk " +
        "  LEFT JOIN planned_purchase plp ON " +
        "    alc._supply_supply_pk=plp._pk " +
        "WHERE wo.id=$1 " +
        "  AND wo._pk=woop._work_order_work_order_pk " +
        "  AND woop._pk=op._work_order_operation_work_order_operation_pk " +
        part
    );
    resp = await obj.client.query(checkSql, params);

    while (resp.rows.length) {
        row = resp.rows.shift();

        if (row.plp_pk) {
            await obj.client.query(
                "DELETE FROM planned_purchase WHERE _pk=$1;",
                [Number(row.plp_pk)]
            );
            await obj.client.query(
                "DELETE FROM allocation WHERE _supply_supply_pk=$1;",
                [Number(row.plp_pk)]
            );
        }

        if (op !== "closed") {
            await obj.client.query(
                "DELETE FROM outside_process WHERE _pk=$1;",
                [Number(row.op_pk)]
            );
        } else {
            await obj.client.query(
                "UPDATE outside_process " +
                "SET allocated = 0, status = 'C', " +
                "  updated = now(), updated_by = $2 " +
                "WHERE _pk=$1;",
                [Number(row.op_pk), obj.client.currentUser()]
            );
        }
    }
}

const selOpSql = (
    "SELECT _pk AS pk, allocated, shipped, received," +
    "  quantity_due, due_date, status " +
    "FROM outside_process " +
    "WHERE id = $1" +
    "  AND NOT is_deleted; "
);
const updOpSql = (
    "UPDATE outside_process SET " +
    "  updated = now(), " +
    "  updated_by = $1, " +
    "  required = $2, " +
    "  quantity_due = $2 - received, " +
    "  due_date = $3, " +
    "  status = $4 " +
    "WHERE _pk = $5 "
);

async function doBeforeUpdate(obj) {
    let lastopidx = obj.newRec.operations.length - 1;
    let newlastop = obj.newRec.operations[lastopidx] || {completed: 0};
    let oldlastop = obj.oldRec.operations[lastopidx] || {completed: 0};
    let newcomp = newlastop.completed || 0;
    let completing = newcomp.minus(oldlastop.completed);
    let username = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let avail = 0;
    let dalcs;

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
            // Now only counting upstream work order supply as unavailable
            // TODO: Only inventory is counted available. That means, though,
            // all other types of supply when allocation changed or received
            // Would need to kick a recalc on dept work order avail
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

    try {
        // Post completions where last op quantity done
        if (completing > 0 && newlastop.completed > obj.newRec.received) {
            // Do receipt asynchronously
            obj.client.onCommit(async function () {
                await f.datasource.request({
                    method: "POST",
                    name: "doCompleteWorkOrder",
                    user: username,
                    data: {id: obj.newRec.id, quantity: completing},
                    tenant: theTenant
                }, true);
            });
        }

        // Reset available to process after close
        // or if unreleased
        let n = 0;
        let woop;
        if (obj.newRec.status === "C" || obj.newRec.status === "P") {
            while (n < obj.newRec.operations.length) {
                woop = obj.newRec.operations[n];
                n += 1;
                if (woop) {
                    woop.available = 0;
                }
            }
            // If releasing, set availability
        } else if (
            obj.oldRec.status === "P" &&
            obj.newRec.status === "A"
        ) {
            dalcs = await f.datasource.request({
                method: "GET",
                name: "Allocation",
                client: obj.client,
                filter: {criteria: [{
                    property: "demand.id",
                    operator: "IN",
                    value: obj.newRec.materials.filter(
                        (m) => m.operation
                    ).map((m) => m.id)
                }]},
                properties: ["id", "demand", "supply", "quantity"]
            }, true);
            let first = true;

            obj.newRec.operations.forEach(function (op) {
                if (!op) {
                    return; // deleted
                }
                avail = 0;

                if (first) {
                    first = false;
                    avail = obj.newRec.quantity;
                    obj.newRec.materials.filter(
                        (m) => (
                            m.operation === op.sequence &&
                            m.quantityDue > 0
                        )
                    ).forEach(calcAvail);
                }
                op.available = avail;
            });

            // Any other update, update operations
        } else if (obj.newRec.status === "I") {
            let curop = obj.newRec.operations.find((o) => o); // First
            let nxtop;
            let idx = obj.newRec.operations.indexOf(curop) + 1;

            // Loop through ops and update operation avail
            while (idx < obj.newRec.operations.length) {
                nxtop = obj.newRec.operations[idx];
                if (nxtop) {
                    nxtop.available = curop.completed;
                    curop = nxtop;
                }
                idx += 1;
            }
        }

        if (obj.newRec.status === "C") {
            obj.newRec.quantity = 0;
            obj.newRec.closeDate = f.today();
            obj.newRec.materials.filter((m) => m).forEach(function (m) {
                m.status = "C";
                m.quantityDue = 0;
            });
            obj.newRec.operations.filter((o) => o).forEach(function (o) {
                o.status = "C";
                o.remaining = 0;
                o.available = 0;
            });

            // Handle ony outside process planned
            if (obj.oldRec.operations.some((o) => o && o.service)) {
                await checkOpenOsp(obj, "closed");
            }
            // Clear all allocations before committing
            await handleAllocations(obj);
        } else {
            // This specifically deals with deleted requirements
            n = 0;
            await handleAllocations(obj, true);

            // Handle outside processes
            n = 0;
            let oldWoop;
            let newWoop;
            let op;
            let minqty;

            while (n < obj.oldRec.operations.length) {
                oldWoop = obj.oldRec.operations[n];
                newWoop = obj.newRec.operations[n];

                // Did this have outside process before?
                if (oldWoop.outsideProcessId && oldWoop.status !== "C") {
                    // Should it still have it? If no, delete
                    if (
                        !newWoop ||
                        !newWoop.service ||
                        oldWoop.id !==
                        newWoop.id
                    ) {
                        await checkOpenOsp(
                            obj,
                            "deleted",
                            oldWoop.outsideProcessId
                        );
                        if (newWoop) {
                            if (newWoop.service) {
                                newWoop.outsideProcessId = f.createId();
                            } else {
                                newWoop.outsideProcessId = "";
                            }
                        }

                    } else if (oldWoop.service.id !== newWoop.service.id) {
                        await checkOpenOsp(
                            obj,
                            "changed",
                            oldWoop.outsideProcessId
                        );
                        newWoop.outsideProcessId = f.createId();
                        obj.newRec.planStatus = "U";

                    // Otherwise, update if necessary
                    } else {
                        op = await obj.client.query(
                            selOpSql,
                            [oldWoop.outsideProcessId]
                        );
                        op = op.rows[0];
                        minqty = Math.max(
                            Number(op.shipped),
                            Number(op.allocated).plus(Number(op.received))
                        );

                        if (newWoop.planned < minqty) {
                            return Promise.reject(
                                "Operation " + newWoop.number +
                                " planned quantity " + newWoop.planned +
                                " cannot be less than outside process " +
                                "quantity processed of " + minqty
                            );
                        }

                        if (
                            newWoop.planned !== Number(op.quantity_due) ||
                            newWoop.plannedEndTime.slice(0, 10) !==
                            op.due_date ||
                            newWoop.status !== op.status
                        ) {
                            obj.client.query(updOpSql, [
                                obj.client.currentUser(),
                                newWoop.planned,
                                newWoop.plannedEndTime.slice(0, 10),
                                newWoop.status,
                                op.pk
                            ]);
                            if (oldWoop.planned < newWoop.planned) {
                                obj.newRec.planStatus = "U";
                            }
                        }
                    }
                // Does it need outside process? If yes, and not there,
                // set up to create it (after insert when op _pk exists)
                } else if (
                    newWoop &&
                    newWoop.service &&
                    !oldWoop.outsideProcessId
                ) {
                    newWoop.outsideProcessId = f.createId();
                    obj.newRec.planStatus = "U";
                }
                n += 1;
            }
            // Flag to make new outside process records
            while (n < obj.newRec.operations.length) {
                newWoop = obj.newRec.operations[n];

                if (obj.newRec.status === "I") {
                    newWoop.status = "A";
                } else {
                    newWoop.status = obj.newRec.status;
                }

                if (newWoop.service) {
                    newWoop.outsideProcessId = f.createId();
                    obj.newRec.planStatus = "U";
                }
                n += 1;
            }
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "PATCH",
    "WorkOrder",
    doBeforeUpdate,
    f.datasource.TRIGGER_BEFORE
);

async function doAfterUpdate(obj) {
    let len1;
    let n1 = 0;
    let theUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let theId = obj.newRec.id;
    let bfrMtl = stringifyMatl(obj.oldRec);
    let aftMtl = stringifyMatl(obj.newRec);

    async function processRecalc(orec, nrec, dmd, act) {
        async function recalcInv(pItemId, pSiteId) {
            await f.datasource.request({
                method: "POST",
                name: "doRecalcInventoryOrders",
                client: obj.client,
                user: theUser,
                data: {
                    itemId: pItemId,
                    siteId: pSiteId
                }
            }, true);
        }

        if (orec && !nrec) {
            await recalcInv(orec.item.id, orec.site.id);
        } else if (nrec && !orec) {
            await recalcInv(nrec.item.id, nrec.site.id);
        } else if (
            nrec.item.id !== orec.item.id ||
            nrec.site.id !== orec.site.id
        ) {
            await recalcInv(orec.item.id, orec.site.id);
            await recalcInv(nrec.item.id, nrec.site.id);
        } else if (
            nrec[dmd] !== orec[dmd] ||
            nrec[act] !== orec[act] ||
            nrec.status === "C"
        ) {
            await recalcInv(nrec.item.id, nrec.site.id);
        }
    }

    // Detect changes in demands & recalc if applicable
    n1 = 0;
    len1 = Math.max(
        obj.oldRec.materials.length,
        obj.newRec.materials.length
    );
    while (n1 < len1) {
        await processRecalc(
            obj.oldRec.materials[n1],
            obj.newRec.materials[n1],
            "required",
            "issued"
        );

        n1 += 1;
    }

    if (obj.newRec.quantity !== obj.oldRec.quantity) {
        await processRecalc(
            obj.oldRec,
            obj.newRec,
            "ordered",
            "received"
        );
    }

    if (
        bfrMtl !== aftMtl &&
        obj.newRec.status !== "C"
    ) {
        obj.client.onCommit(function () {
            return f.datasource.request({
                method: "POST",
                name: "doPlanWorkOrderSupply",
                // Asynchronous call
                user: theUser,
                data: {id: theId, silentFail: true},
                tenant: theTenant
            }, true);
        });
    }

    let requests = [];

    // Propagate priority changes
    obj.newRec.materials.forEach(function (mtl) {
        let oldMtl;
        if (mtl) { // Not deleted
            oldMtl = obj.oldRec.materials.find((m) => m.id === mtl.id);
            if (oldMtl && oldMtl.priority !== mtl.priority) {
                requests.push({
                    method: "POST",
                    name: "doPropagatePriority",
                    client: obj.client,
                    user: obj.client.currentUser(),
                    data: {demandId: mtl.id}
                });
            }
        }
    });

    try {
        while (requests.length) {
            await f.datasource.request(requests.shift(), true);
        }
        await handleAllocations(obj);

        // Insert outside process for any needed
        let n = 0;
        let oldWoop;
        let newWoop;
        let wo = obj.newRec;

        while (n < wo.operations.length) {
            newWoop = wo.operations[n];
            oldWoop = obj.oldRec.operations.find(
                (o) => o.id === newWoop.id
            );

            if (newWoop.outsideProcessId) {
                if (
                    !oldWoop ||
                    oldWoop.outsideProcessId !== newWoop.outsideProcessId
                ) {
                    await obj.client.query(insOpSql, [
                        newWoop.outsideProcessId,
                        obj.client.currentUser(),
                        wo.number + String("#") + newWoop.sequence,
                        newWoop.service.id,
                        wo.site.id,
                        newWoop.planned,
                        f.parseDate(newWoop.plannedEndTime.slice(0, 10)),
                        wo.status,
                        0,
                        wo.priority,
                        {},
                        (
                            wo.salesDemand
                            ? wo.salesDemand.id
                            : ""
                        ),
                        (
                            wo.salesOrder
                            ? wo.salesOrder.id
                            : ""
                        ),
                        newWoop.id,
                        wo.id,
                        newWoop.planned
                    ]);
                }
            } else if (
                oldWoop &&
                oldWoop.outsideProcessId &&
                !newWoop.outsideProcessId
            ) {
                await f.datasource.request({
                    client: obj.client,
                    method: "POST",
                    name: "doUpdateWorkOrderPlanStatus",
                    data: {id: obj.newRec.id}
                }, true);
            }

            n += 1;
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "PATCH",
    "WorkOrder",
    doAfterUpdate,
    f.datasource.TRIGGER_AFTER
);

async function doBeforeDelete(obj) {
    let oldRec = obj.oldRec;

    if (!oldRec) {
        return Promise.resolve();
    }

    if (
        oldRec.status !== "P" &&
        oldRec.status !== "U"
    ) {
        throw (
            "Work order that has been released or closed may not be deleted"
        );
    }

    // Handle ony outside process planned
    if (obj.oldRec.operations.some((o) => o && o.outsideProcessId)) {
        await checkOpenOsp(obj, "deleted");
    }
    await handleAllocations(obj, true);
}

f.datasource.registerFunction(
    "DELETE",
    "WorkOrder",
    doBeforeDelete,
    f.datasource.TRIGGER_BEFORE
);

async function doAfterDelete(obj) {
    try {
        // Don't pass client so we get old record
        // before this all commits
        let oldRec = await f.datasource.request({
            method: "GET",
            name: "WorkOrder",
            user: obj.client.currentUser(),
            properties: ["item", "site", "materials"],
            id: obj.id,
            tenant: obj.client.tenant()
        }, true);
        let rows = oldRec.materials.map(function (req) {
            return {item: req.item, site: req.site};
        });
        rows.unshift({item: oldRec.item, site: oldRec.site});
        let row;

        while (rows.length) {
            row = rows.shift();
            await f.datasource.request({
                method: "POST",
                name: "doRecalcInventoryOrders",
                client: obj.client,
                data: {
                    itemId: row.item.id,
                    siteId: row.site.id
                }
            }, true);
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "DELETE",
    "WorkOrder",
    doAfterDelete,
    f.datasource.TRIGGER_AFTER
);