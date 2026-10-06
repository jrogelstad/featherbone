/*
    SupplyChain physical count: /count/create-physical-count,
    /count/post-physical-count and /count/print-recount.

    Creating a count builds one tag per inventory record (per location or
    trace when present) and freezes those items at the site
    (Inventory.isActiveCount). Counted quantities are entered on the tags
    the way the client does (count/module.js physCountTag.calcValues);
    posting writes "Physical Count" inventory transactions for completed
    tags with a change and releases the freeze. Only one count may be
    active in the database, so this file closes every count it opens.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const buy = require("./lib/buy");

async function activeCounts(s) {
    return s.list("PhysicalCounts", {
        filter: {criteria: [{property: "isActive", value: true}]}
    });
}

async function adjustIn(s, item, site, quantity, details) {
    let adj = await s.create("InventoryAdjustment", {
        item: {id: item.id},
        site: {id: site.id},
        quantity,
        type: "I",
        details: details || []
    });
    return buy.waitFor(s, "InventoryAdjustment", adj.id, (a) => a.isPosted);
}

// Enter a count on a tag like the client: newQuantity, quantityChange and
// values are computed client side from count (or recount) and item cost.
function enterCount(tag, qty, opts) {
    let cost = tag.item.cost.amount;
    let isRecount = Boolean(opts && opts.recount !== undefined);
    let counted = (
        isRecount
        ? opts.recount
        : qty
    );

    tag.count = qty;
    tag.isRecount = isRecount;
    tag.recount = (
        isRecount
        ? opts.recount
        : 0
    );
    tag.newQuantity = counted;
    tag.quantityChange = counted - tag.oldQuantity;
    tag.newValue = {currency: "USD", amount: counted * cost};
    tag.valueChange = {
        currency: "USD",
        amount: counted * cost - tag.oldValue.amount
    };
    tag.isComplete = !(opts && opts.incomplete);
}

describe("physical count", function () {
    let s;
    let w;
    let preexisting = false;
    let opened = [];

    function guard(t) {
        if (preexisting) {
            t.skip("another physical count is already active in this database");
            return true;
        }
        return false;
    }

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
        preexisting = (await activeCounts(s)).length > 0;
    });

    after(async function () {
        // Never leave a count open: it blocks every other count and freezes
        // inventory for other test files.
        let i = 0;
        while (i < opened.length) {
            let pc = await s.read("PhysicalCount", opened[i]);
            if (pc && pc.isActive) {
                await s.route("/count/post-physical-count", {id: pc.id});
            }
            i += 1;
        }
    });

    describe("site without locations", function () {
        let hinge;
        let knob;
        let screw;
        let finish;
        let empty;
        let pc;
        let blocked;

        before(async function () {
            if (preexisting) {
                return;
            }
            hinge = await fx.purchasedItem(s, w, {prefix: "HINGE", cost: 2.5});
            knob = await fx.purchasedItem(s, w, {prefix: "KNOB", cost: 4});
            screw = await fx.purchasedItem(s, w, {prefix: "SCREW", cost: 0.5});
            finish = await fx.purchasedItem(s, w, {prefix: "FINISH", cost: 10});
            empty = await fx.purchasedItem(s, w, {prefix: "EMPTY", cost: 1});
            await adjustIn(s, hinge, w.site, 10);
            await adjustIn(s, knob, w.site, 5);
            await adjustIn(s, screw, w.site, 100);
            await adjustIn(s, finish, w.site, 2);
        });

        it("creates tags for inventory with quantity and freezes it",
                async function (t) {
            if (guard(t)) {
                return;
            }
            let msg = await s.route("/count/create-physical-count", {
                site: {id: w.site.id},
                description: "Regression count",
                hasQuantity: true,
                startTagNr: 100
            });
            assert.equal(msg, "Physical count created successfully");

            let counts = await activeCounts(s);
            assert.equal(counts.length, 1);
            pc = counts[0];
            opened.push(pc.id);
            assert.match(pc.number, /^PC-\d+$/);
            assert.equal(pc.description, "Regression count");
            assert.equal(pc.site.id, w.site.id);
            assert.equal(pc.isActive, true);
            assert.equal(pc.closedTime, null);

            // Sorted by item number; zero quantity item left out
            let tags = pc.tags.slice().sort((a, b) => a.number - b.number);
            assert.deepEqual(
                tags.map((g) => [
                    g.number, g.item.id, g.oldQuantity, g.oldValue.amount,
                    g.quantityChange, g.valueChange.amount, g.count,
                    g.isComplete
                ]),
                [
                    [100, finish.id, 2, 20, -2, -20, 0, false],
                    [101, hinge.id, 10, 25, -10, -25, 0, false],
                    [102, knob.id, 5, 20, -5, -20, 0, false],
                    [103, screw.id, 100, 50, -100, -50, 0, false]
                ]
            );
            let inv = await buy.inventory(s, hinge, w.site);
            assert.equal(tags[1].inventory.id, inv.id);
            assert.equal(inv.isActiveCount, true);
            assert.equal(
                (await buy.inventory(s, empty, w.site)).isActiveCount,
                false
            );
        });

        it("refuses a second active count", async function (t) {
            if (guard(t)) {
                return;
            }
            let resp = await s.raw("POST", "/count/create-physical-count", {
                site: {id: w.site.id}
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /Active count must be closed/);
        });

        it("blocks transactions on counted items while active",
                async function (t) {
            if (guard(t)) {
                return;
            }
            blocked = await s.create("InventoryAdjustment", {
                item: {id: hinge.id},
                site: {id: w.site.id},
                quantity: 1,
                type: "I",
                details: []
            });
            let resp = await buy.postRoute(
                s,
                "/stock/post-inventory-adjustments",
                {ids: [blocked.id]}
            );
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /active inventory count/);
            assert.equal(
                (await s.read("InventoryAdjustment", blocked.id)).isPosted,
                false
            );
            assert.equal(await buy.onHand(s, hinge, w.site), 10);

            // Items outside the count still transact
            await adjustIn(s, empty, w.site, 1);
            assert.equal(await buy.onHand(s, empty, w.site), 1);
        });

        it("print-recount validates its input", async function (t) {
            if (guard(t)) {
                return;
            }
            let resp = await s.raw("POST", "/count/print-recount", {ids: []});
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /A count Id must be provided/);

            resp = await s.raw("POST", "/count/print-recount", {
                ids: [pc.id],
                form: "Print Physical Recount"
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /No tags flagged for recount/);
        });

        it("saves counts entered on tags", async function (t) {
            if (guard(t)) {
                return;
            }
            pc = await s.update("PhysicalCount", pc.id, function (r) {
                r.tags.forEach(function (g) {
                    if (g.item.id === hinge.id) {
                        enterCount(g, 12);
                    } else if (g.item.id === knob.id) {
                        enterCount(g, 4, {recount: 3});
                    } else if (g.item.id === screw.id) {
                        enterCount(g, 100); // No change
                    } else if (g.item.id === finish.id) {
                        enterCount(g, 0, {incomplete: true});
                    }
                });
            });
            let byItem = {};
            pc.tags.forEach((g) => (byItem[g.item.id] = g));
            assert.deepEqual(
                [
                    byItem[hinge.id].newQuantity,
                    byItem[hinge.id].quantityChange,
                    byItem[hinge.id].valueChange.amount
                ],
                [12, 2, 5]
            );
            assert.deepEqual(
                [
                    byItem[knob.id].isRecount,
                    byItem[knob.id].recount,
                    byItem[knob.id].quantityChange
                ],
                [true, 3, -2]
            );
            assert.equal(byItem[finish.id].isComplete, false);
        });

        it("print-recount prints tags flagged for recount",
                async function (t) {
            if (guard(t)) {
                return;
            }
            let forms = await s.list("PrintForms", {
                filter: {criteria: [
                    {property: "name", value: "Print Physical Recount"}
                ]},
                properties: ["name"]
            });
            if (!forms.length) {
                t.skip("Print Physical Recount form not installed");
                return;
            }
            let file = await s.route("/count/print-recount", {
                ids: [pc.id],
                form: "Print Physical Recount"
            });
            assert.equal(file, pc.number + ".pdf");

            let resp = await s.raw("POST", "/count/print-recount", {
                ids: [pc.id],
                form: "No such form"
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /not found/);
        });

        it("posting writes adjustments for completed tags with a change " +
                "and closes the count", async function (t) {
            if (guard(t)) {
                return;
            }
            let msg = await s.route("/count/post-physical-count", {
                id: pc.id
            });
            assert.equal(msg, "Physical count posted successfully");

            pc = await s.read("PhysicalCount", pc.id);
            assert.equal(pc.isActive, false);
            assert.ok(pc.closedTime, "closed time set");

            let tagNr = {};
            pc.tags.forEach((g) => (tagNr[g.item.id] = g.number));

            let tx = await buy.transactions(s, hinge, [
                {property: "type", value: "Physical Count"}
            ]);
            assert.equal(tx.length, 1);
            assert.deepEqual(
                [
                    tx[0].document, tx[0].reference, tx[0].quantity,
                    tx[0].quantityBefore, tx[0].quantityAfter,
                    tx[0].totalCost.amount, tx[0].date
                ],
                [
                    pc.number, pc.number + "\\" + tagNr[hinge.id], 2, 10,
                    12, 5, fx.today()
                ]
            );
            tx = await buy.transactions(s, knob, [
                {property: "type", value: "Physical Count"}
            ]);
            assert.deepEqual(
                tx.map((x) => [x.quantity, x.totalCost.amount]),
                [[-2, -8]]
            );

            // No change and incomplete tags do not post
            assert.equal(await buy.transactionCount(screw), 1);
            assert.equal(await buy.transactionCount(finish), 1);

            assert.equal(await buy.onHand(s, hinge, w.site), 12);
            assert.equal(await buy.onHand(s, knob, w.site), 3);
            assert.equal(await buy.onHand(s, screw, w.site), 100);
            assert.equal(await buy.onHand(s, finish, w.site), 2);

            let inv = await buy.inventory(s, hinge, w.site);
            assert.equal(inv.isActiveCount, false);
            assert.equal(inv.lastCount, fx.today());
            assert.equal(inv.totalValue.amount, 30);
            inv = await buy.inventory(s, finish, w.site);
            assert.equal(inv.isActiveCount, false);
            assert.equal(inv.lastCount, fx.today());
        });

        it("a closed count cannot be posted or printed again",
                async function (t) {
            if (guard(t)) {
                return;
            }
            let resp = await s.raw("POST", "/count/post-physical-count", {
                id: pc.id
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /is not active/);
            resp = await s.raw("POST", "/count/print-recount", {
                ids: [pc.id],
                form: "Print Physical Recount"
            });
            assert.equal(resp.status, 500);
            assert.match(String(resp.body), /not active/);
            assert.equal(await buy.onHand(s, hinge, w.site), 12);
        });

        it("a transaction held back by the count posts afterwards",
                async function (t) {
            if (guard(t)) {
                return;
            }
            await s.route("/stock/post-inventory-adjustments", {
                ids: [blocked.id]
            });
            assert.equal(
                (await s.read("InventoryAdjustment", blocked.id)).isPosted,
                true
            );
            assert.equal(await buy.onHand(s, hinge, w.site), 13);
        });
    });

    describe("location controlled site", function () {
        let lc;
        let bin1;
        let bin2;
        let part;
        let pc;

        before(async function () {
            if (preexisting) {
                return;
            }
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
            part = await fx.purchasedItem(
                s,
                Object.assign({}, w, {site: lc}),
                {cost: 3}
            );
            await adjustIn(s, part, lc, 10, [
                {quantity: 6, location: {id: bin1.id}},
                {quantity: 4, location: {id: bin2.id}}
            ]);
        });

        it("creates one tag per location for a single item",
                async function (t) {
            if (guard(t)) {
                return;
            }
            await s.route("/count/create-physical-count", {
                site: {id: lc.id},
                item: {id: part.id}
            });
            pc = (await activeCounts(s))[0];
            opened.push(pc.id);
            assert.equal(pc.site.id, lc.id);
            let tags = pc.tags.slice().sort((a, b) => a.number - b.number);
            assert.equal(tags[0].number, 1);
            assert.deepEqual(
                tags.map((g) => [g.item.id, g.oldQuantity]).sort(
                    (a, b) => b[1] - a[1]
                ),
                [[part.id, 6], [part.id, 4]]
            );
            let bins = tags.map((g) => g.location.id).sort();
            assert.deepEqual(bins, [bin1.id, bin2.id].sort());
        });

        it("posting adjusts only the counted location", async function (t) {
            if (guard(t)) {
                return;
            }
            pc = await s.update("PhysicalCount", pc.id, function (r) {
                r.tags.forEach(function (g) {
                    enterCount(g, (
                        g.location.id === bin1.id
                        ? 5
                        : 4
                    ));
                });
            });
            await s.route("/count/post-physical-count", {id: pc.id});

            let tx = await buy.transactions(s, part, [
                {property: "type", value: "Physical Count"}
            ]);
            assert.deepEqual(
                tx.map((x) => [x.quantity, x.location.id]),
                [[-1, bin1.id]]
            );
            let inv = await buy.inventory(s, part, lc);
            assert.equal(inv.quantity, 9);
            let locs = {};
            inv.locations.forEach((l) => (locs[l.location.id] = l.quantity));
            assert.equal(locs[bin1.id], 5);
            assert.equal(locs[bin2.id], 4);
        });
    });
});
