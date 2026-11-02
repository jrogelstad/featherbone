/*jslint unordered devel*/
/*global*/

function backward(a, b) {
    return b.sequence - a.sequence;
}

let sql1;
let sql2;
let sql3;
const sql3clause = " ORDER BY _product_product_pk, po.sequence;";
let sql4;
let sql5;
const wip = {};
const PPK = "_product_product_pk"; // lint tyranny
const PK = "_pk";

async function doRollUpCosts(obj) {
    if (wip[obj.client.tenant().pgDatabase]) {
        throw "Cost rollup already in process";
    }

    let mtl = 0;
    let lbr = 0;
    let svc = 0;
    let ovh = 0;
    let ttl = 0;
    let cur;
    let theId;
    let found;
    let router;
    let inQty;
    let hrs;
    let batches;
    let item;
    let err;
    let is;
    let iss;
    let ops;

    function applyMatlCost(row, cstItem) {
        let mcst;
        let lcst;
        let scst;
        let ocst;
        let op = (
            row.operation
            ? item.operations.find((o) => o.sequence === row.operation)
            : false
        );
        let inputQty = (
            op
            ? op.inputQty
            : item.eoq
        );
        let qty = row.quantityPer.times(
            inputQty
        ).plus(
            row.fixedQuantity
        ).times(
            row.ratio
        );

        if (!cstItem.isFractional) {
            qty = Math.ceil(qty);
        }

        mcst = qty.times(
            cstItem.materialCost.amount
        ).div(item.eoq);
        lcst = qty.times(
            cstItem.laborCost.amount
        ).div(item.eoq);
        scst = qty.times(
            cstItem.serviceCost.amount
        ).div(item.eoq);
        ocst = qty.times(
            cstItem.overheadCost.amount
        ).div(item.eoq);

        mtl = mtl.plus(mcst);
        lbr = lbr.plus(lcst);
        svc = svc.plus(scst);
        ovh = ovh.plus(ocst);
    }

    function haveInactive(item) {
        let it = item.billOfMaterialItems.find(
            (r) => r.item.status === "I"
        );
        if (it) {
            err = {parent: item, input: it.item};
            return true;
        }
        return false;
    }

    function buildRouting(pk) {
        let prdOps = ops.filter((o) => o[PPK] === pk);
        let op;
        let ret = [];

        while (prdOps.length) {
            op = prdOps.shift();
            ret.push({
                batchSize: Number(op.batch_size),
                id: op.id,
                laborCapacity: Number(op.labor_capacity),
                laborResource: (
                    Number(op.lbr_cost)
                    ? {laborCost: {amount: Number(op.lbr_cost)}}
                    : null
                ),
                machineCapacity: Number(op.machine_capacity),
                machineResource: (
                    Number(op.ovh_cost)
                    ? {overheadCost: {amount: Number(op.ovh_cost)}}
                    : null
                ),
                runRate: Number(op.run_rate),
                runUnit: op.run_unit,
                service: (
                    Number(op.svc_cost)
                    ? {serviceCost: {amount: Number(op.svc_cost)}}
                    : 0
                ),
                sequence: Number(op.sequence),
                setupTime: Number(op.setup_time),
                yield: Number(op.yield)
            });
        }
        return ret;
    }

    try {
        // Don't let others start this process
        wip[obj.client.tenant().pgDatabase] = true;

        let subscr = obj.data.subscription;
        let process;

        //console.log("Start process, query BOMs");
        let itemId = obj.data.itemId;
        let proposed = await f.datasource.request({
            method: "GET",
            name: "ProposedCost",
            client: obj.client,
            filter: {criteria: [{
                property: "status",
                operator: "!=",
                value: "U"
            }, {
                property: "item.status",
                value: "A"
            }]}
        }, true);
        let items = [];
        let requests = [];
        let cnt = 0;

        // Build product list faster outside of fb crud system
        let bom;
        let resp;

        if (itemId) {
            resp = await obj.client.query(sql2, [itemId]);
            bom = resp.rows.slice();
            if (bom.length) {
                let idClause = "$1";
                let res = await obj.client.query(
                    "SELECT _pk FROM item WHERE id = $1",
                    [itemId]
                );
                let ids = [Number(res.rows[0][PK])];

                bom.forEach(function (r) {
                    let prdPk = Number(r.prod_pk);
                    let itmPk = (
                        r.bom_prod_pk
                        ? Number(r.bom_prod_pk)
                        : false
                    );
                    if (ids.indexOf(prdPk) === -1) {
                        ids.push(prdPk);
                    }
                    if (
                        itmPk &&
                        r.bom_source === "M" &&
                        ids.indexOf(itmPk) === -1
                    ) {
                        ids.push(itmPk);
                    }
                });
                idClause = ids.map(function () {
                    cnt += 1;
                    return "$" + cnt;
                });
                let opSql = (
                    sql3 + " AND _product_product_pk IN (" + idClause + ") " +
                    sql3clause
                );
                ops = await obj.client.query(opSql, ids);
                ops = ops.rows;
            } else {
                // If we got here, must be no BOM, grab directly
                item = await f.datasource.request({
                    client: obj.client,
                    id: itemId,
                    method: "GET",
                    name: "Product"
                });
                if (item) {
                    if (item.status === "I") {
                        return Promise.reject(
                            "Cannot roll cost on inactive items"
                        );
                    }
                    if (item.type === "E") {
                        return Promise.reject(
                            "Cannot roll cost on expense items"
                        );
                    }
                    items.push(item);
                } else {
                    return Promise.reject("Item not found");
                }
            }
        } else {
            resp = await obj.client.query(sql1);
            bom = resp.rows.slice();
            // Let postgres do heavy lifting to figure out levels
            let levels = await obj.client.query(sql5);
            levels = levels.rows;
            bom.forEach(function (row) {
                let lvl = levels.find((l) => l.prod_number === row.prod_number);
                if (lvl) {
                    row.level = Number(lvl.max_level);
                } else {
                    row.level = 0;
                }
            });
            ops = await obj.client.query(
                sql3 + sql3clause
            );
            ops = ops.rows;
            // Stay inside the request's transaction: a COMMIT here
            // would end it early and leave the rest in autocommit.
            await obj.client.query(
                "DELETE FROM \"$subscription\" " +
                "WHERE objectid = 'proposed_cost';"
            );
        }
        let lastPk;
        let row;
        let product;

        //console.log("Gathered BOMs, organizing products...");
        //await process.next();
        while (bom.length) {
            row = bom.shift();
            if (Number(row.prod_pk) !== lastPk) {
                if (
                    product &&
                    !items.find((i) => i.id === product.id)
                ) {
                    items.push(product);
                }
                product = {
                    billOfMaterialItems: [],
                    cost: {
                        amount: Number(row.prod_cost),
                        currency: row.prod_curr
                    },
                    eoq: Number(row.prod_eoq),
                    id: row.prod_id,
                    isFractional: Boolean(row.prod_is_fractional),
                    laborCost: {amount: Number(row.prod_lbr_cst)},
                    materialCost: {amount: Number(row.prod_mtl_cst)},
                    number: row.prod_number,
                    operations: [],
                    overheadCost: {amount: Number(row.prod_ovh_cst)},
                    status: row.prod_status,
                    serviceCost: {amount: Number(row.prod_svc_cst)},
                    level: row.level
                };
                product.operations = buildRouting(row.prod_pk);
            }
            if (row.bom_id) {
                product.billOfMaterialItems.push({
                    fixedQuantity: Number(row.bom_fixed_qty),
                    id: row.bom_id,
                    item: {
                        id: row.bom_prod_id,
                        isFractional: Boolean(row.bom_is_fractional),
                        number: row.bom_number,
                        source: row.bom_source,
                        status: row.bom_status,
                        laborCost: {amount: Number(row.bom_lbr_cst)},
                        materialCost: {amount: Number(row.bom_mtl_cst)},
                        overheadCost: {amount: Number(row.bom_ovh_cst)},
                        serviceCost: {amount: Number(row.bom_svc_cst)},
                        type: row.bom_type
                    },
                    operation: Number(row.bom_op),
                    quantityPer: Number(row.bom_qty_per),
                    ratio: Number(row.bom_ratio),
                    sequence: Number(row.bom_seq)
                });

                // Check if product without bom
                if (
                    row.bom_source === "M" &&
                    !resp.rows.find((b) => b.prod_id === row.bom_prod_id)
                ) {
                    items.push({
                        billOfMaterialItems: [],
                        cost: {
                            amount: Number(row.bom_cost),
                            currency: row.prod_curr
                        },
                        eoq: Number(row.bom_eoq),
                        id: row.bom_prod_id,
                        isFractional: Boolean(row.bom_is_fractional),
                        laborCost: {amount: Number(row.bom_lbr_cst)},
                        materialCost: {amount: Number(row.bom_mtl_cst)},
                        number: row.bom_number,
                        operations: buildRouting(row.bom_prod_pk),
                        overheadCost: {amount: Number(row.bom_ovh_cst)},
                        status: row.bom_status,
                        serviceCost: {amount: Number(row.bom_svc_cst)},
                        level: row.level + 1
                    });
                }
            }
            lastPk = Number(row.prod_pk);
        }
        if (
            product &&
            !items.find((i) => i.id === product.id)
        ) {
            items.push(product);
        }
        //console.log("Processed Products, checking inactive");

        process = f.datasource.createProcess({
            client: obj.client,
            count: items.length,
            name: "Rolling costs",
            subscription: subscr
        });
        await process.start();

        // Validate
        if (proposed.some((pc) => pc.status === "A")) {
            return Promise.reject(
                "There are approved proposed costs for manufactured items"
            );
        }

        if (items.some(haveInactive)) {
            return Promise.reject(
                "Product " + err.parent.number +
                " has an inactive product " + err.input.number +
                " on its bill of materials"
            );
        }

        // Sort descending by level;
        items.sort((a, b) => b.level - a.level);

        //console.log("Dependencies sorted, processing costs");
        await process.next();

        cnt = 0;
        while (cnt < items.length) {
            item = items[cnt];
            cnt += 1;
            //console.log("Process->", item.number);
            mtl = 0;
            lbr = 0;
            svc = 0;
            ovh = 0;
            ttl = 0;
            cur = item.cost.currency;
            theId = undefined;
            found = proposed.find((p) => p.item.id === item.id);
            router = item.operations;
            inQty = item.eoq;
            hrs = undefined;
            batches = undefined;

            if (found) {
                theId = found.id;
            }

            // Calculate labor, overhead, service
            // Reverse sort to calc yield impact
            router.sort(backward).forEach(function (op) {
                let yld = op.yield.times(0.01);

                inQty = inQty.div(yld);

                if (
                    !item.isFractional &&
                    Math.round(inQty) !== inQty
                ) {
                    inQty = Math.ceil(inQty);
                }
                op.inputQty = inQty;

                switch (op.runUnit) {
                case "HU":
                    hrs = inQty.times(op.runRate);
                    break;
                case "MU":
                    hrs = inQty.times(
                        op.runRate
                    ).div(60);
                    break;
                case "UH":
                    hrs = inQty.div(
                        op.runRate
                    );
                    break;
                case "UM":
                    hrs = inQty.times(
                        op.runRate
                    ).div(3600);
                    break;
                case "HB":
                    batches = Math.ceil(
                        inQty.div(op.batchSize)
                    );
                    hrs = batches.times(
                        op.runRate
                    );
                    break;
                }
                op.runTime = hrs;

                // Calc Total shop hours and cost
                hrs = hrs.plus(op.setupTime);
                if (op.machineResource) {
                    ovh = op.machineResource.overheadCost.amount.times(
                        hrs
                    ).times(
                        op.machineCapacity
                    ).div(
                        item.eoq
                    ).plus(
                        ovh
                    );
                }
                if (op.laborResource) {
                    lbr = op.laborResource.laborCost.amount.times(
                        hrs
                    ).times(
                        op.laborCapacity
                    ).div(
                        item.eoq
                    ).plus(
                        lbr
                    );
                }
                if (op.service) {
                    svc = op.service.serviceCost.amount;
                }
            });

            // Total material for purchased items
            item.billOfMaterialItems.filter(
                (row) => (row.item.source === "P")
            ).forEach(function (row) {
                applyMatlCost(row, row.item);
            });

            // Total material for manufactured items
            item.billOfMaterialItems.filter(
                (row) => (row.item.source === "M")
            ).forEach(function (row) {
                let mkitm = items.find((mi) => mi.id === row.item.id);

                applyMatlCost(row, mkitm);
            });

            ttl = mtl.plus(lbr).plus(svc).plus(ovh);

            // Create insert/update
            if (
                mtl !== item.materialCost.amount ||
                lbr !== item.laborCost.amount ||
                svc !== item.serviceCost.amount ||
                ovh !== item.overheadCost.amount ||
                ttl !== item.cost.amount ||
                (
                    found &&
                    (
                        mtl !== found.materialCost.amount ||
                        lbr !== found.laborCost.amount ||
                        svc !== found.serviceCost.amount ||
                        ovh !== found.overheadCost.amount ||
                        ttl !== found.totalCost.amount
                    )
                )
            ) {
                if (
                    found &&
                    item.materialCost.amount === mtl &&
                    item.laborCost.amount === lbr &&
                    item.serviceCost.amount === svc &&
                    item.overheadCost.amount === ovh &&
                    item.cost.amount === ttl
                ) {
                    requests.push({
                        method: "DELETE",
                        name: "ProposedCost",
                        client: obj.client,
                        id: theId
                    });
                } else {
                    if (obj.data.autoUpdate) {
                        await obj.client.query(sql4, [
                            mtl,
                            ovh,
                            lbr,
                            svc,
                            ttl,
                            obj.client.currentUser(),
                            item.id
                        ]);
                        iss = await obj.client.query(
                            "SELECT i.id AS item_id, " +
                            "  i.number AS item_number, " +
                            "  s.id AS site_id " +
                            "FROM inventory inv, item i, site s " +
                            "WHERE i._pk=inv._item_item_pk " +
                            "  AND s._pk=inv._site_site_pk " +
                            "  AND inv.quantity > 0 " +
                            "  AND i.id=$1; ",
                            [item.id]
                        );

                        while (iss.rows.length) {
                            is = iss.rows.shift();
                            await f.datasource.request({
                                method: "POST",
                                name: "InventoryTransaction",
                                client: obj.client,
                                user: obj.client.currentUser(),
                                data: {
                                    date: f.today(),
                                    item: {id: is.item_id},
                                    site: {id: is.site_id},
                                    quantity: 0,
                                    type: "Standard Cost Update",
                                    document: is.item_number,
                                    reference: is.item_number
                                }
                            }, true);
                        }
                    } else {
                        requests.push(f.datasource.request({
                            method: "POST",
                            name: "ProposedCost",
                            id: theId,
                            data: {
                                item: {id: item.id},
                                status: "P",
                                materialCost: {
                                    currency: cur,
                                    amount: mtl
                                },
                                laborCost: {
                                    currency: cur,
                                    amount: lbr
                                },
                                serviceCost: {
                                    currency: cur,
                                    amount: svc
                                },
                                overheadCost: {
                                    currency: cur,
                                    amount: ovh
                                },
                                totalCost: {
                                    currency: cur,
                                    amount: ttl
                                }
                            },
                            tenant: obj.client.tenant(),
                            user: obj.client.currentUser()
                        }, true));
                    }
                }
            } else if (
                found &&
                item.materialCost.amount === found.materialCost.amount &&
                item.laborCost.amount === found.laborCost.amount &&
                item.serviceCost.amount === found.serviceCost.amount &&
                item.overheadCost.amount === found.overheadCost.amount &&
                item.cost.amount === found.totalCost.amount
            ) {
                requests.push(f.datasource.request({
                    method: "DELETE",
                    name: "ProposedCost",
                    id: theId,
                    tenant: obj.client.tenant(),
                    user: obj.client.currentUser()
                }, true));
            }
            requests.push(process.next());
            await Promise.all(requests);

            // Update local record for later use
            item.materialCost.amount = mtl;
            item.laborCost.amount = lbr;
            item.serviceCost.amount = svc;
            item.overheadCost.amount = ovh;
            item.cost.amount = ttl;

            requests = [];
        }

        await process.complete();
    } catch (e) {
        let msg = (
            typeof e === "object"
            ? e.message
            : e
        );
        return Promise.reject(msg);
    } finally {
        wip[obj.client.tenant().pgDatabase] = false;
    }
}

f.datasource.registerFunction(
    "POST",
    "doRollUpCosts",
    doRollUpCosts
);

sql1 = (
    "SELECT " +
    "  p._pk AS prod_pk," +
    "  p.id AS prod_id, " +
    "  p.number AS prod_number, " +
    "  p.status AS prod_status," +
    "  p.is_fractional AS prod_is_fractional," +
    "  (p.material_cost).amount AS prod_mtl_cst," +
    "  (p.labor_cost).amount AS prod_lbr_cst," +
    "  (p.service_cost).amount AS prod_svc_cst, " +
    "  (p.overhead_cost).amount AS prod_ovh_cst," +
    "  (p.cost).amount AS prod_cost," +
    "  (p.cost).currency AS prod_curr, " +
    "  p.eoq AS prod_eoq," +
    "  bom.sequence AS bom_seq," +
    "  bom.id AS bom_id, " +
    "  bom.operation AS bom_op," +
    "  bom.fixed_quantity AS bom_fixed_qty," +
    "  bom.quantity_per AS bom_qty_per," +
    "  bom.ratio AS bom_ratio," +
    "  bom.product_id AS bom_prod_id, " +
    "  bom.number AS bom_number," +
    "  bom.status AS bom_status," +
    "  bom.is_fractional AS bom_is_fractional," +
    "  (bom.material_cost).amount AS bom_mtl_cst," +
    "  (bom.labor_cost).amount AS bom_lbr_cst," +
    "  (bom.service_cost).amount AS bom_svc_cst," +
    "  (bom.overhead_cost).amount AS bom_ovh_cst, " +
    "  bom.source AS bom_source, " +
    "  bom.type AS bom_type " +
    "FROM product p " +
    "LEFT JOIN ( " +
    "SELECT " +
    "  pbi._product_product_pk, " +
    "  pbi.id, " +
    "  pbi.sequence, " +
    "  pbi.operation, " +
    "  pbi.fixed_quantity, " +
    "  pbi.quantity_per, " +
    "  pbi.ratio, " +
    "  pi.id AS product_id, " +
    "  pi.number, " +
    "  pi.status, " +
    "  pi.is_fractional, " +
    "  pi.material_cost, " +
    "  pi.labor_cost, " +
    "  pi.service_cost, " +
    "  pi.overhead_cost, " +
    "  pi.source, " +
    "  pi.type " +
    "FROM " +
    "  product_bill_of_material_item pbi, " +
    "  product pi " +
    "WHERE NOT pbi.is_deleted " +
    "  AND NOT pi.is_deleted " +
    "  AND pbi._item_item_pk = pi._pk " +
    "  AND (pi.source = 'M' OR (pi.cost).amount > 0) " +
    ") bom ON  " +
    " p._pk=bom._product_product_pk " +
    "WHERE NOT p.is_deleted " +
    "  AND (p.source = 'M' OR p.type ='K') " +
    "  AND p.status != 'I' " +
    "ORDER BY p._pk, bom.sequence; "
);

sql2 = (
    "SELECT " +
    "  prod_pk," +
    "  prod_id, " +
    "  prod_number, " +
    "  prod_status," +
    "  prod_is_fractional," +
    "  prod_mtl_cst," +
    "  prod_lbr_cst," +
    "  prod_svc_cst, " +
    "  prod_ovh_cst," +
    "  prod_cost," +
    "  prod_curr, " +
    "  prod_eoq," +
    "  pk AS bom_pk, " +
    "  bom_sequence AS bom_seq," +
    "  bom_id AS bom_id, " +
    "  bom_operation AS bom_op," +
    "  bom_fixed_quantity AS bom_fixed_qty," +
    "  bom_quantity_per AS bom_qty_per," +
    "  bom_ratio AS bom_ratio," +
    "  child_pk AS bom_prod_pk, " +
    "  item_id AS bom_prod_id, " +
    "  item_number AS bom_number," +
    "  item_status AS bom_status," +
    "  item_is_fractional AS bom_is_fractional," +
    "  item_material_cost AS bom_mtl_cst," +
    "  item_labor_cost AS bom_lbr_cst," +
    "  item_service_cost AS bom_svc_cst," +
    "  item_overhead_cost AS bom_ovh_cst, " +
    "  item_cost AS bom_cost, " +
    "  item_source AS bom_source, " +
    "  item_type AS bom_type, " +
    "  item_eoq AS bom_eoq, " +
    "  level " +
    "FROM (" +
    "WITH RECURSIVE bom( " +
    "  prod_pk," +
    "  prod_id, " +
    "  prod_number, " +
    "  prod_status," +
    "  prod_is_fractional," +
    "  prod_mtl_cst," +
    "  prod_lbr_cst," +
    "  prod_svc_cst, " +
    "  prod_ovh_cst," +
    "  prod_cost," +
    "  prod_curr, " +
    "  prod_eoq," +
    "  pk," +
    "  parent_pk, " +
    "  child_pk, " +
    "  level, " +
    "  bom_fixed_quantity, " +
    "  bom_id," +
    "  bom_quantity_per, " +
    "  bom_ratio, " +
    "  bom_sequence, " +
    "  bom_operation, " +
    "  item_id, " +
    "  item_cost_currency, " +
    "  item_labor_cost, " +
    "  item_material_cost, " +
    "  item_number, " +
    "  item_overhead_cost, " +
    "  item_service_cost, " +
    "  item_cost, " +
    "  item_type, " +
    "  item_status, " +
    "  item_source, " +
    "  item_is_fractional, " +
    "  item_eoq, " +
    "  path, " +
    "  cycle " +
    ") AS ( " +
    "SELECT  " +
    "  product._pk," +
    "  product.id, " +
    "  product.number, " +
    "  product.status," +
    "  product.is_fractional," +
    "  (product.material_cost).amount," +
    "  (product.labor_cost).amount," +
    "  (product.service_cost).amount, " +
    "  (product.overhead_cost).amount," +
    "  (product.cost).amount," +
    "  (product.cost).currency, " +
    "  product.eoq," +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "1, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "bi.operation, " +
    "item.id, " +
    "(item.cost).currency, " +
    "(item.labor_cost).amount, " +
    "(item.material_cost).amount, " +
    "item.number, " +
    "(item.overhead_cost).amount, " +
    "(item.service_cost).amount, " +
    "(item.cost).amount, " +
    "item.type, " +
    "item.status, " +
    "item.source, " +
    "item.is_fractional, " +
    "item.eoq, " +
    "ARRAY[bi._pk], " +
    "false " +
    "FROM product_bill_of_material_item bi, item_unit u, product, item " +
    "WHERE item._pk = bi._item_item_pk " +
    "    AND product._pk = bi._product_product_pk " +
    "    AND bi._unit_item_unit_pk = u._pk " +
    "    AND NOT bi.is_deleted " +
    "    AND product.id = $1 " +
    "UNION " +
    "SELECT  " +
    "  product._pk," +
    "  product.id, " +
    "  product.number, " +
    "  product.status," +
    "  product.is_fractional," +
    "  (product.material_cost).amount," +
    "  (product.labor_cost).amount," +
    "  (product.service_cost).amount, " +
    "  (product.overhead_cost).amount," +
    "  (product.cost).amount," +
    "  (product.cost).currency, " +
    "  product.eoq," +
    "bi._pk, " +
    "bi._product_product_pk, " +
    "item._pk, " +
    "bom.level + 1, " +
    "bi.fixed_quantity, " +
    "bi.id, " +
    "bi.quantity_per, " +
    "bi.ratio, " +
    "bi.sequence, " +
    "bi.operation, " +
    "item.id, " +
    "(item.cost).currency, " +
    "(item.labor_cost).amount, " +
    "(item.material_cost).amount, " +
    "item.number, " +
    "(item.overhead_cost).amount, " +
    "(item.service_cost).amount, " +
    "(item.cost).amount, " +
    "item.type, " +
    "item.status, " +
    "item.source, " +
    "item.is_fractional, " +
    "item.eoq, " +
    "bom.path || bi._pk, " +
    "bi._pk = ANY(bom.path) " +
    "FROM bom, product_bill_of_material_item bi, item_unit u, item, " +
    "product " +
    "WHERE item._pk = bi._item_item_pk " +
    "    AND product._pk = bi._product_product_pk " +
    "  AND bi._unit_item_unit_pk = u._pk " +
    "  AND bi._product_product_pk = bom.child_pk " +
    "  AND NOT bi.is_deleted " +
    "  AND NOT cycle " +
    ") SELECT * FROM bom " +
    ") AS data " +
    "ORDER BY prod_pk, bom_sequence;"
);
sql3 = (
    "SELECT _product_product_pk, po.id, " +
    "  run_rate, run_unit, yield, setup_time, " +
    "  machine_capacity, labor_capacity,batch_size, sequence," +
    "  COALESCE((mr.overhead_cost).amount,0) AS ovh_cost, " +
    "  COALESCE((lr.labor_cost).amount,0) AS lbr_cost, " +
    "  COALESCE((svc.service_cost).amount,0) AS svc_cost " +
    "FROM product p, product_operation po " +
    "  LEFT JOIN machine_resource mr ON " +
    "    mr._pk=_machine_resource_machine_resource_pk " +
    "    AND NOT mr.is_deleted " +
    "  LEFT JOIN labor_resource lr  ON " +
    "    lr._pk=_labor_resource_labor_resource_pk " +
    "    AND NOT lr.is_deleted " +
    "  LEFT JOIN service svc  ON " +
    "    svc._pk=_service_service_pk " +
    "    AND NOT svc.is_deleted " +
    "WHERE NOT po.is_deleted " +
    "  AND NOT p.is_deleted " +
    "  AND po._product_product_pk=p._pk " +
    "  AND p.source = 'M' " +
    "  AND p.type != 'E' " +
    "  AND p.status != 'I' "
);

sql4 = (
    "UPDATE product SET " +
    "  material_cost.amount = $1, " +
    "  overhead_cost.amount = $2, " +
    "  labor_cost.amount = $3, " +
    "  service_cost.amount = $4, " +
    "  cost.amount = $5, " +
    "  updated = now(), " +
    "  updated_by = $6 " +
    "WHERE id = $7"
);
// Query for all levels
sql5 = (
    "SELECT " +
    " prod_number, " +
    " max(level) AS max_level " +
    "FROM ( " +
    "WITH RECURSIVE bom( " +
    "  prod_pk, " +
    "  prod_number,  " +
    "  pk, " +
    "  parent_pk,  " +
    "  child_pk,  " +
    "  level,  " +
    "  path,  " +
    "  cycle  " +
    ") AS (  " +
    "SELECT   " +
    " product._pk,   " +
    " product.number,  " +
    " bi._pk,  " +
    " bi._product_product_pk,  " +
    " item._pk,  " +
    " 1,   " +
    " ARRAY[bi._pk],  " +
    " false  " +
    " FROM product_bill_of_material_item bi, product, item  " +
    " WHERE item._pk = bi._item_item_pk  " +
    "    AND product._pk = bi._product_product_pk  " +
    "    AND NOT bi.is_deleted  " +
    "    AND NOT product.is_deleted " +
    "UNION  " +
    "SELECT   " +
    "  product._pk, " +
    "  product.number, " +
    "  bi._pk, " +
    "  bi._product_product_pk, " +
    "  item._pk, " +
    "  bom.level + 1,  " +
    "  bom.path || bi._pk,  " +
    "  bi._pk = ANY(bom.path)  " +
    "FROM bom, product_bill_of_material_item bi, item,  " +
    " product  " +
    "WHERE item._pk = bi._item_item_pk " +
    " AND product._pk = bi._product_product_pk " +
    " AND bi._product_product_pk = bom.child_pk " +
    "  AND NOT bi.is_deleted " +
    "  AND NOT cycle " +
    ") SELECT * FROM bom " +
    ") AS data " +
    "GROUP BY prod_number "
);
