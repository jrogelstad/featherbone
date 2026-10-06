/*
    SupplyChain stock: inventory adjustments, moves and stock routes.

    InventoryAdjustment and MoveInventory records auto-post after commit
    (triggers-inventory-adjustment.js, triggers-move-inventory.js), and can
    be posted again through /stock/post-inventory-adjustments and
    /stock/post-move-inventory. Posting creates InventoryTransaction rows
    valued at the item's standard cost and updates Inventory (quantity,
    values, locations). Also covers /stock/get-site-data and
    /stock/get-ship-container-number.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const buy = require("./lib/buy");

// Create an adjustment the way the client saves it and wait for the
// background post. type "I" = in, "O" = out.
async function adjust(s, item, site, type, quantity, details, comments) {
    let adj = await s.create("InventoryAdjustment", {
        item: {id: item.id},
        site: {id: site.id},
        quantity,
        type,
        comments: comments || "",
        details: details || []
    });
    return buy.waitFor(s, "InventoryAdjustment", adj.id, (a) => a.isPosted);
}

describe("inventory", function () {
    let s;
    let w;

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
    });

    describe("adjustments at a site without locations", function () {
        let part;

        before(async function () {
            part = await fx.purchasedItem(s, w, {cost: 2.5});
        });

        it("a new item starts with an empty inventory record",
                async function () {
            let inv = await buy.inventory(s, part, w.site);
            assert.ok(inv, "inventory record created with the item site");
            assert.equal(inv.status, "A");
            assert.equal(inv.quantity, 0);
            assert.equal(inv.totalValue.amount, 0);
            assert.equal(inv.isActiveCount, false);
            assert.equal(inv.number, "(" + w.site.code + ") " + part.number);
        });

        it("adjusting in auto-posts: transaction and on-hand at " +
                "standard cost", async function () {
            let adj = await adjust(s, part, w.site, "I", 8, [], "found");
            assert.match(adj.number, /^ADJ-\d+$/);
            assert.equal(adj.isPosted, true);
            assert.equal(adj.postedDate, fx.today());

            let tx = await buy.transactions(s, part);
            assert.equal(tx.length, 1);
            assert.deepEqual(
                [
                    tx[0].type, tx[0].document, tx[0].reference,
                    tx[0].quantity, tx[0].quantityBefore,
                    tx[0].quantityAfter, tx[0].comments, tx[0].date
                ],
                [
                    "Adjustment", adj.number, adj.number, 8, 0, 8,
                    "found", fx.today()
                ]
            );
            assert.equal(tx[0].materialCost.amount, 20);
            assert.equal(tx[0].totalCost.amount, 20);
            assert.match(tx[0].number, /^T\d+$/);

            let inv = await buy.inventory(s, part, w.site);
            assert.equal(inv.quantity, 8);
            assert.equal(inv.available, 8);
            assert.equal(inv.materialValue.amount, 20);
            assert.equal(inv.totalValue.amount, 20);
            assert.equal(inv.projected, 8);
        });

        it("adjusting out reduces on-hand and value", async function () {
            let adj = await adjust(s, part, w.site, "O", 3);
            let tx = await buy.transactions(s, part, [
                {property: "document", value: adj.number}
            ]);
            assert.equal(tx.length, 1);
            assert.equal(tx[0].quantity, -3);
            assert.equal(tx[0].quantityBefore, 8);
            assert.equal(tx[0].quantityAfter, 5);
            assert.equal(tx[0].totalCost.amount, -7.5);

            let inv = await buy.inventory(s, part, w.site);
            assert.equal(inv.quantity, 5);
            assert.equal(inv.totalValue.amount, 12.5);
        });

        it("adjusting out below zero is allowed and raises a critical " +
                "alert", async function () {
            await adjust(s, part, w.site, "O", 7);
            let inv = await buy.inventory(s, part, w.site);
            assert.equal(inv.quantity, -2);
            assert.equal(inv.available, -2);
            assert.equal(inv.totalValue.amount, -5);

            let found = await buy.poll(async function () {
                let rows = await buy.alerts(inv.id);
                return rows.find((r) => r.severity === "Critical");
            });
            assert.ok(found, "critical inventory alert");
            assert.equal(found.category, "Inventory");
            assert.match(found.message, /has dropped below zero to -2/);
        });

        it("adjusting back in from negative restores value",
                async function () {
            await adjust(s, part, w.site, "I", 4);
            let inv = await buy.inventory(s, part, w.site);
            assert.equal(inv.quantity, 2);
            assert.equal(inv.totalValue.amount, 5);
            assert.equal(await buy.transactionCount(part), 4);
        });

        it("posting an already posted adjustment again is a no-op",
                async function () {
            let adj = await adjust(s, part, w.site, "I", 1);
            let count = await buy.transactionCount(part);
            let resp = await s.raw(
                "POST",
                "/stock/post-inventory-adjustments",
                {ids: [adj.id]}
            );
            assert.ok(resp.status < 300, "status " + resp.status);
            assert.equal(await buy.transactionCount(part), count);
            assert.equal(await buy.onHand(s, part, w.site), 3);
        });

        it("a zero quantity adjustment saves but never posts",
                async function () {
            let count = await buy.transactionCount(part);
            let adj = await s.create("InventoryAdjustment", {
                item: {id: part.id},
                site: {id: w.site.id},
                quantity: 0,
                type: "I",
                details: []
            });
            let resp = await buy.postRoute(
                s,
                "/stock/post-inventory-adjustments",
                {ids: [adj.id]}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /greater than zero/);
            adj = await s.read("InventoryAdjustment", adj.id);
            assert.equal(adj.isPosted, false);
            assert.equal(await buy.transactionCount(part), count);
        });

        it("transactions are read only over the data API",
                async function () {
            // InventoryTransaction is a read-only feather: the server
            // registers only GET for it, so writes are 404 (the module's
            // PATCH/DELETE triggers are a second line of defence).
            let tx = await buy.transactions(s, part);
            let resp = await s.raw(
                "PATCH",
                "/data/inventory-transaction/" + tx[0].id,
                [{op: "replace", path: "/quantity", value: 99}]
            );
            assert.equal(resp.status, 404);
            resp = await s.raw(
                "DELETE",
                "/data/inventory-transaction/" + tx[0].id
            );
            assert.equal(resp.status, 404);
            resp = await s.raw("POST", "/data/inventory-transaction", {
                item: {id: part.id},
                site: {id: w.site.id},
                quantity: 100
            });
            assert.equal(resp.status, 404);
            let again = await s.read("InventoryTransaction", tx[0].id);
            assert.equal(again.quantity, tx[0].quantity);
            assert.equal(await buy.onHand(s, part, w.site), 3);
        });
    });

    describe("location controlled site", function () {
        let lc;
        let wlc;
        let bin1;
        let bin2;
        let part;

        function byBin(inv) {
            let ret = {};
            inv.locations.forEach(function (l) {
                ret[
                    l.location.id === bin1.id
                    ? "bin1"
                    : (
                        l.location.id === bin2.id
                        ? "bin2"
                        : l.location.id
                    )
                ] = l.quantity;
            });
            return ret;
        }

        before(async function () {
            bin1 = await fx.location(s);
            bin2 = await fx.location(s);
            let addr = await fx.address(s);
            lc = await s.create("Site", {
                code: fx.uniq("LC"),
                description: "Location controlled warehouse",
                address: {id: addr.id},
                locationControlled: true,
                defaultLocation: {id: bin1.id},
                defaultReceiveLocation: {id: bin1.id},
                defaultShipLocation: {id: bin1.id},
                defaultWipLocation: {id: bin1.id}
            });
            wlc = Object.assign({}, w, {site: lc});
            part = await fx.purchasedItem(s, wlc, {cost: 4});
        });

        it("get-site-data returns the site with its locations",
                async function () {
            let site = await s.route("/stock/get-site-data", {id: lc.id});
            assert.equal(site.id, lc.id);
            assert.equal(site.code, lc.code);
            assert.equal(site.locationControlled, true);
            assert.equal(site.defaultLocation.id, bin1.id);
            assert.equal(site.defaultReceiveLocation.id, bin1.id);
        });

        it("an adjustment needs detail rows per location",
                async function () {
            let adj = await s.create("InventoryAdjustment", {
                item: {id: part.id},
                site: {id: lc.id},
                quantity: 1,
                type: "I",
                details: []
            });
            let resp = await buy.postRoute(
                s,
                "/stock/post-inventory-adjustments",
                {ids: [adj.id]}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /requires detail records/);
            assert.equal(
                (await s.read("InventoryAdjustment", adj.id)).isPosted,
                false
            );
        });

        it("adjusting in by location posts one transaction per detail",
                async function () {
            let adj = await adjust(s, part, lc, "I", 10, [
                {quantity: 6, location: {id: bin1.id}},
                {quantity: 4, location: {id: bin2.id}}
            ]);
            let tx = await buy.transactions(s, part, [
                {property: "document", value: adj.number}
            ]);
            assert.deepEqual(
                tx.map((t) => [
                    t.quantity,
                    t.location.id === bin1.id,
                    t.totalCost.amount
                ]).sort((a, b) => b[0] - a[0]),
                [[6, true, 24], [4, false, 16]]
            );
            let inv = await buy.inventory(s, part, lc);
            assert.equal(inv.quantity, 10);
            assert.equal(inv.available, 10);
            assert.deepEqual(byBin(inv), {bin1: 6, bin2: 4});
        });

        it("moving inventory between locations auto-posts and keeps " +
                "the total", async function () {
            let mv = await s.create("MoveInventory", {
                item: {id: part.id},
                site: {id: lc.id},
                quantity: 5,
                fromLocation: {id: bin1.id},
                toLocation: {id: bin2.id},
                date: fx.today()
            });
            mv = await buy.waitFor(
                s,
                "MoveInventory",
                mv.id,
                (m) => m.status === "C"
            );
            assert.equal(mv.status, "C");
            assert.match(mv.number, /^MV-\d+$/);

            let inv = await buy.inventory(s, part, lc);
            assert.equal(inv.quantity, 10);
            assert.equal(inv.totalValue.amount, 40);
            assert.deepEqual(byBin(inv), {bin1: 1, bin2: 9});

            let tx = await buy.transactions(s, part, [
                {property: "type", value: "Move Inventory"}
            ]);
            assert.deepEqual(
                tx.map((t) => [
                    t.quantity,
                    t.location.id === bin1.id
                    ? "bin1"
                    : "bin2",
                    t.reference,
                    t.totalCost.amount
                ]).sort((a, b) => a[0] - b[0]),
                [
                    [-5, "bin1", mv.number, -20],
                    [5, "bin2", mv.number, 20]
                ]
            );
        });

        it("both move transactions carry the move number as document", {
            todo: "defect: do-post-move-inventory.js sets document only " +
            "on the outbound leg; the inbound transaction has document ''"
        }, async function () {
            let tx = await buy.transactions(s, part, [
                {property: "type", value: "Move Inventory"}
            ]);
            assert.equal(tx.length, 2);
            assert.equal(tx[0].document, tx[0].reference);
            assert.equal(tx[1].document, tx[1].reference);
        });

        it("moving the whole quantity out of a location drops it",
                async function () {
            let mv = await s.create("MoveInventory", {
                item: {id: part.id},
                site: {id: lc.id},
                quantity: 1,
                fromLocation: {id: bin1.id},
                toLocation: {id: bin2.id},
                date: fx.today()
            });
            await buy.waitFor(s, "MoveInventory", mv.id,
                    (m) => m.status === "C");
            let inv = await buy.inventory(s, part, lc);
            assert.deepEqual(byBin(inv), {bin2: 10});
        });

        it("adjusting out by location reduces that location",
                async function () {
            await adjust(s, part, lc, "O", 3, [
                {quantity: 3, location: {id: bin2.id}}
            ]);
            let inv = await buy.inventory(s, part, lc);
            assert.equal(inv.quantity, 7);
            assert.deepEqual(byBin(inv), {bin2: 7});
        });

        it("a move at a site without locations saves but does not post",
                async function () {
            let plain = await fx.purchasedItem(s, w, {cost: 1});
            let mv = await s.create("MoveInventory", {
                item: {id: plain.id},
                site: {id: w.site.id},
                quantity: 1,
                fromLocation: {id: bin1.id},
                toLocation: {id: bin2.id},
                date: fx.today()
            });
            let resp = await buy.postRoute(
                s,
                "/stock/post-move-inventory",
                {ids: [mv.id]}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /not locaton controlled/);
            assert.equal((await s.read("MoveInventory", mv.id)).status, "P");
            assert.equal(await buy.transactionCount(plain), 0);
        });
    });

    describe("stock routes", function () {
        it("get-ship-container-number hands out sequential numbers",
                async function () {
            let a = await s.route("/stock/get-ship-container-number", {});
            let b = await s.route("/stock/get-ship-container-number", {});
            // Fresh demo: "000001", "000002" (autoNumber ShipmentContainer)
            let na = /^(\D*)(\d+)(\D*)$/.exec(a);
            let nb = /^(\D*)(\d+)(\D*)$/.exec(b);
            assert.ok(na && nb, a + ", " + b);
            assert.equal(nb[1], na[1]);
            assert.equal(Number(nb[2]), Number(na[2]) + 1);
            assert.equal(b.length, a.length);
        });

        it("get-site-data returns nothing for an unknown id",
                async function () {
            let resp = await s.raw("POST", "/stock/get-site-data", {
                id: "no-such-site"
            });
            assert.ok(resp.status < 300, "status " + resp.status);
            assert.ok(!resp.body, "empty body");
        });
    });
});
