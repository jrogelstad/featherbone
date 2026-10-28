/*jslint unordered devel*/
/*global*/
let sql1;
let sql2;
let sql4;

const dateDiff = (start, end) => Math.ceil((end - start) / 86400000);

async function doCalc(obj) {
    let pgClient = obj.client;
    let demandId = obj.data.demandId || "";
    let itemId = obj.data.itemId;
    let siteId = obj.data.siteId;
    let qty = obj.data.quantity;
    let reqDate = (
        obj.data.requestedDate
        ? obj.data.requestedDate.slice(0, 10)
        : f.today()
    );
    let requestedDate = f.parseDate(reqDate);
    let today = f.parseDate(f.today());
    let allocParent = Boolean(obj.data.allocateParent);
    let dueDate;
    let planSettings = await f.datasource.request({
        client: obj.client,
        data: {name: "planSettings"},
        method: "GET",
        name: "getSettings"
    }, true);
    planSettings = planSettings || {shippingBuffer: 0};
    let shipBuffer = planSettings.shippingBuffer;

    if (!itemId) {
        throw "Item id required";
    }
    if (!siteId) {
        throw "Site id required";
    }
    if (!qty) {
        throw "Quantity required";
    }
    let indented = await pgClient.query(sql1, [itemId, siteId]);

    function padSpaces(spcs, dat) {
        dat.description = spcs + dat.description;
        if (dat.detail && dat.detail.length) {
            let ps2 = padSpaces.bind(null, spcs + "  ");
            dat.detail.forEach(ps2);
        }
    }
    let ps1 = padSpaces.bind(null, "    ");

    // Include the product we're planning at the top
    let is = await pgClient.query(sql2, [itemId, siteId]);
    if (!is.rows.length) {
        throw ("Item site not found");
    }
    let theIs = is.rows[0];
    theIs.path = [];

    // Get existing supplies
    let n = 0;
    let skeys = indented.rows.map((r) => r.is_pk);
    if (allocParent) {
        skeys.push(theIs.is_pk);
    }
    let ikeys = skeys.map(function () {
        n += 1;
        return "$" + n;
    });
    let sql3 = (
        "SELECT s._pk AS supply_pk, its._pk AS item_site_pk, " +
        "  s.quantity - s.allocated AS unallocated, " +
        "  0 AS quantity, " +
        "  s.id, s.number, s.created, " +
        "  item.number AS item_number, item.id AS item_id, " +
        "  to_camel_case(s.tableoid::regclass::text) AS object_type, " +
        "  CASE WHEN s.tableoid::regclass::text = 'inventory' THEN " +
        "    current_date - 2 " +
        "  ELSE " +
        "    s.start_date " +
        "  END AS start_date, " +
        "  CASE WHEN s.tableoid::regclass::text = 'inventory' THEN " +
        "    current_date - 1 " +
        "  ELSE " +
        "    s.due_date " +
        "  END AS due_date, " +
        "  false AS is_allocated " +
        "FROM supply s, item_site its, item " +
        "WHERE NOT s.is_deleted " +
        "  AND NOT its.is_deleted " +
        "  AND s.status != 'C' " +
        "  AND s.quantity > 0 " +
        "  AND s.allocated < s.quantity " +
        "  AND s._item_item_pk=its._item_item_pk " +
        "  AND s._site_site_pk=its._site_site_pk " +
        "  AND s._item_item_pk=item._pk " +
        "  AND its._pk IN (" + ikeys.toString() + ") " +
        "ORDER BY COALESCE(due_date, '1970-01-01'), s._pk; "
    );
    let supply = await pgClient.query(sql3, skeys);
    let supply2 = await pgClient.query(sql4, [siteId, itemId, demandId]);
    supply.rows = supply2.rows.concat(supply.rows);

    // Flatten kits
    let kits = [];
    function flattenKits(item) {
        let child;
        let ary = indented.rows.filter((r) => r.parent_pk === item.child_pk);
        let childKits = [];
        if (item.item_type === "K") {
            kits.push(item);
        }
        while (ary.length) {
            child = ary.shift();
            if (item.item_type === "K") {
                child.level -= 1;
                child.parent_pk = item.parent_pk;
            }
            if (child.item_type === "K") {
                childKits.push(child);
            }
            if (child.item_source === "M") {
                ary = ary.concat(flattenKits(child));
            }
        }
        return childKits;
    }
    indented.rows.filter((r) => r.level === 1).forEach(flattenKits);
    kits.forEach(function (kit) {
        // Remove kits from all paths
        indented.rows.filter((r) => r.item_type !== "K").forEach(function (r) {
            let p = r.path.indexOf(kit.pk);
            if (p !== -1) {
                r.path.splice(p, 1);
            }
        });
        // Remove kit from bom
        let i = indented.rows.indexOf(kit);
        indented.rows.splice(i, 1);
    });

    // Sort the whole thing into a proper tree
    let bom = indented.rows.filter((r) => r.level === 1);
    let rem = indented.rows.filter((r) => r.level === 2);
    let lvl = 2;
    let thePlan = [];
    let child;
    let parent;
    let idx;
    let lvls = {};
    let top = true;

    function byLevel(r) {
        return r.level === lvl;
    }
    function bySequence(a, b) {
        return a.bom_sequence - b.bom_sequence;
    }
    function byParent(row) {
        return row.child_pk === child.parent_pk;
    }
    bom.sort(bySequence);
    while (rem.length) {
        rem.sort(bySequence);
        while (rem.length) {
            child = rem.pop();
            parent = bom.find(byParent);
            idx = bom.indexOf(parent) + 1;
            bom.splice(idx, 0, child);
        }
        lvl += 1;
        rem = indented.rows.filter(byLevel);
    }
    bom.unshift(theIs);
    let paths = [];
    let currPath = [];

    function extractPath(bi) {
        let ary = bi.path.map(function (k) {
            let fd = indented.rows.find((bi) => bi.pk === k);
            return {
                id: fd.bom_id,
                leadTime: fd.is_lead_time,
                number: fd.item_number
            };
        });
        ary.unshift({
            id: theIs.bom_id,
            leadTime: theIs.is_lead_time,
            number: theIs.item_number
        });
        ary.reverse();
        return ary;
    }

    // Build the plan
    async function planSupplies(args) {
        let pAry = args.parentArray;
        let pQty = args.quantity;
        let pId = args.id;
        let pSpcs = args.spaces;
        let pDueDate = new Date(args.dueDate);
        let row;
        let sups;
        let sup;
        let qtyReq;
        let toAlloc;
        let woPlan;
        let planItem;
        let woNr;
        let theLinks;
        let minDate = f.parseDate(f.endOfTime());
        let maxDate = f.parseDate(f.startOfTime());
        let desc;
        let topId = f.createId();
        let wipPath;
        let objType;
        let typ;
        let theEnd;
        let theStart;
        pSpcs = pSpcs || "";
        let planStartDate;
        let planDueDate;

        if (pId) {
            theLinks = [{target: pId, type: "FS"}];
        }

        while (bom.length) {
            row = bom.shift();

            // Keep track of lead time paths
            currPath = currPath.slice();
            lvls[row.level] = {
                dueDate: pDueDate,
                id: row.bom_id,
                path: currPath
            };

            // First assign available supply
            sups = supply.rows.filter(
                (s) => (
                    row.is_pk === s.item_site_pk &&
                    (s.unallocated > 0 || s.is_allocated)
                )
            );

            qtyReq = pQty.times(
                Number(row.bom_quantity_per)
            ).plus(
                Number(row.bom_fixed_quantity)
            ).times(
                Number(row.bom_ratio)
            );
            if (!row.item_is_fractional) {
                qtyReq = Math.ceil(qtyReq);
            }

            while (sups.length && qtyReq) {
                sup = sups.shift();
                if (sup.is_allocated) {
                    toAlloc = Number(sup.quantity);
                } else {
                    toAlloc = Math.min(Number(sup.unallocated), qtyReq);
                    sup.unallocated = Number(sup.unallocated).minus(toAlloc);
                }
                qtyReq = qtyReq.minus(toAlloc);

                if (sup.object_type === "WorkOrder") {
                    woPlan = await f.datasource.request({
                        client: obj.client,
                        data: {
                            id: sup.id,
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
                        let sd = f.parseDate(i.startDate);
                        let dd = f.parseDate(i.dueDate);
                        if (sd.valueOf() < minDate.valueOf()) {
                            minDate = sd;
                        }
                        if (dd.valueOf() > maxDate.valueOf()) {
                            maxDate = dd;
                        }
                    });
                    woPlan.forEach(ps1);
                    woPlan.forEach(function (i) {
                        i.parent = sup.id;
                    });
                    woNr = sup.number;
                    if (woNr.split("-").length === 3) {
                        woNr = woNr.slice(0, woNr.lastIndexOf("-"));
                    }

                    planItem = {
                        description: (
                            pSpcs + "(" + woNr + ") " +
                            sup.item_number +
                            " [Qty: " + toAlloc.toLocaleString() + "]"
                        ),
                        detail: woPlan,
                        dueDate: maxDate,
                        feather: "WorkOrder",
                        id: sup.id,
                        key: sup.id,
                        level: lvl,
                        links: theLinks,
                        number: {
                            id: sup.id,
                            number: sup.number,
                            objectType: sup.objectType
                        },
                        objectType: sup.objectType,
                        percent: 0,
                        startDate: minDate,
                        type: "group"
                    };
                } else {
                    if (
                        row.level === 0 ||
                        sup.object_type !== "Inventory"
                    ) {
                        if (sup.object_type === "Inventory") {
                            desc = (
                                pSpcs + sup.number +
                                " [Qty: " + toAlloc.toLocaleString() + "]"
                            );
                        } else {
                            desc = (
                                pSpcs + "(" + sup.number + ") " +
                                row.item_number +
                                " [Qty: " + toAlloc.toLocaleString() + "]"
                            );
                        }

                        planItem = {
                            description: desc,
                            detail: [],
                            dueDate: sup.due_date.toLocalDate(),
                            id: sup.id,
                            level: row.level,
                            links: theLinks,
                            number: {
                                id: sup.id,
                                number: sup.number,
                                objectType: sup.object_type
                            },
                            objectType: sup.object_type,
                            parent: pId,
                            percent: 0,
                            startDate: sup.start_date.toLocalDate(),
                            type: (
                                row.level === 0
                                ? "task"
                                : ""
                            )
                        };
                    }
                }
                if (planItem) {
                    // For display
                    pAry.push(planItem);
                    // For scheduling
                    wipPath = currPath.slice();
                    wipPath.unshift({
                        id: sup.id,
                        leadTime: Math.max(
                            dateDiff(today, sup.due_date).minus(1),
                            0
                        ),
                        number: sup.number,
                        plan: planItem
                    });
                    paths.push(wipPath);
                }
            }

            if (qtyReq) {
                // Still need to do something new so reflect that
                objType = "PlannedPurchase";
                typ = "";
                theEnd = new Date(pDueDate);
                theStart = new Date(theEnd);
                theStart.setDate(theStart.getDate() - Number(row.is_lead_time));

                if (row.item_source === "M") {
                    if (row.is_planning_policy === "L") {
                        objType = "PlannedWorkOrder";
                    } else {
                        objType = "WorkOrder";
                        typ = "task";
                    }
                }

                planItem = {
                    description: (
                        pSpcs + "(NEW " + objType.toName() + ") " +
                        row.item_number + " [Qty: " +
                        qtyReq.toLocaleString() + "]"
                    ),
                    detail: [],
                    dueDate: theEnd,
                    feather: "Product",
                    id: row.bom_id,
                    isNew: true,
                    key: row.item_id,
                    level: row.level,
                    links: theLinks,
                    number: {
                        id: row.bom_id,
                        number: "NEW",
                        objectType: objType
                    },
                    objectType: objType,
                    percent: 0,
                    quantity: qtyReq,
                    startDate: theStart,
                    type: typ
                };

                paths.push(extractPath(row));

                lvls[row.level].startDate = new Date(theStart);
                lvls[row.level].startDate.setDate(
                    lvls[row.level].startDate.getDate()
                );

                // If top level work order...
                if (row.is_planning_policy === "M" && top) {
                    top = false;
                    planItem.description = "    " + planItem.description;
                    planItem.links = [];
                    planItem = {
                        description: (
                            pSpcs + "(NEW " + objType.toName() +
                            " Group) [Qty: " + qtyReq.toLocaleString() + "]"
                        ),
                        detail: [planItem],
                        dueDate: pDueDate,
                        feather: "Product",
                        id: topId,
                        isNew: true,
                        key: row.item_id,
                        links: [],
                        number: {
                            id: topId,
                            number: "NEW",
                            objectType: objType
                        },
                        objectType: objType,
                        percent: 0,
                        startDate: f.parseDate(f.today()),
                        type: "group"
                    };
                    pAry.push(planItem);
                    planStartDate = f.parseDate(f.endOfTime());
                    planDueDate = f.parseDate(f.startOfTime());

                    await planSupplies({
                        dueDate: theStart,
                        id: row.bom_id,
                        parentArray: planItem.detail,
                        quantity: qtyReq,
                        spaces: pSpcs + "    "
                    });

                    planItem.detail.filter(
                        (r) => r.objectType === "WorkOrder"
                    ).forEach(function (item) {
                        if (
                            item.startDate.valueOf() < planStartDate.valueOf()
                        ) {
                            planStartDate = new Date(item.startDate);
                        }
                        if (item.dueDate.valueOf() > planDueDate.valueOf()) {
                            planDueDate = new Date(item.dueDate);
                        }
                    });
                    planItem.startDate = planStartDate;
                    planItem.dueDate = planDueDate;
                } else {
                    pAry.push(planItem);
                }
            } else {
                // All quantities covered by existing supplies
                // so remove all dependencies
                while (bom.length && bom[0].level > row.level) {
                    bom.shift();
                }
            }
            if (bom.length) {
                if (bom[0].level > row.level) {
                    pId = lvls[row.level].id;
                    pDueDate = new Date(theStart);
                    pDueDate.setDate(pDueDate.getDate());
                    theLinks = [{target: pId, type: "FS"}];
                } else if (bom[0].level < row.level) {
                    pId = lvls[bom[0].level - 1].id;
                    currPath = lvls[bom[0].level - 1].path;
                    pDueDate = new Date(lvls[bom[0].level - 1].startDate);
                    theLinks = [{target: pId, type: "FS"}];
                } else {
                    currPath = lvls[row.level].path;
                }
            }
        }
    }

    let theDueDate = new Date(requestedDate);
    theDueDate.setDate(theDueDate.getDate());

    await planSupplies({
        parentArray: thePlan,
        quantity: qty,
        dueDate: theDueDate
    });

    // Determine critical path
    let maxLeadTime = 0;
    paths.forEach(function (p) {
        p.totalLeadTime = p.reduce((acc, cv) => acc.plus(cv.leadTime), 0);
        if (p.totalLeadTime > maxLeadTime) {
            maxLeadTime = p.totalLeadTime;
        }
    });

    paths.forEach(function (p) {
        if (p.totalLeadTime === maxLeadTime) {
            p.isCriticalPath = true;
        }
    });

    /*
    console.log(paths.map(function (p) {
        let val = p.map((cp) => cp.number + " - " + cp.leadTime).join(" -> ");
        let flag = (
            p.isCriticalPath
            ? "Critical! "
            : ""
        );
        return flag + "Leadtime: " + p.totalLeadTime + ", Path: " + val;
    }));
    */

    let requestedLeadTime = dateDiff(today, requestedDate);
    let totalLeadTime = maxLeadTime.plus(1);
    let addLeadTime = 0;

    if (requestedLeadTime >= totalLeadTime) {
        dueDate = requestedDate;
    } else {
        addLeadTime = totalLeadTime.minus(requestedLeadTime);
        dueDate = today;
        dueDate.setDate(dueDate.getDate() + totalLeadTime);
    }

    function postProcessDates(pln) {
        pln.forEach(function (row) {
            if (row.isNew) {
                if (addLeadTime) {
                    row.startDate.setDate(
                        row.startDate.getDate() + addLeadTime
                    );
                    row.dueDate.setDate(
                        row.dueDate.getDate() + addLeadTime
                    );
                }
                delete row.isNew;
            }
            if (row.startDate.constructor.name === "Date") {
                row.startDate = row.startDate.toLocalDate();
            }
            if (row.dueDate.constructor.name === "Date") {
                row.dueDate = row.dueDate.toLocalDate();
            }
            if (row.detail) {
                postProcessDates(row.detail);
            }
        });
    }
    postProcessDates(thePlan);
    if (shipBuffer) {
        let startDate = new Date(dueDate);
        dueDate.setDate(dueDate.getDate().plus(shipBuffer));
        thePlan.push({
            description: "Shipping Buffer",
            detail: [],
            dueDate: dueDate.toLocalDate(),
            id: "planSettings",
            isNew: true,
            level: 0,
            links: [],
            number: {
                id: f.createId(),
                number: "NEW",
                objectType: "Settings"
            },
            objectType: "Settings",
            percent: 0,
            route: "settings/planSettings",
            startDate: startDate.toLocalDate(),
            type: "task"
        });
    }

    return {
        dueDate: dueDate.toLocalDate(),
        plan: thePlan
    };
}

f.datasource.registerFunction(
    "POST",
    "doCalculateDueDate",
    doCalc
);

sql1 = (
    "WITH RECURSIVE bom( " +
    "pk, " +
    "parent_pk, " +
    "child_pk, " +
    "level, " +
    "bom_fixed_quantity, " +
    "bom_id," +
    "bom_quantity_per, " +
    "bom_ratio, " +
    "bom_sequence, " +
    "bom_unit_id, " +
    "bom_unit_code, " +
    "item_id, " +
    "item_number, " +
    "item_type, " +
    "item_status, " +
    "item_source, " +
    "item_is_fractional, " +
    "site_id, " +
    "site_code, " +
    "is_pk, " +
    "is_planning_policy, " +
    "is_lead_time, " +
    "path, " +
    "cycle " +
    ") AS ( " +
    "SELECT  " +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "1, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "u.id, " +
    "u.code, " +
    "item.id, " +
    "item.number, " +
    "item.type, " +
    "item.status, " +
    "item.source, " +
    "item.is_fractional, " +
    "site.id, " +
    "site.code, " +
    "item_site._pk, " +
    "item_site.planning_policy, " +
    "item_site.lead_time, " +
    "ARRAY[bi._pk], " +
    "false " +
    "FROM product_bill_of_material_item bi, " +
    "  item_unit u, product, item, site, " +
    "  item_site " +
    "WHERE item._pk = bi._item_item_pk " +
    "    AND product._pk = bi._product_product_pk " +
    "    AND bi._unit_item_unit_pk = u._pk " +
    "    AND item_site._item_item_pk = item._pk " +
    "    AND item_site._site_site_pk = site._pk " +
    "    AND item_site.planning_policy != 'R' " +
    "    AND item.type != 'E' " +
    "    AND (bi.quantity_per > 0 OR bi.fixed_quantity > 0) " +
    "    AND NOT bi.is_deleted " +
    "    AND NOT item.is_deleted " +
    "    AND NOT site.is_deleted " +
    "    AND NOT item_site.is_deleted " +
    "    AND product.id = $1 " +
    "    AND site.id = $2 " +
    "UNION " +
    "SELECT  " +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "bom.level + 1, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "u.id, " +
    "u.code, " +
    "item.id, " +
    "item.number, " +
    "item.type, " +
    "item.status, " +
    "item.source, " +
    "item.is_fractional, " +
    "site.id, " +
    "site.code, " +
    "item_site._pk, " +
    "item_site.planning_policy, " +
    "item_site.lead_time, " +
    "bom.path || bi._pk, " +
    "bi._pk = ANY(bom.path) " +
    "FROM bom, product_bill_of_material_item bi, item_unit u, item, site, " +
    "  item_site  " +
    "WHERE item._pk = bi._item_item_pk " +
    "  AND bi._unit_item_unit_pk = u._pk " +
    "  AND bi._product_product_pk = bom.child_pk " +
    "  AND item_site._item_item_pk = item._pk " +
    "  AND item_site._site_site_pk = site._pk " +
    "  AND item_site.planning_policy != 'R' " +
    "  AND item.type != 'E' " +
    "  AND site.id = $2 " +
    "  AND (bi.quantity_per > 0 OR bi.fixed_quantity > 0) " +
    "  AND NOT bi.is_deleted " +
    "  AND NOT item.is_deleted " +
    "  AND NOT site.is_deleted " +
    "  AND NOT item_site.is_deleted " +
    "  AND NOT cycle " +
    ") SELECT * FROM bom "
);

sql2 = (
    "SELECT " +
    "-1 AS pk, " +
    "p._pk AS parent_pk, " +
    "-1 AS child_pk, " +
    "0 AS level, " +
    "0 AS bom_fixed_quantity, " +
    "p.id AS bom_id," +
    "1 AS bom_quantity_per, " +
    "1 AS bom_ratio, " +
    "0 AS bom_sequence, " +
    "u.id AS bom_unit_id, " +
    "u.code AS bom_unit_code, " +
    "p.id AS item_id, " +
    "p.number AS item_number, " +
    "p.type AS item_type, " +
    "p.status AS item_status, " +
    "p.source AS item_source, " +
    "p.is_fractional AS item_is_fractional, " +
    "s.id AS site_id, " +
    "s.code AS site_code, " +
    "its._pk AS is_pk, " +
    "its.planning_policy AS is_planning_policy, " +
    "its.lead_time AS is_lead_time " +
    "FROM item_site its, product p, unit u, site s " +
    "WHERE NOT its.is_deleted " +
    "  AND NOT p.is_deleted " +
    "  AND NOT s.is_deleted " +
    "  AND its._item_item_pk=p._pk " +
    "  AND its._site_site_pk=s._pk " +
    "  AND u._pk=p._unit_item_unit_pk " +
    "  AND p.id = $1 " +
    "  AND s.id = $2 "
);

sql4 = (
    "SELECT s._pk AS supply_pk, its._pk AS item_site_pk, " +
    "  0 AS unallocated, " +
    "  a.quantity, " +
    "  s.id, s.number, s.created, " +
    "  item.number AS item_number, item.id AS item_id, " +
    "  to_camel_case(s.tableoid::regclass::text) AS object_type, " +
    "  CASE WHEN s.tableoid::regclass::text = 'inventory' THEN " +
    "    current_date - 2 " +
    "  ELSE " +
    "    s.start_date " +
    "  END AS start_date, " +
    "  CASE WHEN s.tableoid::regclass::text = 'inventory' THEN " +
    "    current_date - 1 " +
    "  ELSE " +
    "    s.due_date " +
    "  END AS due_date, " +
    "  true AS is_allocated " +
    "FROM supply s, item_site its, item, allocation a, demand d, site " +
    "WHERE NOT s.is_deleted " +
    "  AND NOT its.is_deleted " +
    "  AND s.status != 'C' " +
    "  AND s.quantity > 0 " +
    "  AND s._item_item_pk=its._item_item_pk " +
    "  AND s._site_site_pk=its._site_site_pk " +
    "  AND s._item_item_pk=item._pk " +
    "  AND site._pk=s._site_site_pk " +
    "  AND d._pk=a._demand_demand_pk " +
    "  AND a._supply_supply_pk=s._pk " +
    "  AND site.id=$1 " +
    "  AND item.id=$2 " +
    "  AND d.id=$3 " +
    "ORDER BY COALESCE(s.due_date, '1970-01-01'), s._pk; "
);