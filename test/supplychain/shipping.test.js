/*
    Sales order shipping (SupplyChain ship/): ship data lookup, shipment
    entry rules (pack status, in-shipping quantities, one pending shipment
    per order and site, quantity limits), shipping a partial and then the
    remaining quantity (sales order status S -> B -> C with
    shipSettings.useBackOrder, shipped/back-ordered quantities, actual
    cost, allocations, inventory and InventoryTransaction rows), guards
    against double shipping and shipping held orders, and bills of lading.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const sell = require("./lib/sell");

function lineOf(so, n) {
    return so.lines.find((l) => l.line === n);
}

describe("sales order shipping", function () {
    let s;
    let w;
    let item;
    let so;
    let sh1;
    let sh2;

    before(async function () {
        s = await signedIn();
        w = await sell.world(s);
        item = await sell.soldItem(s, w, {
            prefix: "SHIPIT", onHand: 20, price: 10, cost: 4
        });
        so = await sell.salesOrder(s, w, [
            {item, ordered: 10, price: 10}
        ], {purchaseOrder: "PO-SHIP-1"});
        so = await sell.startAndRelease(s, so);
    });

    it("get-sales-order-ship-data returns the order with item " +
            "customs data", async function () {
        let data = await s.route("/ship/get-sales-order-ship-data", {
            id: so.id
        });

        assert.equal(data.number, so.number);
        assert.equal(data.status, "A");
        assert.equal(data.purchaseOrder, "PO-SHIP-1");
        assert.equal(data.shipTo.id, so.shipTo.id);
        assert.equal(data.site.id, w.site.id);
        assert.equal(data.lines.length, 1);
        assert.equal(data.lines[0].quantityDue, 10);
        assert.deepEqual(
            Object.keys(data.lines[0].item).filter((k) => [
                "countryOfOrigin", "customsDescription", "customsValue",
                "freightCode", "harmonizedTariffCode", "weight"
            ].includes(k)).sort(),
            [
                "countryOfOrigin", "customsDescription", "customsValue",
                "freightCode", "harmonizedTariffCode", "weight"
            ]
        );
    });

    it("a shipment for more than is due is refused", async function () {
        let resp = await s.raw("POST", "/data/sales-order-shipment", {
            salesOrder: {id: so.id},
            site: fx.ref(w.site),
            shipTo: fx.ref(so.shipTo),
            shippedBy: fx.ref(w.employee),
            freightCharges: fx.money(0),
            containers: [],
            trackingUrls: [],
            lines: [{
                line: 1,
                item: fx.ref(item),
                salesOrderLine: {id: so.lines[0].id},
                quantity: 11,
                details: []
            }]
        });

        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Ship quantity can not be greater than quantity due"
        );
        assert.equal((await sell.readSo(s, so)).status, "A");
    });

    it("creating a partial shipment puts the order in shipping",
            async function () {
        sh1 = await sell.shipment(s, w, so, {1: 4});

        assert.match(sh1.number, /^SH-\d+$/);
        assert.equal(sh1.status, "P");
        assert.equal(sh1.packStatus, "P");
        assert.equal(sh1.isInvoiced, false);
        assert.equal(sh1.containerCount, 0);

        so = await sell.readSo(s, so);
        assert.equal(so.status, "S");
        assert.equal(so.lines[0].inShipping, 4);
        assert.equal(so.lines[0].status, "A");
    });

    it("only one pending shipment per order and site", async function () {
        let resp = await s.raw("POST", "/data/sales-order-shipment", {
            salesOrder: {id: so.id},
            site: fx.ref(w.site),
            shipTo: fx.ref(so.shipTo),
            shippedBy: fx.ref(w.employee),
            freightCharges: fx.money(0),
            containers: [],
            trackingUrls: [],
            lines: []
        });

        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Sales order " + so.number + " already has an active shipment " +
            sh1.number + " at Regression test warehouse"
        );
    });

    it("shipping a partial shipment back-orders the rest and posts " +
            "inventory", async function () {
        let msg = await sell.ship(s, sh1);
        assert.equal(msg, "Shipment(s) shipped successfully");

        let shipped = await s.read("SalesOrderShipment", sh1.id);
        assert.equal(shipped.status, "S");
        assert.equal(shipped.shipDate, fx.today());

        so = await sell.readSo(s, so);
        let ln = lineOf(so, 1);
        // useBackOrder: a partly shipped order goes to BackOrdered
        assert.equal(so.status, "B");
        assert.equal(ln.status, "A");
        assert.equal(ln.shipped, 4);
        assert.equal(ln.quantityDue, 6);
        assert.equal(ln.backOrdered, 6);
        assert.equal(ln.inShipping, 0);
        assert.equal(ln.allocated, 6);
        // Actual cost = shipped x item cost
        assert.equal(ln.actualMaterialCost.amount, 16);
        assert.equal(ln.actualTotalCost.amount, 16);
        assert.equal(so.planStatus, "I");

        let alc = await sell.allocations(s, ln.id);
        assert.deepEqual(alc.map((a) => a.quantity), [6]);

        let inv = await sell.inventory(s, item, w.site);
        assert.equal(inv.quantity, 16);
        assert.equal(inv.allocated, 6);
        assert.equal(inv.totalValue.amount, 64);

        let tx = await sell.transactions(item);
        assert.deepEqual(tx.slice(1), [{
            quantity: -4,
            quantityBefore: 20,
            quantityAfter: 16,
            type: "Shipment",
            document: sh1.number,
            reference: ln.number
        }]);
    });

    it("inventory allocated matches its allocation rows after a " +
            "partial shipment", {todo: "plan 2.5: allocation drift"},
            async function () {
        let check = await sell.inventoryAllocation(item, w.site);
        assert.equal(check.allocated, check.rows);
    });

    it("a shipped shipment is not shipped again", async function () {
        let resp = await s.raw("POST", "/ship/ship-sales-order-shipments", {
            ids: [sh1.id]
        });

        // Silently ignored: only pending (P/R) shipments are fetched
        assert.equal(resp.status, 200);
        assert.equal((await sell.onHand(s, item, w.site)), 16);
        assert.equal(lineOf(await sell.readSo(s, so), 1).shipped, 4);
        assert.equal((await sell.transactions(item)).length, 2);
    });

    it("a shipped shipment cannot be deleted", async function () {
        let resp = await s.raw(
            "DELETE",
            "/data/sales-order-shipment/" + sh1.id
        );
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Shipped shipment may not be deleted");
    });

    it("deleting a pending shipment returns the order to back ordered",
            async function () {
        let pending = await sell.shipment(s, w, so, {1: 2});
        let rec = await sell.readSo(s, so);
        assert.equal(rec.status, "S");
        assert.equal(lineOf(rec, 1).inShipping, 2);

        await s.remove("SalesOrderShipment", pending.id);
        rec = await sell.readSo(s, so);
        assert.equal(rec.status, "B");
        assert.equal(lineOf(rec, 1).inShipping, 0);
    });

    it("concurrent ship requests for one shipment post it once",
            async function () {
        let other = await signedIn();
        sh2 = await sell.shipment(s, w, so);
        assert.equal(sh2.packStatus, "C");

        let resp = await Promise.all([
            s.raw("POST", "/ship/ship-sales-order-shipments", {
                ids: [sh2.id]
            }),
            other.raw("POST", "/ship/ship-sales-order-shipments", {
                ids: [sh2.id]
            })
        ]);
        // The loser is refused by the in-memory "pending" guard, or, if
        // it arrives after the winner finished, finds nothing pending
        assert.ok(resp.some((r) => r.status === 200));
        resp.filter((r) => r.status !== 200).forEach(function (r) {
            assert.equal(r.body, "Shipment is already in shipping process");
        });
        assert.equal(await sell.onHand(s, item, w.site), 10);
        assert.equal(lineOf(await sell.readSo(s, so), 1).shipped, 10);
    });

    it("shipping the rest closes the order and its lines",
            async function () {
        so = await sell.readSo(s, so);
        let ln = lineOf(so, 1);

        assert.equal(so.status, "C");
        assert.equal(so.planStatus, "C");
        assert.equal(ln.status, "C");
        assert.equal(ln.shipped, 10);
        assert.equal(ln.quantityDue, 0);
        assert.equal(ln.backOrdered, 0);
        assert.equal(ln.allocated, 0);
        assert.equal(ln.actualMaterialCost.amount, 40);
        assert.equal((await sell.allocations(s, ln.id)).length, 0);

        let inv = await sell.inventory(s, item, w.site);
        assert.equal(inv.quantity, 10);
        assert.equal(inv.allocated, 0);
        assert.deepEqual(
            (await sell.transactions(item)).map((t) => [
                t.type, t.quantity, t.quantityAfter
            ]),
            [["Adjustment", 20, 20], ["Shipment", -4, 16],
                ["Shipment", -6, 10]]
        );
    });

    it("an order on hold cannot be shipped", async function () {
        let held = await sell.salesOrder(s, w, [
            {item, ordered: 1, price: 10}
        ]);
        held = await sell.startAndRelease(s, held);
        await s.route("/sell/hold", {
            salesOrderId: held.id, hold: true, recursive: false
        });

        // The server accepts the shipment (only the client form checks
        // the hold), but refuses to ship it
        let shpmt = await sell.shipment(s, w, held);
        let resp = await s.raw("POST", "/ship/ship-sales-order-shipments", {
            ids: [shpmt.id]
        });
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Sales order " + held.number + " is on hold ");
        assert.equal(await sell.onHand(s, item, w.site), 10);
        assert.equal((await s.read("SalesOrderShipment", shpmt.id)).status, "P");

        // Clean up so the order is releasable again
        await s.remove("SalesOrderShipment", shpmt.id);
        await s.route("/sell/hold", {
            salesOrderId: held.id, hold: false, recursive: false
        });
        assert.equal((await sell.readSo(s, held)).status, "A");
    });

    it("an order with a future requested date cannot ship early",
            async function () {
        let later = await sell.salesOrder(s, w, [
            {item, ordered: 1, price: 10, requestedDate: fx.today(5)}
        ], {requestedDate: fx.today(5)});
        later = await sell.startAndRelease(s, later);
        let shpmt = await sell.shipment(s, w, later);

        let resp = await s.raw("POST", "/ship/ship-sales-order-shipments", {
            ids: [shpmt.id]
        });
        assert.equal(resp.status, 500);
        assert.match(
            resp.body,
            new RegExp(
                "^Sales order " + later.number +
                " can not be shipped before its requested date of "
            )
        );
        await s.remove("SalesOrderShipment", shpmt.id);
    });

    it("create-bill-of-lading summarizes shipments", async function () {
        let id = await s.route("/ship/create-bill-of-lading", {
            ids: [sh1.id, sh2.id]
        });
        let bol = await s.read("BillOfLading", id);

        assert.match(bol.number, /^\d+$/);
        assert.equal(bol.salesOrders, so.number + "," + so.number);
        assert.equal(bol.shipTo.id, so.shipTo.id);
        assert.equal(bol.shipFrom.id, w.site.address.id);
        assert.equal(bol.shipments.length, 2);
        assert.deepEqual(
            bol.shipments.map((r) => r.shipment.id).sort(),
            [sh1.id, sh2.id].sort()
        );
        assert.equal(bol.orders.length, 2);
        assert.equal(bol.orders[0].numberOfPackages, 0);
        assert.deepEqual(bol.information, []);

        let resp = await s.raw("POST", "/ship/create-bill-of-lading", {
            ids: ["no-such-shipment"]
        });
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Shipment(s) not found");
    });

    it("bill of lading orders carry the customer purchase order",
            {todo: "defect: SalesOrderShipment.salesOrder has no " +
            "purchaseOrder, so orders read \"PO#:undefined\""},
            async function () {
        let id = await s.route("/ship/create-bill-of-lading", {
            ids: [sh1.id]
        });
        let bol = await s.read("BillOfLading", id);

        assert.equal(bol.purchaseOrders, "PO-SHIP-1");
        assert.equal(bol.orders[0].orderNumber, so.number + " - PO#:PO-SHIP-1");
    });

    it("picklist and container routes are routed but have no server " +
            "function", async function () {
        let resp = await s.raw("POST", "/ship/confirm-picklist-batch", {
            ids: [so.id]
        });
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Function POST doConfirmPicklistBatch is not registered."
        );

        resp = await s.raw(
            "POST",
            "/ship/create-sales-order-shipment-containers",
            {id: sh1.id}
        );
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Function POST doCreateSalesOrderShipmentContainers is not " +
            "registered."
        );
    });
});
