/*
    Billing (SupplyChain bill/): shipment invoices built from shipped
    quantities (lines, freight, address-based taxes, totals), sales
    history rows written by the invoice triggers, the sales order history
    route, invoice payments (partial, full, multi-invoice, over-payment and
    currency checks, concurrency), prepaid invoices applied to shipment
    invoices, and invoice deletion.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const fx = require("../harness/fixtures");
const sell = require("./lib/sell");

describe("billing", function () {
    let s;
    let w;
    let taxed;
    let plain;
    let so;
    let sh1;
    let sh2;
    let inv1;
    let inv2;

    // Ship and invoice a one-line order for quick payment scenarios
    async function invoicedOrder(qty, price) {
        let order = await sell.salesOrder(s, w, [
            {item: plain, ordered: qty, price}
        ]);
        order = await sell.startAndRelease(s, order);
        let shpmt = await sell.shipment(s, w, order);
        await sell.ship(s, shpmt);
        return sell.invoiceShipment(s, shpmt);
    }

    function history(invoice) {
        return s.list("SalesHistories", {
            filter: {
                criteria: [{property: "invoice.id", value: invoice.id}],
                sort: [{property: "description"}]
            }
        });
    }

    before(async function () {
        let zip = fx.uniq("Z");
        let city = "Billville" + Date.now().toString(36);

        s = await signedIn();
        w = await sell.world(s, {customer: {
            taxable: true,
            address: {postalCode: zip, city, state: "ZZ"}
        }});
        await sell.taxRate(s, {zipCode: zip, city, state: "ZZ", rateState: 7});
        taxed = await sell.soldItem(s, w, {
            prefix: "TAXED", onHand: 50, price: 35, cost: 20,
            description: "Taxed camper part"
        });
        plain = await sell.soldItem(s, w, {
            prefix: "PLAIN", onHand: 50, price: 10, cost: 4,
            description: "Untaxed camper part"
        });

        let rates = await s.route("/sell/get-address-tax-rates", {
            city, postalCode: zip, state: "ZZ"
        });
        so = await sell.salesOrder(s, w, [
            {item: taxed, ordered: 5, price: 35, taxable: true},
            {item: plain, ordered: 2, price: 10}
        ], {
            taxable: true,
            purchaseOrder: "PO-BILL-1",
            taxes: rates.map((r) => ({
                taxType: fx.ref(r.taxType),
                percent: r.percent,
                shippingTaxable: r.shippingTaxable,
                amount: fx.money(12.25)
            }))
        });
        so = await sell.startAndRelease(s, so);
        sh1 = await sell.shipment(s, w, so, {1: 3, 2: 2}, {freight: 15});
        await sell.ship(s, sh1);
    });

    it("do-create-shipment-invoice bills the shipped quantities",
            async function () {
        inv1 = await sell.invoiceShipment(s, sh1);

        assert.equal(inv1.objectType, "ShipmentInvoice");
        assert.match(inv1.number, /^I-\d+$/);
        assert.equal(inv1.status, "A");
        assert.equal(inv1.invoiceDate, fx.today());
        assert.equal(inv1.customer.id, w.customer.id);
        assert.equal(inv1.billTo.id, so.billTo.id);
        assert.equal(inv1.shipTo.id, sh1.shipTo.id);
        assert.equal(inv1.salesOrder.id, so.id);
        assert.equal(inv1.shipment.id, sh1.id);
        assert.equal(inv1.purchaseOrder, "PO-BILL-1");
        assert.equal(inv1.terms.id, w.terms.id);
        assert.equal(inv1.taxable, true);

        assert.deepEqual(inv1.lines.map((l) => [
            l.line, l.item.id, l.ordered, l.shipped, l.billed,
            l.backOrdered, l.price.amount, l.discountPrice.amount,
            l.amount.amount, l.taxable, l.salesOrderLine.line,
            l.shipmentLine.line
        ]), [
            [1, taxed.id, 5, 3, 3, 2, 35, 35, 105, true, 1, 1],
            [2, plain.id, 2, 2, 2, 0, 10, 10, 20, false, 2, 2]
        ]);

        assert.equal(inv1.subtotal.amount, 125);
        assert.equal(inv1.freight.amount, 15);
        assert.equal(inv1.taxes.length, 1);
        assert.equal(inv1.taxes[0].percent, 7);
        assert.equal(inv1.taxes[0].taxType.code, "State: ZZ");
        assert.equal(inv1.tax.amount, inv1.taxes[0].amount.amount);
        assert.equal(
            inv1.total.amount,
            sell.round2(125 + 15 + inv1.tax.amount)
        );
        assert.equal(inv1.paid.amount, 0);
        assert.equal(inv1.balance.amount, inv1.total.amount);
        assert.equal(inv1.prepaid.amount, 0);
        assert.deepEqual(inv1.payments, []);

        let shipped = await s.read("SalesOrderShipment", sh1.id);
        assert.equal(shipped.isInvoiced, true);
    });

    it("invoice tax keeps cents (7% of 105.00 is 7.35)",
            {todo: "plan 2.2: Math.round(ttl, 2) rounds to whole units"},
            async function () {
        assert.equal(inv1.taxes[0].amount.amount, 7.35);
        assert.equal(inv1.tax.amount, 7.35);
        assert.equal(inv1.total.amount, 147.35);
    });

    it("the invoice writes sales history for lines, freight and tax",
            async function () {
        let rows = await history(inv1);
        let byDesc = {};
        rows.forEach((r) => (byDesc[r.description] = r));

        assert.deepEqual(Object.keys(byDesc).sort(), [
            "Shipping", "State tax for ZZ", "Taxed camper part",
            "Untaxed camper part"
        ]);

        let ln = byDesc["Taxed camper part"];
        assert.equal(ln.item.id, taxed.id);
        assert.equal(ln.quantity, 3);
        assert.equal(ln.amount.amount, 105);
        assert.equal(ln.salesOrderLine, 1);
        assert.equal(ln.salesOrder.id, so.id);
        assert.equal(ln.shipment.id, sh1.id);
        assert.equal(ln.site.code, w.site.code);
        assert.equal(ln.unit.code, "ea");
        assert.equal(ln.isTax, false);
        assert.equal(ln.isShipping, false);

        let frt = byDesc.Shipping;
        assert.equal(frt.isShipping, true);
        assert.equal(frt.quantity, 1);
        assert.equal(frt.amount.amount, 15);
        assert.equal(frt.unitPrice.amount, 15);
        assert.equal(frt.referenceId, inv1.id);

        let tax = byDesc["State tax for ZZ"];
        assert.equal(tax.isTax, true);
        assert.equal(tax.quantity, 1);
        assert.equal(tax.taxType.code, "State: ZZ");
        assert.equal(tax.amount.amount, inv1.tax.amount);
    });

    it("sales history item rows carry shipment line and unit price",
            {todo: "plan 2.8: trigger reads ln.shipment and ln.unitPrice"},
            async function () {
        let rows = (await history(inv1)).filter((r) => r.item);

        assert.deepEqual(
            rows.map((r) => [r.description, r.shipmentLine,
                    r.unitPrice && r.unitPrice.amount]),
            [["Taxed camper part", 1, 35], ["Untaxed camper part", 2, 10]]
        );
    });

    it("sales-order-history lists invoices and uninvoiced shipments",
            async function () {
        sh2 = await sell.shipment(s, w, so);
        await sell.ship(s, sh2);

        let rows = await s.route("/bill/sales-order-history", {id: so.id});
        let invRows = rows.filter(
            (r) => r.invoice && r.invoice.id === inv1.id
        );
        let header = invRows[0];

        assert.equal(header.level, 0);
        assert.equal(header.description, "Shipment Invoice");
        assert.equal(header.shipment.id, sh1.id);
        assert.equal(header.shipDate, inv1.invoiceDate);
        assert.equal(header.amount.amount, inv1.total.amount);
        assert.equal(invRows.length, 5);
        assert.ok(invRows.slice(1).every((r) => r.level === 1));
        assert.deepEqual(
            invRows.slice(1).map((r) => r.amount.amount).sort(
                (a, b) => a - b
            ),
            [inv1.tax.amount, 15, 20, 105].sort((a, b) => a - b)
        );

        let unbilled = rows.slice(invRows.length);
        assert.deepEqual(unbilled.map((r) => [
            r.level, r.description, r.quantity, r.amount
        ]), [
            [0, "Uninvoiced shipment", 2, null],
            [1, "Taxed camper part", 2, null]
        ]);
        assert.equal(unbilled[0].shipment.id, sh2.id);
    });

    it("payments are refused above the unpaid amount or in another " +
            "currency", async function () {
        let resp = await s.raw("POST", "/bill/do-apply-invoice-payment", {
            ids: [inv1.id],
            amount: fx.money(inv1.total.amount + 0.01),
            reference: "too much"
        });
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Applied amount must be less than or equal to unpaid amount " +
            "of selected invoices"
        );

        resp = await s.raw("POST", "/bill/do-apply-invoice-payment", {
            ids: [inv1.id],
            amount: fx.money(10, "EUR"),
            reference: "euro"
        });
        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Applied currency must be the same as invoice currency"
        );

        resp = await s.raw("POST", "/bill/do-apply-invoice-payment", {
            ids: ["no-such-invoice"],
            amount: fx.money(10),
            reference: "none"
        });
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "No invoice found");

        let rec = await s.read("ShipmentInvoice", inv1.id);
        assert.equal(rec.paid.amount, 0);
        assert.deepEqual(rec.payments, []);
    });

    it("a partial payment keeps the invoice active", async function () {
        let msg = await sell.payInvoices(s, [inv1.id], 50, "CHK-1");
        assert.equal(msg, "Payment applied");

        let rec = await s.read("ShipmentInvoice", inv1.id);
        assert.equal(rec.status, "A");
        assert.equal(rec.paid.amount, 50);
        assert.equal(rec.balance.amount, sell.round2(rec.total.amount - 50));
        assert.deepEqual(
            rec.payments.map((p) => [p.amount.amount, p.reference]),
            [[50, "CHK-1"]]
        );
    });

    it("one payment across invoices pays the oldest in full first and " +
            "closes it", async function () {
        inv2 = await sell.invoiceShipment(s, sh2);
        assert.equal(inv2.subtotal.amount, 70);
        assert.equal(inv2.freight.amount, 0);

        let owed1 = sell.round2(inv1.total.amount - 50);
        await sell.payInvoices(s, [inv2.id, inv1.id], owed1 + 20, "CHK-2");

        let rec1 = await s.read("ShipmentInvoice", inv1.id);
        let rec2 = await s.read("ShipmentInvoice", inv2.id);
        assert.equal(rec1.status, "C");
        assert.equal(rec1.paid.amount, rec1.total.amount);
        assert.equal(rec1.balance.amount, 0);
        assert.deepEqual(
            rec1.payments.map((p) => [p.amount.amount, p.reference]),
            [[50, "CHK-1"], [owed1, "CHK-2"]]
        );
        assert.equal(rec2.status, "A");
        assert.equal(rec2.paid.amount, 20);
        assert.deepEqual(
            rec2.payments.map((p) => [p.amount.amount, p.reference]),
            [[20, "CHK-2"]]
        );

        // Nothing left to pay on a closed invoice
        let resp = await s.raw("POST", "/bill/do-apply-invoice-payment", {
            ids: [inv1.id],
            amount: fx.money(1),
            reference: "late"
        });
        assert.equal(resp.status, 500);
    });

    it("an invoice with payments cannot be deleted", async function () {
        let resp = await s.raw("DELETE", "/data/shipment-invoice/" + inv2.id);
        assert.equal(resp.status, 500);
        assert.equal(resp.body, "Cannot delete an invoice with payment history");
    });

    it("deleting an unpaid invoice un-invoices the shipment and drops " +
            "its history", async function () {
        let inv = await invoicedOrder(2, 10);
        assert.equal((await history(inv)).length, 1);

        await s.remove("ShipmentInvoice", inv.id);
        assert.equal(
            (await s.read("SalesOrderShipment", inv.shipment.id)).isInvoiced,
            false
        );
        assert.equal((await history(inv)).length, 0);
    });

    it("a shipment can only be invoiced once",
            {todo: "defect: do-create-shipment-invoice ignores isInvoiced"},
            async function () {
        let order = await sell.salesOrder(s, w, [
            {item: plain, ordered: 1, price: 10}
        ]);
        order = await sell.startAndRelease(s, order);
        let shpmt = await sell.shipment(s, w, order);
        await sell.ship(s, shpmt);
        await s.route("/bill/do-create-shipment-invoice", {id: shpmt.id});

        let resp = await s.raw("POST", "/bill/do-create-shipment-invoice", {
            id: shpmt.id
        });
        let invs = await s.findBy("ShipmentInvoices", "shipment.id", shpmt.id);
        assert.equal(invs.length, 1);
        assert.equal(resp.status, 500);
    });

    it("concurrent payments on one invoice are both kept",
            {todo: "plan 2.3: invoice read before lock, last write wins"},
            async function () {
        let other = await signedIn();
        let inv = await invoicedOrder(10, 10);
        let resp = await Promise.all([
            s.raw("POST", "/bill/do-apply-invoice-payment", {
                ids: [inv.id], amount: fx.money(30), reference: "A"
            }),
            other.raw("POST", "/bill/do-apply-invoice-payment", {
                ids: [inv.id], amount: fx.money(40), reference: "B"
            })
        ]);
        let applied = [30, 40].filter((ignore, i) => resp[i].status === 200);
        let rec = await s.read("ShipmentInvoice", inv.id);

        assert.equal(
            rec.paid.amount,
            applied.reduce((a, b) => a + b, 0)
        );
        assert.equal(rec.payments.length, applied.length);
    });

    describe("prepaid invoices", function () {
        let order;
        let pre1;
        let pre2;
        let inv;

        before(async function () {
            order = await sell.salesOrder(s, w, [
                {item: plain, ordered: 2, price: 10}
            ]);
            order = await sell.startAndRelease(s, order);
            pre1 = await sell.prepaidInvoice(s, w, order, 20);
            pre2 = await sell.prepaidInvoice(s, w, order, 15);
            let shpmt = await sell.shipment(s, w, order);
            await sell.ship(s, shpmt);
            inv = await sell.invoiceShipment(s, shpmt);
            pre1 = await s.read("PrepaidInvoice", pre1.id);
            pre2 = await s.read("PrepaidInvoice", pre2.id);
        });

        it("a prepaid invoice starts fully unapplied", async function () {
            let fresh = await sell.prepaidInvoice(s, w, order, 12.5);
            assert.equal(fresh.objectType, "PrepaidInvoice");
            assert.match(fresh.number, /^I-\d+$/);
            assert.equal(fresh.status, "A");
            assert.equal(fresh.unapplied.amount, 12.5);
            assert.equal(fresh.balance.amount, 12.5);
            await s.remove("PrepaidInvoice", fresh.id);
        });

        it("the shipment invoice consumes the oldest prepayment",
                async function () {
            assert.equal(inv.total.amount, 20);
            assert.equal(inv.prepaid.amount, 20);
            assert.equal(inv.paid.amount, 20);
            assert.equal(inv.balance.amount, 0);
            assert.equal(inv.prepayments[0].prepaidInvoice.id, pre1.id);
            assert.equal(inv.prepayments[0].amount.amount, 20);

            assert.equal(pre1.unapplied.amount, 0);
            assert.deepEqual(
                pre1.applications.map((a) => [a.invoice.id, a.amount.amount]),
                [[inv.id, 20]]
            );
            assert.equal(pre2.unapplied.amount, 15);

            let resp = await s.raw("DELETE", "/data/prepaid-invoice/" + pre1.id);
            assert.equal(resp.status, 500);
            assert.equal(
                resp.body,
                "Cannot delete prepaid invoice that has been applied"
            );
        });

        it("prepayment application stops at zero balance",
                {todo: "plan 2.8: prepayment loop never updates prepaid"},
                async function () {
            assert.equal(inv.prepayments.length, 1);
            assert.deepEqual(pre2.applications, []);
        });

        it("a fully prepaid shipment invoice is closed",
                {todo: "defect: POST trigger never closes paid invoices"},
                async function () {
            assert.equal(inv.status, "C");
        });
    });
});
