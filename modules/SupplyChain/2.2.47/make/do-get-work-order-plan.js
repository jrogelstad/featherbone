/*jslint unordered devel*/
/*global*/
async function doWoPlan(obj) {
    let woId = obj.data.id;
    let list = [];
    let allcs = [];
    let womap = [];
    let top = true;
    let showOps = obj.data.showOperations !== false;
    let showStock = obj.data.showStockItems !== false;

    async function fetch(pId, pLevel) {
        let awo;
        let woallocs;
        let ids;
        let wo = await f.datasource.request({
            method: "GET",
            name: "WorkOrder",
            client: obj.client,
            id: pId,
            properties: [
                "allocated",
                "created",
                "createdBy",
                "dueDate",
                "id",
                "materials",
                "number",
                "operations",
                "ordered",
                "item",
                "quantity",
                "received",
                "startDate",
                "updated",
                "updatedBy"
            ]
        }, true);

        if (!wo) {
            return Promise.reject("Work order id " + pId + " not found");
        }

        wo.level = pLevel;
        ids = wo.materials.filter(
            (m) => m.allocated > 0
        ).map((m) => m.id);
        let ospIds = wo.operations.filter(
            (o) => o.outsideProcessId
        ).map((o) => o.outsideProcessId);
        ids = ids.concat(ospIds);

        if (ids.length) {
            woallocs = await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    operator: "IN",
                    property: "demand.id",
                    value: ids
                }, {
                    operator: "IN",
                    property: "supply.objectType",
                    value: [
                        "WorkOrder",
                        "PurchaseOrderLine",
                        "PlannedWorkOrder",
                        "PlannedPurchase"
                    ]
                }]},
                method: "GET",
                name: "Allocation"
            }, true);

            if (woallocs.length) {
                allcs = allcs.concat(woallocs);
                ids = woallocs.filter(
                    (r) => r.supply.objectType === "WorkOrder"
                ).map((r) => r.supply.id);
                if (ids.length) {
                    awo = await f.datasource.request({
                        client: obj.client,
                        filter: {criteria: [{
                            operator: "IN",
                            property: "id",
                            value: ids
                        }]},
                        method: "GET",
                        name: "WorkOrder",
                        properties: ["id", "number"]
                    }, true);
                    womap = womap.concat(awo);
                }
            }
        }
        return wo;
    }

    async function process(wo) {
        let lvl = wo.level + 1;
        let rsv = allcs.find((r) => r.supply.id === wo.id);
        let parent;
        let supplies;
        let op;

        wo.materials.sort(function (a, b) {
            if (a.operation === b.operation) {
                return a.sequence - b.sequence;
            }
            return a.operation - b.operation;
        });
        if (!showOps) {
            wo.materials.forEach(function (mat) {
                mat.operation = 0;
            });
        }

        if (rsv) {
            parent = list.find((i) => i.id === rsv.demand.id);
        }

        if (top) {
            list.push({
                description: (
                    "(" + wo.number + ") " + wo.item.number +
                    " [Qty: " + wo.quantity.toLocaleString() + "]"
                ),
                dueDate: wo.dueDate,
                id: wo.id,
                level: 0,
                links: [],
                number: {
                    id: wo.id,
                    number: wo.number,
                    objectType: "WorkOrder"
                },
                objectType: "WorkOrder",
                percent: wo.received.div(wo.ordered),
                startDate: wo.startDate,
                allocated: wo.allocated,
                type: (
                    showOps
                    ? "group"
                    : "task"
                )
            });
            top = false;
        }

        if (parent) {
            parent.id = wo.id;
            parent.description = (
                "(" + wo.number + ") " + wo.item.number +
                " [Qty: " + wo.quantity.toLocaleString() + "]"
            );
            parent.startDate = wo.startDate;
            parent.dueDate = wo.dueDate;
            parent.number = {
                id: wo.id,
                number: wo.number,
                objectType: "WorkOrder"
            };
            parent.objectType = "WorkOrder";
            parent.percent = wo.received.div(wo.ordered);
            if (showOps) {
                parent.type = "group";
            } else if (rsv.isFirm) {
                parent.type = "task";
            }
        }

        function addOutsideProcess(op, spc) {
            spc = spc || "";
            if (op.outsideProcessId) {
                let ospa = allcs.find(
                    (a) => a.demand.id === op.outsideProcessId
                );
                if (ospa) {
                    list.push({
                        description: (
                            spc + "    (" + ospa.supply.number + ") " +
                            ospa.supply.item.number +
                            " [Qty: " + ospa.quantity.toLocaleString()
                            + "]"
                        ),
                        dueDate: ospa.supply.dueDate,
                        id: ospa.supply.id,
                        level: lvl,
                        links: [{target: op.id, type: "FF"}],
                        number: {
                            id: op.outsideProcessId,
                            number: op.number,
                            objectType: "OutsideProcess"
                        },
                        percent: op.completed.div(op.planned),
                        objectType: ospa.supply.objectType,
                        startDate: ospa.supply.startDate
                    });
                }
            }
        }

        async function next() {
            let matl;
            let childId;

            if (!wo.materials.length) {
                // Add remaining operations
                while (wo.operations.length) {
                    op = wo.operations.shift();
                    addOutsideProcess(op, "    ");
                    if (showOps) {
                        list.push({
                            description: (
                                "    (" + op.sequence + ") " +
                                op.description
                            ),
                            dueDate: op.plannedEndTime.slice(0, 10),
                            id: op.id,
                            level: lvl,
                            links: (
                                wo.operations.length
                                ? [{target: wo.operations[0].id, type: "FS"}]
                                : []
                            ),
                            number: {
                                id: wo.id,
                                number: op.number,
                                objectType: "WorkOrder"
                            },
                            objectType: "WorkOrderOperation",
                            percent: op.completed.div(op.planned),
                            startDate: op.plannedStartTime.slice(0, 10)
                        });
                    }
                }
                return;
            }

            matl = wo.materials.shift();
            if (
                wo.operations.length &&
                (
                    matl.operation ||
                    !matl
                )
            ) {
                while (
                    wo.operations.length &&
                    (
                        !matl ||
                        wo.operations[0].sequence <= matl.operation
                    )
                ) {
                    op = wo.operations.shift();
                    addOutsideProcess(op);
                    list.push({
                        description: (
                            "    (" + op.sequence + ") " +
                            op.description
                        ),
                        dueDate: op.plannedEndTime.slice(0, 10),
                        id: op.id,
                        level: lvl,
                        links: (
                            wo.operations.length
                            ? [{target: wo.operations[0].id, type: "FS"}]
                            : []
                        ),
                        number: {
                            id: wo.id,
                            number: op.number,
                            objectType: "WorkOrder"
                        },
                        percent: op.completed.div(op.planned),
                        objectType: "WorkOrderOperation",
                        startDate: op.plannedStartTime.slice(0, 10)
                    });
                }
            }
            list.push({
                description: matl.item.description,
                dueDate: matl.dueDate,
                id: matl.id,
                level: (
                    matl.operation
                    ? lvl + 1
                    : lvl
                ),
                links: [{target: wo.id, type: "FS"}],
                number: {
                    id: wo.id,
                    number: matl.number,
                    objectType: "WorkOrder"
                },
                objectType: "WorkOrderRequirement",
                percent: (
                    matl.required
                    ? matl.issued.plus(matl.returned).div(matl.required)
                    : 1
                ),
                startDate: matl.dueDate
            });

            if (matl.allocated > 0) {
                supplies = allcs.filter((r) => r.demand.id === matl.id);
                let x = 0;
                let a;
                let woChild;
                if (supplies.length) {
                    while (x < supplies.length) {
                        a = supplies[x];
                        x += 1;
                        woChild = womap.find(
                            (c) => c.id === a.supply.id
                        );
                        if (woChild) {
                            childId = woChild.id;
                            let res = await fetch(childId, (
                                matl.operation
                                ? lvl + 1
                                : lvl
                            ));
                            await process(res);
                        } else {
                            // Purchase order allocaation
                            list.push({
                                description: (
                                    "(" + a.supply.number + ") " +
                                    a.supply.item.number +
                                    " [Qty: " + a.quantity.toLocaleString()
                                    + "]"
                                ),
                                dueDate: a.supply.dueDate,
                                id: a.supply.id,
                                level: lvl,
                                links: [{target: wo.id, type: "FS"}],
                                number: {
                                    id: a.supply.id,
                                    number: a.supply.number,
                                    objectType: a.supply.objectType
                                },
                                objectType: a.supply.objectType,
                                percent: 0,
                                startDate: a.supply.startDate
                            });
                        }
                    }
                    await next();
                    return;
                }
            }

            await next();
        }

        await next();
        return list;
    }


    let res = await fetch(woId, 0);
    await process(res);

    if (!showStock) {
        list = list.filter(
            (i) => i.objectType !== "WorkOrderRequirement"
        );
    }

    return list;
}

f.datasource.registerFunction(
    "POST",
    "doGetWorkOrderPlan",
    doWoPlan
);