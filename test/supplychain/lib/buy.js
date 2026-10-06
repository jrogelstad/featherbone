/*
    SupplyChain regression tests: purchasing, stock and count helpers.

    Builders for purchase orders and receipts shaped like the payloads the
    SupplyChain client sends (buy/module.js, stock/module.js), readers for
    inventory and inventory transactions, and a poll helper for work that
    Featherbone runs after commit (auto-posting receipts, adjustments and
    moves happens in onCommit callbacks, after the HTTP response).
*/
/*jslint node*/
"use strict";

const {money, ref, today, uniq} = require("../../harness/fixtures");
const db = require("../../harness/db");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call fn until it returns a truthy value or the timeout passes. Returns
// the last value (falsy on timeout) so the caller's assertion reports it.
async function poll(fn, opts) {
    let timeout = (opts && opts.timeout) || 10000;
    let interval = (opts && opts.interval) || 100;
    let started = Date.now();
    let ret = await fn();

    while (!ret && Date.now() - started < timeout) {
        await sleep(interval);
        ret = await fn();
    }
    return ret;
}

// Wait until fn() stops changing (for asserting that nothing more happens
// after a background post). Returns the settled value.
async function settle(fn, quietMs) {
    let quiet = quietMs || 750;
    let last = JSON.stringify(await fn());
    let stableSince = Date.now();
    let started = Date.now();
    let now;

    while (Date.now() - stableSince < quiet && Date.now() - started < 15000) {
        await sleep(50);
        now = JSON.stringify(await fn());
        if (now !== last) {
            last = now;
            stableSince = Date.now();
        }
    }
    return JSON.parse(last);
}

const LOCKED = /is (already )?locked by/;

function isLockError(err) {
    let body = (
        (err && err.body !== undefined)
        ? err.body
        : err
    );
    return LOCKED.test(
        typeof body === "string"
        ? body
        : JSON.stringify(body || "")
    );
}

// Run fn, retrying while it fails because a background (onCommit) post
// still holds the record lock. Records are auto-posted right after save;
// when that post is expected to fail it leaves no visible trace (its lock
// is never committed), so the only signal is the lock error itself.
// fn may throw (session.call) or return a raw {status, body} response.
async function unlocked(fn, timeout) {
    let started = Date.now();
    let limit = timeout || 15000;
    let resp;

    while (true) {
        try {
            resp = await fn();
            if (
                !resp || resp.status === undefined ||
                resp.status < 300 || !isLockError(resp.body) ||
                Date.now() - started > limit
            ) {
                return resp;
            }
        } catch (err) {
            if (!isLockError(err) || Date.now() - started > limit) {
                throw err;
            }
        }
        await sleep(200);
    }
}

// Raw POST to a module route, retrying on lock contention
function postRoute(session, path, body) {
    return unlocked(() => session.raw("POST", path, body));
}

function num(v) {
    return Number(v);
}

// Purchase order payload as the client posts it. lines: [{item, ordered,
// price, unit, ratio}]
function purchaseOrderData(w, supp, lines, overrides) {
    return Object.assign({
        orderDate: today(),
        plannedDelivery: today(7),
        supplier: ref(supp),
        terms: ref(w.terms),
        site: ref(w.site),
        currency: ref(w.currency),
        freight: money(0),
        lines: lines.map(function (ln) {
            return {
                item: ref(ln.item),
                site: ref(ln.site || w.site),
                ordered: ln.ordered,
                price: money(ln.price),
                unit: ref(ln.unit || w.unit),
                ratio: ln.ratio || 1,
                plannedDelivery: today(7),
                description: ln.item.description,
                components: []
            };
        })
    }, overrides);
}

async function purchaseOrder(session, w, supp, lines, overrides) {
    let po = await session.create(
        "PurchaseOrder",
        purchaseOrderData(w, supp, lines, overrides)
    );
    return session.read("PurchaseOrder", po.id);
}

// Release/unrelease/close like the client (always sends ids). Retries if
// a just-finished receipt post still holds the order's lock.
async function setPoStatus(session, ids, status) {
    return unlocked(() => session.route(
        "/buy/change-purchase-order-status",
        {
            ids: (
                Array.isArray(ids)
                ? ids
                : [ids]
            ),
            status
        }
    ));
}

// Receipt as the client builds it (buy/module.js purchaseOrderReceipt):
// site and lines come from /buy/get-purchase-order-receipt-data, with one
// receipt line per PO line that still has quantity open.
// quantities: {<PO line number>: quantity}; lines not listed get 0.
async function receiptData(session, poId, quantities, overrides) {
    let rd = await session.route(
        "/buy/get-purchase-order-receipt-data",
        {id: poId}
    );
    let n = 0;
    let lines = [];

    rd.lines.forEach(function (ln) {
        if (ln.quantity > 0) {
            n += 1;
            lines.push({
                line: n,
                purchaseOrderLine: {id: ln.id},
                item: {id: ln.item.id},
                quantity: quantities[ln.line] || 0,
                details: []
            });
        }
    });

    return Object.assign({
        purchaseOrder: {id: poId},
        site: ref(rd.site),
        lines
    }, overrides);
}

// Create a receipt. Insert auto-posts it after commit
// (triggers-purchase-order-receipt.js); wait for that unless told not to.
async function receive(session, poId, quantities, opts) {
    let data = await receiptData(session, poId, quantities);
    let rcpt = await session.create("PurchaseOrderReceipt", data);
    if (opts && opts.noWait) {
        return rcpt;
    }
    return waitFor(
        session,
        "PurchaseOrderReceipt",
        rcpt.id,
        (r) => r.status === "R" || r.error
    );
}

// A receipt that stays pending: auto-post rejects a receipt with no
// quantity (before locking anything), then lines are filled in with PATCH
// (there is no auto-post on update).
async function pendingReceipt(session, poId, quantities) {
    let data = await receiptData(session, poId, {});
    let rcpt = await session.create("PurchaseOrderReceipt", data);
    let rd = await session.route(
        "/buy/get-purchase-order-receipt-data",
        {id: poId}
    );
    return unlocked(() => session.update(
        "PurchaseOrderReceipt",
        rcpt.id,
        function (r) {
            r.lines.forEach(function (ln) {
                let pol = rd.lines.find(
                    (p) => p.id === ln.purchaseOrderLine.id
                );
                ln.quantity = quantities[pol.line] || 0;
            });
        }
    ));
}

// Inventory (Supply subtype) for one item at one site, via the data API
async function inventory(session, item, site) {
    let rows = await session.list("Inventories", {
        filter: {criteria: [
            {property: "item.id", value: item.id},
            {property: "site.id", value: site.id}
        ]}
    });
    return rows[0];
}

async function onHand(session, item, site) {
    let inv = await inventory(session, item, site);
    return (
        inv
        ? num(inv.quantity)
        : undefined
    );
}

// Inventory transactions for an item, oldest first
async function transactions(session, item, criteria) {
    return session.list("InventoryTransactions", {
        filter: {
            criteria: [{property: "item.id", value: item.id}].concat(
                criteria || []
            ),
            sort: [{property: "created"}]
        }
    });
}

// Raw row count of inventory_transaction for an item (SQL, independent of
// API paging and authorization)
async function transactionCount(item) {
    let resp = await db.query(
        "SELECT count(*)::int AS n FROM inventory_transaction t " +
        "JOIN item i ON i._pk = t._item_item_pk " +
        "WHERE i.id = $1 AND NOT t.is_deleted",
        [item.id]
    );
    return resp.rows[0].n;
}

// Wait for an async (onCommit) post to land and return the record
async function waitFor(session, feather, id, predicate, timeout) {
    let rec = await poll(async function () {
        let r = await session.read(feather, id);
        return (
            predicate(r)
            ? r
            : false
        );
    }, {timeout});
    return rec || session.read(feather, id);
}

// Alerts about a record. SQL because the data API cannot filter on the
// json "relation" column (POST /data/alerts with relation.id -> 500).
async function alerts(relationId) {
    let resp = await db.query(
        "SELECT category, severity, message FROM alert " +
        "WHERE relation->>'id' = $1 AND NOT is_deleted ORDER BY created",
        [relationId]
    );
    return resp.rows;
}

module.exports = {
    alerts,
    inventory,
    num,
    onHand,
    pendingReceipt,
    poll,
    postRoute,
    purchaseOrder,
    purchaseOrderData,
    receiptData,
    receive,
    setPoStatus,
    settle,
    sleep,
    transactionCount,
    transactions,
    uniq,
    unlocked,
    waitFor
};
