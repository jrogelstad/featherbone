/*jslint devel*/
async function createDeallocateHistory(obj) {
    let alc = obj.data.allocation;
    let type = obj.data.type;
    let toDealloc = obj.data.quantity;
    let theId = obj.data.id;
    let dtyp = alc.demand.objectType.toName();
    let styp = type.toName();
    let dmd;
    let txt = (
        `Quantity ${toDealloc} of ${alc.demand.item.number} ` +
        `was deallocated from ${dtyp} ${alc.demand.number} ` +
        `due to `
    );
    switch (obj.data.reason) {
    case "adjustment":
        dmd = await obj.client.query(
            "SELECT number FROM inventory_adjustment WHERE id=$1",
            [theId]
        );
        txt += (
            `inventory adjustment ` +
            `${dmd.rows[0].number}`
        );
        break;
    case "closed":
        txt += (
            `${styp} supply ` +
            `${alc.supply.number} being closed`
        );
        break;
    case "delete":
        txt += (
            `${styp} supply ` +
            `${alc.supply.number} being deleted`
        );
        break;
    case "negative":
        txt += (
            `inventory having a negative quantity on supply receipt`
        );
        break;
    case "usage":
        dmd = await obj.client.query(
            "SELECT number FROM demand WHERE id=$1",
            [theId]
        );
        txt += (
            `allocation being used by ${styp} ` +
            `${dmd.rows[0].number}`
        );
        break;
    default:
        Promise.reject("No deallocation reason code");
    }
    let sql = (
        "INSERT INTO %I " +
        "( _pk, id, created, created_by, updated, updated_by, " +
        "  is_deleted, lock, text, is_system, " +
        "  %I) VALUES( " +
        "  (SELECT nextval('object__pk_seq')), $1, now(), " +
        "   $2, now(), $2, false, null, $3, true, "
    );
    let valid = true;
    let currUser = obj.client.currentUser();
    let theTenant = obj.client.tenant();
    let sqla;
    let resa;

    switch (alc.demand.objectType) {
    case "OutsideProcess":
        sql = sql.format([
            "work_order_comment",
            "_work_order_work_order_pk"
        ]);
        sql += (
            "(SELECT wo._pk FROM work_order wo " +
            "  JOIN outside_process osp ON " +
            "    wo._pk=osp._work_order_work_order_pk " +
            "WHERE osp.id = $4)); "
        );
        sqla = (
            "SELECT wo.id, wo.number, 'WorkOrder' AS object_type " +
            "FROM work_order wo " +
            "  JOIN outside_process osp ON " +
            "    wo._pk=_work_order_work_order_pk " +
            "WHERE osp.id = $1; "
        );
        break;
    case "SalesOrderLine":
        sql = sql.format([
            "sales_order_comment",
            "_sales_order_sales_order_pk"
        ]);
        sql += (
            "(SELECT so._pk FROM sales_order so " +
            "  JOIN sales_order_line sol ON " +
            "    so._pk=_sales_order_sales_order_pk " +
            "WHERE sol.id = $4)); "
        );
        sqla = (
            "SELECT so.id, so.number, 'SalesOrder' " +
            "   AS object_type " +
            "FROM sales_order so " +
            "  JOIN sales_order_line sol ON " +
            "    so._pk=_sales_order_sales_order_pk " +
            "WHERE sol.id = $1; "
        );
        break;
    case "SalesOrderRequirement":
        sql = sql.format([
            "sales_order_comment",
            "_sales_order_sales_order_pk"
        ]);
        sql += (
            "(SELECT so._pk FROM sales_order so " +
            "  JOIN sales_order_line sol ON " +
            "    so._pk=_sales_order_sales_order_pk " +
            "  JOIN sales_order_requirement sor ON " +
            "    sol._pk=_sales_order_line_sales_order_line_pk " +
            "WHERE sor.id = $4)); "
        );
        sqla = (
            "SELECT so.id, so.number, 'SalesOrder' AS " +
            "  object_type " +
            "FROM sales_order so " +
            "  JOIN sales_order_line sol ON " +
            "    so._pk=_sales_order_sales_order_pk " +
            "  JOIN sales_order_requirement sor ON " +
            "    sol._pk=_sales_order_line_sales_order_line_pk " +
            "WHERE sor.id = $1; "
        );
        break;
    case "WorkOrderRequirement":
        sql = sql.format([
            "work_order_comment",
            "_work_order_work_order_pk"
        ]);
        sql += (
            "(SELECT wo._pk FROM work_order wo " +
            "  JOIN work_order_requirement wor ON " +
            "    wo._pk=_work_order_work_order_pk " +
            "WHERE wor.id = $4)); "
        );
        sqla = (
            "SELECT wo.id, wo.number, 'WorkOrder' AS object_type " +
            "FROM work_order wo " +
            "  JOIN work_order_requirement wor ON " +
            "    wo._pk=_work_order_work_order_pk " +
            "WHERE wor.id = $1; "
        );
        break;
    default:
        valid = false;
    }

    if (valid) {
        await obj.client.query(sql, [
            f.createId(),
            obj.client.currentUser(),
            txt,
            alc.demand.id
        ]);
        resa = await obj.client.query(sqla, [alc.demand.id]);
        if (resa.rows.length) {
            obj.client.onCommit(function () {
                f.datasource.request({
                    data: {
                        category: resa.rows[0].object_type.toName(),
                        message: txt,
                        relation: {
                            code: resa.rows[0].number,
                            id: resa.rows[0].id,
                            objectType: resa.rows[0].object_type
                        },
                        severity: "Warning"
                    },
                    method: "POST",
                    name: "Alert",
                    tenant: theTenant,
                    user: currUser
                }, true);
            });
        }
    }
}

f.datasource.registerFunction(
    "POST",
    "doCreateDeallocationHistory",
    createDeallocateHistory
);

async function transact(obj) {
    let theId = obj.data.id;
    let qty = obj.data.quantity;
    let invQty = qty;
    let type = obj.data.type;
    let realloc = Boolean(obj.data.reallocate);
    let updPlanStatus = obj.data.updatePlanStatus !== false;
    let target = (
        type === "demand"
        ? "supply"
        : "demand"
    );
    let props = ["id", target, "quantity"];

    if (realloc) {
        props.push("salesOrder");
        props.push("salesDemand");
    }

    // Sort by inventory, firmed, planned, due date, create date
    function byTypeDate(a, b) {
        if (
            a[target].objectType === "Inventory" &&
            b[target].objectType !== "Inventory"
        ) {
            return 1;
        }

        if (
            a[target].objectType === "Inventory" &&
            b[target].objectType === "Inventory"
        ) {
            if (a[target].created > b[target].created) {
                return 1;
            }
            return -1;
        }

        if (
            !a[target].objectType.startsWith("Planned") &&
            b[target].objectType.startsWith("Planned")
        ) {
            return 1;
        }

        if (
            a[target].dueDate > b[target].dueDate
        ) {
            return 1;
        }
        if (
            a[target].dueDate < b[target].dueDate
        ) {
            return -1;
        }

        if (a[target].created > b[target].created) {
            return 1;
        }
        return -1;
    }

    // Get alloctions
    let resp = await f.datasource.request({
        client: obj.client,
        filter: {criteria: [{
            property: type + ".id",
            value: theId
        }]},
        isForUpdate: true,
        method: "GET",
        name: "Allocation",
        properties: props
    }, true);
    let allc = resp.sort(byTypeDate);
    let alc;
    let alcQty;
    let bal;
    let itemId;
    let siteId;
    let woreqs = [];
    let woosps = [];
    let soreqs = [];
    let solines = [];

    async function deallocate(tgt, hist) {
        let toDealloc;
        while (qty && allc.length) {
            if (tgt === "supply" && !obj.data.isLifo) {
                alc = allc.shift();
            } else {
                alc = allc.pop();
            }
            itemId = alc[tgt].item.id;
            siteId = alc[tgt].site.id;
            alcQty = alc.quantity;

            if (qty < alcQty) {
                bal = alcQty.minus(qty);
                toDealloc = qty;
                qty = 0;
                if (alc.supply && alc.supply.objectType === "Inventory") {
                    invQty = invQty.minus(toDealloc);
                }

                await f.datasource.request({
                    client: obj.client,
                    data: [{
                        op: "replace",
                        path: "/quantity",
                        value: bal
                    }],
                    eventKey: obj.eventKey,
                    id: alc.id,
                    method: "PATCH",
                    name: "Allocation"
                }, true);
            } else {
                qty = qty.minus(alcQty);
                toDealloc = alcQty;
                if (alc.supply && alc.supply.objectType === "Inventory") {
                    invQty = invQty.minus(toDealloc);
                }
                await f.datasource.request({
                    client: obj.client,
                    eventKey: obj.eventKey,
                    id: alc.id,
                    method: "DELETE",
                    name: "Allocation"
                }, true);
            }

            if (hist) {
                await createDeallocateHistory({
                    client: obj.client,
                    data: {
                        allocation: alc,
                        id: obj.data.adjustId || theId,
                        quantity: toDealloc,
                        reason: (
                            obj.data.adjustId
                            ? "adjustment"
                            : "usage"
                        ),
                        type: obj.data.type
                    }
                });
            }
        }
    }

    try {
        if (realloc) {
            // Use more performant SQL for reallocation
            if (type === "demand") {
                return Promise.reject("Cannot reallocate demand");
            }
            let pk = "_pk"; // Lint tyranny
            // Look for existing inventory allocations to demand
            // For the item and site in question
            let sql = (
                "SELECT inv._pk, inv.quantity " +
                "FROM supply sup " +
                "  JOIN item si ON si._pk=sup._item_item_pk " +
                "  JOIN site ss ON ss._pk=sup._site_site_pk " +
                "  JOIN inventory inv " +
                "    ON (si._pk=inv._item_item_pk " +
                "    AND ss._pk=inv._site_site_pk) " +
                "WHERE sup.id=$1;"
            );
            let params = [theId];
            let tgtInv = await obj.client.query(sql, params);
            let invPk = tgtInv.rows[0][pk];
            let onHand = Number(tgtInv.rows[0].quantity);
            if (!invPk) {
                return Promise.reject("Inventory not found");
            }

            let tgtAlloc;
            let row;
            let iqty;
            // What was actually taken off the supply's allocations, and
            // what actually ended up allocated to inventory. These differ
            // when inventory is negative, and from the quantity asked for
            // when the supply had less allocated than that.
            let moved = 0;
            let newiallc = 0;
            let toDealloc = 0;

            sql = (
                "SELECT iallc._pk, iallc.id, iallc.quantity, " +
                "  iallc._demand_demand_pk, d.id AS demand_id " +
                "FROM allocation iallc " +
                "  JOIN demand d ON d._pk=_demand_demand_pk " +
                "WHERE _supply_supply_pk=$1 AND NOT iallc.is_deleted;"
            );
            params = [invPk];
            tgtAlloc = await obj.client.query(sql, params);

            while (qty && allc.length) {
                alc = allc.shift();
                alcQty = alc.quantity;

                switch (alc.demand.objectType) {
                case "SalesOrderLine":
                    solines.push(alc.demand.id);
                    break;
                case "SalesOrderRequirement":
                    soreqs.push(alc.demand.id);
                    break;
                case "WorkOrderRequirement":
                    woreqs.push(alc.demand.id);
                    break;
                }

                // First update old allocation
                if (qty < alcQty) {
                    bal = alcQty.minus(qty);
                    iqty = qty;
                    qty = 0;
                    sql = (
                        "UPDATE allocation SET " +
                        "  quantity = $1, " +
                        "  updated = now(), " +
                        "  updated_by = $2 " +
                        "WHERE id=$3;"
                    );
                    params = [
                        bal,
                        obj.client.currentUser(),
                        alc.id
                    ];
                } else {
                    iqty = alcQty;
                    qty = qty.minus(alcQty);
                    sql = "DELETE FROM allocation WHERE id=$1;";
                    params = [alc.id];
                }
                moved = moved.plus(iqty);

                await obj.client.query(sql, params);

                // Don't reallocate negative inventory
                if (onHand < 0) {
                    toDealloc = Math.min(Math.abs(onHand), iqty);
                    await createDeallocateHistory({
                        client: obj.client,
                        data: {
                            allocation: alc,
                            quantity: toDealloc,
                            reason: "negative",
                            type: obj.data.type
                        }
                    });
                    iqty = Math.max(iqty.plus(onHand), 0);
                    onHand = 0;
                    // Update original demand
                    sql = (
                        "UPDATE demand SET " +
                        "  allocated = allocated - $1, " +
                        "  updated = now(), " +
                        "  updated_by = $2 " +
                        "WHERE id = $3;"
                    );
                    params = [
                        toDealloc,
                        obj.client.currentUser(),
                        alc.demand.id
                    ];
                    await obj.client.query(sql, params);
                }

                // Counted after the negative inventory adjustment above,
                // which takes back part of what was moved. Counting before
                // it left inventory's allocated higher than its
                // allocations.
                newiallc = newiallc.plus(iqty);

                // Next, update or create inventory allocation
                if (iqty) {
                    row = tgtAlloc.rows.find(
                        (r) => r.demand_id === alc.demand.id
                    );
                    if (row) {
                        // Inventory allocation exsists, updated it
                        sql = (
                            "UPDATE allocation SET " +
                            "  quantity = quantity + $1, " +
                            "  updated = now(), " +
                            "  updated_by = $2 " +
                            "WHERE _pk=$3;"
                        );
                        params = [
                            iqty,
                            obj.client.currentUser(),
                            Number(row[pk])
                        ];
                    } else {
                        // No inventory allocation, so insert
                        sql = (
                            "INSERT INTO allocation " +
                            "(_pk, id, created, created_by, updated, " +
                            "  updated_by, is_deleted, lock, owner, " +
                            "  etag, _demand_demand_pk, " +
                            "  _supply_supply_pk, quantity, is_firm, " +
                            "  _sales_demand_demand_pk, " +
                            "  _sales_order_sales_order_pk " +
                            ") VALUES( " +
                            "  (SELECT nextval('object__pk_seq')), $1, " +
                            "  now(), " +
                            "   $2, now(), $2, false, null, $2, $1, " +
                            "  (SELECT _pk FROM demand WHERE id=$3), $4," +
                            "  $5, false, " +
                            "  COALESCE(" +
                            "    (SELECT _pk FROM sales_order_line " +
                            "     WHERE id=$6) " +
                            "    ,-1" +
                            "  )," +
                            "  COALESCE(" +
                            "    (SELECT _pk FROM sales_order WHERE id=$7), " +
                            "    -1" +
                            "  )" +
                            ");"
                        );
                        params = [
                            f.createId(),
                            obj.client.currentUser(),
                            alc.demand.id,
                            invPk,
                            iqty,
                            (
                                alc.salesDemand
                                ? alc.salesDemand.id
                                : null
                            ),
                            (
                                alc.salesOrder
                                ? alc.salesOrder.id
                                : null
                            )
                        ];
                    }
                    await obj.client.query(sql, params);
                }
            }

            // Since we're doing this direct (no triggers) update supplies too

            // Update original supply
            sql = (
                "UPDATE supply SET " +
                "  allocated = allocated - $1, " +
                "  updated = now(), " +
                "  updated_by = $2 " +
                "WHERE id = $3;"
            );
            // Only what was actually moved: the quantity asked for can be
            // more than the supply had allocated
            params = [
                moved,
                obj.client.currentUser(),
                theId
            ];
            await obj.client.query(sql, params);

            // Update inventory
            sql = (
                "UPDATE inventory SET " +
                "  allocated = allocated + $1, " +
                "  updated = now(), " +
                "  updated_by = $2 " +
                "WHERE _pk = $3;"
            );
            params = [
                newiallc,
                obj.client.currentUser(),
                invPk
            ];
            await obj.client.query(sql, params);
        } else {
            await deallocate(target, Boolean(obj.data.adjustId));

            if (qty && type === "demand" && invQty) {
                qty = invQty;

                // In case we have to "steal" allocations from somewhere else
                if (!itemId) {
                    resp = await f.datasource.request({
                        client: obj.client,
                        id: theId,
                        method: "GET",
                        name: "Demand",
                        properties: ["item", "site"]
                    }, true);
                    itemId = resp.item.id;
                    siteId = resp.site.id;
                }

                resp = await f.datasource.request({
                    client: obj.client,
                    filter: {criteria: [{
                        property: "supply.item.id",
                        value: itemId
                    }, {
                        property: "supply.site.id",
                        value: siteId
                    }, {
                        property: "supply.objectType",
                        value: "Inventory"
                    }]},
                    isForUpdate: true,
                    method: "GET",
                    name: "Allocation",
                    properties: ["id", "demand", "quantity"]
                }, true);
                target = "demand";
                allc = resp.sort(byTypeDate);

                await deallocate("demand", true);
            }
        }

        // Finally update update plan status for any affected demands
        if (updPlanStatus) {
            if (woreqs.length) {
                await f.datasource.request({
                    client: obj.client,
                    data: {outsideProcessIds: woosps, requirementIds: woreqs},
                    method: "POST",
                    name: "doUpdateWorkOrderPlanStatus"
                }, true);
            }
            if (solines.length || soreqs.length) {
                await f.datasource.request({
                    client: obj.client,
                    data: {lineIds: solines, requirementIds: soreqs},
                    method: "POST",
                    name: "doUpdateSalesOrderPlanStatus"
                }, true);
            }
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doTransactAllocated",
    transact
);