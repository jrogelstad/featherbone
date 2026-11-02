/*jslint node*/
/**
    Settles the base-currency value of invoices saved before invoices
    settled their own (bill/triggers-invoice.js, settleInvoiceMoney).

    An invoice is a completed transaction, so its value in the books'
    currency is the one on its date. Each line amount and the subtotal,
    tax, freight and total that has no `effective` yet gets the invoice
    date as `effective` and its base amount at that day's rate, from the
    framework's money_base -- which also says when there is no rate, by
    answering nothing, and such a value is left open rather than settled
    at zero. Paid and balance stay open; they move with payments.

    Runs at every deploy and only touches values with no `effective`, so
    a redeploy changes nothing.

    @module BillInvoiceBaseAmounts
*/
(function (exports) {
    "use strict";

    function settled(col, dateCol) {
        return (
            col + " = CASE WHEN (" + col + ").effective IS NULL " +
            "AND money_base(" + col + ", " + dateCol + ") IS NOT NULL " +
            "THEN ROW((" + col + ").amount, (" + col + ").currency, " +
            dateCol + "::timestamptz, money_base(" + col + ", " + dateCol +
            "))::mono ELSE " + col + " END"
        );
    }

    const SQL = [
        (
            "UPDATE invoice_line il SET " +
            settled("amount", "i.invoice_date") + " " +
            "FROM invoice i " +
            "WHERE i._pk = il._invoice_invoice_pk " +
            "AND i.invoice_date IS NOT NULL " +
            "AND (il.amount).effective IS NULL;"
        ),
        (
            "UPDATE invoice SET " +
            ["subtotal", "tax", "freight", "total"].map(function (col) {
                return settled(col, "invoice_date");
            }).join(", ") + " " +
            "WHERE invoice_date IS NOT NULL " +
            "AND ((subtotal).effective IS NULL " +
            "OR (tax).effective IS NULL " +
            "OR (freight).effective IS NULL " +
            "OR (total).effective IS NULL);"
        )
    ];

    exports.execute = async function (obj) {
        let index = 0;

        while (index < SQL.length) {
            await obj.client.query(SQL[index]);
            index += 1;
        }
    };

}(exports));
