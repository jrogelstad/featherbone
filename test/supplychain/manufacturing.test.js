/*
    SupplyChain Make: work order flows (make/*.js routes and triggers).

    Modeled on the demo, where 19 work orders went through to status C
    with every operation and requirement closed: create (auto-explode),
    plan supply, release, manual issue, operation completions, receipts
    with backflush, complete and close. Also holds (recursive through
    make-to-order children), indented work order / plan, planned work
    order conversion, and posting races.

    Issues, operation completions, receipts and the explode of a new work
    order are posted by the server after commit, so the helpers in
    lib/make.js poll the document and then wait for the server to go
    quiet before asserting.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
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

function sumOfParts(costs) {
    return r2(costs.material + costs.labor + costs.overhead + costs.service);
}

function req(wo, item) {
    return wo.materials.find((m) => m.item.id === item.id);
}

describe("manufacturing: work orders", function () {
    let s;
    let w;
    let cab;
    const COMPONENTS = ["plywood", "hinge", "knob", "screw", "varathane"];

    before(async function () {
        s = await signedIn();
        await fx.configure(s);
        w = await fx.world(s);
        await mk.employee(s, settings.adminUser);
        // Plywood is issued by hand, everything else is backflushed
        cab = await mk.demoCabinet(s, w, {issueMethods: {plywood: "M"}});
        let i = 0;
        while (i < COMPONENTS.length) {
            await mk.receiveStock(s, w, cab[COMPONENTS[i]], 100);
            i += 1;
        }
    });

    describe("lifecycle of a demo cabinet work order (qty 2)", function () {
        let wo;
        let snapshots = [];

        function snap(label, rec) {
            snapshots.push({label, costs: mk.actualCosts(rec)});
        }

        it("is created unexploded and exploded by the server after commit",
                async function () {
            let created = await mk.createWorkOrder(s, w, cab.assy, 2);

            assert.equal(created.status, "U");
            assert.deepEqual(created.materials, []);
            wo = await mk.waitExploded(s, created.id);

            assert.equal(wo.status, "P");
            assert.equal(wo.error, "");
            assert.match(wo.number, /^W-\d+$/);
            assert.equal(wo.quantity, 2);
            assert.deepEqual(
                wo.materials.map((m) => [
                    m.number, m.item.id, m.quantityPer, m.ratio,
                    m.unit.id, m.required, m.quantityDue, m.status
                ]),
                [
                    [wo.number + ".1", cab.plywood.id, 0.25, 1,
                            w.unit.id, 0.5, 0.5, "P"],
                    [wo.number + ".2", cab.hinge.id, 8, 1,
                            w.unit.id, 16, 16, "P"],
                    [wo.number + ".3", cab.knob.id, 4, 1,
                            w.unit.id, 8, 8, "P"],
                    [wo.number + ".4", cab.screw.id, 20, 1,
                            w.unit.id, 40, 40, "P"],
                    // 24 floz = 0.1875 gal, rounded up to whole gallons
                    [wo.number + ".5", cab.varathane.id, 12, 0.0078125,
                            cab.floz.id, 1, 1, "P"]
                ]
            );
            assert.deepEqual(
                wo.operations.map((o) => [
                    o.number, o.description, o.planned, o.runTime,
                    o.setupTime, o.status
                ]),
                [
                    [wo.number + "#1", "Cut", 2, 0.5, 0.25, "P"],
                    [wo.number + "#2", "Assemble", 2, 0.5, 0, "P"],
                    [wo.number + "#3", "Varnish", 2, 0.5, 0, "P"]
                ]
            );
            assert.deepEqual(
                {
                    material: r2(wo.estimatedMaterialCost.amount),
                    labor: r2(wo.estimatedLaborCost.amount),
                    overhead: r2(wo.estimatedOverheadCost.amount),
                    service: r2(wo.estimatedServiceCost.amount),
                    total: r2(wo.estimatedTotalCost.amount)
                },
                {
                    material: 178.2,
                    labor: 52.5,
                    overhead: 7.5,
                    service: 0,
                    total: 238.2
                }
            );
        });

        it("allocates stock to every requirement after exploding",
                async function () {
            let i = 0;
            let mtl;
            let alcs;

            assert.equal(wo.planStatus, "I");
            while (i < wo.materials.length) {
                mtl = wo.materials[i];
                i += 1;
                assert.equal(mtl.allocated, mtl.required, mtl.number);
                alcs = await mk.allocations(mtl.id);
                assert.deepEqual(
                    alcs.map((a) => [a.supplyType, a.quantity, a.isFirm]),
                    [["Inventory", mtl.required, false]],
                    mtl.number
                );
            }
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                16
            );
        });

        it("re-explodes a pending work order on request, dropping its " +
                "allocations until supply is planned again",
                async function () {
            let oldIds = wo.materials.map((m) => m.id);
            let msg = await s.route(
                "/make/explode-work-order",
                {ids: [wo.id]}
            );

            assert.equal(msg, "Work Order(s) exploded");
            await mk.quiesce();
            wo = await s.read("WorkOrder", wo.id);
            assert.equal(wo.status, "P");
            assert.equal(wo.planStatus, "U");
            assert.deepEqual(
                wo.materials.map((m) => [m.required, m.allocated]),
                [[0.5, 0], [16, 0], [8, 0], [40, 0], [1, 0]]
            );
            assert.ok(wo.materials.every((m) => !oldIds.includes(m.id)));
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                0
            );

            msg = await s.route("/make/plan-work-order-supply", {id: wo.id});
            assert.equal(msg, "Work order supply planned");
            await mk.quiesce();
            wo = await s.read("WorkOrder", wo.id);
            assert.equal(wo.planStatus, "I");
            assert.deepEqual(
                wo.materials.map((m) => m.allocated),
                [0.5, 16, 8, 40, 1]
            );
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                16
            );
        });

        it("releases: status A down to requirements and operations",
                async function () {
            wo = await mk.release(s, wo.id);

            assert.deepEqual(mk.statusOf(wo), {
                status: "A",
                materials: ["A", "A", "A", "A", "A"],
                operations: ["A", "A", "A"]
            });
            assert.deepEqual(
                wo.operations.map((o) => o.available),
                [2, 0, 0]
            );
        });

        it("offers only manually issued materials for issue",
                async function () {
            let data = await s.route(
                "/make/get-work-order-issue-data",
                {id: wo.id}
            );

            assert.equal(data.id, wo.id);
            assert.equal(data.status, "A");
            assert.equal(data.onHold, false);
            assert.equal(data.site.id, w.site.id);
            assert.deepEqual(
                data.materials.map((m) => m.item.id),
                [cab.plywood.id]
            );
        });

        it("issues plywood by hand", async function () {
            let plywood = req(wo, cab.plywood);
            let iss = await mk.issueMaterials(s, wo.id, [
                {requirement: plywood, quantity: 0.5}
            ]);

            assert.equal(iss.status, "I");
            assert.equal(iss.error, "");
            assert.match(iss.number, /^WI-\d+$/);
            wo = await s.read("WorkOrder", wo.id);
            plywood = req(wo, cab.plywood);
            assert.equal(wo.status, "I");
            assert.equal(plywood.issued, 0.5);
            assert.equal(plywood.status, "C");
            assert.equal(plywood.quantityDue, 0);
            assert.equal(r2(plywood.actualCost.amount), 60);
            assert.deepEqual(mk.actualCosts(wo), {
                material: 60, labor: 0, overhead: 0, service: 0, total: 60
            });

            let txs = await mk.transactions(
                cab.plywood.id,
                {document: iss.number}
            );
            assert.deepEqual(
                txs.map((t) => [t.type, t.reference, t.quantity]),
                [["Work Order Issue", plywood.number, -0.5]]
            );
            // Closed requirement gives its allocation back
            assert.deepEqual(await mk.allocations(plywood.id), []);
            assert.deepEqual(
                await mk.inventory(cab.plywood.id, w.site.id),
                {quantity: 99.5, allocated: 0, available: 99.5}
            );
            snap("issue", wo);
        });

        it("posts a completion of the first operation with setup and run " +
                "cost", async function () {
            let oc = await mk.completeOperation(s, wo.operations[0], 2);

            assert.equal(oc.isPosted, true);
            assert.equal(oc.error, "");
            assert.match(oc.number, /^OC-\d+$/);
            wo = await s.read("WorkOrder", wo.id);
            assert.deepEqual(
                wo.operations.map((o) => [o.completed, o.remaining, o.status]),
                [[2, 0, "C"], [0, 2, "A"], [0, 2, "A"]]
            );
            // (0.25 setup + 2 x 0.25 run) x $30 labor, x $10 overhead
            assert.equal(r2(wo.actualLaborCost.amount), 22.5);
            assert.equal(r2(wo.actualOverheadCost.amount), 7.5);
            // Materials with no operation are not backflushed here
            assert.equal(req(wo, cab.hinge).issued, 0);
            snap("operation 1", wo);
        });

        it("posts a completion of the second operation", async function () {
            let oc = await mk.completeOperation(s, wo.operations[1], 2);

            assert.equal(oc.isPosted, true);
            wo = await s.read("WorkOrder", wo.id);
            assert.deepEqual(
                wo.operations.map((o) => [o.completed, o.status]),
                [[2, "C"], [2, "C"], [0, "A"]]
            );
            assert.equal(r2(wo.actualLaborCost.amount), 37.5);
            assert.equal(r2(wo.actualOverheadCost.amount), 7.5);
            snap("operation 2", wo);
        });

        it("receives one cabinet, completing the last operation and " +
                "backflushing materials", async function () {
            let rcpt = await mk.receiveWorkOrder(s, wo, 1);

            assert.equal(rcpt.status, "R");
            assert.equal(rcpt.error, "");
            assert.match(rcpt.number, /^RC-\d+$/);
            wo = await s.read("WorkOrder", wo.id);
            assert.equal(wo.status, "I");
            assert.equal(wo.received, 1);
            assert.equal(wo.quantity, 1);
            assert.deepEqual(
                wo.operations.map((o) => [o.completed, o.status]),
                [[2, "C"], [2, "C"], [1, "I"]]
            );
            assert.deepEqual(
                wo.materials.map((m) => [m.issued, m.status]),
                [[0.5, "C"], [8, "I"], [4, "I"], [20, "I"], [1, "C"]]
            );
            assert.equal(r2(wo.actualLaborCost.amount), 45);

            let txs = await mk.transactions(
                cab.assy.id,
                {document: rcpt.number}
            );
            assert.deepEqual(
                txs.map((t) => [t.type, t.reference, t.quantity]),
                [["Work Order Receipt", wo.number, 1]]
            );
            txs = await mk.transactions(
                cab.hinge.id,
                {document: rcpt.number}
            );
            assert.deepEqual(
                txs.map((t) => [t.type, t.reference, t.quantity]),
                [["Work Order Issue", wo.number + ".2", -8]]
            );
            assert.equal(await mk.onHand(cab.assy.id, w.site.id), 1);
            assert.equal(await mk.onHand(cab.hinge.id, w.site.id), 92);
            assert.equal(await mk.onHand(cab.varathane.id, w.site.id), 99);
            snap("receipt 1", wo);
        });

        it("completes the rest and closes the work order automatically",
                async function () {
            let resp = await s.raw(
                "POST",
                "/make/complete-work-order",
                {ids: [wo.id]}
            );

            // Only creates the receipt; it posts after commit
            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            wo = await mk.poll(async function () {
                let r = await s.read("WorkOrder", wo.id);
                return r.status === "C" && !r.lock && r;
            });
            assert.ok(wo, "work order closed");
            await mk.quiesce();
            wo = await s.read("WorkOrder", wo.id);

            assert.deepEqual(mk.statusOf(wo), {
                status: "C",
                materials: ["C", "C", "C", "C", "C"],
                operations: ["C", "C", "C"]
            });
            assert.equal(wo.received, 2);
            assert.equal(wo.quantity, 0);
            assert.equal(wo.closeDate, fx.today());
            assert.deepEqual(
                wo.materials.map((m) => [m.issued, m.quantityDue]),
                [[0.5, 0], [16, 0], [8, 0], [40, 0], [1, 0]]
            );
            let receipts = (await mk.transactions(cab.assy.id)).filter(
                (t) => t.type === "Work Order Receipt"
            );
            assert.deepEqual(receipts.map((t) => t.quantity), [1, 1]);

            let onHand = {};
            let i = 0;
            while (i < COMPONENTS.length) {
                onHand[COMPONENTS[i]] = await mk.onHand(
                    cab[COMPONENTS[i]].id,
                    w.site.id
                );
                assert.equal(
                    (await mk.inventory(cab[COMPONENTS[i]].id, w.site.id))
                        .allocated,
                    0,
                    COMPONENTS[i] + " allocation released"
                );
                i += 1;
            }
            assert.deepEqual(onHand, {
                plywood: 99.5,
                hinge: 84,
                knob: 92,
                screw: 60,
                varathane: 99
            });
            assert.equal(await mk.onHand(cab.assy.id, w.site.id), 2);
            snap("closed", wo);
        });

        it("ends with actual costs equal to the standard for what was " +
                "used", {
            todo: "plan 2.4: receipt backflush adds item cost AND " +
                    "material cost; totals re-add cumulative amounts"
        }, function () {
            assert.deepEqual(mk.actualCosts(wo), {
                material: 178.2,
                labor: 52.5,
                overhead: 7.5,
                service: 0,
                total: 238.2
            });
        });

        it("keeps actual total = material + labor + overhead + service " +
                "after every posting", {
            todo: "plan 2.4: operation completion and receipt add the " +
                    "cumulative component costs onto the previous total"
        }, function () {
            snapshots.forEach(function (snp) {
                assert.equal(
                    snp.costs.total,
                    sumOfParts(snp.costs),
                    snp.label + ": " + JSON.stringify(snp.costs)
                );
            });
        });

        it("records actual labor and overhead on each operation", {
            todo: "defect: no posting writes WorkOrderOperation " +
                    "actualLaborCost/actualOverheadCost (always 0)"
        }, function () {
            assert.deepEqual(
                wo.operations.map((o) => [
                    r2(o.actualLaborCost.amount),
                    r2(o.actualOverheadCost.amount)
                ]),
                [[22.5, 7.5], [15, 0], [15, 0]]
            );
        });
    });

    describe("receipt backflush of a component with service cost",
            function () {
        let wo;

        before(async function () {
            let part = await mk.product(s, w, {
                prefix: "TREATED", cost: 2, serviceCost: 1
            });
            let kit = await mk.product(s, w, {
                source: "M",
                prefix: "TRIM",
                components: [{item: part, quantityPer: 1}]
            });
            await mk.receiveStock(s, w, part, 10);
            wo = await mk.workOrder(s, w, kit, 1);
            wo = await mk.release(s, wo.id);
            await mk.receiveWorkOrder(s, wo, 1);
            wo = await s.read("WorkOrder", wo.id);
        });

        it("closes the work order on full receipt", function () {
            assert.equal(wo.status, "C");
            assert.equal(wo.received, 1);
            assert.deepEqual(wo.materials.map((m) => m.issued), [1]);
        });

        it("costs the backflush at material 2 + service 1", {
            todo: "plan 2.4: do-post-work-order-receipts.js doubles " +
                    "material and writes matcst into actualServiceCost"
        }, function () {
            assert.deepEqual(mk.actualCosts(wo), {
                material: 2, labor: 0, overhead: 0, service: 1, total: 3
            });
        });
    });

    describe("allocations on manual issue and return", function () {
        let wo;
        let part;
        let assy;

        before(async function () {
            part = await mk.product(s, w, {
                prefix: "BRACKET", cost: 3.2, itemSite: {issueMethod: "M"}
            });
            assy = await mk.product(s, w, {
                source: "M",
                prefix: "SHELF",
                components: [{item: part, quantityPer: 8}]
            });
            await mk.receiveStock(s, w, part, 100);
            wo = await mk.workOrder(s, w, assy, 4);
            wo = await mk.release(s, wo.id);
        });

        it("relieves the allocation by the quantity issued", {
            // plan 2.5: do-post-work-order-issue.js only relieves when
            // txtype === "issue", which never matches ("issued"); the
            // work order update trigger (handleAllocations) trims the
            // over-allocation instead, so the end state is right today.
        }, async function () {
            let mtl = wo.materials[0];

            assert.equal(mtl.allocated, 32);
            await mk.issueMaterials(s, wo.id, [
                {requirement: mtl, quantity: 10}
            ]);
            wo = await s.read("WorkOrder", wo.id);
            mtl = wo.materials[0];

            assert.equal(mtl.issued, 10);
            assert.equal(mtl.quantityDue, 22);
            assert.equal(mtl.allocated, 22);
            assert.deepEqual(
                (await mk.allocations(mtl.id)).map((a) => a.quantity),
                [22]
            );
            assert.deepEqual(
                await mk.inventory(part.id, w.site.id),
                {quantity: 90, allocated: 22, available: 90}
            );
            assert.equal(r2(wo.actualMaterialCost.amount), 32);
        });

        it("posts a negative issue as a return and re-allocates",
                async function () {
            let mtl = wo.materials[0];
            let iss = await mk.issueMaterials(s, wo.id, [
                {requirement: mtl, quantity: -2}
            ]);

            assert.equal(iss.status, "I");
            wo = await s.read("WorkOrder", wo.id);
            mtl = wo.materials[0];
            assert.equal(mtl.issued, 10);
            assert.equal(mtl.returned, 2);
            assert.equal(mtl.quantityDue, 24);
            assert.equal(mtl.allocated, 24);
            assert.equal(r2(wo.actualMaterialCost.amount), 25.6);
            let txs = await mk.transactions(part.id, {document: iss.number});
            assert.deepEqual(
                txs.map((t) => [t.type, t.quantity]),
                [["Work Order Return", 2]]
            );
            assert.deepEqual(
                await mk.inventory(part.id, w.site.id),
                {quantity: 92, allocated: 24, available: 92}
            );
        });
    });

    describe("posting races", function () {
        let widget;

        before(async function () {
            let pin = await mk.product(s, w, {prefix: "PIN", cost: 1});
            widget = await mk.product(s, w, {
                source: "M",
                prefix: "WIDGET",
                components: [{item: pin, quantityPer: 1}],
                operations: [{
                    description: "Press", runRate: 1, labor: w.labor
                }]
            });
            await mk.receiveStock(s, w, pin, 100);
        });

        it("posts a work order receipt once when posted concurrently", {
            todo: "plan 2.3: do-post-work-order-receipts.js reads status " +
                    "P before taking the lock, so each caller posts again"
        }, async function () {
            let wo = await mk.workOrder(s, w, widget, 3);
            wo = await mk.release(s, wo.id);
            let rcpt = await mk.receiveWorkOrder(s, wo, 1, {noWait: true});

            // The save auto-posts after commit; the client "Post" action
            // can race it
            await Promise.all([
                s.raw("POST", "/make/post-work-order-receipts", {
                    ids: [rcpt.id]
                }),
                s.raw("POST", "/make/post-work-order-receipts", {
                    ids: [rcpt.id]
                })
            ]);
            await mk.poll(async function () {
                let r = await s.read("WorkOrderReceipt", rcpt.id);
                return r.status === "R";
            });
            await mk.quiesce();
            rcpt = await s.read("WorkOrderReceipt", rcpt.id);
            wo = await s.read("WorkOrder", wo.id);

            let txs = await mk.transactions(
                widget.id,
                {document: rcpt.number}
            );
            assert.equal(txs.length, 1, "one receipt transaction");
            assert.equal(wo.received, 1);
            assert.equal(wo.status, "I");
        });

        it("refuses to post an operation completion twice", {
            todo: "plan 2.3: post-operation-completion.js never checks " +
                    "isPosted, so re-posting reports the quantity again"
        }, async function () {
            let wo = await mk.workOrder(s, w, widget, 3);
            wo = await mk.release(s, wo.id);
            let oc = await mk.completeOperation(s, wo.operations[0], 1);
            assert.equal(oc.isPosted, true);

            let resp = await s.raw(
                "POST",
                "/make/post-operation-completion",
                {id: oc.id}
            );
            await mk.quiesce();
            wo = await s.read("WorkOrder", wo.id);

            assert.ok(resp.status >= 400, "second post refused");
            assert.equal(wo.operations[0].completed, 1);
            assert.equal(wo.received, 1);
        });
    });

    describe("make-to-order children and holds", function () {
        let panel;
        let bolt;
        let seat;
        let camper;
        let wo;
        let child;

        before(async function () {
            panel = await mk.product(s, w, {prefix: "PANEL", cost: 12});
            bolt = await mk.product(s, w, {
                prefix: "BOLT", cost: 0.1, itemSite: {issueMethod: "M"}
            });
            // Make-to-order (planning policy M): exploding the parent
            // creates a firm child work order
            seat = await mk.product(s, w, {
                source: "M",
                prefix: "SEAT",
                components: [{item: panel, quantityPer: 2}],
                operations: [{
                    description: "Upholster", runRate: 1, labor: w.labor
                }]
            });
            camper = await mk.product(s, w, {
                source: "M",
                prefix: "CAMPER",
                components: [
                    {item: seat, quantityPer: 1},
                    {item: bolt, quantityPer: 10}
                ],
                operations: [{
                    description: "Final", runRate: 2, labor: w.labor
                }]
            });
            await mk.receiveStock(s, w, panel, 20);
            await mk.receiveStock(s, w, bolt, 100);
            wo = await mk.workOrder(s, w, camper, 1);
            let alcs = await mk.allocations(req(wo, seat).id);
            child = await s.read("WorkOrder", alcs[0].supplyId);
        });

        it("explodes a firm child work order with dash numbers",
                async function () {
            let base = wo.number.slice(0, wo.number.lastIndexOf("-"));
            let alcs = await mk.allocations(req(wo, seat).id);

            assert.equal(wo.status, "P");
            assert.match(wo.number, /^W-\d+-1$/);
            assert.equal(child.number, base + "-2");
            assert.equal(child.item.id, seat.id);
            assert.equal(child.ordered, 1);
            assert.equal(child.status, "P");
            assert.deepEqual(
                alcs.map((a) => [a.supplyType, a.quantity, a.isFirm]),
                [["WorkOrder", 1, true]]
            );
            assert.deepEqual(
                child.materials.map((m) => [m.item.id, m.required]),
                [[panel.id, 2]]
            );
        });

        it("prints the indented work order with the child inline",
                async function () {
            let rows = await s.route(
                "/make/print-indented-work-order",
                {id: wo.id}
            );

            assert.deepEqual(
                rows.map((r) => [
                    r.level, r.objectType, r.number.number, r.quantity
                ]),
                [
                    [0, "WorkOrder", wo.number, 1],
                    [1, "WorkOrder", child.number, 1],
                    [2, "WorkOrderRequirement", child.number + ".1", 2],
                    [2, "WorkOrderOperation", child.number + "#1", 1],
                    [1, "WorkOrderRequirement", wo.number + ".2", 10],
                    [1, "WorkOrderOperation", wo.number + "#1", 1]
                ]
            );
        });

        it("returns the work order plan with the child linked to the " +
                "parent", async function () {
            let rows = await s.route("/make/get-work-order-plan", {id: wo.id});

            assert.equal(rows[0].level, 0);
            assert.equal(rows[0].number.number, wo.number);
            assert.equal(rows[0].objectType, "WorkOrder");
            assert.equal(rows[1].level, 1);
            assert.equal(rows[1].number.number, child.number);
            assert.deepEqual(rows[1].links, [{target: wo.id, type: "FS"}]);
            assert.deepEqual(
                [...new Set(rows.map((r) => r.objectType))].sort(),
                ["WorkOrder", "WorkOrderOperation", "WorkOrderRequirement"]
            );
        });

        it("puts the order and its firm children on hold (recursive)",
                async function () {
            let msg = await s.route("/make/hold", {
                workOrderId: wo.id, hold: true, recursive: true
            });

            assert.equal(msg, "Work order(s) put on hold");
            let p = await s.read("WorkOrder", wo.id);
            let c = await s.read("WorkOrder", child.id);
            assert.equal(p.onHold, true);
            assert.equal(c.onHold, true);
            assert.ok(p.operations.every((o) => o.onHold));
            assert.ok(c.operations.every((o) => o.onHold));
        });

        it("refuses status changes while on hold", async function () {
            let resp = await s.raw("PATCH", "/data/work-order/" + wo.id, [
                {op: "replace", path: "/status", value: "A"}
            ]);

            assertFailed(
                resp,
                /Status cannot be changed because the order is on hold/
            );
        });

        it("takes the order and its children off hold (recursive)",
                async function () {
            let msg = await s.route("/make/hold", {
                workOrderId: wo.id, hold: false, recursive: true
            });

            assert.equal(msg, "Work order(s) taken off hold");
            let p = await s.read("WorkOrder", wo.id);
            let c = await s.read("WorkOrder", child.id);
            assert.equal(p.onHold, false);
            assert.equal(c.onHold, false);
            assert.ok(c.operations.every((o) => !o.onHold));
        });

        it("holds only the order itself when not recursive",
                async function () {
            await s.route("/make/hold", {
                workOrderId: wo.id, hold: true, recursive: false
            });
            let p = await s.read("WorkOrder", wo.id);
            let c = await s.read("WorkOrder", child.id);

            assert.equal(p.onHold, true);
            assert.equal(c.onHold, false);
            await s.route("/make/hold", {
                workOrderId: wo.id, hold: false, recursive: false
            });
        });

        describe("transactions against a released order on hold",
                function () {
            let iss;

            before(async function () {
                wo = await mk.release(s, wo.id);
                await s.route("/make/hold", {
                    workOrderId: wo.id, hold: true
                });
                wo = await s.read("WorkOrder", wo.id);
                assert.equal(wo.status, "A");
                assert.equal(wo.onHold, true);
            });

            it("rejects operation completions", async function () {
                let oc = await mk.completeOperation(s, wo.operations[0], 1);

                assert.equal(oc.isPosted, false);
                assert.equal(
                    oc.error,
                    "Order is on hold and cannot be transacted against"
                );
                let p = await s.read("WorkOrder", wo.id);
                assert.equal(p.operations[0].completed, 0);
            });

            it("rejects receipts", async function () {
                let rcpt = await mk.receiveWorkOrder(s, wo, 1);

                assert.equal(rcpt.status, "P");
                assert.equal(
                    rcpt.error,
                    "Order is on hold and cannot be transacted against"
                );
                let p = await s.read("WorkOrder", wo.id);
                assert.equal(p.received, 0);
            });

            it("leaves issues unposted", async function () {
                iss = await s.create("WorkOrderIssue", {
                    date: fx.today(),
                    workOrder: {id: wo.id},
                    materials: [{
                        materialRequirement: {id: req(wo, bolt).id},
                        quantity: 10,
                        details: []
                    }]
                });
                await mk.quiesce();
                let resp = await s.raw(
                    "POST",
                    "/make/post-work-order-issues",
                    {ids: [iss.id]}
                );

                assertFailed(
                    resp,
                    new RegExp("Work order " + wo.number + " is on hold")
                );
                iss = await s.read("WorkOrderIssue", iss.id);
                assert.equal(iss.status, "P");
                let p = await s.read("WorkOrder", wo.id);
                assert.equal(req(p, bolt).issued, 0);
            });

            it("records why an issue failed to post", {
                todo: "defect: do-post-work-order-issue.js returns " +
                        "Promise.reject for on-hold orders inside try " +
                        "without await, skipping error/alert handling"
            }, function () {
                assert.match(iss.error, /on hold/);
            });

            it("refuses to close", async function () {
                let resp = await s.raw("POST", "/make/close-work-order", {
                    ids: [wo.id]
                });

                assertFailed(
                    resp,
                    /Status cannot be changed because the order is on hold/
                );
            });

            it("posts the pending issue once off hold", async function () {
                await s.route("/make/hold", {
                    workOrderId: wo.id, hold: false
                });
                let msg = await s.route(
                    "/make/post-work-order-issues",
                    {ids: [iss.id]}
                );

                assert.equal(msg, "Materials issued successfully");
                await mk.quiesce();
                iss = await s.read("WorkOrderIssue", iss.id);
                assert.equal(iss.status, "I");
                let p = await s.read("WorkOrder", wo.id);
                assert.equal(req(p, bolt).issued, 10);
                assert.equal(p.status, "I");
            });
        });
    });

    describe("planned work orders", function () {
        let door;
        let wall;
        let wo;
        let planned;

        before(async function () {
            let latch = await mk.product(s, w, {prefix: "LATCH", cost: 2});
            // Plan-to-order (policy L): shortages become planned orders
            door = await mk.product(s, w, {
                source: "M",
                prefix: "DOOR",
                itemSite: {planningPolicy: "L"},
                components: [{item: latch, quantityPer: 1}]
            });
            wall = await mk.product(s, w, {
                source: "M",
                prefix: "WALL",
                components: [{item: door, quantityPer: 2}]
            });
            await mk.receiveStock(s, w, latch, 10);
            wo = await mk.workOrder(s, w, wall, 1);
        });

        it("plans a work order for the shortage when supply is planned",
                async function () {
            let alcs = await mk.allocations(req(wo, door).id);

            assert.deepEqual(
                alcs.map((a) => [a.supplyType, a.quantity, a.isFirm]),
                [["PlannedWorkOrder", 2, false]]
            );
            planned = await s.read("PlannedWorkOrder", alcs[0].supplyId);
            assert.equal(planned.item.id, door.id);
            assert.equal(planned.quantity, 2);
            assert.equal(planned.site.id, w.site.id);
        });

        it("re-planning an allocated order changes nothing",
                async function () {
            let msg = await s.route(
                "/make/plan-work-order-supply",
                {id: wo.id}
            );

            assert.equal(msg, "Work order supply planned");
            await mk.quiesce();
            let alcs = await mk.allocations(req(wo, door).id);
            assert.deepEqual(alcs.map((a) => a.supplyId), [planned.id]);
        });

        it("converts the planned order to an exploded work order",
                async function () {
            let msg = await s.route(
                "/make/convert-planned-work-orders",
                {ids: [planned.id]}
            );

            assert.equal(msg, "Work orders created");
            let alcs = await mk.poll(async function () {
                let a = await mk.allocations(req(wo, door).id);
                return a.length && a[0].supplyType === "WorkOrder" && a;
            });
            assert.ok(alcs, "allocation moved to a work order");
            let dwo = await mk.waitExploded(s, alcs[0].supplyId);

            assert.equal(dwo.item.id, door.id);
            assert.equal(dwo.ordered, 2);
            assert.equal(dwo.status, "P");
            assert.equal(dwo.materials.length, 1);
            assert.equal(alcs[0].quantity, 2);
            assert.equal(
                await s.read("PlannedWorkOrder", planned.id),
                undefined
            );
        });
    });

    describe("unrelease, close and delete", function () {
        let wo;
        let hingeAllocated;

        before(async function () {
            hingeAllocated = (await mk.inventory(cab.hinge.id, w.site.id))
                .allocated;
            wo = await mk.workOrder(s, w, cab.assy, 1);
        });

        it("allocates stock for the new order", async function () {
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                hingeAllocated + 8
            );
        });

        it("unreleases a released order back to pending", async function () {
            wo = await mk.release(s, wo.id);
            wo = await s.update("WorkOrder", wo.id, function (rec) {
                rec.status = "P";
            });

            assert.deepEqual(mk.statusOf(wo), {
                status: "P",
                materials: ["P", "P", "P", "P", "P"],
                operations: ["P", "P", "P"]
            });
            wo = await mk.release(s, wo.id);
        });

        it("refuses to delete a released order", async function () {
            assertFailed(
                await s.raw("DELETE", "/data/work-order/" + wo.id),
                /Work order that has been released or closed may not be deleted/
            );
        });

        it("closes: requirements and operations closed, allocations " +
                "released", async function () {
            await s.route("/make/close-work-order", {ids: [wo.id]});
            await mk.quiesce();
            wo = await s.read("WorkOrder", wo.id);

            assert.deepEqual(mk.statusOf(wo), {
                status: "C",
                materials: ["C", "C", "C", "C", "C"],
                operations: ["C", "C", "C"]
            });
            assert.equal(wo.received, 0);
            assert.equal(wo.quantity, 0);
            assert.equal(wo.closeDate, fx.today());
            assert.ok(wo.materials.every((m) => m.quantityDue === 0));
            assert.ok(wo.operations.every((o) => o.remaining === 0));
            let i = 0;
            while (i < wo.materials.length) {
                assert.deepEqual(await mk.allocations(wo.materials[i].id), []);
                i += 1;
            }
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                hingeAllocated
            );
        });

        it("refuses to close or explode a closed order", async function () {
            assertFailed(
                await s.raw("POST", "/make/close-work-order", {ids: [wo.id]}),
                new RegExp("Work order " + wo.number + " is already closed")
            );
            assertFailed(
                await s.raw("POST", "/make/explode-work-order", {
                    ids: [wo.id]
                }),
                /Work order must be in Pending status to be exploded/
            );
        });

        it("closes a single order passed as {id}", {
            todo: "defect: do-close-work-order.js reads obj.data.ids[i] " +
                    "even when called with {id} (TypeError)"
        }, async function () {
            let other = await mk.workOrder(s, w, cab.assy, 1);

            try {
                let resp = await s.raw("POST", "/make/close-work-order", {
                    id: other.id
                });
                assert.ok(resp.status < 300, JSON.stringify(resp.body));
                other = await s.read("WorkOrder", other.id);
                assert.equal(other.status, "C");
            } finally {
                other = await s.read("WorkOrder", other.id);
                if (other.status !== "C") {
                    await s.remove("WorkOrder", other.id);
                }
            }
        });

        it("deletes a pending order and its allocations", async function () {
            let other = await mk.workOrder(s, w, cab.assy, 1);
            let hinge = req(other, cab.hinge);

            assert.equal((await mk.allocations(hinge.id)).length, 1);
            await s.remove("WorkOrder", other.id);
            await mk.quiesce();

            assert.equal(await s.read("WorkOrder", other.id), undefined);
            assert.deepEqual(await mk.allocations(hinge.id), []);
            assert.equal(
                (await mk.inventory(cab.hinge.id, w.site.id)).allocated,
                hingeAllocated
            );
        });

        it("explodes an order saved without cost fields", {
            todo: "defect: do-explode-work-order.js reads " +
                    "estimatedMaterialCost.currency; a WorkOrder POST " +
                    "without the money fields never explodes"
        }, async function () {
            let bare = await s.create("WorkOrder", {
                item: fx.ref(cab.assy),
                site: fx.ref(w.site),
                ordered: 1,
                startDate: fx.today(),
                dueDate: fx.today(7)
            });

            bare = await mk.waitExploded(s, bare.id);
            try {
                assert.equal(bare.error, "");
                assert.equal(bare.status, "P");
            } finally {
                await s.remove("WorkOrder", bare.id);
                await mk.quiesce();
            }
        });
    });
});
