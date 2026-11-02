/*jslint devel*/
/*global*/

async function doSolPlan(obj) {
    let list = [];
    let allcs;
    let sol = await f.datasource.request({
        client: obj.client,
        id: obj.data.id,
        method: "GET",
        name: "SalesOrderLine",
        properties: [
            "dueDate",
            "id",
            "materials",
            "quantityDue",
            "salesOrder"
        ]
    }, true);
    if (sol && sol.materials.length) {
        allcs = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                operator: "IN",
                property: "demand.id",
                value: sol.materials.map((r) => r.id)
            }]},
            method: "GET",
            name: "Allocation"
        }, true);
    } else {
        allcs = await f.datasource.request({
            client: obj.client,
            filter: {criteria: [{
                property: "demand.id",
                value: obj.data.id
            }]},
            method: "GET",
            name: "Allocation"
        }, true);
    }
    let allc;
    let woPlan;
    let sos = allcs.slice();
    let minDate = f.endOfTime();
    let maxDate = f.startOfTime();
    let woNr;
    let yesterday = f.parseDate(f.today());
    yesterday.setDate(yesterday.getDate() - 1);
    let lastReq = false;
    let lvl = 0;
    let spc = "";

    if (sol.materials.length) {
        sos.forEach(function (so) {
            let mtl = sol.materials.find((s) => s.id === so.demand.id);
            so.requirement = mtl;
        });
        sos.sort(function (a, b) {
            if (a.requirement.sequence !== b.requirement.sequence) {
                return a.sequence - b.sequence;
            }
            if (a.supply.objectType === "Inventory") {
                return -1;
            }
            if (a.supply.dueDate < b.supply.dueDate) {
                return -1;
            }
            if (a.supply.dueDate > b.supply.dueDate) {
                return 1;
            }
            return 0;
        });
    } else {
        sos.sort(function (a, b) {
            if (a.supply.objectType === "Inventory") {
                return -1;
            }
            if (a.supply.dueDate < b.supply.dueDate) {
                return -1;
            }
            if (a.supply.dueDate > b.supply.dueDate) {
                return 1;
            }
            return 0;
        });
    }

    function padSpaces(spcs, dat) {
        dat.description = spcs + dat.description;
        if (dat.detail && dat.detail.length) {
            let ps2 = padSpaces.bind(null, spcs + "    ");
            dat.detail.forEach(ps2);
        }
    }
    let ps1 = padSpaces.bind(null, "    ");

    while (sos.length) {
        allc = sos.shift();
        if (
            allc.requirement &&
            lastReq !== allc.requirement
        ) {
            lastReq = allc.requirement;
            list.push({
                allocated: lastReq.allocated,
                description: (
                    "(" + lastReq.number + ") " +
                    lastReq.item.number +
                    " [Qty: " + lastReq.quantityDue.toLocaleString() + "]"
                ),
                detail: [],
                dueDate: sol.dueDate,
                id: lastReq.id,
                level: 0,
                links: [],
                number: {
                    id: lastReq.id,
                    number: lastReq.number,
                    objectType: lastReq.objectType
                },
                objectType: lastReq.objectType,
                percent: lastReq.issued.div(lastReq.required),
                sequence: lastReq.sequence,
                startDate: sol.salesOrder.orderDate,
                type: "group"
            });
            spc = "  ";
            lvl = 1;
        } else if (!allc.requirement) {
            spc = "";
            lvl = 0;
        }

        if (allc.supply.objectType === "WorkOrder") {
            woNr = allc.supply.number;
            if (woNr.split("-").length === 3) {
                woNr = woNr.slice(0, woNr.lastIndexOf("-"));
            }
            woPlan = await f.datasource.request({
                client: obj.client,
                data: {
                    id: allc.supply.id,
                    showOperations: false,
                    showStockItems: false
                },
                method: "POST",
                name: "doGetWorkOrderPlan"
            }, true);
            woPlan.filter(
                (i) => (
                    i.objectType === "WorkOrder" &&
                    i.type
                )
            ).forEach(function (i) {
                if (i.startDate < minDate) {
                    minDate = i.startDate;
                }
                if (i.dueDate > maxDate) {
                    maxDate = i.dueDate;
                }
            });
            woPlan.forEach(ps1);
            woPlan.forEach(function (i) {
                i.parent = allc.supply.id;
            });
            list.push({
                description: spc + (
                    "(" + woNr + ") " +
                    allc.supply.item.number +
                    " [Qty: " + allc.quantity + "]"
                ),
                detail: woPlan,
                dueDate: maxDate,
                id: allc.supply.id,
                level: lvl,
                links: [],
                number: {
                    id: allc.supply.id,
                    number: allc.supply.number,
                    objectType: allc.supply.objectType
                },
                objectType: allc.supply.objectType,
                percent: 0,
                sequence: 0,
                startDate: minDate,
                type: "group"
            });
            minDate = f.endOfTime();
        } else if (allc.supply.objectType === "Inventory") {
            list.push({
                description: (
                    spc + "(" + allc.supply.site.code + ") " +
                    allc.supply.item.number +
                    " [Qty: " + allc.quantity + "]"
                ),
                dueDate: f.today(),
                id: allc.supply.id,
                level: 0,
                links: [],
                number: {
                    id: allc.supply.id,
                    number: allc.supply.number,
                    objectType: "Inventory"
                },
                objectType: "Inventory",
                percent: 1,
                startDate: yesterday.toLocalDate(),
                type: "task"
            });
        } else {
            list.push({
                description: spc + (
                    "(" + allc.supply.number + ") " +
                    "[Qty: " + allc.quantity + "]"
                ),
                dueDate: allc.supply.dueDate || allc.supply.startDate,
                id: allc.supply.id,
                level: lvl,
                links: [],
                number: {
                    id: allc.supply.id,
                    number: allc.supply.number,
                    objectType: allc.supply.objectType
                },
                objectType: allc.supply.objectType,
                percent: 0,
                startDate: allc.supply.startDate,
                type: "task"
            });
        }
    }

    return list;
}

f.datasource.registerFunction(
    "POST",
    "doGetSalesOrderLinePlan",
    doSolPlan
);