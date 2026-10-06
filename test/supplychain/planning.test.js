/*
    Supply planning for sales demand (SupplyChain plan/ and sell/):
    starting an order short of stock allocates inventory and plans a
    purchase for the shortage (plan-to-order) or a work order (make-to-
    order), plan status, plan-supply and plan-sales-order-supply,
    clear-allocations and create-allocations, the inventory plan and
    due date calculation for a manufactured item.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const sell = require("./lib/sell");

describe("supply planning", function () {
    let s;
    let w;
    let item;
    let so;
    let line;
    let planned;

    async function allocSummary() {
        let rows = await sell.allocations(s, line.id);
        return rows.map((a) => [a.supply.objectType, a.quantity]).sort();
    }

    before(async function () {
        s = await signedIn();
        w = await sell.world(s);
        // Plan-to-order purchased item, lead time 5, 2 on hand
        item = await sell.soldItem(s, w, {
            prefix: "SHORT", onHand: 2, price: 20, cost: 5
        });
        so = await sell.salesOrder(s, w, [
            {item, ordered: 5, price: 20, requestedDate: fx.today(10)}
        ], {requestedDate: fx.today(10)});
    });

    it("starting an order short of stock allocates what is on hand " +
            "and plans a purchase for the rest", async function () {
        await s.route("/sell/start-sales-orders", {ids: [so.id]});
        so = await sell.readSo(s, so);
        line = so.lines[0];

        assert.equal(line.quantityDue, 5);
        assert.equal(line.allocated, 5);
        assert.equal(line.dueDate, fx.today(10));
        assert.equal(so.planStatus, "P");
        assert.deepEqual(await allocSummary(), [
            ["Inventory", 2], ["PlannedPurchase", 3]
        ]);

        let rows = await s.list("PlannedOrders", {
            filter: {criteria: [{property: "item.id", value: item.id}]}
        });
        assert.equal(rows.length, 1);
        planned = rows[0];
        assert.equal(planned.objectType, "PlannedPurchase");
        assert.match(planned.number, /^PL-\d+$/);
        assert.equal(planned.quantity, 3);
        assert.equal(planned.allocated, 3);
        assert.equal(planned.isFirm, false);
        assert.equal(planned.dueDate, fx.today(10));
        // start = due - item site lead time (5 days)
        assert.equal(planned.startDate, fx.today(5));
        assert.equal(planned.site.id, w.site.id);
        assert.equal(planned.salesOrder.id, so.id);
        assert.equal(planned.demand.id, line.id);
        assert.equal(planned.salesDemand.id, line.id);

        let inv = await sell.inventory(s, item, w.site);
        assert.equal(inv.quantity, 2);
        assert.equal(inv.allocated, 2);
        assert.equal(inv.onOrder, 3);
        assert.equal(inv.demand, 5);
        assert.equal(inv.projected, 0);
    });

    it("plan-supply does nothing for a covered demand and replanning " +
            "the order is idempotent", async function () {
        let resp = await s.route("/plan/plan-supply", {demandId: line.id});
        assert.equal(resp, false);

        resp = await s.route("/sell/plan-sales-order-supply", {id: so.id});
        assert.equal(resp, undefined);

        let rows = await s.list("PlannedOrders", {
            filter: {criteria: [{property: "item.id", value: item.id}]}
        });
        assert.deepEqual(rows.map((r) => r.id), [planned.id]);
        assert.deepEqual(await allocSummary(), [
            ["Inventory", 2], ["PlannedPurchase", 3]
        ]);
        assert.equal((await sell.readSo(s, so)).planStatus, "P");
    });

    it("the line plan lists inventory and planned supply",
            async function () {
        let plan = await s.route("/sell/get-sales-order-line-plan", {
            id: line.id
        });
        let byType = {};
        plan.forEach((p) => (byType[p.objectType] = p));

        assert.deepEqual(Object.keys(byType).sort(), [
            "Inventory", "PlannedPurchase"
        ]);
        assert.equal(byType.PlannedPurchase.id, planned.id);
        assert.equal(byType.PlannedPurchase.startDate, fx.today(5));
        assert.equal(byType.PlannedPurchase.dueDate, fx.today(10));
        assert.equal(
            byType.PlannedPurchase.description,
            "(" + planned.number + ") [Qty: 3]"
        );
        assert.equal(byType.Inventory.percent, 1);
    });

    it("clear-allocations removes every allocation and resets plan " +
            "status", async function () {
        let resp = await s.route("/plan/clear-allocations", {});
        assert.equal(resp, undefined);

        so = await sell.readSo(s, so);
        assert.equal(so.lines[0].allocated, 0);
        assert.equal(so.planStatus, "U");
        assert.deepEqual(await allocSummary(), []);
        assert.equal(
            (await s.read("PlannedPurchase", planned.id)).allocated,
            0
        );
        assert.equal((await sell.inventory(s, item, w.site)).allocated, 0);
    });

    it("get-inventory-plan runs unallocated demand and supply by date",
            async function () {
        let inv = await sell.inventory(s, item, w.site);
        let plan = await s.route("/plan/get-inventory-plan", {id: inv.id});
        // Due dates come straight from pg as Date objects, so they
        // serialize as the server's local midnight in UTC, not as
        // "YYYY-MM-DD" strings like everywhere else
        let midnight = new Date(fx.today(10) + "T00:00:00").toISOString();

        assert.deepEqual(plan.map((p) => [
            p.demand && p.demand.id,
            p.supply && p.supply.id,
            p.dueDate,
            p.quantity,
            p.available
        ]), [
            [line.id, null, midnight, -5, -3],
            [null, planned.id, midnight, 3, 0]
        ]);
        assert.equal(plan[0].demand.objectType, "SalesOrderLine");
        assert.equal(plan[1].supply.objectType, "PlannedPurchase");

        let resp = await s.raw("POST", "/plan/get-inventory-plan", {
            id: "no-such-inventory"
        });
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Inventory not found");
    });

    it("create-allocations for a demand allocates existing supply",
            async function () {
        let resp = await s.route("/plan/create-allocations", {
            demandId: line.id
        });
        assert.equal(resp, "Allocations created");

        so = await sell.readSo(s, so);
        assert.equal(so.lines[0].allocated, 5);
        assert.equal(so.planStatus, "P");
        assert.deepEqual(await allocSummary(), [
            ["Inventory", 2], ["PlannedPurchase", 3]
        ]);
        let alc = await sell.allocations(s, line.id);
        assert.ok(alc.every((a) => a.salesOrder.id === so.id));
        assert.ok(alc.every((a) => a.salesDemand.id === line.id));
    });

    it("inventory allocated matches its allocation rows after " +
            "reallocation", {todo: "plan 2.5: allocation drift"},
            async function () {
        let check = await sell.inventoryAllocation(item, w.site);
        assert.equal(check.allocated, 2);
        assert.equal(check.rows, check.allocated);
    });

    it("a failed create-allocations with clear leaves allocations " +
            "intact", {todo: "plan 2.1: clear-allocations COMMITs " +
            "mid-transaction"}, async function () {
        // An object demand id makes the demand query throw after the
        // clear step has already run
        let resp = await s.raw("POST", "/plan/create-allocations", {
            clear: true,
            demandId: {bad: true}
        });
        let after = await allocSummary();

        if (!after.length) {
            // Put things back for the rest of this file
            await s.route("/plan/create-allocations", {demandId: line.id});
        }
        assert.equal(resp.status, 500);
        assert.deepEqual(after, [["Inventory", 2], ["PlannedPurchase", 3]]);
    });

    it("a make-to-order assembly is supplied by a new work order",
            async function () {
        let cab = await fx.cabinetAssembly(s, w);
        await s.update("Product", cab.assy.id, function (p) {
            p.isSold = true;
            p.price = fx.money(400);
        });
        let order = await sell.salesOrder(s, w, [
            {item: cab.assy, ordered: 2, price: 400}
        ]);
        await s.route("/sell/start-sales-orders", {ids: [order.id]});
        order = await sell.readSo(s, order);

        assert.equal(order.lines[0].allocated, 2);
        assert.equal(order.planStatus, "O");
        let alc = await sell.allocations(s, order.lines[0].id);
        assert.equal(alc.length, 1);
        assert.equal(alc[0].supply.objectType, "WorkOrder");
        assert.equal(alc[0].quantity, 2);

        let wos = await s.list("WorkOrders", {
            filter: {criteria: [{property: "item.id", value: cab.assy.id}]}
        });
        assert.equal(wos.length, 1);
        assert.equal(wos[0].ordered, 2);
        assert.equal(wos[0].dueDate, fx.today());
        assert.equal(wos[0].startDate, fx.today(-5));
        assert.equal(wos[0].salesOrder.id, order.id);

        let plan = await s.route("/sell/get-sales-order-plan", {
            id: order.id
        });
        assert.equal(plan.length, 1);
        assert.equal(plan[0].detail[0].objectType, "WorkOrder");
        assert.equal(plan[0].detail[0].id, wos[0].id);
    });

    describe("calculate-due-date", function () {
        let cab;

        before(async function () {
            cab = await fx.cabinetAssembly(s, w);
        });

        it("adds the critical path lead time when nothing is in stock",
                async function () {
            let resp = await s.route("/plan/calculate-due-date", {
                itemId: cab.assy.id,
                siteId: w.site.id,
                quantity: 2,
                requestedDate: fx.today()
            });

            // assembly lead time 5 + component lead time 5 + 1 day
            assert.equal(resp.dueDate, fx.today(11));
            assert.equal(resp.plan.length, 1);

            let group = resp.plan[0];
            assert.equal(group.type, "group");
            assert.equal(group.objectType, "WorkOrder");
            assert.equal(group.dueDate, fx.today(11));
            assert.equal(group.startDate, fx.today(6));

            let rows = group.detail.map((r) => [
                r.objectType, r.number.number, r.quantity, r.startDate,
                r.dueDate
            ]);
            assert.deepEqual(rows[0], [
                "WorkOrder", "NEW", 2, fx.today(6), fx.today(11)
            ]);
            assert.deepEqual(rows.slice(1).map((r) => r[2]).sort(
                (a, b) => a - b
            ), [0.5, 2, 8, 16, 40]);
            assert.ok(rows.slice(1).every((r) => (
                r[0] === "PlannedPurchase" &&
                r[3] === fx.today(1) &&
                r[4] === fx.today(6)
            )));
        });

        it("keeps a requested date beyond the lead time", async function () {
            let resp = await s.route("/plan/calculate-due-date", {
                itemId: cab.assy.id,
                siteId: w.site.id,
                quantity: 2,
                requestedDate: fx.today(30)
            });
            assert.equal(resp.dueDate, fx.today(30));
        });

        it("validates its input", async function () {
            let cases = [
                [{siteId: w.site.id, quantity: 1}, "Item id required"],
                [{itemId: cab.assy.id, quantity: 1}, "Site id required"],
                [{itemId: cab.assy.id, siteId: w.site.id}, "Quantity required"]
            ];
            let i = 0;
            let resp;

            while (i < cases.length) {
                resp = await s.raw(
                    "POST",
                    "/plan/calculate-due-date",
                    cases[i][0]
                );
                assert.equal(resp.status, 500);
                assert.equal(resp.body, cases[i][1]);
                i += 1;
            }
        });
    });
});
