/*jslint devel */
// Purchase order lines open at the reporting date, by expected delivery,
// for the due-date histogram. Open = ordered by the reporting date less
// received by it, so a pinned board sees the backlog as it stood. Closed
// lines count only what they received.
//
// Request: {asOf, bucket: "day" | "week" | "month"}.
// Response: {asOf, rows: [{period, late, amount, units}]}, period being the
// bucket's first day; late when due before the reporting date. Amount is
// money; units are inventory units.

let BUCKETS = ["day", "month", "week"];

let OPEN = (
    "rec AS (SELECT rl._purchase_order_line_purchase_order_line_pk " +
    "AS line_pk, SUM(rl.quantity) AS qty " +
    "FROM purchase_order_receipt_line rl " +
    "JOIN purchase_order_receipt r ON r._pk = " +
    "rl._purchase_order_receipt_purchase_order_receipt_pk " +
    "AND NOT r.is_deleted AND r.status = 'R' " +
    "CROSS JOIN p WHERE NOT rl.is_deleted AND r.receipt_date <= p.as_of " +
    "GROUP BY 1), " +
    "o AS (SELECT pol.due_date AS due, GREATEST(CASE " +
    "WHEN pol.status = 'C' THEN LEAST(pol.ordered, pol.received) " +
    "ELSE pol.ordered END - COALESCE(rec.qty, 0), 0) AS open, " +
    "money_base(pol.amount, p.as_of) / NULLIF(pol.ordered, 0) AS each, " +
    "COALESCE(NULLIF(pol.ratio, 0), 1) AS ratio " +
    "FROM purchase_order_line pol " +
    "JOIN purchase_order po " +
    "ON po._pk = pol._purchase_order_purchase_order_pk " +
    "LEFT JOIN rec ON rec.line_pk = pol._pk CROSS JOIN p " +
    "WHERE NOT pol.is_deleted AND NOT po.is_deleted " +
    "AND po.order_date <= p.as_of) "
);

async function doGetPurchaseSchedule(obj) {
    let data = obj.data || {};
    let bucket = data.bucket || "week";
    let sql = (
        "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of), " +
        OPEN +
        "SELECT to_char(date_trunc('" + bucket + "', o.due), " +
        "'YYYY-MM-DD') AS period, o.due < p.as_of AS late, " +
        "SUM(o.open * COALESCE(o.each, 0)) AS amount, " +
        "SUM(o.open * o.ratio) AS units " +
        "FROM o CROSS JOIN p WHERE o.open > 0 AND o.due IS NOT NULL " +
        "GROUP BY 1, 2 ORDER BY 1, 2;"
    );
    let meta;
    let rows;

    if (BUCKETS.indexOf(bucket) === -1) {
        return Promise.reject("Unknown bucket: " + String(bucket));
    }

    try {
        meta = await obj.client.query(
            "SELECT to_char(COALESCE($1::date, current_date), " +
            "'YYYY-MM-DD') AS as_of;",
            [data.asOf || null]
        );
        rows = await obj.client.query(sql, [data.asOf || null]);

        return {
            asOf: meta.rows[0].as_of,
            rows: rows.rows.map(function (row) {
                return {
                    amount: Number(row.amount),
                    late: row.late,
                    period: row.period,
                    units: Number(row.units)
                };
            })
        };
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doGetPurchaseSchedule",
    doGetPurchaseSchedule
);
