/*
    SupplyChain purchasing: purchase order lifecycle and receiving.

    Modeled on the demo database, where 28 purchase orders went
    Pending -> Approved (released) -> received -> Closed. Covers
    /buy/change-purchase-order-status, /buy/get-purchase-order-receipt-data,
    /buy/post-purchase-order-receipts and the PurchaseOrder /
    PurchaseOrderReceipt triggers (totals, line status, auto-post on save,
    inventory transactions and on-hand), plus known posting defects
    (plan 2.3 double posting, plan 2.8 receipt loop index not reset).
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const buy = require("./lib/buy");

describe("purchasing", function () {
    let s;
    let w;
    let supp;

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
        supp = await fx.supplier(s, w);
    });

    describe("purchase order lifecycle (demo: P -> A -> B -> C)",
            function () {
        let hinge;
        let knob;
        let po;
        let rcpt1;

        before(async function () {
            hinge = await fx.purchasedItem(s, w, {
                prefix: "HINGE", cost: 3.2, description: "Cabinet hinge"
            });
            knob = await fx.purchasedItem(s, w, {
                prefix: "KNOB", cost: 1.4, description: "Cabinet knob"
            });
        });

        it("creates a pending order with line amount = ordered x price " +
                "and subtotal/total", async function () {
            // Purchase prices use 4 decimals (purchasePriceDecimals)
            po = await buy.purchaseOrder(s, w, supp, [
                {item: hinge, ordered: 40, price: 2.9875},
                {item: knob, ordered: 25, price: 1.2345}
            ], {freight: fx.money(12.5)});

            assert.match(po.number, /^P-\d+$/);
            assert.equal(po.status, "P");
            assert.equal(po.lines.length, 2);
            assert.deepEqual(
                po.lines.map((l) => [
                    l.line, l.number, l.status, l.ordered, l.quantity,
                    l.received, l.amount.amount
                ]),
                [
                    [1, po.number + "\\1", "P", 40, 40, 0, 119.5],
                    // Line amounts are not rounded to currency precision
                    [2, po.number + "\\2", "P", 25, 25, 0, 30.8625]
                ]
            );
            assert.equal(po.lines[0].dueDate, po.lines[0].plannedDelivery);
            assert.equal(po.subtotal.amount, 150.3625);
            assert.equal(po.total.amount, 162.8625);
            assert.equal(po.subtotal.currency, "USD");
            assert.equal(po.tax.amount, 0);
            assert.equal(po.hasOutsideProcess, false);

            // Open supply shows as on order
            let inv = await buy.inventory(s, hinge, w.site);
            assert.equal(inv.onOrder, 40);
            assert.equal(inv.quantity, 0);
        });

        it("recalculates totals when a line changes", async function () {
            po = await s.update("PurchaseOrder", po.id, function (r) {
                r.lines[1].ordered = 20;
                r.lines[1].price.amount = 1.25;
            });
            assert.equal(po.lines[1].amount.amount, 25);
            assert.equal(po.lines[1].quantity, 20);
            assert.equal(po.subtotal.amount, 144.5);
            assert.equal(po.total.amount, 157);
        });

        it("releases (P -> A) and unreleases (A -> P) with " +
                "change-purchase-order-status", async function () {
            await buy.setPoStatus(s, po.id, "A");
            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "A");
            assert.deepEqual(po.lines.map((l) => l.status), ["A", "A"]);

            await buy.setPoStatus(s, po.id, "P");
            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "P");
            assert.deepEqual(po.lines.map((l) => l.status), ["P", "P"]);

            await buy.setPoStatus(s, po.id, "A");
            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "A");
            // Status change does not touch money
            assert.equal(po.total.amount, 157);
        });

        it("get-purchase-order-receipt-data returns what the receipt " +
                "form needs", async function () {
            let rd = await s.route(
                "/buy/get-purchase-order-receipt-data",
                {id: po.id}
            );
            assert.equal(rd.number, po.number);
            assert.equal(rd.status, "A");
            assert.equal(rd.site.id, w.site.id);
            assert.equal(rd.site.locationControlled, false);
            assert.deepEqual(
                rd.lines.map((l) => [l.line, l.item.id, l.quantity]),
                [[1, hinge.id, 40], [2, knob.id, 20]]
            );
        });

        it("a partial receipt auto-posts on save: receipt R, line and " +
                "order backordered, inventory at standard cost",
                async function () {
            rcpt1 = await buy.receive(s, po.id, {1: 16, 2: 20});

            assert.equal(rcpt1.error, "");
            assert.equal(rcpt1.status, "R");
            assert.match(rcpt1.number, /^RC-\d+$/);
            assert.equal(rcpt1.receiptDate, fx.today());

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "B");
            assert.deepEqual(
                po.lines.map((l) => [
                    l.status, l.received, l.quantity, l.backOrdered
                ]),
                [["B", 16, 24, 24], ["C", 20, 0, 0]]
            );

            let tx = await buy.transactions(s, hinge);
            assert.equal(tx.length, 1);
            assert.equal(tx[0].type, "Purchase Order Receipt");
            assert.equal(tx[0].document, rcpt1.number);
            assert.equal(tx[0].reference, po.number + "\\1");
            assert.equal(tx[0].date, fx.today());
            assert.equal(tx[0].site.id, w.site.id);
            assert.equal(tx[0].quantity, 16);
            assert.equal(tx[0].quantityBefore, 0);
            assert.equal(tx[0].quantityAfter, 16);
            // Valued at the item's standard cost (3.20), not the PO price
            assert.equal(tx[0].materialCost.amount, 51.2);
            assert.equal(tx[0].laborCost.amount, 0);
            assert.equal(tx[0].totalCost.amount, 51.2);

            let inv = await buy.inventory(s, hinge, w.site);
            assert.equal(inv.quantity, 16);
            assert.equal(inv.available, 16);
            assert.equal(inv.materialValue.amount, 51.2);
            assert.equal(inv.totalValue.amount, 51.2);
            assert.equal(inv.onOrder, 24);

            inv = await buy.inventory(s, knob, w.site);
            assert.equal(inv.quantity, 20);
            assert.equal(inv.totalValue.amount, 28);
            assert.equal(inv.onOrder, 0);

            // Receiving does not change the item's standard cost
            let item = await s.read("Product", hinge.id);
            assert.equal(item.materialCost.amount, 3.2);
        });

        it("receipt data then offers only lines still open",
                async function () {
            let data = await buy.receiptData(s, po.id, {1: 24});
            assert.equal(data.lines.length, 1);
            assert.equal(data.lines[0].purchaseOrderLine.id, po.lines[0].id);
        });

        it("receiving the remainder closes the order", async function () {
            let rcpt2 = await buy.receive(s, po.id, {1: 24});
            assert.equal(rcpt2.status, "R");
            assert.notEqual(rcpt2.number, rcpt1.number);

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "C");
            assert.deepEqual(
                po.lines.map((l) => [l.status, l.received, l.quantity]),
                [["C", 40, 0], ["C", 20, 0]]
            );

            let tx = await buy.transactions(s, hinge);
            assert.deepEqual(
                tx.map((t) => [t.document, t.quantity, t.quantityAfter]),
                [[rcpt1.number, 16, 16], [rcpt2.number, 24, 40]]
            );
            let inv = await buy.inventory(s, hinge, w.site);
            assert.equal(inv.quantity, 40);
            assert.equal(inv.totalValue.amount, 128);
            assert.equal(inv.onOrder, 0);
        });

        it("a closed order cannot be released, unreleased or deleted",
                async function () {
            let resp = await s.raw(
                "POST",
                "/buy/change-purchase-order-status",
                {ids: [po.id], status: "A"}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /receiving history/);

            resp = await s.raw(
                "POST",
                "/buy/change-purchase-order-status",
                {ids: [po.id], status: "P"}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /receiving history/);

            resp = await s.raw("DELETE", "/data/purchase-order/" + po.id);
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /closed purchase order/);

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "C");
        });
    });

    describe("closing and deleting", function () {
        let part;

        before(async function () {
            part = await fx.purchasedItem(s, w, {cost: 5});
        });

        it("closing a backordered order closes lines and clears " +
                "on order", async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 10, price: 4.5}
            ]);
            await buy.setPoStatus(s, po.id, "A");
            await buy.receive(s, po.id, {1: 4});
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 6);

            await buy.setPoStatus(s, po.id, "C");
            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "C");
            assert.equal(po.lines[0].status, "C");
            assert.equal(po.lines[0].received, 4);

            let inv = await buy.inventory(s, part, w.site);
            assert.equal(inv.onOrder, 0);
            assert.equal(inv.quantity, 4);
        });

        it("a pending order can be deleted and its supply goes away",
                async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 3, price: 4.5}
            ]);
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 3);

            await s.remove("PurchaseOrder", po.id);
            let resp = await s.raw("GET", "/data/purchase-order/" + po.id);
            assert.ok(
                resp.status === 404 || resp.body === undefined ||
                resp.body === null || resp.body === "",
                "deleted order is gone (" + resp.status + ")"
            );
            let inv = await buy.poll(async function () {
                let i = await buy.inventory(s, part, w.site);
                return (
                    i.onOrder === 0
                    ? i
                    : false
                );
            });
            assert.ok(inv, "on order back to zero");
        });

        it("change-purchase-order-status accepts a single id like other " +
                "posting routes", {
            todo: "defect: make/do-change-purchase-order-status.js reads " +
            "obj.data.ids[i] even when only {id} is sent -> 500"
        }, async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 1, price: 1}
            ]);
            let resp = await s.raw(
                "POST",
                "/buy/change-purchase-order-status",
                {id: po.id, status: "A"}
            );
            assert.equal(resp.status, 200);
            assert.equal((await s.read("PurchaseOrder", po.id)).status, "A");
        });
    });

    describe("receiving edge cases", function () {
        let part;

        before(async function () {
            part = await fx.purchasedItem(s, w, {cost: 2});
        });

        it("over-receipt is accepted: received exceeds ordered and the " +
                "order closes", async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 5, price: 1.5}
            ]);
            await buy.setPoStatus(s, po.id, "A");
            let before = await buy.onHand(s, part, w.site);

            let rcpt = await buy.receive(s, po.id, {1: 7});
            assert.equal(rcpt.status, "R");
            assert.equal(rcpt.error, "");

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.status, "C");
            assert.deepEqual(
                [po.lines[0].received, po.lines[0].quantity,
                        po.lines[0].status],
                [7, 0, "C"]
            );
            assert.equal(await buy.onHand(s, part, w.site), before + 7);
        });

        it("receives in the purchase unit using the line ratio",
                async function () {
            let box = await fx.unit(s, "RTBOX12", "Box of 12");
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 2, price: 20, unit: box, ratio: 12}
            ]);
            // quantity is in inventory units, amount in purchase units
            assert.deepEqual(
                [po.lines[0].unit.code, po.lines[0].ratio,
                        po.lines[0].quantity, po.lines[0].amount.amount],
                ["RTBOX12", 12, 24, 40]
            );
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 24);

            await buy.setPoStatus(s, po.id, "A");
            let before = await buy.onHand(s, part, w.site);
            let rcpt = await buy.receive(s, po.id, {1: 2});
            assert.equal(rcpt.status, "R");

            let tx = await buy.transactions(s, part, [
                {property: "document", value: rcpt.number}
            ]);
            assert.equal(tx.length, 1);
            assert.equal(tx[0].quantity, 24);
            assert.equal(tx[0].totalCost.amount, 48);
            assert.equal(await buy.onHand(s, part, w.site), before + 24);

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.lines[0].received, 2);
            assert.equal(po.status, "C");
        });

        it("a receipt with no quantity does not post and stays pending",
                async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 5, price: 1}
            ]);
            await buy.setPoStatus(s, po.id, "A");
            let count = await buy.transactionCount(part);

            let rcpt = await buy.pendingReceipt(s, po.id, {});
            assert.equal(rcpt.status, "P");

            let resp = await s.raw(
                "POST",
                "/buy/post-purchase-order-receipts",
                {ids: [rcpt.id]}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /has no quantity to post/);
            assert.equal(
                (await s.read("PurchaseOrderReceipt", rcpt.id)).status,
                "P"
            );
            assert.equal(await buy.transactionCount(part), count);
        });

        it("posts a pending receipt through the route, and a second " +
                "post of it is a no-op", async function () {
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 5, price: 1}
            ]);
            await buy.setPoStatus(s, po.id, "A");
            let rcpt = await buy.pendingReceipt(s, po.id, {1: 3});
            assert.equal(rcpt.status, "P");
            assert.equal(rcpt.lines[0].quantity, 3);
            let before = await buy.onHand(s, part, w.site);
            let count = await buy.transactionCount(part);

            await s.route("/buy/post-purchase-order-receipts", {
                ids: [rcpt.id]
            });
            rcpt = await s.read("PurchaseOrderReceipt", rcpt.id);
            assert.equal(rcpt.status, "R");
            assert.equal(await buy.onHand(s, part, w.site), before + 3);
            assert.equal(await buy.transactionCount(part), count + 1);

            // Already received: filtered out by status, nothing posts
            await s.route("/buy/post-purchase-order-receipts", {
                ids: [rcpt.id]
            });
            assert.equal(await buy.onHand(s, part, w.site), before + 3);
            assert.equal(await buy.transactionCount(part), count + 1);
            po = await s.read("PurchaseOrder", po.id);
            assert.equal(po.lines[0].received, 3);
            assert.equal(po.status, "B");
        });
    });

    describe("item suppliers and planned purchases", function () {
        let part;
        let other;
        let s1;
        let s2;
        let poId;

        async function plannedPurchase(qty, price, due, extra) {
            return s.create("PlannedPurchase", Object.assign({
                item: {id: part.id},
                site: {id: w.site.id},
                orderQuantity: qty,
                // Supply quantity in inventory units, as planning sets it
                quantity: qty,
                price: fx.money(price),
                unit: {id: w.unit.id},
                ratio: 1,
                supplier: {id: s2.id},
                dueDate: due,
                startDate: fx.today()
            }, extra));
        }

        before(async function () {
            part = await fx.purchasedItem(s, w, {cost: 2});
            other = await fx.purchasedItem(s, w, {cost: 2});
            s1 = await fx.supplier(s, w);
            s2 = await fx.supplier(s, w);
            await s.update("Product", part.id, function (r) {
                r.suppliers.push({
                    supplier: {id: s1.id},
                    isPrimary: false,
                    unit: {id: w.unit.id},
                    supplierItem: "S1-ITEM",
                    supplierDescription: "Hinge from supplier one",
                    prices: []
                }, {
                    supplier: {id: s2.id},
                    isPrimary: true,
                    unit: {id: w.unit.id},
                    supplierItem: "S2-ITEM",
                    manufacturer: "ACME",
                    manufacturerItem: "A-100",
                    prices: [{quantity: 1, price: fx.money(1.75)}]
                });
            });
        });

        it("get-item-supplier returns the primary supplier by default",
                async function () {
            let r = await s.route("/buy/get-item-supplier", {
                itemId: part.id
            });
            assert.equal(r.objectType, "ItemSupplier");
            assert.equal(r.supplier.id, s2.id);
            assert.equal(r.isPrimary, true);
            assert.equal(r.unit.id, w.unit.id);
            assert.deepEqual(
                [r.supplierItem, r.manufacturer, r.manufacturerItem],
                ["S2-ITEM", "ACME", "A-100"]
            );
            assert.deepEqual(
                r.prices.map((p) => [p.quantity, p.price.amount]),
                [[1, 1.75]]
            );
        });

        it("get-item-supplier returns the requested supplier",
                async function () {
            let r = await s.route("/buy/get-item-supplier", {
                itemId: part.id,
                supplierId: s1.id
            });
            assert.equal(r.supplier.id, s1.id);
            assert.equal(r.supplierItem, "S1-ITEM");
            assert.equal(r.supplierDescription, "Hinge from supplier one");
        });

        it("get-item-supplier answers empty when nothing matches",
                async function () {
            let cases = [
                {itemId: part.id, supplierId: "no-such-supplier"},
                {itemId: other.id},
                {itemId: "no-such-item"}
            ];
            let i = 0;
            while (i < cases.length) {
                let resp = await s.raw(
                    "POST",
                    "/buy/get-item-supplier",
                    cases[i]
                );
                assert.equal(resp.status, 204, JSON.stringify(cases[i]));
                assert.ok(!resp.body);
                i += 1;
            }
        });

        it("a planned purchase prices itself and counts as on order",
                async function () {
            let pp = await plannedPurchase(6, 1.75, fx.today(10));
            pp = await s.read("PlannedPurchase", pp.id);
            assert.match(pp.number, /^PL-\d+$/);
            assert.equal(pp.amount.amount, 10.5);
            assert.equal(pp.quantity, 6);
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 6);

            let resp = await s.raw("POST", "/data/planned-purchase", {
                item: {id: part.id},
                site: {id: w.site.id},
                orderQuantity: 0,
                price: fx.money(1),
                unit: {id: w.unit.id},
                ratio: 1
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /greater than zero/);
        });

        it("convert-planned-purchase builds a pending order from the " +
                "supplier and deletes the planned orders", async function () {
            let pp1 = (await s.list("PlannedPurchases", {
                filter: {criteria: [{property: "item.id", value: part.id}]}
            }))[0];
            let pp2 = await plannedPurchase(4, 2, fx.today(8), {
                supplierItem: "S2-ITEM"
            });

            // UI sends ids in selection order
            poId = await s.route("/buy/convert-planned-purchase", {
                ids: [pp1.id, pp2.id],
                supplierId: s2.id,
                purchaseOrderId: null,
                feather: "PurchaseOrder"
            });
            assert.equal(typeof poId, "string");

            let po = await s.read("PurchaseOrder", poId);
            assert.equal(po.status, "P");
            assert.equal(po.supplier.id, s2.id);
            assert.equal(po.currency.code, "USD");
            assert.equal(po.terms.id, w.terms.id);
            assert.equal(po.site.id, w.site.id);
            assert.equal(po.orderDate, fx.today());
            // Earliest planned due date
            assert.equal(po.plannedDelivery, fx.today(8));
            assert.deepEqual(
                po.lines.map((l) => [
                    l.line, l.item.id, l.ordered, l.quantity, l.price.amount,
                    l.amount.amount, l.plannedDelivery, l.status
                ]),
                [
                    [1, part.id, 6, 6, 1.75, 10.5, fx.today(10), "P"],
                    [2, part.id, 4, 4, 2, 8, fx.today(8), "P"]
                ]
            );
            assert.equal(po.lines[1].supplierItem, "S2-ITEM");
            assert.equal(po.subtotal.amount, 18.5);

            let left = await s.list("PlannedPurchases", {
                filter: {criteria: [{property: "item.id", value: part.id}]}
            });
            assert.equal(left.length, 0);
            // Supply moved from planned to purchase order
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 10);
        });

        it("convert-planned-purchase can add to an existing order",
                async function () {
            let pp = await plannedPurchase(3, 1.5, fx.today(12));
            let id = await s.route("/buy/convert-planned-purchase", {
                ids: [pp.id],
                supplierId: s2.id,
                purchaseOrderId: poId,
                feather: "PurchaseOrder"
            });
            assert.equal(id, poId);
            let po = await s.read("PurchaseOrder", poId);
            assert.deepEqual(
                po.lines.map((l) => [l.line, l.ordered, l.number]),
                [
                    [1, 6, po.number + "\\1"],
                    [2, 4, po.number + "\\2"],
                    [3, 3, po.number + "\\3"]
                ]
            );
            assert.equal(po.subtotal.amount, 23);
            assert.equal((await buy.inventory(s, part, w.site)).onOrder, 13);
        });

        it("convert-planned-purchase refuses a closed order and unknown " +
                "planned orders", async function () {
            await buy.setPoStatus(s, poId, "C");
            let pp = await plannedPurchase(1, 1, fx.today(5));
            let resp = await s.raw("POST", "/buy/convert-planned-purchase", {
                ids: [pp.id],
                supplierId: s2.id,
                purchaseOrderId: poId
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /is closed/);
            assert.ok(await s.read("PlannedPurchase", pp.id));

            resp = await s.raw("POST", "/buy/convert-planned-purchase", {
                ids: ["no-such-planned-order"],
                supplierId: s2.id
            });
            assert.equal(resp.status, 500);
        });
    });

    describe("posting defects", function () {
        it("posting the same receipt twice concurrently posts inventory " +
                "once", {
            todo: "plan 2.3: doPostPurchaseOrderReceipts reads status " +
            "'P' before taking the lock, so both requests post"
        }, async function () {
            let part = await fx.purchasedItem(s, w, {cost: 2});
            let po = await buy.purchaseOrder(s, w, supp, [
                {item: part, ordered: 10, price: 2}
            ]);
            await buy.setPoStatus(s, po.id, "A");
            let rcpt = await buy.pendingReceipt(s, po.id, {1: 5});

            await Promise.allSettled([
                s.route("/buy/post-purchase-order-receipts", {
                    ids: [rcpt.id]
                }),
                s.route("/buy/post-purchase-order-receipts", {
                    ids: [rcpt.id]
                })
            ]);

            po = await s.read("PurchaseOrder", po.id);
            assert.equal(await buy.transactionCount(part), 1);
            assert.equal(await buy.onHand(s, part, w.site), 5);
            assert.equal(po.lines[0].received, 5);
            assert.equal(po.status, "B");
        });

        it("posting two receipts in one call posts both receipts' lines", {
            todo: "plan 2.8: line index j is not reset between receipts " +
            "in do-post-purchase-order-receipt.js, so later receipts are " +
            "marked received without posting"
        }, async function () {
            let p1Item = await fx.purchasedItem(s, w, {cost: 1});
            let p2Item = await fx.purchasedItem(s, w, {cost: 1});
            let p1 = await buy.purchaseOrder(s, w, supp, [
                {item: p1Item, ordered: 5, price: 1}
            ]);
            let p2 = await buy.purchaseOrder(s, w, supp, [
                {item: p2Item, ordered: 5, price: 1}
            ]);
            await buy.setPoStatus(s, [p1.id, p2.id], "A");
            let r1 = await buy.pendingReceipt(s, p1.id, {1: 5});
            let r2 = await buy.pendingReceipt(s, p2.id, {1: 5});

            await s.route("/buy/post-purchase-order-receipts", {
                ids: [r1.id, r2.id]
            });

            r1 = await s.read("PurchaseOrderReceipt", r1.id);
            r2 = await s.read("PurchaseOrderReceipt", r2.id);
            assert.equal(r1.status, "R");
            assert.equal(r2.status, "R");
            assert.equal(await buy.onHand(s, p1Item, w.site), 5);
            assert.equal(await buy.onHand(s, p2Item, w.site), 5);
            p2 = await s.read("PurchaseOrder", p2.id);
            assert.equal(p2.lines[0].received, 5);
            assert.equal(p2.status, "C");
        });
    });
});
