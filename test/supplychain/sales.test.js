/*
    Sales orders (SupplyChain sell/): customer data lookup, order entry
    amounts and numbering, the I -> P -> A statechart driven by the
    start/release routes, allocation of stock on start, hold, line
    changes after release, close, tax rate lookup and the sales order
    plan (gantt) routes. Black-box through /data and /sell routes.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const sell = require("./lib/sell");

describe("sales orders", function () {
    let s;
    let w;
    let widget;
    let gadget;
    let so;

    before(async function () {
        s = await signedIn();
        w = await sell.world(s);
        widget = await sell.soldItem(s, w, {
            prefix: "WIDGET", onHand: 10, price: 25, cost: 10
        });
        gadget = await sell.soldItem(s, w, {
            prefix: "GADGET", onHand: 10, price: 20, cost: 8
        });
    });

    it("get-customer-data returns the defaults the order form copies",
            async function () {
        let data = await s.route("/sell/get-customer-data", {
            id: w.customer.id
        });

        assert.deepEqual(Object.keys(data).sort(), [
            "billTo", "billToIsShipto", "contact", "creditStatus",
            "currency", "discount", "id", "incoTerms", "isActive", "name",
            "number", "shipMethod", "shipTo", "site", "taxable", "terms"
        ]);
        assert.equal(data.id, w.customer.id);
        assert.equal(data.currency.code, "USD");
        assert.equal(data.site.id, w.site.id);
        assert.equal(data.shipMethod.id, w.shipMethod.id);
        assert.equal(data.terms.id, w.terms.id);
        assert.equal(data.taxable, false);
        assert.equal(data.isActive, true);
    });

    it("a new order is Incomplete, numbered, and the server computes " +
            "line amounts and totals", async function () {
        so = await sell.salesOrder(s, w, [
            {item: widget, ordered: 4, price: 25},
            {item: gadget, ordered: 3, price: 20, discount: 10}
        ], {freight: 12.5, purchaseOrder: "PO-RT-1"});

        assert.equal(so.status, "I");
        assert.match(so.number, /^S-\d+$/);
        assert.equal(so.planStatus, "U");
        assert.equal(so.onHold, false);

        let l1 = so.lines[0];
        let l2 = so.lines[1];
        assert.equal(l1.number, so.number + "\\1");
        assert.equal(l2.number, so.number + "\\2");
        // Lines of an incomplete order are pending with nothing due
        assert.deepEqual(
            so.lines.map((l) => [l.status, l.quantityDue, l.allocated]),
            [["P", 0, 0], ["P", 0, 0]]
        );
        assert.equal(l1.amount.amount, 100);
        assert.equal(l1.discountPrice.amount, 25);
        assert.equal(l2.discountPrice.amount, 18);
        assert.equal(l2.amount.amount, 54);
        assert.equal(so.subtotal.amount, 154);
        assert.equal(so.freight.amount, 12.5);
        assert.equal(so.tax.amount, 0);
        assert.equal(so.total.amount, 166.5);
        assert.equal(so.total.currency, "USD");
        // Actual costs start at zero
        assert.equal(l1.actualMaterialCost.amount, 0);
        assert.equal(l1.shipped, 0);

        // Nothing allocated while incomplete
        assert.equal((await sell.allocations(s, l1.id)).length, 0);
        assert.equal(
            (await sell.inventory(s, widget, w.site)).allocated,
            0
        );
    });

    it("start-sales-orders moves I -> P, makes quantities due and " +
            "allocates stock on hand", async function () {
        await s.route("/sell/start-sales-orders", {ids: [so.id]});
        so = await sell.readSo(s, so);

        assert.equal(so.status, "P");
        assert.deepEqual(
            so.lines.map((l) => [l.status, l.quantityDue, l.allocated]),
            [["P", 4, 4], ["P", 3, 3]]
        );
        assert.equal(so.lines[0].dueDate, fx.today());
        // Everything covered from inventory
        assert.equal(so.planStatus, "I");

        let alc = await sell.allocations(s, so.lines[0].id);
        assert.equal(alc.length, 1);
        assert.equal(alc[0].quantity, 4);
        assert.equal(alc[0].supply.objectType, "Inventory");
        assert.equal(alc[0].salesOrder.id, so.id);
        assert.equal(alc[0].salesDemand.id, so.lines[0].id);
        assert.equal(alc[0].isFirm, false);

        let inv = await sell.inventory(s, widget, w.site);
        assert.equal(inv.quantity, 10);
        assert.equal(inv.allocated, 4);
        assert.equal(inv.demand, 4);
        assert.equal(inv.projected, 6);
    });

    it("hold is refused for an order that is not active",
            async function () {
        let resp = await s.raw("POST", "/sell/hold", {
            salesOrderId: so.id, hold: true, recursive: false
        });

        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Only active sales orders may be put on hold");
        assert.equal((await sell.readSo(s, so)).onHold, false);
    });

    it("release-sales-orders moves P -> A and activates the lines",
            async function () {
        await s.route("/sell/release-sales-orders", {ids: [so.id]});
        so = await sell.readSo(s, so);

        assert.equal(so.status, "A");
        assert.deepEqual(so.lines.map((l) => l.status), ["A", "A"]);
        assert.deepEqual(so.lines.map((l) => l.quantityDue), [4, 3]);
        assert.equal(so.planStatus, "I");
    });

    it("hold and allow toggle onHold on an active order",
            async function () {
        let msg = await s.route("/sell/hold", {
            salesOrderId: so.id, hold: true, recursive: false
        });
        assert.equal(msg, "Sales order put on hold");
        assert.equal((await sell.readSo(s, so)).onHold, true);

        msg = await s.route("/sell/hold", {
            salesOrderId: so.id, hold: false, recursive: true
        });
        assert.equal(msg, "Sales order taken off hold");
        so = await sell.readSo(s, so);
        assert.equal(so.onHold, false);
        assert.equal(so.status, "A");
    });

    it("reducing an ordered quantity after release gives back the " +
            "excess allocation", async function () {
        so = await s.update("SalesOrder", so.id, function (rec) {
            rec.lines[0].ordered = 2;
        });

        assert.equal(so.lines[0].quantityDue, 2);
        assert.equal(so.lines[0].allocated, 2);
        assert.equal(so.lines[0].amount.amount, 50);
        assert.equal(so.subtotal.amount, 104);
        assert.equal(so.total.amount, 116.5);

        let alc = await sell.allocations(s, so.lines[0].id);
        assert.deepEqual(alc.map((a) => a.quantity), [2]);
        assert.equal(
            (await sell.inventory(s, widget, w.site)).allocated,
            2
        );
    });

    it("get-sales-order-plan and get-sales-order-line-plan show " +
            "inventory supply per line", async function () {
        let plan = await s.route("/sell/get-sales-order-plan", {
            id: so.id
        });

        assert.equal(plan.length, 2);
        assert.equal(plan[0].id, so.lines[0].id);
        assert.equal(plan[0].type, "group");
        assert.equal(plan[0].level, 0);
        assert.equal(plan[0].quantity, 2);
        assert.equal(plan[0].percent, 0);
        assert.equal(plan[0].startDate, so.orderDate);
        assert.equal(
            plan[0].description,
            "(" + so.lines[0].number + ") " + widget.number + " [Qty: 2]"
        );
        assert.equal(plan[0].detail.length, 1);
        assert.equal(plan[0].detail[0].objectType, "Inventory");
        assert.equal(plan[0].detail[0].level, 1);
        assert.equal(plan[0].detail[0].parent, so.lines[0].id);
        assert.equal(plan[0].detail[0].percent, 1);

        let linePlan = await s.route("/sell/get-sales-order-line-plan", {
            id: so.lines[1].id
        });
        assert.equal(linePlan.length, 1);
        assert.equal(linePlan[0].objectType, "Inventory");
        assert.equal(linePlan[0].type, "task");
        assert.equal(linePlan[0].level, 0);
        assert.equal(linePlan[0].dueDate, fx.today());
        assert.match(linePlan[0].description, /\[Qty: 3\]$/);
    });

    it("close-sales-order closes the order and lines and releases " +
            "allocations", async function () {
        let resp = await s.route("/sell/close-sales-order", {ids: [so.id]});
        assert.equal(resp, undefined);

        so = await sell.readSo(s, so);
        assert.equal(so.status, "C");
        assert.equal(so.planStatus, "C");
        assert.deepEqual(
            so.lines.map((l) => [l.status, l.quantityDue, l.allocated]),
            [["C", 0, 0], ["C", 0, 0]]
        );
        assert.equal((await sell.allocations(s, so.lines[0].id)).length, 0);
        let inv = await sell.inventory(s, widget, w.site);
        assert.equal(inv.allocated, 0);
        assert.equal(inv.quantity, 10);

        resp = await s.raw("POST", "/sell/close-sales-order", {
            ids: [so.id]
        });
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Sales order " + so.number + " is already closed"
        );
    });

    it("an incomplete order can be deleted, a closed one cannot",
            async function () {
        let draft = await sell.salesOrder(s, w, [
            {item: widget, ordered: 1, price: 25}
        ]);
        await s.remove("SalesOrder", draft.id);
        let resp = await s.raw("GET", "/data/sales-order/" + draft.id);
        // Missing records answer 204 No Content
        assert.equal(resp.status, 204);

        resp = await s.raw("DELETE", "/data/sales-order/" + so.id);
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Cannot delete a closed sales order");
    });

    it("get-address-tax-rates matches zip/city/state, creates the tax " +
            "type once and reuses it", async function () {
        let zip = fx.uniq("Z");
        let city = "Taxville" + Date.now().toString(36);

        await sell.taxRate(s, {
            zipCode: zip, city, state: "ZZ", rateState: 6.25, rateCity: 1
        });

        let rates = await s.route("/sell/get-address-tax-rates", {
            city: city.toUpperCase(), postalCode: zip, state: "ZZ"
        });
        assert.equal(rates.length, 2);
        assert.equal(rates[0].percent, 6.25);
        assert.equal(rates[0].shippingTaxable, false);
        assert.equal(rates[0].taxType.code, "State: ZZ");
        assert.equal(rates[1].percent, 1);
        assert.equal(
            rates[1].taxType.code,
            "City: " + zip + "-Testcounty-" + city
        );
        assert.equal(rates[1].taxType.description, "City tax for " + city);
        assert.equal(rates[1].taxType.reportingCode, "RTY");

        let again = await s.route("/sell/get-address-tax-rates", {
            city, postalCode: zip, state: "ZZ"
        });
        assert.equal(again[1].taxType.id, rates[1].taxType.id);
        let types = await s.findBy("TaxTypes", "code", rates[1].taxType.code);
        assert.equal(types.length, 1);

        let none = await s.route("/sell/get-address-tax-rates", {
            city, postalCode: zip, state: "WI"
        });
        assert.deepEqual(none, []);
    });

    it("order taxes are summed into tax and total", async function () {
        let taxed = await sell.salesOrder(s, w, [
            {item: widget, ordered: 3, price: 35, taxable: true}
        ], {
            taxable: true,
            taxes: [{
                taxType: {id: (await s.findBy("TaxTypes", "code",
                        "State: ZZ"))[0].id},
                percent: 7,
                shippingTaxable: false,
                amount: fx.money(7.35)
            }]
        });

        assert.equal(taxed.subtotal.amount, 105);
        assert.equal(taxed.tax.amount, 7.35);
        assert.equal(taxed.total.amount, 112.35);
        await s.remove("SalesOrder", taxed.id);
    });

    it("/sell/explode-sales-order is routed but has no server function",
            async function () {
        let resp = await s.raw("POST", "/sell/explode-sales-order", {
            id: so.id
        });
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Function POST doExplodeSalesOrder is not registered."
        );
    });
});
