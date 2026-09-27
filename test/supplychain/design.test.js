/*
    SupplyChain Design: bill of material, unit conversions, cost roll-up
    and the proposed cost workflow, indented BOM / where-used, BOM cycle
    detection (design/*.js routes and product triggers).

    Costing oracle: John's demo item 2-CABIN-CABINET-ASSY rolls up to
    material 116.60, labor 30.00, overhead 5.00, total 151.60. Its
    varathane line is 12 floz of an item stocked in gallons (ratio
    1/128); the item is not fractional, so 0.09375 gal rounds up to one
    $55 gallon.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fx = require("../harness/fixtures");
const {signedIn} = require("../harness/http");
const mk = require("./lib/make");

const {r2} = mk;

function assertFailed(resp, pattern) {
    assert.ok(
        resp.status >= 400,
        "expected failure, got " + resp.status + " " +
        JSON.stringify(resp.body)
    );
    assert.match(
        typeof resp.body === "string"
        ? resp.body
        : JSON.stringify(resp.body),
        pattern
    );
}

function costOf(pc) {
    return {
        material: r2(pc.materialCost.amount),
        labor: r2(pc.laborCost.amount),
        overhead: r2(pc.overheadCost.amount),
        service: r2(pc.serviceCost.amount),
        total: r2(pc.totalCost.amount)
    };
}

const DEMO_COST = {
    material: 116.6,
    labor: 30,
    overhead: 5,
    service: 0,
    total: 151.6
};
const ZERO_COST = {material: 0, labor: 0, overhead: 0, service: 0, total: 0};

describe("design: bill of material and costing", function () {
    let s;
    let w;
    let cabA; // proposed cost workflow
    let cabB; // immediate update
    let cabC; // inside the camper
    let seat;
    let door;
    let camper;

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
        cabA = await mk.demoCabinet(s, w);
        cabB = await mk.demoCabinet(s, w);
        cabC = await mk.demoCabinet(s, w);
        seat = await mk.product(s, w, {
            source: "M",
            prefix: "SEAT",
            components: [{item: cabC.plywood, quantityPer: 0.5}],
            operations: [{description: "Build", runRate: 1, labor: w.labor}]
        });
        door = await mk.product(s, w, {
            source: "M",
            prefix: "DOOR",
            eoq: 5,
            itemSite: {planningPolicy: "L"},
            components: [{item: cabC.hinge, quantityPer: 2}]
        });
        camper = await mk.product(s, w, {
            source: "M",
            prefix: "CAMPER",
            isSold: true,
            components: [
                {item: cabC.assy, quantityPer: 2},
                {item: seat, quantityPer: 1},
                {item: door, quantityPer: 1},
                {item: cabC.screw, quantityPer: 10, fixedQuantity: 5}
            ],
            operations: [{description: "Final", runRate: 2, labor: w.labor}]
        });
    });

    after(async function () {
        // Never leave approved proposals behind: they block every later
        // roll-up in the database ("There are approved proposed costs")
        let approved = await s.findBy("ProposedCosts", "status", "A");
        let i = 0;
        while (i < approved.length) {
            await s.remove("ProposedCost", approved[i].id);
            i += 1;
        }
    });

    describe("bill of material", function () {
        it("stores the varathane line in floz with the client-computed " +
                "ratio 1/128", async function () {
            let line = cabA.assy.billOfMaterialItems[4];

            assert.equal(cabA.ratio, 0.0078125);
            assert.equal(line.item.id, cabA.varathane.id);
            assert.equal(line.unit.code, "floz");
            assert.equal(line.quantityPer, 12);
            assert.equal(line.ratio, 0.0078125);
        });

        it("/design/get-item-conversions returns the item conversions",
                async function () {
            let convs = await s.route(
                "/design/get-item-conversions",
                {id: cabA.varathane.id}
            );

            assert.equal(convs.length, 1);
            assert.equal(convs[0].fromUnit.id, cabA.floz.id);
            assert.equal(convs[0].toUnit.id, cabA.gal.id);
            assert.equal(convs[0].ratio, 128);
        });

        it("/design/get-item-bom returns the lines in sequence",
                async function () {
            let bom = await s.route("/design/get-item-bom", {id: cabA.assy.id});

            assert.deepEqual(
                bom.map((b) => [b.sequence, b.item.id, b.quantityPer]),
                [
                    [1, cabA.plywood.id, 0.25],
                    [2, cabA.hinge.id, 8],
                    [3, cabA.knob.id, 4],
                    [4, cabA.screw.id, 20],
                    [5, cabA.varathane.id, 12]
                ]
            );
        });

        it("/design/get-item-sites returns the item sites", async function () {
            let sites = await s.route(
                "/design/get-item-sites",
                {id: cabA.assy.id}
            );

            assert.equal(sites.length, 1);
            assert.equal(sites[0].site.id, w.site.id);
            assert.equal(sites[0].isPrimary, true);
            assert.equal(sites[0].planningPolicy, "M");
        });

        it("/design/get-item-operation-bom answers with the operation BOM", {
            todo: "defect: route registered in design/routes.json but " +
                    "doGetItemOperationBom is not defined (500)"
        }, async function () {
            let resp = await s.raw(
                "POST",
                "/design/get-item-operation-bom",
                {id: cabA.assy.id}
            );

            assert.equal(resp.status, 200);
            assert.ok(Array.isArray(resp.body));
        });

        it("resequences BOM lines and defaults the planning policy on save",
                async function () {
            let part = cabA.knob;
            let p = await s.create("Product", {
                number: fx.uniq("RESEQ"),
                description: "Resequence check",
                unit: fx.ref(w.unit),
                site: fx.ref(w.site),
                trace: "N",
                isFractional: false,
                type: "I",
                source: "M",
                status: "A",
                materialCost: fx.money(0),
                laborCost: fx.money(0),
                overheadCost: fx.money(0),
                serviceCost: fx.money(0),
                sites: [{site: fx.ref(w.site), isPrimary: true}],
                conversions: [],
                documents: [],
                suppliers: [],
                billOfMaterialItems: [{
                    sequence: 20, item: fx.ref(part), quantityPer: 2,
                    fixedQuantity: 0, unit: fx.ref(w.unit), ratio: 1,
                    operation: 0
                }, {
                    sequence: 10, item: fx.ref(cabA.screw), quantityPer: 3,
                    fixedQuantity: 0, unit: fx.ref(w.unit), ratio: 1,
                    operation: 0
                }],
                operations: []
            });
            p = await s.read("Product", p.id);

            // Renumbered 1..n by sequence; array order is as sent
            assert.deepEqual(
                p.billOfMaterialItems.map((b) => [b.sequence, b.item.id]),
                [[2, part.id], [1, cabA.screw.id]]
            );
            assert.equal(p.sites[0].planningPolicy, "M");
        });

        it("rejects a BOM that contains its own parent (cycle)",
                async function () {
            let resp = await s.raw(
                "PATCH",
                "/data/product/" + cabC.assy.id,
                [{
                    op: "add",
                    path: "/billOfMaterialItems/5",
                    value: {
                        sequence: 6, item: fx.ref(camper), quantityPer: 1,
                        fixedQuantity: 0, unit: fx.ref(w.unit), ratio: 1,
                        operation: 0
                    }
                }]
            );

            assertFailed(resp, /Self-referencing cycle detected on/);
            let p = await s.read("Product", cabC.assy.id);
            assert.equal(p.billOfMaterialItems.length, 5);
        });

        it("rejects a product on its own BOM", async function () {
            let resp = await s.raw(
                "PATCH",
                "/data/product/" + cabC.assy.id,
                [{
                    op: "add",
                    path: "/billOfMaterialItems/5",
                    value: {
                        sequence: 6, item: fx.ref(cabC.assy), quantityPer: 1,
                        fixedQuantity: 0, unit: fx.ref(w.unit), ratio: 1,
                        operation: 0
                    }
                }]
            );

            assertFailed(
                resp,
                new RegExp("Self-referencing cycle detected on " +
                        cabC.assy.number)
            );
        });
    });

    describe("indented bill of material and where used", function () {
        it("explodes every level with per-parent quantities and costs",
                async function () {
            let rows = await s.route(
                "/design/print-indented-bom",
                {itemId: camper.id}
            );
            let num = (r) => r.product.number.split("-")[0];

            assert.deepEqual(
                rows.map((r) => [r.level, num(r), r.quantityPer,
                        r.fixedQuantity, Number(r.ratio)]),
                [
                    [0, "CAMPER", 1, 0, 1],
                    [1, "CABINET", 2, 0, 1],
                    [2, "PLYWOOD", 0.25, 0, 1],
                    [2, "HINGE", 8, 0, 1],
                    [2, "KNOB", 4, 0, 1],
                    [2, "SCREW", 20, 0, 1],
                    [2, "VARATHANE", 12, 0, 0.0078125],
                    [1, "SEAT", 1, 0, 1],
                    [2, "PLYWOOD", 0.5, 0, 1],
                    [1, "DOOR", 1, 0, 1],
                    [2, "HINGE", 2, 0, 1],
                    [1, "SCREW", 10, 5, 1]
                ]
            );
            assert.equal(rows[0].id, camper.id);
            assert.equal(rows[0].product.id, camper.id);
            assert.equal(rows[1].unit.code, "ea");
            assert.equal(rows[6].unit.code, "floz");
            assert.ok(rows.every((r) => r.cycle === false));
            // Line cost = component cost x quantity per x ratio, NOT
            // extended by the parent quantity and not rounded to whole
            // units (the roll-up charges a whole gallon of varathane)
            assert.deepEqual(
                rows.slice(2, 7).map((r) => r2(r.materialCost.amount)),
                [30, 25.6, 5.6, 0.4, 5.16]
            );
            assert.equal(r2(rows[8].totalCost.amount), 60);
        });

        it("uses the product EOQ as top quantity when asked",
                async function () {
            let rows = await s.route(
                "/design/print-indented-bom",
                {itemId: door.id, useEoq: true}
            );

            assert.equal(rows[0].quantityPer, 5);
            assert.equal(rows[1].quantityPer, 2);
            assert.equal(r2(rows[1].materialCost.amount), 32);
        });

        it("costs a fixed-quantity line as cost x (qty per + fixed)", {
            todo: "defect: do-indented-bill-of-material.js calcCost adds " +
                    "fixedQuantity to the cost amount instead of the quantity"
        }, async function () {
            let rows = await s.route(
                "/design/print-indented-bom",
                {itemId: camper.id}
            );
            let screw = rows[rows.length - 1];

            // 0.02 x (10 + 5); currently 0.02 x 10 + 5 = 5.20
            assert.equal(r2(screw.materialCost.amount), 0.3);
        });

        it("lists where a component is used, parents indented under it",
                async function () {
            let rows = await s.route(
                "/design/print-indented-where-used",
                {itemId: cabC.hinge.id}
            );

            assert.deepEqual(
                rows.map((r) => [r.level, r.product.id, r.quantityPer]),
                [
                    [0, cabC.assy.id, 8],
                    [1, camper.id, 2],
                    [0, door.id, 2],
                    [1, camper.id, 1]
                ]
            );
        });

        it("flattens where used to the sold end items", async function () {
            let rows = await s.route(
                "/design/print-indented-where-used",
                {itemId: cabC.hinge.id, flatten: true}
            );

            assert.deepEqual(rows.map((r) => r.product.id), [camper.id]);
        });
    });

    describe("cost roll-up", function () {
        it("previews the demo cabinet as a pending proposed cost",
                async function () {
            let resp = await mk.rollUp(s, cabA.assy.id, false);

            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            let pcs = await mk.proposedCosts(s, cabA.assy.id);
            assert.equal(pcs.length, 1);
            assert.equal(pcs[0].status, "P");
            assert.deepEqual(costOf(pcs[0]), DEMO_COST);
            // Item cost untouched until the proposal is applied
            assert.deepEqual(await mk.costsOf(s, cabA.assy.id), ZERO_COST);
        });

        it("updates costs immediately with autoUpdate and logs a standard " +
                "cost update for stock on hand", async function () {
            await mk.receiveStock(s, w, cabB.assy, 2);
            let resp = await mk.rollUp(s, cabB.assy.id, true);

            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            assert.deepEqual(await mk.costsOf(s, cabB.assy.id), DEMO_COST);
            assert.equal(
                (await mk.proposedCosts(s, cabB.assy.id)).length,
                0
            );
            let txs = await mk.transactions(cabB.assy.id);
            let upd = txs.filter((t) => t.type === "Standard Cost Update");
            assert.equal(upd.length, 1);
            assert.equal(upd[0].quantity, 0);
            assert.equal(upd[0].document, cabB.assy.number);
        });

        it("rolls up a multi-level BOM bottom-up", async function () {
            let resp = await mk.rollUp(s, camper.id, false);

            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            let costs = {};
            let items = {camper, cabinet: cabC.assy, seat, door};
            let names = Object.keys(items);
            let i = 0;
            while (i < names.length) {
                let pcs = await mk.proposedCosts(s, items[names[i]].id);
                assert.equal(pcs.length, 1, names[i]);
                costs[names[i]] = costOf(pcs[0]);
                i += 1;
            }

            assert.deepEqual(costs.cabinet, DEMO_COST);
            assert.deepEqual(costs.seat, {
                material: 60, labor: 30, overhead: 0, service: 0, total: 90
            });
            // EOQ 5: 10 hinges per 5 doors
            assert.deepEqual(costs.door, {
                material: 6.4, labor: 0, overhead: 0, service: 0, total: 6.4
            });
            // Sub-assembly cost categories carry into the parent:
            // 2 cabinets + seat + door + 15 screws; labor 2x30 + 30 + 2h
            assert.deepEqual(costs.camper, {
                material: 299.9,
                labor: 150,
                overhead: 10,
                service: 0,
                total: 459.9
            });
        });

        it("rejects inactive components and inactive or expense items",
                async function () {
            let part = await mk.product(s, w, {prefix: "OLDPART", cost: 1});
            let assy = await mk.product(s, w, {
                source: "M",
                prefix: "OLDASSY",
                components: [{item: part, quantityPer: 1}]
            });
            let expense = await mk.product(s, w, {
                prefix: "EXPENSE", type: "E", source: "M"
            });

            await s.update("Product", part.id, function (p) {
                p.status = "I";
            });
            try {
                assertFailed(
                    await mk.rollUp(s, assy.id, false),
                    new RegExp("Product " + assy.number + " has an inactive " +
                            "product " + part.number + " on its bill of " +
                            "materials")
                );
                assertFailed(
                    await mk.rollUp(s, part.id, false),
                    /Cannot roll cost on inactive items/
                );
                assertFailed(
                    await mk.rollUp(s, expense.id, false),
                    /Cannot roll cost on expense items/
                );
            } finally {
                // An inactive component anywhere blocks roll-up of all
                await s.update("Product", part.id, function (p) {
                    p.status = "A";
                });
            }
        });

        it("allows one roll-up at a time per database (global wip guard)",
                async function () {
            // do-roll-up-costs.js keeps a module-level `wip` flag keyed by
            // database: a second roll-up while one runs is refused, even
            // for an unrelated item.
            let resps = await Promise.all([
                mk.rollUp(s, camper.id, false),
                mk.rollUp(s, camper.id, false),
                mk.rollUp(s, cabA.assy.id, false),
                mk.rollUp(s, door.id, false)
            ]);
            let ok = resps.filter((r) => r.status < 300);
            let refused = resps.filter((r) => r.status >= 300);

            assert.ok(ok.length >= 1, "at least one roll-up runs");
            refused.forEach(function (r) {
                assert.match(
                    JSON.stringify(r.body),
                    /Cost rollup already in process/
                );
            });
            // The guard is released afterwards
            let again = await mk.rollUp(s, door.id, false);
            assert.ok(again.status < 300, JSON.stringify(again.body));
        });
    });

    describe("proposed cost workflow", function () {
        let pc;

        it("approves selected proposals", async function () {
            pc = (await mk.proposedCosts(s, cabA.assy.id))[0];
            let msg = await s.route(
                "/design/approve-proposed-costs",
                {ids: [pc.id]}
            );

            assert.equal(msg, "Proposal(s) approved");
            pc = await s.read("ProposedCost", pc.id);
            assert.equal(pc.status, "A");
            assert.deepEqual(await mk.costsOf(s, cabA.assy.id), ZERO_COST);
        });

        it("blocks roll-ups while any proposal is approved but not applied",
                async function () {
            assertFailed(
                await mk.rollUp(s, door.id, false),
                /There are approved proposed costs for manufactured items/
            );
        });

        it("applies approved proposals to the item", async function () {
            let msg = await s.route(
                "/design/update-proposed-costs",
                {ids: [pc.id]}
            );

            assert.equal(msg, "Item(s) updated with proposed costs");
            pc = await s.read("ProposedCost", pc.id);
            assert.equal(pc.status, "U");
            assert.deepEqual(await mk.costsOf(s, cabA.assy.id), DEMO_COST);
        });

        it("freezes an applied proposal", async function () {
            let resp = await s.raw(
                "PATCH",
                "/data/proposed-cost/" + pc.id,
                [{op: "replace", path: "/materialCost/amount", value: 1}]
            );

            assertFailed(resp, /Cost is updated, record is frozen/);
        });

        it("proposes nothing when the rolled cost equals the item cost",
                async function () {
            let resp = await mk.rollUp(s, cabA.assy.id, false);

            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            let pcs = await mk.proposedCosts(s, cabA.assy.id);
            assert.deepEqual(pcs.map((p) => p.status), ["U"]);
        });

        it("proposes a change when a component cost changes",
                async function () {
            await s.update("Product", cabA.hinge.id, function (p) {
                p.materialCost.amount = 4;
            });
            let resp = await mk.rollUp(s, cabA.assy.id, false);
            assert.ok(resp.status < 300, JSON.stringify(resp.body));

            let pending = (await mk.proposedCosts(s, cabA.assy.id)).filter(
                (p) => p.status === "P"
            );
            assert.equal(pending.length, 1);
            // 8 hinges x $0.80 more
            assert.deepEqual(costOf(pending[0]), {
                material: 123,
                labor: 30,
                overhead: 5,
                service: 0,
                total: 158
            });
        });

        it("withdraws the pending proposal when the change is reverted", {
            todo: "defect: do-roll-up-costs.js pushes a plain DELETE " +
                    "payload (not a request) when the item already has the " +
                    "rolled cost, so the stale proposal stays pending"
        }, async function () {
            await s.update("Product", cabA.hinge.id, function (p) {
                p.materialCost.amount = 3.2;
            });
            let resp = await mk.rollUp(s, cabA.assy.id, false);
            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            let pcs = await mk.proposedCosts(s, cabA.assy.id);
            assert.deepEqual(pcs.map((p) => p.status), ["U"]);
        });

        it("applies a proposal saved with status U through the data API",
                async function () {
            let seatPc = (await mk.proposedCosts(s, seat.id))[0];

            await s.patch("ProposedCost", seatPc.id, [
                {op: "replace", path: "/status", value: "U"}
            ]);
            assert.deepEqual(await mk.costsOf(s, seat.id), {
                material: 60, labor: 30, overhead: 0, service: 0, total: 90
            });
        });
    });

    describe("failed roll-up", function () {
        let sub;
        let top;

        // A two-level assembly whose top item has stock in an active
        // physical count: the roll-up updates the sub-assembly first, then
        // fails posting the top item's "Standard Cost Update" transaction.
        before(async function () {
            let part = await mk.product(s, w, {prefix: "RAIL", cost: 7});
            sub = await mk.product(s, w, {
                source: "M",
                prefix: "FRAME",
                components: [{item: part, quantityPer: 2}]
            });
            top = await mk.product(s, w, {
                source: "M",
                prefix: "BUNK",
                components: [{item: sub, quantityPer: 1}]
            });
            await mk.receiveStock(s, w, top, 1);
            await s.create("PhysicalCount", {
                description: "Freeze " + top.number,
                site: fx.ref(w.site),
                tags: [{item: fx.ref(top), count: 0}]
            });
            let inv = await s.findBy("Inventories", "item.id", top.id);
            assert.equal(inv[0].isActiveCount, true);
        });

        it("rolls back every item when one item fails (single item)",
                async function () {
            let resp = await mk.rollUp(s, top.id, true);

            assertFailed(resp, /active inventory count/);
            assert.deepEqual(await mk.costsOf(s, sub.id), ZERO_COST);
            assert.deepEqual(await mk.costsOf(s, top.id), ZERO_COST);
        });

        it("rolls back every item when one item fails (all items)", {
            todo: "plan 2.1: roll-up of all items sends an un-awaited " +
                    "'DELETE ...; COMMIT;' mid-transaction, so items " +
                    "updated before the failure stay updated"
        }, async function () {
            // Rolls up every manufactured item in the database
            let resp = await s.raw("POST", "/design/roll-up-costs", {
                autoUpdate: true,
                subscription: {id: fx.uniq("SUB"), eventKey: fx.uniq("EK")}
            });

            assert.ok(resp.status >= 400, "roll-up fails");
            assert.deepEqual(await mk.costsOf(s, sub.id), ZERO_COST);
        });

        it("still accepts roll-ups after a failure", async function () {
            let resp = await mk.rollUp(s, sub.id, false);
            assert.ok(resp.status < 300, JSON.stringify(resp.body));
        });
    });
});
