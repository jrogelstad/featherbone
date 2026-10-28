/*jslint unordered devel*/
function backward(a, b) {
    return b.sequence - a.sequence;
}

function forward(a, b) {
    return a.sequence - b.sequence;
}

function initNextNumber(wo, nr, prefixes) {
    let num = wo.number;
    let sub = (
        nr
        ? nr - 1
        : 0
    );
    return function () {
        let ret;
        sub += 1;
        ret = num + "-" + sub;

        while (prefixes.indexOf(ret) !== -1) {
            sub += 1;
            ret = num + "-" + sub;
        }

        return ret;
    };
}

const one = 1;
const MS_HR = one.times(60).times(60).times(1000);

async function doExplodeWo(obj) {
    let settings = await f.datasource.request({
        method: "GET",
        name: "getSettings",
        client: obj.client,
        data: {name: "makeSettings"}
    }, true);
    let defStatus = settings.defaultStatus || "P";
    let chgStatus = [];
    let errids = [];
    if (!obj.data.nextNumber) {
        errids = obj.data.ids || [obj.data.id];
        errids = errids.slice(); // copy not reference
    }

    let ids = obj.data.ids || [obj.data.id];
    let lockids = ids.slice();
    let wos;
    let boms;
    let requests = [];
    let eKey = obj.data.eventKey || f.createId();
    let nextWo = obj.data.nextNumber;
    let top = !Boolean(obj.data.nextNumber);
    let delids = [];
    let prefixes = [];
    let preexist = [];
    let svcs = [];
    let supp = [];

    // These kinds of transactions must be sequential;
    await obj.client.query("SELECT pg_advisory_xact_lock(1);");

    function doReject(err) {
        let theId;
        let theUser = obj.client.currentUser();
        let theTenant = obj.client.tenant();
        let msg = err.message;

        if (!obj.data.nextNumber) { // Only do this stuff at the top
            while (errids.length) {
                theId = errids.shift();
                obj.client.onRollback(async function () {
                    await f.datasource.request({
                        method: "PATCH",
                        name: "WorkOrder",
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
            }

            // Do we ever explode multiple?
            f.datasource.request({
                method: "POST",
                name: "Alert",
                user: obj.client.currentUser(),
                data: {
                    category: "Work Order",
                    severity: "Warning",
                    message: (
                        "One or more work order(s) failed to explode " +
                        "due to the following error: " +
                        err
                    ),
                    relation: (
                        (wos && wos.length)
                        ? {
                            code: wos[0].number,
                            id: wos[0].id,
                            objectType: "WorkOrder"
                        }
                        : undefined
                    )
                },
                tenant: theTenant
            }, true);
        }
        return Promise.reject(err);
    }

    function getChildren() {
        function getIndented(pId) {
            return new Promise(function (resolve, reject) {
                function callback(resp) {
                    let kids = resp.filter(
                        (r) => r.objectType === "WorkOrder" && r.id !== pId
                    ).map((w) => w.number.id);
                    let firstNr = resp[0].number.number;
                    delids = delids.concat(kids);
                    lockids = lockids.concat(kids);
                    if (resp.length) {
                        if (firstNr.split("-").length - 1 === 2) {
                            prefixes.push(
                                firstNr.slice(0, firstNr.lastIndexOf("-"))
                            );
                        } else {
                            prefixes.push(firstNr);
                        }
                    }
                    resolve();
                }

                f.datasource.request({
                    method: "POST",
                    name: "doIndentedWorkOrder",
                    client: obj.client,
                    data: {id: pId, isFirmOnly: true}
                }, true).then(callback).catch(reject);
            });
        }

        return Promise.all(ids.map(getIndented));
    }

    async function deleteChildren() {
        let pId;
        let cnt = 0;

        while (cnt < delids.length) {
            pId = delids[cnt];
            cnt += 1;

            await f.datasource.request({
                method: "DELETE",
                name: "WorkOrder",
                client: obj.client,
                eventKey: eKey,
                isHard: true,
                id: pId
            }, true);
        }

        // Gather list of remaining children at other levels
        // Can't reuse those numbers
        preexist = await f.datasource.request({
            method: "GET",
            name: "WorkOrder",
            client: obj.client,
            filter: {criteria: [{
                property: "number",
                operator: "~",
                value: prefixes.toString("|")
            }, {
                property: "id",
                operator: "!~",
                value: ids.toString("|")
            }]},
            properties: ["number"]
        }, true);

        prefixes = preexist.map((p) => p.number);
    }

    function lockWo() {
        return Promise.all(lockids.map(function (id) {
            return f.datasource.lock(
                id,
                obj.client.currentUser(),
                eKey,
                "Explode work order",
                obj.client
            );
        }));
    }

    async function fetchWo() {
        let theWos;
        let wo;
        let matl;
        let n = 0;
        let i = 0;
        let alcs;
        let alc;
        try {
            theWos = await f.datasource.request({
                method: "GET",
                name: "WorkOrder",
                client: obj.client,
                filter: {
                    criteria: [{
                        property: "id",
                        operator: "IN",
                        value: ids
                    }]
                }
            }, true);

            // Remove all material allocations except children
            // (get to those later)
            while (n < theWos.length) {
                wo = theWos[n];
                n += 1;
                if (wo.status !== "U") { // Only care if exploded before
                    while (i < wo.materials.length) {
                        matl = wo.materials[i];
                        i += 1;
                        if (matl.allocated) {
                            alcs = await f.datasource.request({
                                method: "GET",
                                name: "Allocation",
                                client: obj.client,
                                filter: {
                                    criteria: [{
                                        property: "demand.id",
                                        value: matl.id
                                    }, {
                                        property: "supply.objectType",
                                        operator: "!=",
                                        value: "WorkOrder"
                                    }]
                                }
                            }, true);

                            while (alcs.length) {
                                alc = alcs.shift();
                                await f.datasource.request({
                                    method: "DELETE",
                                    name: "Allocation",
                                    client: obj.client,
                                    id: alc.id
                                }, true);
                            }
                        }
                    }
                }
            }
            return theWos;
        } catch (err) {
            return Promise.reject(err);
        }
    }

    function fetchBom(resp) {
        return new Promise(function (resolve, reject) {
            let items = [];
            wos = resp;
            ids = [];

            if (!wos.length) {
                reject("Work order(s) not found");
                return;
            }

            // Get phantom boms recursively
            function getPhantoms(resp) {
                let phIds = [];
                items = items.concat(resp);

                resp.forEach(function (item) {
                    item.billOfMaterialItems.forEach(function (bitem) {
                        if (
                            (
                                bitem.item.type === "P" ||
                                bitem.item.type === "K"
                            ) &&
                            !items.find((i) => i.id === bitem.id)
                        ) {
                            phIds.push(bitem.item.id);
                        }
                    });
                });

                if (!phIds.length) {
                    resolve(items);
                    return;
                }

                f.datasource.request({
                    method: "GET",
                    name: "Product",
                    properties: [
                        "id",
                        "number",
                        "drawingLink",
                        "operations",
                        "billOfMaterialItems"
                    ],
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: phIds
                        }]
                    }
                }, true).then(getPhantoms).catch(reject);
            }

            if (wos.every(function (wo) {
                if (
                    wo.status !== "U" &&
                    wo.status !== "P"
                ) {
                    reject(
                        "Work order must be in Pending " +
                        "status to be exploded"
                    );
                    return false;
                }

                ids.push(wo.item.id);

                return true;
            })) {
                f.datasource.request({
                    method: "GET",
                    name: "Product",
                    properties: [
                        "id",
                        "number",
                        "drawingLink",
                        "operations",
                        "billOfMaterialItems",
                        "documents"
                    ],
                    client: obj.client,
                    filter: {
                        criteria: [{
                            property: "id",
                            operator: "IN",
                            value: ids
                        }]
                    }
                }, true).then(getPhantoms).catch(reject);
            }
        });
    }

    async function fetchItemSites(resp) {
        let itemIds = [];
        let siteIds = [];
        let svcIds = [];

        boms = resp;
        boms.forEach(function (bom) {
            // Below accomdate ECN boms for the future
            bom.inputs = bom.inputs || bom.billOfMaterialItems;
            bom.inputs.forEach(function (inp) {
                if (itemIds.indexOf(inp.item.id) === -1) {
                    itemIds.push(inp.item.id);
                }
            });

            // Outside processes
            bom.operations.filter(
                (op) => op.service
            ).forEach(function (op) {
                svcIds.push(op.service.id);
            });
        });

        wos.forEach(function (wo) {
            if (siteIds.indexOf(wo.site.id) === -1) {
                siteIds.push(wo.site.id);
            }
        });

        if (svcIds.length) {
            svcs = await f.datasource.request({
                method: "GET",
                name: "ItemSite",
                properties: [
                    "id",
                    "item",
                    "site",
                    "leadTime"
                ],
                client: obj.client,
                filter: {criteria: [{
                    property: "item.id",
                    operator: "IN",
                    value: svcIds
                }, {
                    property: "site.id",
                    operator: "IN",
                    value: siteIds
                }]}
            }, true);
        }

        if (itemIds.length) {
            let sql = (
                "SELECT i.id AS item_id, s.id AS site_id, " +
                "  SUM(su.quantity - su.allocated) AS unallocated " +
                "FROM supply su " +
                "  JOIN product i ON (i._pk=su._item_item_pk) " +
                "  JOIN site s ON (s._pk=su._site_site_pk) " +
                "WHERE NOT su.is_deleted " +
                "  AND to_camel_case(su.tableoid::regclass::text) " +
                "  != 'Inventory'" +
                "  AND su.quantity > su.allocated " +
                "  AND s.id = $1 " +
                "  AND i.id IN ("
            );
            let params = [siteIds[0]];
            let n = 2;
            let p = [];
            itemIds.forEach(function (i) {
                p.push("$" + n);
                params.push(i);
                n += 1;
            });
            sql = sql + p.join() + ") GROUP BY i.id, s.id ";
            let rslt = await obj.client.query(sql, params);
            supp = rslt.rows;
            supp.forEach(function (r) {
                r.unallocated = Number(r.unallocated);
            });
        }

        return f.datasource.request({
            method: "GET",
            name: "Inventory",
            properties: [
                "id",
                "item",
                "site",
                "itemSite",
                "available",
                "allocated"
            ],
            client: obj.client,
            filter: {criteria: [{
                property: "item.id",
                operator: "IN",
                value: itemIds
            }, {
                property: "site.id",
                value: siteIds[0]
            }]}
        }, true);
    }

    async function process(resp) {
        let err;
        let inventory = resp;

        function inactive(bi) {
            if (bi.item.status !== "A") {
                err = new Error(
                    "Work order can not be exploded because item " +
                    bi.item.number +
                    " is not active."
                );
                return true;
            }
            return false;
        }

        function invalid(wo) {
            let bom = boms.find((r) => r.id === wo.item.id);

            function hasSite(bi) {
                let ok = (
                    bi.item.type !== "I"
                ) || Boolean(
                    inventory.find(function (i) {
                        return (
                            i.site.id === wo.site.id &&
                            i.item.id === bi.item.id
                        );
                    })
                );
                if (!ok) {
                    err = new Error(
                        "Item " + bi.item.number +
                        " is not setup on site " + wo.site.code
                    );
                    return false;
                }

                return true;
            }

            if (!bom) {
                err = new Error(
                    "Bill of material not found for work order " +
                    wo.number
                );
                return true;
            }

            if (!bom.inputs.every(hasSite)) {
                return true;
            }
            return false;
        }

        function splicePhantoms(pBom) {
            let copy = f.copy(pBom);
            let n = 0;
            let cBom;

            copy.forEach(function (bItem) {
                let pItem;
                let idx;

                if (bItem.item.type === "P" || bItem.item.type === "K") {
                    pItem = boms.find((i) => i.id === bItem.item.id);
                    idx = pBom.indexOf(pBom.find((i) => i.id === bItem.id));
                    cBom = f.copy(pItem.billOfMaterialItems);
                    cBom.forEach(function (i) {
                        i.operation = bItem.operation;
                        i.quantityPer = i.quantityPer.times(
                            bItem.quantityPer
                        );
                    });
                    splicePhantoms(cBom);
                    pBom.splice(idx, 1, ...cBom);
                }
            });
            pBom.forEach(function (i) {
                n += 1;
                i.sequence = n;
            });
        }

        // Validate
        if (boms.some(function (bom) {
            return bom.inputs.some(inactive);
        })) {
            return doReject(err);
        }

        if (wos.some(invalid)) {
            return doReject(err);
        }

        try {
            // Do work
            wos.forEach(function (wo) {
                let inQty;
                let time;
                let bom = boms.find((r) => r.id === wo.item.id);
                let estlbr = 0;
                let estmat = 0;
                let estsvc = 0;
                let estovh = 0;
                let curr = wo.estimatedMaterialCost.currency;
                let mto = [];
                let sids = [];
                let seq = 0;

                wo.materials.length = 0;
                wo.operations.length = 0;
                wo.drawingLink = bom.drawingLink;
                wo.documents = bom.documents;

                inQty = wo.ordered;

                if (bom.operations.length) {
                    // Reverse sort to calc yield impact
                    bom.operations.sort(backward);

                    bom.operations.forEach(function (op) {
                        let yld = op.yield.times(0.01);
                        let svc;

                        inQty = inQty.div(yld);

                        if (
                            !wo.item.isFractional &&
                            Math.round(inQty) !== inQty
                        ) {
                            inQty = Math.ceil(inQty);
                        }

                        if (op.service) {
                            svc = svcs.find(function (svc) {
                                return (
                                    svc.item.id === op.service.id &&
                                    svc.site.id === wo.site.id
                                );
                            });

                            if (!svc) {
                                throw (
                                    "Service " + op.service.number +
                                    " is not not assigned to site " +
                                    wo.site.code
                                );
                            }

                            if (svc.item.status !== "A") {
                                throw (
                                    "Service " + svc.item.number +
                                    " is not active"
                                );
                            }

                            if (svc.item.unit.id !== wo.item.unit.id) {
                                throw (
                                    "Service " + svc.item.number +
                                    " unit of measure " + svc.item.unit.code +
                                    " does not match work order" +
                                    " unit of measure " +
                                    wo.item.unit.code
                                );
                            }

                            op.serviceLeadTime = svc.leadTime;
                        } else {
                            op.serviceLeadTime = 0;
                        }

                        wo.operations.push({
                            id: f.createId(),
                            sequence: op.sequence,
                            description: op.description,
                            machineResource: op.machineResource,
                            laborResource: op.laborResource,
                            queueTime: op.queueTime,
                            setupTime: op.setupTime,
                            runRate: op.runRate,
                            runUnit: op.runUnit,
                            batchSize: op.batchSize,
                            waitTime: op.waitTime,
                            moveTime: op.moveTime,
                            yield: op.yield,
                            instructions: op.instructions,
                            machineCapacity: op.machineCapacity,
                            laborCapacity: op.laborCapacity,
                            transferBatchPolicy: op.transferBatchPolicy,
                            transferBatchValue: op.transferBatchValue,
                            planned: inQty,
                            remaining: inQty,
                            overheadCost: f.copy(
                                op.machineResource
                                ? op.machineResource.overheadCost
                                : {currency: curr, amount: 0}
                            ),
                            laborCost: f.copy(
                                op.laborResource
                                ? op.laborResource.laborCost
                                : {currency: curr, amount: 0}
                            ),
                            serviceCost: f.copy(
                                op.service
                                ? op.service.serviceCost
                                : {currency: curr, amount: 0}
                            ),
                            estimatedOverheadCost: {
                                currency: curr,
                                amount: 0
                            },
                            estimatedLaborCost: {
                                currency: curr,
                                amount: 0
                            },
                            estimatedServiceCost: {
                                currency: curr,
                                amount: 0
                            },
                            actualOverheadCost: {currency: curr, amount: 0},
                            actualLaborCost: {currency: curr, amount: 0},
                            actualServiceCost: {currency: curr, amount: 0},
                            service: op.service,
                            estimatedMachineHours: 0,
                            estimatedLaborHours: 0,
                            completed: 0,
                            rejected: 0,
                            onHold: false,
                            setupComplete: false,
                            toComplete: 0,
                            started: 0,
                            isManualAdd: false,
                            outsideProcessId: "",
                            serviceLeadTime: op.serviceLeadTime
                        });
                    });

                    // Schedule forward
                    time = f.parseDate(wo.startDate);
                    wo.operations.sort(forward);

                    // All these for transfer batch stuff
                    let opnewst;
                    let opnewet;
                    let opprvst;
                    let opprvet;
                    let opprvdur = 0;
                    let opprv;

                    wo.scheduleMethod = "F";

                    wo.operations.forEach(function (op) {
                        let hrs;
                        let cost;
                        let batches;
                        let tfrdur = 0;
                        let prvtfrdur = 0;
                        let opdur;

                        switch (op.runUnit) {
                        case "HU":
                            hrs = op.planned.times(op.runRate);
                            break;
                        case "MU":
                            hrs = op.planned.times(
                                op.runRate
                            ).div(60);
                            break;
                        case "UH":
                            hrs = op.planned.div(
                                op.runRate
                            );
                            break;
                        case "UM":
                            hrs = op.planned.times(
                                op.runRate
                            ).div(3600);
                            break;
                        case "HB":
                            batches = Math.ceil(
                                op.planned.div(op.batchSize)
                            );
                            hrs = batches.times(
                                op.runRate
                            );
                            break;
                        }
                        op.runTime = hrs;

                        // Calc Total shop hours and cost
                        hrs = hrs.plus(op.setupTime);
                        op.capacityTime = hrs;
                        cost = op.estimatedOverheadCost;
                        cost.amount = op.overheadCost.amount.times(
                            hrs
                        ).times(
                            op.machineCapacity
                        );
                        estovh = estovh.plus(cost.amount);
                        cost = op.estimatedLaborCost;
                        cost.amount = op.laborCost.amount.times(hrs).times(
                            op.laborCapacity
                        );
                        estlbr = estlbr.plus(cost.amount);
                        cost = op.estimatedServiceCost;
                        cost.amount = op.serviceCost.amount.times(
                            op.planned
                        );
                        estsvc = estsvc.plus(cost.amount);

                        // Calc total plan time
                        hrs = hrs.plus(
                            op.queueTime
                        ).plus(
                            op.waitTime
                        ).plus(
                            op.moveTime
                        ).plus(
                            op.serviceLeadTime.plus(1).times(24)
                        );
                        op.leadTime = hrs;

                        // Handle transfer offset for next op
                        opdur = op.leadTime.times(MS_HR);
                        if (
                            opprv && (
                                (
                                    opprv.transferBatchPolicy === "Q" &&
                                    opprv.planned >
                                    opprv.transferBatchValue
                                ) ||
                                opprv.transferBatchPolicy === "P"
                            )
                        ) {
                            // Setup time
                            prvtfrdur = opprv.queueTime.plus(
                                opprv.setupTime
                            ).plus(
                                opprv.waitTime
                            ).plus(
                                opprv.moveTime
                            ).times(MS_HR);

                            if (opprv.transferBatchPolicy === "Q") {
                                // Prev. run time for partial qty
                                prvtfrdur = prvtfrdur.plus(
                                    opprv.runTime.times(MS_HR).div(
                                        opprv.planned
                                    ).times(
                                        opprv.transferBatchValue
                                    )
                                );
                                // Current run time for partial qty
                                tfrdur = op.runTime.times(MS_HR).div(
                                    op.planned
                                ).times(
                                    opprv.transferBatchValue
                                );
                            } else if (opprv.transferBatchPolicy === "P") {
                                // Run time for partial qty
                                prvtfrdur = prvtfrdur.plus(
                                    opprv.runTime.times(MS_HR).times(
                                        opprv.transferBatchValue.times(
                                            0.01
                                        )
                                    )
                                );
                                // Current run time for partial qty
                                tfrdur = op.runTime.times(MS_HR).times(
                                    opprv.transferBatchValue.times(0.01)
                                );
                            }
                            opnewst = new Date(
                                opprvst.getTime().plus(prvtfrdur)
                            );
                            if (opprvdur > opdur) {
                                opnewet = new Date(
                                    opprvet.getTime().plus(
                                        tfrdur
                                    ).plus(
                                        op.queueTime.plus(
                                            op.waitTime
                                        ).plus(
                                            op.moveTime
                                        ).times(MS_HR)
                                    )
                                );
                            } else {
                                opnewet = new Date(
                                    opnewst.getTime().plus(opdur)
                                );
                            }
                        } else {
                            opnewst = new Date(time);
                            time.setHours(time.getHours().plus(hrs));
                            opnewet = new Date(time);
                        }
                        op.plannedStartTime = opnewst.toJSON();
                        op.plannedEndTime = opnewet.toJSON();
                        opprvst = opnewst;
                        opprvet = opnewet;
                        opprvdur = opdur;
                        opprv = op;
                    });
                }

                // Inject phantom bill of material if applicable
                splicePhantoms(bom.inputs);

                // Build material requirements
                bom.inputs.forEach(function (i) {
                    let estCost = f.copy(i.item.cost);
                    let reqQty;
                    let reqDt = wo.startDate;
                    let op;
                    let plnQty;
                    let inv = inventory.find(
                        (s) => (
                            s.site.id === wo.site.id &&
                            s.item.id === i.item.id
                        )
                    );
                    let sid = f.createId();
                    let mid = f.createId();
                    let mtoNumber;
                    let invalloc = 0;

                    if (i.operation) {
                        op = wo.operations.find(
                            (o) => o.sequence === i.operation
                        );
                        reqDt = op.plannedStartTime;
                    }

                    if (op) {
                        plnQty = op.planned;
                    } else if (wo.operations.length) {
                        plnQty = wo.operations[0].planned;
                    } else {
                        plnQty = wo.ordered;
                    }

                    reqQty = i.quantityPer.times(
                        plnQty
                    ).plus(
                        i.fixedQuantity
                    ).times(
                        i.ratio
                    );

                    if (!i.item.isFractional) {
                        reqQty = Math.ceil(reqQty);
                    }

                    estCost.amount = estCost.amount.times(reqQty);
                    estmat = estmat.plus(estCost.amount);

                    // Deal with make to order items
                    if (
                        reqQty &&
                        inv && // Kits don't have inventory
                        inv.itemSite.planningPolicy === "M"
                    ) {
                        if (!nextWo) {
                            // Exploded before? Reset number
                            if (wo.status !== "U") {
                                nextWo = wo.number.slice(
                                    wo.number.lastIndexOf("-") + 1
                                );
                                wo.number = wo.number.slice(
                                    0,
                                    wo.number.lastIndexOf("-")
                                );
                            }
                            // Set up dash numbers
                            nextWo = initNextNumber(wo, nextWo, prefixes);
                            wo.number = nextWo();
                        }
                        mtoNumber = nextWo();

                        // Check if inventory available
                        let toalloc = Math.max(inv.available.minus(
                            inv.allocated
                        ), 0);
                        let tomake = reqQty;
                        toalloc = Math.min(toalloc, reqQty);
                        if (toalloc > 0) {
                            tomake = reqQty.minus(toalloc);
                            inv.available = inv.available.minus(toalloc);
                            invalloc = toalloc;
                        }

                        // deduct any other unallocated supply
                        // It will be planned against the order later
                        if (tomake) {
                            let usup = supp.find(
                                (s) => (
                                    s.site_id === wo.site.id &&
                                    s.item_id === i.item.id &&
                                    s.unallocated
                                )
                            );
                            if (usup) {
                                toalloc = Math.min(
                                    usup.unallocated,
                                    reqQty.minus(toalloc)
                                );
                                tomake = reqQty.minus(toalloc);
                                usup.unallocated = usup.unallocated.minus(
                                    toalloc
                                );
                            }
                        }

                        // Make if not enough supply
                        if (tomake) {
                            let ddt = f.parseDate(wo.startDate);
                            ddt.setDate(ddt.getDate().minus(1));
                            let sdt = f.parseDate(wo.startDate);
                            sdt.setDate(
                                sdt.getDate().minus(
                                    inv.itemSite.leadTime
                                ).minus(1)
                            );

                            mto.push({
                                method: "POST",
                                name: "WorkOrder",
                                client: obj.client,
                                data: {
                                    actualLaborCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    actualMaterialCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    actualOverheadCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    actualServiceCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    actualTotalCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    estimatedLaborCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    estimatedMaterialCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    estimatedOverheadCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    estimatedServiceCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    estimatedTotalCost: {
                                        currency: curr,
                                        amount: 0
                                    },
                                    id: sid,
                                    item: {id: i.item.id},
                                    number: mtoNumber,
                                    site: {id: wo.site.id},
                                    ordered: tomake,
                                    startDate: sdt.toLocalDate(),
                                    dueDate: ddt.toLocalDate(),
                                    status: "P",
                                    salesDemand: wo.salesDemand,
                                    salesOrder: wo.salesOrder,
                                    priority: wo.priority
                                },
                                id: sid
                            }, {
                                method: "POST",
                                name: "Allocation",
                                client: obj.client,
                                data: {
                                    demand: {id: mid},
                                    supply: {id: sid},
                                    quantity: tomake,
                                    isFirm: true
                                }
                            });
                            sids.push(sid);
                        }

                        // Allocate any inventory if avail
                        if (invalloc) {
                            mto.push({
                                method: "POST",
                                name: "Allocation",
                                client: obj.client,
                                data: {
                                    demand: {id: mid},
                                    supply: {id: inv.id},
                                    quantity: invalloc
                                }
                            });
                        }
                    }
                    wo.materials.push({
                        actualCost: {amount: 0, currency: estCost.currency},
                        id: mid,
                        sequence: i.sequence,
                        item: i.item,
                        site: wo.site,
                        fixedQuantity: i.fixedQuantity,
                        quantityPer: i.quantityPer,
                        unit: {id: i.unit.id},
                        ratio: i.ratio,
                        required: reqQty,
                        estimatedCost: estCost,
                        operation: i.operation,
                        dueDate: reqDt,
                        substitutions: i.substitutions.map(
                            (s) => s.item.id
                        ).concat([i.item.id]),
                        reference: i.reference
                    });
                });
                // Set line numbers
                wo.materials.forEach(function (mtl) {
                    seq += 1;
                    mtl.sequence = seq;
                    mtl.number = wo.number + "." + seq;
                });

                wo.estimatedMaterialCost.amount = estmat;
                wo.estimatedLaborCost.amount = estlbr;
                wo.estimatedOverheadCost.amount = estovh;
                wo.estimatedServiceCost.amount = estsvc;
                wo.estimatedTotalCost.amount = estmat.plus(
                    estlbr
                ).plus(estovh).plus(estsvc);
                wo.status = "P";

                if (defStatus !== "P" || wo.error) {
                    chgStatus.push(wo.id);
                }

                //Update this work order
                requests.push({
                    method: "POST",
                    name: "WorkOrder",
                    client: obj.client,
                    id: wo.id,
                    eventKey: eKey,
                    data: wo
                });

                // Build make to order children
                requests = requests.concat(mto);

                // Explode children
                if (sids.length) {
                    requests.push({
                        method: "POST",
                        name: "doExplodeWorkOrder",
                        client: obj.client,
                        data: {
                            ids: sids,
                            nextNumber: nextWo,
                            eventKey: eKey
                        }
                    });
                }

                //Update plan status
                requests.push({
                    method: "POST",
                    name: "doUpdateWorkOrderPlanStatus",
                    client: obj.client,
                    data: {id: wo.id}
                });
            });

            // If applicable, change status of work orders after
            // all children and allocations settled
            chgStatus.forEach(function (woid) {
                requests.push({
                    method: "PATCH",
                    name: "WorkOrder",
                    client: obj.client,
                    id: woid,
                    data: [{
                        op: "replace",
                        path: "/status",
                        value: defStatus
                    }, {
                        op: "replace",
                        path: "/error",
                        value: ""
                    }]
                });
            });

            while (requests.length) {
                await f.datasource.request(requests.shift(), true);
            }
            return "Work Order(s) exploded";
        } catch (e) {
            return doReject(e);
        }
    }

    let resp;
    try {
        if (top) {
            await getChildren();
            await lockWo();
            await deleteChildren();
        }
        resp = await fetchWo();
        resp = await fetchBom(resp);
        resp = await fetchItemSites(resp);
        return process(resp);
    } catch (err) {
        return doReject(err);
    }
}

f.datasource.registerFunction(
    "POST",
    "doExplodeWorkOrder",
    doExplodeWo
);