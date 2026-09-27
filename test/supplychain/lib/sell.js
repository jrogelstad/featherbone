/*
    Order-to-cash test helpers: customers, stocked sold items, sales
    orders, shipments and invoices built through the HTTP API the way the
    SupplyChain client does it (see sc-demo sell/, ship/, bill/, plan/
    module.js for the payloads these mirror).
*/
/*jslint node*/
"use strict";

const db = require("../../harness/db");
const fx = require("../../harness/fixtures");

const {money, ref, uniq} = fx;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll fn() until it returns a truthy value or the timeout expires.
// Used for work the server finishes after responding (onCommit posts).
async function poll(fn, opts) {
    opts = opts || {};
    let timeout = opts.timeout || 15000;
    let interval = opts.interval || 100;
    let started = Date.now();
    let result;

    while (true) {
        result = await fn();
        if (result) {
            return result;
        }
        if (Date.now() - started > timeout) {
            throw new Error(
                "Timed out waiting for " + (opts.what || "condition")
            );
        }
        await sleep(interval);
    }
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

async function employee(session, user) {
    return session.create("Employee", {
        number: uniq("EMP"),
        firstName: "Regression",
        lastName: "Shipper",
        isActive: true,
        userAccount: user || ""
    });
}

// A customer shipping to its bill-to address. opts.taxable, opts.address
async function customer(session, w, opts) {
    opts = opts || {};
    let billTo = await fx.address(session, Object.assign({
        name: "Regression Customer"
    }, opts.address));
    return session.create("Customer", {
        number: uniq("CUST"),
        name: "Regression Customer",
        isActive: true,
        billTo: ref(billTo),
        billToIsShipto: true,
        shipTo: ref(billTo),
        terms: ref(w.terms),
        currency: ref(w.currency),
        site: ref(w.site),
        shipMethod: ref(w.shipMethod),
        creditStatus: "G",
        taxable: Boolean(opts.taxable),
        discount: 0
    });
}

// Inventory record of an item at a site
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
        ? inv.quantity
        : undefined
    );
}

// Inventory adjustments post themselves after commit (onCommit callback
// in triggers-inventory-adjustment.js), so wait for isPosted.
async function adjust(session, item, site, quantity, type) {
    let adj = await session.create("InventoryAdjustment", {
        number: uniq("ADJ"),
        item: ref(item),
        site: ref(site),
        quantity,
        type: type || "I",
        details: [],
        comments: "Regression test stock"
    });
    await poll(async function () {
        let rec = await session.read("InventoryAdjustment", adj.id);
        return rec.isPosted;
    }, {what: "inventory adjustment " + adj.number + " to post"});
    return adj;
}

// A purchased, sold item with optional stock on hand
async function soldItem(session, w, opts) {
    opts = opts || {};
    let item = await fx.purchasedItem(session, w, {
        prefix: opts.prefix || "SELL",
        description: opts.description || "Camper widget",
        cost: (
            opts.cost === undefined
            ? 10
            : opts.cost
        ),
        price: opts.price || 25,
        isSold: true
    });
    if (opts.onHand) {
        await adjust(session, item, w.site, opts.onHand);
    }
    return item;
}

// Everything an order-to-cash flow needs, built once per file
async function world(session, opts) {
    opts = opts || {};
    await fx.configure(session);
    // Planning reads a shipping buffer; pin it so dates are predictable
    await fx.settings(session, "planSettings", {shippingBuffer: 0});
    let w = await fx.world(session);
    w.employee = await employee(session);
    w.customer = await customer(session, w, opts.customer);
    return w;
}

// lines: [{item, ordered, price, discount, taxable}]
function soLine(w, ln, idx) {
    return {
        line: idx + 1,
        item: ref(ln.item),
        site: ref(ln.site || w.site),
        ordered: ln.ordered,
        price: money(
            ln.price === undefined
            ? 25
            : ln.price
        ),
        // The server recomputes amounts (triggers-sales-order.js
        // calcAmounts); send zero so tests see the server's numbers
        amount: money(0),
        discount: ln.discount || 0,
        taxable: Boolean(ln.taxable),
        requestedDate: ln.requestedDate || fx.today(),
        materials: []
    };
}

// Create a sales order the way the client saves a new one (status "I")
async function salesOrder(session, w, lines, opts) {
    opts = opts || {};
    let cust = opts.customer || w.customer;
    return session.create("SalesOrder", {
        status: "I",
        orderDate: fx.today(),
        requestedDate: opts.requestedDate || fx.today(),
        customer: ref(cust),
        billTo: ref(cust.billTo),
        shipTo: ref(cust.shipTo),
        terms: ref(w.terms),
        currency: ref(w.currency),
        shipMethod: ref(w.shipMethod),
        site: ref(w.site),
        taxable: Boolean(opts.taxable),
        freight: money(opts.freight || 0),
        subtotal: money(0),
        tax: money(0),
        total: money(0),
        taxes: opts.taxes || [],
        purchaseOrder: opts.purchaseOrder || "",
        lines: lines.map((ln, idx) => soLine(w, ln, idx))
    });
}

function readSo(session, so) {
    return session.read("SalesOrder", so.id || so);
}

// "Start" (I -> P) then "Release" (P -> A), as the list actions do
async function startAndRelease(session, so) {
    await session.route("/sell/start-sales-orders", {ids: [so.id]});
    await session.route("/sell/release-sales-orders", {ids: [so.id]});
    return readSo(session, so);
}

// Allocation rows for a demand (sales order line)
function allocations(session, demandId) {
    return session.list("Allocations", {
        filter: {criteria: [{property: "demand.id", value: demandId}]}
    });
}

// Build a shipment like the client: one line per open sales order line
// at the shipment site. qtys maps line number -> quantity (default: due)
async function shipment(session, w, so, qtys, opts) {
    let data = await session.route(
        "/ship/get-sales-order-ship-data",
        {id: so.id}
    );
    let n = 0;
    qtys = qtys || {};
    opts = opts || {};
    return session.create("SalesOrderShipment", {
        salesOrder: {id: so.id},
        site: ref(w.site),
        shipTo: ref(data.shipTo),
        shipMethod: ref(data.shipMethod),
        purchaseOrder: data.purchaseOrder,
        shippedBy: ref(w.employee),
        // The client model defaults money to zero; invoicing reads it
        freightCharges: money(opts.freight || 0),
        containers: [],
        trackingUrls: [],
        lines: data.lines.filter(
            (ln) => ln.site.id === w.site.id && ln.quantityDue > 0
        ).map(function (ln) {
            n += 1;
            return {
                line: n,
                item: ref(ln.item),
                salesOrderLine: {id: ln.id},
                quantity: (
                    qtys[ln.line] === undefined
                    ? ln.quantityDue
                    : qtys[ln.line]
                ),
                details: []
            };
        })
    });
}

async function ship(session, shpmt) {
    return session.route("/ship/ship-sales-order-shipments", {
        ids: [shpmt.id]
    });
}

async function invoiceShipment(session, shpmt) {
    let id = await session.route(
        "/bill/do-create-shipment-invoice",
        {id: shpmt.id}
    );
    return session.read("ShipmentInvoice", id);
}

// Inventory transactions for an item (SQL: not exposed per item/site
// cheaply through the API)
async function transactions(item) {
    let resp = await db.query(
        "SELECT t.quantity, t.quantity_before, t.quantity_after, t.type, " +
        "  t.document, t.reference " +
        "FROM inventory_transaction t " +
        "  JOIN item i ON i._pk = t._item_item_pk " +
        "WHERE i.id = $1 AND NOT t.is_deleted ORDER BY t._pk",
        [item.id]
    );
    return resp.rows.map((r) => ({
        quantity: Number(r.quantity),
        quantityBefore: Number(r.quantity_before),
        quantityAfter: Number(r.quantity_after),
        type: r.type,
        document: r.document,
        reference: r.reference
    }));
}

// Inventory "allocated" versus the allocation rows that point at it
async function inventoryAllocation(item, site) {
    let resp = await db.query(
        "SELECT inv.allocated, " +
        "  (SELECT COALESCE(SUM(a.quantity), 0) FROM allocation a " +
        "   WHERE a._supply_supply_pk = inv._pk AND NOT a.is_deleted) " +
        "   AS rows " +
        "FROM inventory inv " +
        "  JOIN item i ON i._pk = inv._item_item_pk " +
        "  JOIN site s ON s._pk = inv._site_site_pk " +
        "WHERE i.id = $1 AND s.id = $2",
        [item.id, site.id]
    );
    return {
        allocated: Number(resp.rows[0].allocated),
        rows: Number(resp.rows[0].rows)
    };
}

// A prepaid invoice (deposit) against a sales order, like the
// "Create prepaid invoice" action saves it
async function prepaidInvoice(session, w, so, amount) {
    return session.create("PrepaidInvoice", {
        invoiceDate: fx.today(),
        shipDate: fx.today(),
        status: "A",
        customer: ref(so.customer),
        billTo: ref(so.billTo),
        shipTo: ref(so.shipTo),
        terms: ref(w.terms),
        currency: ref(w.currency),
        taxable: false,
        salesOrder: ref(so),
        subtotal: money(amount),
        tax: money(0),
        freight: money(0),
        total: money(amount),
        paid: money(0),
        balance: money(amount),
        lines: [],
        taxes: [],
        payments: [],
        applications: []
    });
}

function payInvoices(session, ids, amount, reference) {
    return session.route("/bill/do-apply-invoice-payment", {
        amount: money(amount),
        ids,
        reference: reference || ""
    });
}

// Tax rate row matched by address zip/city/state (get-address-tax-rates)
async function taxRate(session, opts) {
    return session.create("TaxRate", Object.assign({
        zipCode: opts.zipCode,
        city: opts.city,
        state: opts.state,
        county: opts.county || "Testcounty",
        salesTaxRate: opts.rateState || 0,
        rateState: opts.rateState || 0,
        rateCounty: opts.rateCounty || 0,
        rateCity: opts.rateCity || 0,
        rateSpecialDistrict: 0,
        reportingCodeState: "RTS",
        reportingCodeCounty: "RTC",
        reportingCodeCity: "RTY",
        reportingCodeSpecialDistrict: "",
        postOffice: opts.city,
        shippingTaxable: Boolean(opts.shippingTaxable),
        primaryRecord: true,
        z2tId: ""
    }));
}

module.exports = {
    adjust,
    allocations,
    customer,
    employee,
    inventory,
    inventoryAllocation,
    invoiceShipment,
    onHand,
    payInvoices,
    poll,
    prepaidInvoice,
    readSo,
    round2,
    salesOrder,
    ship,
    shipment,
    sleep,
    soldItem,
    startAndRelease,
    taxRate,
    transactions,
    world
};
