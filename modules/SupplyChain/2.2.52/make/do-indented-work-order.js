/*jslint unordered*/

function doIndentWo(obj) {
    let woId = obj.data.id;
    let list = [];
    let allcs = [];
    let womap = [];
    let top = true;
    let showOps = obj.data.showOperations !== false;
    let showStock = obj.data.showStockItems !== false;
    let isFirmOnly = Boolean(obj.data.isFirmOnly);

    return new Promise(function (resolve, reject) {
        function fetch(pId, pLevel) {
            let wo;

            return new Promise(function (resolve, reject) {
                function callback(resp) {
                    womap = womap.concat(resp);
                    resolve(wo);
                }

                function fetchWo(resp) {
                    let ids;

                    if (resp.length) {
                        allcs = allcs.concat(resp);
                        ids = resp.map((r) => r.supply.id);
                        f.datasource.request({
                            client: obj.client,
                            filter: {criteria: [{
                                operator: "IN",
                                property: "id",
                                value: ids
                            }]},
                            method: "GET",
                            name: "WorkOrder",
                            properties: ["id", "number"]
                        }, true).then(callback).catch(reject);
                        return;
                    }
                    callback([]);
                }

                function fetchAllc(resp) {
                    let ids;
                    let allocFilter;

                    if (!resp) {
                        reject("Work order id " + pId + " not found");
                        return;
                    }

                    wo = resp;
                    wo.level = pLevel;
                    ids = wo.materials.filter(
                        (m) => m.allocated > 0
                    ).map((m) => m.id);

                    allocFilter = {criteria: [{
                        operator: "IN",
                        property: "demand.id",
                        value: ids
                    }, {
                        property: "supply.objectType",
                        value: "WorkOrder"
                    }]};

                    if (isFirmOnly) {
                        allocFilter.criteria.push({
                            property: "isFirm",
                            value: true
                        });
                    }

                    if (ids.length) {
                        f.datasource.request({
                            client: obj.client,
                            filter: allocFilter,
                            method: "GET",
                            name: "Allocation"
                        }, true).then(fetchWo).catch(reject);
                        return;
                    }
                    callback([]);
                }

                f.datasource.request({
                    method: "GET",
                    name: "WorkOrder",
                    client: obj.client,
                    id: pId,
                    properties: [
                        "actualLaborCost",
                        "actualMaterialCost",
                        "actualOverheadCost",
                        "actualServiceCost",
                        "actualTotalCost",
                        "allocated",
                        "created",
                        "createdBy",
                        "drawingLink",
                        "dueDate",
                        "estimatedLaborCost",
                        "estimatedMaterialCost",
                        "estimatedOverheadCost",
                        "estimatedServiceCost",
                        "estimatedTotalCost",
                        "id",
                        "materials",
                        "number",
                        "operations",
                        "ordered",
                        "item",
                        "received",
                        "site",
                        "status",
                        "updated",
                        "updatedBy"
                    ]
                }, true).then(fetchAllc).catch(reject);
            });
        }

        function process(wo) {
            return new Promise(function (resolve, reject) {
                let lvl = wo.level + 1;
                let rsv = allcs.find((r) => r.supply.id === wo.id);
                let parent;
                let child;
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
                        actualMaterialCost: wo.actualMaterialCost,
                        actualLaborCost: wo.actualLaborCost,
                        actualOverheadCost: wo.actualOverheadCost,
                        actualServiceCost: wo.actualServiceCost,
                        actualTotalCost: wo.actualTotalCost,
                        created: wo.created,
                        createdBy: wo.createdBy,
                        description: wo.item.description,
                        drawingLink: wo.drawingLink,
                        dueDate: wo.dueDate,
                        estimatedMaterialCost: wo.estimatedMaterialCost,
                        estimatedLaborCost: wo.estimatedLaborCost,
                        estimatedOverheadCost: wo.estimatedOverheadCost,
                        estimatedServiceCost: wo.estimatedServiceCost,
                        estimatedTotalCost: wo.estimatedTotalCost,
                        id: wo.id,
                        level: 0,
                        number: {
                            id: wo.id,
                            number: wo.number,
                            objectType: "WorkOrder"
                        },
                        objectType: "WorkOrder",
                        product: wo.item,
                        quantity: wo.ordered,
                        remaining: wo.ordered.minus(wo.received),
                        allocated: wo.allocated,
                        site: wo.site,
                        status: wo.status,
                        updated: wo.updated,
                        updatedBy: wo.updatedBy
                    });
                    top = false;
                }

                if (parent) {
                    parent.drawingLink = wo.drawingLink;
                    parent.number = {
                        id: wo.id,
                        number: wo.number,
                        objectType: "WorkOrder"
                    };
                    parent.objectType = "WorkOrder";
                }

                function next() {
                    let matl;
                    let childId;

                    if (!wo.materials.length) {
                        // Add remaining operations
                        while (wo.operations.length && showOps) {
                            op = wo.operations.shift();
                            list.push({
                                actualMaterialCost: null,
                                actualLaborCost: op.actualLaborCost,
                                actualOverheadCost: op.actualOverheadCost,
                                actualServiceCost: op.actualServiceCost,
                                actualTotalCost: {
                                    currency: op.actualServiceCost.currency,
                                    amount: op.actualLaborCost.amount.plus(
                                        op.actualOverheadCost.amount
                                    ).plus(
                                        op.actualServiceCost.amount
                                    )
                                },
                                created: op.created,
                                createdBy: op.createdBy,
                                description: op.description,
                                dueDate: op.plannedEndTime,
                                estimatedMaterialCost: null,
                                estimatedLaborCost: op.estimatedLaborCost,
                                estimatedOverheadCost: op.estimatedOverheadCost,
                                estimatedServiceCost: op.estimatedServiceCost,
                                estimatedTotalCost: {
                                    currency: op.estimatedServiceCost.currency,
                                    amount: op.estimatedLaborCost.amount.plus(
                                        op.estimatedOverheadCost.amount
                                    ).plus(
                                        op.estimatedServiceCost.amount
                                    )
                                },
                                id: op.id,
                                level: lvl,
                                number: {
                                    id: wo.id,
                                    number: op.number,
                                    objectType: "WorkOrder"
                                },
                                objectType: "WorkOrderOperation",
                                product: null,
                                quantity: op.planned,
                                remaining: op.remaining,
                                allocated: null,
                                sequence: op.sequence,
                                site: null,
                                status: op.status,
                                updated: op.updated,
                                updatedBy: op.updatedBy
                            });
                        }
                        resolve(list);
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
                            list.push({
                                actualMaterialCost: null,
                                actualLaborCost: op.actualLaborCost,
                                actualOverheadCost: op.actualOverheadCost,
                                actualServiceCost: op.actualServiceCost,
                                actualTotalCost: {
                                    currency: op.actualServiceCost.currency,
                                    amount: op.actualLaborCost.amount.plus(
                                        op.actualOverheadCost.amount
                                    ).plus(
                                        op.actualServiceCost.amount
                                    )
                                },
                                created: op.created,
                                createdBy: op.createdBy,
                                description: op.description,
                                dueDate: op.plannedEndTime,
                                estimatedMaterialCost: null,
                                estimatedLaborCost: op.estimatedLaborCost,
                                estimatedOverheadCost: op.estimatedOverheadCost,
                                estimatedServiceCost: op.estimatedServiceCost,
                                estimatedTotalCost: {
                                    currency: op.estimatedServiceCost.currency,
                                    amount: op.estimatedLaborCost.amount.plus(
                                        op.estimatedOverheadCost.amount
                                    ).plus(
                                        op.estimatedServiceCost.amount
                                    )
                                },
                                id: op.id,
                                level: lvl,
                                number: {
                                    id: wo.id,
                                    number: op.number,
                                    objectType: "WorkOrder"
                                },
                                objectType: "WorkOrderOperation",
                                product: null,
                                quantity: op.planned,
                                remaining: op.remaining,
                                allocated: null,
                                sequence: op.sequence,
                                site: null,
                                status: op.status,
                                updated: op.updated,
                                updatedBy: op.updatedBy
                            });
                        }
                    }
                    list.push({
                        actualMaterialCost: matl.actualMaterialCost,
                        actualLaborCost: matl.actualLaborCost,
                        actualOverheadCost: matl.actualOverheadCost,
                        actualServiceCost: matl.actualServiceCost,
                        actualTotalCost: matl.actualTotalCost,
                        created: matl.created,
                        createdBy: matl.createdBy,
                        description: matl.item.description,
                        dueDate: matl.dueDate,
                        estimatedMaterialCost: matl.estimatedMaterialCost,
                        estimatedLaborCost: matl.estimatedLaborCost,
                        estimatedOverheadCost: matl.estimatedOverheadCost,
                        estimatedServiceCost: matl.estimatedServiceCost,
                        estimatedTotalCost: matl.estimatedTotalCost,
                        id: matl.id,
                        level: (
                            matl.operation
                            ? lvl + 1
                            : lvl
                        ),
                        number: {
                            id: wo.id,
                            number: matl.number,
                            objectType: "WorkOrder"
                        },
                        objectType: "WorkOrderRequirement",
                        product: matl.item,
                        sequence: matl.sequence,
                        status: matl.status,
                        quantity: matl.required,
                        remaining: matl.required.minus(
                            matl.issued
                        ).plus(matl.returned),
                        allocated: matl.allocated,
                        site: matl.site,
                        updated: matl.updated,
                        updatedBy: matl.updatedBy
                    });

                    if (matl.allocated > 0) {
                        child = allcs.find((r) => r.demand.id === matl.id);
                        if (child) {
                            childId = womap.find(
                                (c) => c.id === child.supply.id
                            ).id;
                            fetch(childId, (
                                matl.operation
                                ? lvl + 1
                                : lvl
                            )).then(
                                process
                            ).then(next).catch(reject);
                            return;
                        }
                    }

                    next();
                }

                next();
            });
        }

        function postProcess(list) {
            if (!showStock) {
                list = list.filter(
                    (i) => i.objectType !== "WorkOrderRequirement"
                );
            }
            return Promise.resolve(list);
        }

        fetch(woId, 0).then(
            process
        ).then(postProcess).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doIndentedWorkOrder",
    doIndentWo
);