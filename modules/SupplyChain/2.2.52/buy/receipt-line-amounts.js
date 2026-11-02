/*jslint node*/
/**
    Fills in the value of receipt lines posted before the line carried
    one.

    A posted receipt line is worth its quantity at the order line's unit
    price (quantity / ordered of the line's amount, to the cent), kept as
    money says it: the amount in the order's own currency, and the base
    amount converted at the rate in force on the day the receipt was
    posted, with `effective` set to that day. Converted the way the
    framework's convertCurrency does it: the latest rate on or before that
    day, divided where the rate is stored base to foreign and multiplied
    where it is foreign to base, rounded to the base currency's minor
    unit.

    Runs at every deploy and touches only posted lines that still need it:
    those with no value, and those whose value is not in the order's
    currency or not dated the day the receipt was posted -- which is
    every line an earlier version of this script or of posting valued. A
    line already done is left alone, so a redeploy changes nothing. A day
    and currency with no rate cannot be converted and is left as it is;
    the deploy log says how many.

    @module BuyReceiptLineAmounts
*/
(function (exports) {
    "use strict";

    // Posted lines whose order line is priced, one row per day and
    // currency, so each rate is looked up once.
    //
    // "Priced" is tested on the amount itself, not the money as a whole:
    // a composite IS NOT NULL only when every field is, and an order
    // line's money has no `effective` until something settles it, so
    // `pol.amount IS NOT NULL` was false for every unsettled order line
    // -- every one on a real database -- and nothing was filled in.
    const WANTED = (
        "FROM purchase_order_receipt_line rl " +
        "JOIN purchase_order_receipt r " +
        "ON r._pk = rl._purchase_order_receipt_purchase_order_receipt_pk " +
        "JOIN purchase_order_line pol " +
        "ON pol._pk = rl._purchase_order_line_purchase_order_line_pk " +
        "WHERE r.status = 'R' AND NOT r.is_deleted AND NOT rl.is_deleted " +
        "AND r.receipt_date IS NOT NULL " +
        "AND pol.ordered <> 0 AND (pol.amount).amount IS NOT NULL " +
        "AND (pol.amount).currency IS NOT NULL "
    );

    // The base currency on a day: the latest one in force by then, or the
    // earliest there is when the day predates them all.
    const BASE_BY = (
        "SELECT (bc.currency).code AS code, " +
        "(bc.currency).minor_unit AS minor FROM _base_currency bc " +
        "WHERE bc.effective <= ($1::date + 1)::timestamptz " +
        "ORDER BY bc.effective DESC LIMIT 1;"
    );
    const BASE_FIRST = (
        "SELECT (bc.currency).code AS code, " +
        "(bc.currency).minor_unit AS minor FROM _base_currency bc " +
        "ORDER BY bc.effective ASC LIMIT 1;"
    );

    // The latest rate between two currencies on a day. The framework
    // looks up to the end of the day, hence the day after.
    const RATE = (
        "SELECT (cc.from_currency).code AS from_code, cc.ratio " +
        "FROM _currency_conversion cc " +
        "WHERE (cc.from_currency).code IN ($1, $2) " +
        "AND (cc.to_currency).code IN ($1, $2) " +
        "AND cc.effective < ($3::date + 1)::timestamptz " +
        "ORDER BY cc.effective DESC LIMIT 1;"
    );

    function update(op) {
        let share = (
            "round(rl.quantity * (pol.amount).amount / pol.ordered, 2)"
        );

        return (
            "UPDATE purchase_order_receipt_line rl " +
            "SET amount = ROW(" + share + ", (pol.amount).currency, " +
            "$1::date::timestamptz, " +
            "round(" + share + " " + op + " $3::numeric, $4::int))::mono " +
            "FROM purchase_order_receipt r, purchase_order_line pol " +
            "WHERE r._pk = rl._purchase_order_receipt_purchase_order_" +
            "receipt_pk " +
            "AND pol._pk = rl._purchase_order_line_purchase_order_line_pk " +
            "AND r.status = 'R' AND NOT r.is_deleted AND NOT rl.is_deleted " +
            "AND pol.ordered <> 0 AND (pol.amount).amount IS NOT NULL " +
            "AND r.receipt_date = $1::date " +
            "AND (pol.amount).currency = $2 " +
            "AND ((rl.amount).amount IS NULL " +
            "OR (rl.amount).base_amount IS NULL " +
            "OR (rl.amount).currency IS DISTINCT FROM (pol.amount).currency " +
            "OR (rl.amount).effective IS DISTINCT FROM " +
            "r.receipt_date::timestamptz);"
        );
    }

    exports.execute = async function (obj) {
        let client = obj.client;
        let groups = await client.query(
            "SELECT DISTINCT to_char(r.receipt_date, 'YYYY-MM-DD') AS day, " +
            "(pol.amount).currency AS currency " + WANTED +
            "ORDER BY 1, 2;"
        );
        let skipped = 0;
        let base;
        let rate;
        let group;
        let index = 0;

        while (index < groups.rows.length) {
            group = groups.rows[index];
            index += 1;
            base = (await client.query(BASE_BY, [group.day])).rows[0];
            if (!base) {
                base = (await client.query(BASE_FIRST)).rows[0];
            }

            if (!base) {
                skipped += 1;
            } else if (group.currency === base.code) {
                await client.query(
                    update("*"),
                    [group.day, group.currency, 1, base.minor]
                );
            } else {
                rate = (await client.query(
                    RATE,
                    [group.currency, base.code, group.day]
                )).rows[0];

                if (!rate) {
                    skipped += 1;
                } else {
                    await client.query(
                        update(
                            (rate.from_code === base.code)
                            ? "/"
                            : "*"
                        ),
                        [group.day, group.currency, rate.ratio, base.minor]
                    );
                }
            }
        }

        if (skipped) {
            console.log(
                "Receipt line values: " + skipped + " day and currency " +
                "combinations have no exchange rate and were left unvalued."
            );
        }
    };

}(exports));
