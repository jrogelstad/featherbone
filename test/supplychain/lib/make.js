/*
    SupplyChain regression tests: design (bill of material, costing) and
    manufacturing (work order) helpers.

    Builders shaped like the payloads the SupplyChain client sends
    (design/module.js, make/module.js), readers for inventory and
    inventory transactions, and poll helpers for work Featherbone does
    after commit: work orders auto-explode, plan supply, and issues,
    operation completions, receipts and adjustments auto-post in onCommit
    callbacks that run after the HTTP response.
*/
/*jslint node*/
"use strict";

const fx = require("../../harness/fixtures");
const db = require("../../harness/db");

const {money, ref, today, uniq} = fx;

const COST_FIELDS = [
    "estimatedLaborCost",
    "estimatedMaterialCost",
    "estimatedServiceCost",
    "estimatedOverheadCost",
    "estimatedTotalCost",
    "actualLaborCost",
    "actualMaterialCost",
    "actualServiceCost",
    "actualOverheadCost",
    "actualTotalCost"
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call fn until it returns a truthy value or the timeout passes. Returns
// the last value (falsy on timeout) so the caller's assertion reports it.
async function poll(fn, opts) {
    let timeout = (opts && opts.timeout) || 15000;
    let interval = (opts && opts.interval) || 200;
    let started = Date.now();
    let ret = await fn();

    while (!ret && Date.now() - started < timeout) {
        await sleep(interval);
        ret = await fn();
    }
    return ret;
}

// Wait until the server has no open work on the test database (no other
// backend running a query or sitting in a transaction), seen on several
// consecutive checks. Background onCommit work (plan supply after an
// explode, auto-posting) runs in its own transactions, so this is the
// generic "server is done" signal.
async function quiesce(opts) {
    let quietChecks = (opts && opts.checks) || 4;
    let timeout = (opts && opts.timeout) || 20000;
    let started = Date.now();
    let quiet = 0;
    let resp;

    while (quiet < quietChecks && Date.now() - started < timeout) {
        resp = await db.query(
            "SELECT count(*)::int AS busy FROM pg_stat_activity " +
            "WHERE datname = current_database() " +
            "  AND pid <> pg_backend_pid() " +
            "  AND state IN ('active', 'idle in transaction', " +
            "    'idle in transaction (aborted)');"
        );
        if (resp.rows[0].busy) {
            quiet = 0;
        } else {
            quiet += 1;
        }
        await sleep(75);
    }
    return quiet >= quietChecks;
}

function num(v) {
    return Number(v);
}

// Round money-ish numbers for comparisons (JS float noise)
function r2(v) {
    return Math.round(Number(v) * 100) / 100;
}

function zeroCosts(currency) {
    let ret = {};
    COST_FIELDS.forEach(function (k) {
        ret[k] = money(0, currency);
    });
    return ret;
}

// Ensure an item unit by code
function unit(session, code, description) {
    return fx.unit(session, code, description);
}

// Employee linked to the signed-in user (operation completions need one)
async function employee(session, userName) {
    let found = await session.findBy("Employees", "userAccount", userName);
    if (found.length) {
        return found[0];
    }
    return session.create("Employee", {
        number: uniq("EMP"),
        firstName: "Regression",
        lastName: "Tester",
        userAccount: userName,
        isActive: true
    });
}

// Product builder: exposes unit per BOM line and item conversions so the
// demo's floz-of-a-gallon varathane line can be modeled.
// components: [{item, quantityPer, fixedQuantity, unit, ratio, operation}]
// operations: [{description, setupTime, runRate, waitTime, labor,
//   machine, yield}]
async function product(session, w, opts) {
    let isMake = opts.source === "M";
    let cost = opts.cost || 0;
    let data = {
        number: uniq(opts.prefix || "ITEM"),
        description: opts.description || "Regression product",
        unit: ref(opts.unit || w.unit),
        site: ref(w.site),
        trace: "N",
        isFractional: Boolean(opts.isFractional),
        type: opts.type || "I",
        source: opts.source || "P",
        status: "A",
        isSold: Boolean(opts.isSold),
        eoq: opts.eoq || 1,
        price: money(opts.price || 0),
        materialCost: money(
            isMake
            ? 0
            : cost
        ),
        laborCost: money(0),
        overheadCost: money(0),
        serviceCost: money(opts.serviceCost || 0),
        sites: [fx.itemSite(w.site, Object.assign({
            planningPolicy: (
                isMake
                ? "M"
                : "L"
            )
        }, opts.itemSite))],
        conversions: (opts.conversions || []).map(function (c) {
            return {
                fromUnit: ref(c.fromUnit),
                toUnit: ref(c.toUnit),
                ratio: c.ratio
            };
        }),
        documents: [],
        suppliers: [],
        billOfMaterialItems: (opts.components || []).map(function (c, i) {
            return {
                sequence: i + 1,
                item: ref(c.item),
                quantityPer: c.quantityPer,
                fixedQuantity: c.fixedQuantity || 0,
                unit: ref(c.unit || w.unit),
                ratio: (
                    c.ratio === undefined
                    ? 1
                    : c.ratio
                ),
                operation: c.operation || 0
            };
        }),
        operations: (opts.operations || []).map(function (o, i) {
            let op = {
                sequence: i + 1,
                description: o.description || "Operation " + (i + 1),
                setupTime: o.setupTime || 0,
                runRate: o.runRate || 0,
                runUnit: o.runUnit || "HU",
                queueTime: 0,
                waitTime: o.waitTime || 0,
                moveTime: 0,
                yield: o.yield || 100,
                batchSize: 1,
                machineCapacity: 1,
                laborCapacity: 1,
                transferBatchPolicy: "C",
                isSubcontract: false
            };
            if (o.labor) {
                op.laborResource = ref(o.labor);
            }
            if (o.machine) {
                op.machineResource = ref(o.machine);
            }
            return op;
        })
    };

    return session.create("Product", data);
}

// BOM line ratio exactly as the client computes it (design/module.js
// mixinItemConversion "unit" handler): 1 when the BOM unit is the stock
// unit, else from the conversion that mentions the BOM unit.
function bomRatio(itemUnitId, bomUnitId, conversions) {
    let one = 1;
    let conv;

    if (itemUnitId === bomUnitId) {
        return 1;
    }
    conv = conversions.find(
        (c) => c.fromUnit.id === bomUnitId || c.toUnit.id === bomUnitId
    );
    if (!conv) {
        return 0;
    }
    if (conv.fromUnit.id === bomUnitId) {
        return one / conv.ratio;
    }
    return conv.ratio;
}

// The demo's 2-CABIN-CABINET-ASSY exactly: the finish (varathane) is
// stocked in gallons at $55 and consumed at 12 floz, with an item
// conversion floz -> gal of 128, so the BOM ratio is 1/128 = 0.0078125.
// Components use `issueMethods` ({plywood: "M"}) when a test needs manual
// issue.
async function demoCabinet(session, w, opts) {
    opts = opts || {};
    let gal = await unit(session, "gal", "Gallon");
    let floz = await unit(session, "floz", "Fluid ounce");
    let im = opts.issueMethods || {};

    function is(name) {
        return {issueMethod: im[name] || "B"};
    }

    let plywood = await product(session, w, {
        prefix: "PLYWOOD", cost: 120, isFractional: true,
        description: "Birch plywood 3/8, 4x8 sheet", itemSite: is("plywood")
    });
    let hinge = await product(session, w, {
        prefix: "HINGE", cost: 3.2, description: "Cabinet hinge",
        itemSite: is("hinge")
    });
    let knob = await product(session, w, {
        prefix: "KNOB", cost: 1.4, description: "Cabinet knob",
        itemSite: is("knob")
    });
    let screw = await product(session, w, {
        prefix: "SCREW", cost: 0.02, description: "Screw #10",
        itemSite: is("screw")
    });
    let varathane = await product(session, w, {
        prefix: "VARATHANE", cost: 55, unit: gal,
        description: "Clear varathane, gallon", itemSite: is("varathane"),
        conversions: [{fromUnit: floz, toUnit: gal, ratio: 128}]
    });
    let ratio = bomRatio(gal.id, floz.id, varathane.conversions);
    let assy = await product(session, w, {
        source: "M",
        prefix: "CABINET",
        description: "Cabin cabinet assembly",
        isSold: opts.isSold,
        components: [
            {item: plywood, quantityPer: 0.25},
            {item: hinge, quantityPer: 8},
            {item: knob, quantityPer: 4},
            {item: screw, quantityPer: 20},
            {item: varathane, quantityPer: 12, unit: floz, ratio}
        ],
        operations: [
            {
                description: "Cut", setupTime: 0.25, runRate: 0.25,
                labor: w.labor, machine: w.machine
            },
            {description: "Assemble", runRate: 0.25, labor: w.labor},
            {
                description: "Varnish", runRate: 0.25, waitTime: 24,
                labor: w.labor
            }
        ]
    });

    return {
        assy, plywood, hinge, knob, screw, varathane, gal, floz, ratio
    };
}

// Roll up one item. Resolves to {status, body}.
function rollUp(session, itemId, autoUpdate) {
    return session.raw("POST", "/design/roll-up-costs", {
        autoUpdate: Boolean(autoUpdate),
        itemId,
        subscription: {id: uniq("SUB"), eventKey: uniq("EK")}
    });
}

async function proposedCosts(session, itemId) {
    return session.findBy("ProposedCosts", "item.id", itemId);
}

async function costsOf(session, itemId) {
    let p = await session.read("Product", itemId);
    return {
        material: r2(p.materialCost.amount),
        labor: r2(p.laborCost.amount),
        overhead: r2(p.overheadCost.amount),
        service: r2(p.serviceCost.amount),
        total: r2(p.cost.amount)
    };
}

// Light read of a few properties (cheap enough to poll without loading
// the server with full record reads)
async function peek(session, plural, id, properties) {
    let rows = await session.list(plural, {
        filter: {criteria: [{property: "id", value: id}]},
        properties: ["id"].concat(properties)
    });
    return rows[0];
}

// Inventory ---------------------------------------------------------------

async function inventory(itemId, siteId) {
    let resp = await db.query(
        "SELECT inv.quantity, inv.allocated, inv.available " +
        "FROM inventory inv " +
        "  JOIN item i ON i._pk = inv._item_item_pk " +
        "  JOIN site s ON s._pk = inv._site_site_pk " +
        "WHERE i.id = $1 AND s.id = $2 AND NOT inv.is_deleted;",
        [itemId, siteId]
    );
    let row = resp.rows[0];
    if (!row) {
        return undefined;
    }
    return {
        quantity: num(row.quantity),
        allocated: num(row.allocated),
        available: num(row.available)
    };
}

async function onHand(itemId, siteId) {
    let inv = await inventory(itemId, siteId);
    return (
        inv
        ? inv.quantity
        : undefined
    );
}

// Inventory transactions for an item (optionally by document number)
async function transactions(itemId, opts) {
    let params = [itemId];
    let sql = (
        "SELECT t.number, t.type, t.document, t.reference, t.quantity, " +
        "  t.quantity_before, t.quantity_after " +
        "FROM inventory_transaction t " +
        "  JOIN item i ON i._pk = t._item_item_pk " +
        "WHERE i.id = $1 AND NOT t.is_deleted "
    );
    if (opts && opts.document) {
        params.push(opts.document);
        sql += "AND t.document = $2 ";
    }
    sql += "ORDER BY t._pk;";
    let resp = await db.query(sql, params);
    return resp.rows.map(function (r) {
        return {
            number: r.number,
            type: r.type,
            document: r.document,
            reference: r.reference,
            quantity: num(r.quantity),
            quantityBefore: num(r.quantity_before),
            quantityAfter: num(r.quantity_after)
        };
    });
}

// Put stock on hand with an inventory adjustment (auto-posts on save)
async function receiveStock(session, w, item, quantity) {
    let adj = await session.create("InventoryAdjustment", {
        item: ref(item),
        site: ref(w.site),
        quantity,
        type: "I"
    });
    let posted = await poll(async function () {
        let a = await peek(session, "InventoryAdjustments", adj.id, [
            "isPosted"
        ]);
        return a.isPosted && a;
    });
    if (!posted) {
        throw new Error("Adjustment for " + item.number + " did not post");
    }
    return posted;
}

// Allocations against a demand (requirement) id, straight from the table
async function allocations(demandId) {
    let resp = await db.query(
        "SELECT a.id, a.quantity, a.is_firm, s.id AS supply_id, " +
        "  to_camel_case(s.tableoid::regclass::text) AS supply_type " +
        "FROM allocation a " +
        "  JOIN demand d ON d._pk = a._demand_demand_pk " +
        "  JOIN supply s ON s._pk = a._supply_supply_pk " +
        "WHERE d.id = $1 AND NOT a.is_deleted;",
        [demandId]
    );
    return resp.rows.map(function (r) {
        return {
            id: r.id,
            quantity: num(r.quantity),
            isFirm: r.is_firm,
            supplyId: r.supply_id,
            supplyType: r.supply_type
        };
    });
}

// Work orders -------------------------------------------------------------

// Create the way the client does: status defaults to "U" (unexploded) and
// the server explodes it after commit. Waits until exploded and settled.
async function createWorkOrder(session, w, item, ordered, overrides) {
    let wo = await session.create("WorkOrder", Object.assign({
        item: ref(item),
        site: ref(w.site),
        ordered,
        startDate: today(),
        dueDate: today(7)
    }, zeroCosts(), overrides));
    return wo;
}

async function waitExploded(session, woId) {
    await poll(async function () {
        let r = await peek(session, "WorkOrders", woId, [
            "status", "error", "lock"
        ]);
        return (r.status !== "U" || r.error) && !r.lock;
    });
    await quiesce();
    return session.read("WorkOrder", woId);
}

async function workOrder(session, w, item, ordered, overrides) {
    let wo = await createWorkOrder(session, w, item, ordered, overrides);
    return waitExploded(session, wo.id);
}

// Release as the client does (status "A" and save)
async function release(session, woId) {
    let wo = await session.update("WorkOrder", woId, function (rec) {
        rec.status = "A";
    });
    await quiesce();
    return wo;
}

// Issue materials. lines: [{requirement, quantity}] where requirement is
// the work order material row.
async function issueMaterials(session, woId, lines, opts) {
    let iss = await session.create("WorkOrderIssue", Object.assign({
        date: today(),
        workOrder: {id: woId},
        materials: lines.map(function (ln) {
            return {
                materialRequirement: {id: ln.requirement.id},
                quantity: ln.quantity,
                details: []
            };
        })
    }, opts && opts.data));
    if (opts && opts.noWait) {
        return iss;
    }
    await poll(async function () {
        let r = await peek(session, "WorkOrderIssues", iss.id, [
            "status", "error"
        ]);
        return r.status === "I" || r.error;
    });
    await quiesce();
    return session.read("WorkOrderIssue", iss.id);
}

// Report an operation completion (auto-posts after commit)
async function completeOperation(session, op, quantity, opts) {
    let oc = await session.create("OperationCompletion", Object.assign({
        operation: {id: op.id},
        quantity
    }, opts));
    await poll(async function () {
        let r = await peek(session, "OperationCompletions", oc.id, [
            "isPosted", "error"
        ]);
        return r.isPosted || r.error;
    });
    await quiesce();
    return session.read("OperationCompletion", oc.id);
}

// Receive finished goods (auto-posts after commit)
async function receiveWorkOrder(session, wo, quantity, opts) {
    let rcpt = await session.create("WorkOrderReceipt", {
        workOrder: {id: wo.id},
        site: ref(wo.site),
        receiptDate: today(),
        quantity,
        details: []
    });
    if (opts && opts.noWait) {
        return rcpt;
    }
    await poll(async function () {
        let r = await peek(session, "WorkOrderReceipts", rcpt.id, [
            "status", "error"
        ]);
        return r.status === "R" || r.error;
    });
    await quiesce();
    return session.read("WorkOrderReceipt", rcpt.id);
}

// Work order status summary for assertions
function statusOf(wo) {
    return {
        status: wo.status,
        materials: wo.materials.filter(Boolean).map((m) => m.status),
        operations: wo.operations.filter(Boolean).map((o) => o.status)
    };
}

function actualCosts(wo) {
    return {
        material: r2(wo.actualMaterialCost.amount),
        labor: r2(wo.actualLaborCost.amount),
        overhead: r2(wo.actualOverheadCost.amount),
        service: r2(wo.actualServiceCost.amount),
        total: r2(wo.actualTotalCost.amount)
    };
}

module.exports = {
    COST_FIELDS,
    actualCosts,
    allocations,
    bomRatio,
    completeOperation,
    costsOf,
    createWorkOrder,
    demoCabinet,
    employee,
    inventory,
    issueMaterials,
    num,
    onHand,
    peek,
    poll,
    product,
    proposedCosts,
    quiesce,
    r2,
    receiveStock,
    receiveWorkOrder,
    release,
    rollUp,
    sleep,
    statusOf,
    transactions,
    unit,
    waitExploded,
    workOrder,
    zeroCosts
};
