/*jslint*/
f.datasource.registerFunction(
    "POST",
    "Invoice",
    function (obj) {
        if (obj.newRec.total.amount <= 0) {
            throw "Invoice total must be positive";
        }
        obj.newRec.balance.amount = obj.newRec.total.amount.minus(
            obj.newRec.paid.amount
        );
    },
    f.datasource.TRIGGER_BEFORE
);
f.datasource.registerFunction(
    "POST",
    "Invoice",
    async function (obj) {
        let n = 0;
        let trans = [];
        let ln;
        let lns;

        try {
            obj.newRec.lines = obj.newRec.lines || [];
            lns = obj.newRec.lines.filter((l) => l.billed);
            while (n < lns.length) {
                ln = lns[n];
                n += 1;
                trans.push(f.datasource.request({
                    client: obj.client,
                    data: {
                        amount: ln.amount,
                        description: ln.item.description,
                        discount: ln.discount,
                        invoice: obj.newRec,
                        item: {id: ln.item.id},
                        quantity: ln.billed,
                        referenceId: ln.id,
                        salesOrder: obj.newRec.salesOrder,
                        salesOrderLine: (
                            ln.salesOrderLine
                            ? ln.salesOrderLine.line
                            : 0
                        ),
                        shipment: obj.newRec.shipment,
                        shipmentLine: (
                            ln.shipmentLine
                            ? ln.shipmentLine.line
                            : 0
                        ),
                        site: (
                            obj.newRec.shipment
                            ? obj.newRec.shipment.site
                            : null
                        ),
                        unit: {id: ln.item.unit.id},
                        unitPrice: {
                            amount: ln.price.amount,
                            currency: ln.price.currency
                        }
                    },
                    method: "POST",
                    name: "SalesHistory"
                }, true));
            }

            if (obj.newRec.freight.amount) {
                trans.push(f.datasource.request({
                    client: obj.client,
                    data: {
                        amount: obj.newRec.freight,
                        description: "Shipping",
                        invoice: obj.newRec,
                        isShipping: true,
                        quantity: 1,
                        referenceId: obj.newRec.id,
                        salesOrder: obj.newRec.salesOrder,
                        shipment: obj.newRec.shipment,
                        site: (
                            obj.newRec.shipment
                            ? obj.newRec.shipment.site
                            : null
                        ),
                        unitPrice: obj.newRec.freight
                    },
                    method: "POST",
                    name: "SalesHistory"
                }, true));
            }

            n = 0;
            obj.newRec.taxes = obj.newRec.taxes || [];
            lns = obj.newRec.taxes.filter((t) => t.amount.amount);
            while (n < lns.length) {
                ln = lns[n];
                n += 1;
                trans.push(f.datasource.request({
                    client: obj.client,
                    data: {
                        amount: ln.amount,
                        description: ln.taxType.description,
                        invoice: obj.newRec,
                        isTax: true,
                        quantity: 1,
                        referenceId: ln.id,
                        salesOrder: obj.newRec.salesOrder,
                        shipment: obj.newRec.shipment,
                        site: (
                            obj.newRec.shipment
                            ? obj.newRec.shipment.site
                            : null
                        ),
                        taxType: ln.taxType,
                        unitPrice: ln.amount
                    },
                    method: "POST",
                    name: "SalesHistory"
                }, true));
            }

            await Promise.all(trans);
        } catch (e) {
            return Promise.reject(e);
        }
    },
    f.datasource.TRIGGER_AFTER
);
f.datasource.registerFunction(
    "PATCH",
    "Invoice",
    async function (obj) {
        if (obj.newRec.paid.amount > obj.newRec.total.amount) {
            throw "Paid amount cannot exceed total amount";
        }

        if (obj.newRec.total.amount < obj.oldRec.paid.amount) {
            throw (
                "Updated total amount cannot be less than amount already paid"
            );
        }

        if (obj.newRec.total.amount <= 0) {
            throw (
                "Invoice total must be positive"
            );
        }
        if (
            obj.newRec.paid.amount !== obj.oldRec.paid.amount ||
            obj.newRec.total.amount !== obj.oldRec.total.amount
        ) {
            obj.newRec.balance = {
                amount: obj.newRec.total.amount.minus(
                    obj.newRec.paid.amount
                ),
                currency: obj.newRec.total.currency
            };
        }
        if (obj.newRec.paid.amount === obj.newRec.total.amount) {
            obj.newRec.status = "C";
        }
        // Handle history updates
        try {
            let hist = await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    property: "invoice.id",
                    value: obj.oldRec.id
                }]},
                method: "GET",
                name: "SalesHistory",
                properties: ["id", "referenceId"]
            }, true);
            let row;
            let rowId = f.createId();

            row = hist.find((h) => h.referenceId === obj.oldRec.id);
            if (row) {
                rowId = row.id;
                hist.splice(hist.indexOf(row), 1);
            }
            if (obj.oldRec.freight.amount !== obj.newRec.freight.amount) {
                if (obj.newRec.freight.amount) {
                    await f.datasource.request({
                        client: obj.client,
                        data: {
                            amount: obj.newRec.freight,
                            description: "Shipping",
                            invoice: obj.newRec,
                            isShipping: true,
                            quantity: 1,
                            referenceId: obj.newRec.id,
                            salesOrder: obj.newRec.salesOrder,
                            shipment: obj.newRec.shipment,
                            site: (
                                obj.newRec.shipment
                                ? obj.newRec.shipment.site
                                : null
                            ),
                            unitPrice: obj.newRec.freight
                        },
                        id: rowId,
                        method: "POST",
                        name: "SalesHistory"
                    }, true);
                } else if (row) {
                    await f.datasource.request({
                        client: obj.client,
                        id: rowId,
                        isHard: true,
                        method: "DELETE",
                        name: "SalesHistory"
                    }, true);
                }
            }

            let n = 0;
            let ln;
            let payload;
            // Reconcile lines
            while (n < obj.newRec.lines.length) {
                ln = obj.newRec.lines[n];
                n += 1;
                if (ln) {
                    payload = {
                        client: obj.client,
                        data: {
                            amount: ln.amount,
                            description: ln.item.description,
                            discount: ln.discount,
                            invoice: obj.newRec,
                            item: {id: ln.item.id},
                            quantity: ln.billed,
                            referenceId: ln.id,
                            salesOrder: obj.newRec.salesOrder,
                            salesOrderLine: (
                                ln.salesOrderLine
                                ? ln.salesOrderLine.line
                                : 0
                            ),
                            shipment: obj.newRec.shipment,
                            shipmentLine: (
                                ln.shipmentLine
                                ? ln.shipmentLine.line
                                : 0
                            ),
                            site: (
                                obj.newRec.shipment
                                ? obj.newRec.shipment.site
                                : null
                            ),
                            unit: {id: ln.item.unit.id},
                            unitPrice: {
                            amount: ln.price.amount,
                            currency: ln.price.currency
                        }
                        },
                        method: "POST",
                        name: "SalesHistory"
                    };
                    row = hist.find((h) => h.referenceId === ln.id);
                    // This will force a patch
                    if (row) {
                        hist.splice(hist.indexOf(row), 1);
                        payload.id = row.id;
                    }
                    await f.datasource.request(payload, true);
                }
            }

            // Reconcile taxes
            n = 0;
            while (n < obj.newRec.taxes.length) {
                ln = obj.newRec.taxes[n];
                n += 1;
                if (ln) {
                    payload = {
                        client: obj.client,
                        data: {
                            amount: ln.amount,
                            description: ln.taxType.description,
                            invoice: obj.newRec,
                            isTax: true,
                            quantity: 1,
                            referenceId: ln.id,
                            salesOrder: obj.newRec.salesOrder,
                            shipment: obj.newRec.shipment,
                            site: (
                                obj.newRec.shipment
                                ? obj.newRec.shipment.site
                                : null
                            ),
                            taxType: ln.taxType,
                            unitPrice: ln.amount
                        },
                        method: "POST",
                        name: "SalesHistory"
                    };
                    row = hist.find((h) => h.referenceId === ln.id);
                    // This will force a patch
                    if (row) {
                        hist.splice(hist.indexOf(row), 1);
                        payload.id = row.id;
                    }
                    await f.datasource.request(payload, true);
                }
            }

            // Delete anything else that is no longer relevant
            while (hist.length) {
                row = hist.shift();
                await f.datasource.request({
                    client: obj.client,
                    id: row.id,
                    isHard: true,
                    method: "DELETE",
                    name: "SalesHistory"
                }, true);
            }
        } catch (e) {
            return Promise.reject(e);
        }
    },
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "Invoice",
    async function (obj) {
        if (obj.oldRec.payments.length) {
            throw "Cannot delete an invoice with payment history";
        }
        try {
            let hist = await f.datasource.request({
                client: obj.client,
                filter: {criteria: [{
                    property: "invoice.id",
                    value: obj.oldRec.id
                }]},
                method: "GET",
                name: "SalesHistory",
                properties: ["id", "objectType"]
            }, true);
            let row;

            while (hist.length) {
                row = hist.pop();
                await f.datasource.request({
                    client: obj.client,
                    id: row.id,
                    isHard: true,
                    method: "DELETE",
                    name: "SalesHistory"
                }, true);
            }
        } catch (e) {
            return Promise.reject(e);
        }
    },
    f.datasource.TRIGGER_BEFORE
);

/*
    An invoice is a completed transaction: what it is worth in the books'
    currency is known the day it is dated, at that day's rate, and does
    not move after (John, Oct 2026). Each line amount and the subtotal,
    tax, freight and total keep their invoice-currency `amount` and gain
    a `baseAmount` converted with convertCurrency at the invoice date,
    with `effective` set to that date -- the framework's mark for a
    settled value, which list totals and the sales rollups then take as
    is (money_base) instead of converting again at whatever the rate is
    on the day somebody looks.

    Paid and balance are left open: they move with payments, which settle
    at their own dates.

    Run on every save, so a changed amount or date is settled again at
    the invoice's date.
*/
async function settleInvoiceMoney(obj) {
    let rec = obj.newRec;
    let date = rec.invoiceDate || f.today();
    let values = [rec.subtotal, rec.tax, rec.freight, rec.total];
    let lines = rec.lines || [];

    async function settle(money) {
        let base;

        if (!money || !money.currency) {
            return;
        }
        base = await f.datasource.request({
            client: obj.client,
            data: {
                amount: money.amount || 0,
                effective: date,
                fromCurrency: money.currency
            },
            method: "GET",
            name: "convertCurrency"
        }, true);
        money.baseAmount = base.amount;
        money.effective = date;
    }

    lines.forEach(function (line) {
        if (line) {
            values.push(line.amount);
        }
    });

    try {
        while (values.length) {
            await settle(values.shift());
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "Invoice",
    settleInvoiceMoney,
    f.datasource.TRIGGER_BEFORE
);
f.datasource.registerFunction(
    "PATCH",
    "Invoice",
    settleInvoiceMoney,
    f.datasource.TRIGGER_BEFORE
);
