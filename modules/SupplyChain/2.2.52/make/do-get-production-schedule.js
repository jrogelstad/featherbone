/*jslint devel */
// Work orders open at the reporting date, by due date, for the due-date
// histogram. Open = ordered less received into stock by the reporting
// date, so a pinned board sees the backlog as it stood. Closed work orders
// count only what they finished. Valued at standard cost.
//
// Request: {asOf, bucket: "day" | "week" | "month"}.
// Response: {asOf, rows: [{period, late, amount, units}]}, period being the
// bucket's first day; late when due before the reporting date. Amount is
// money; units are inventory units.

let BUCKETS = ["day", "month", "week"];

let OPEN = (
    "rec AS (SELECT r._work_order_work_order_pk AS wo_pk, " +
    "SUM(r.quantity) AS qty FROM work_order_receipt r CROSS JOIN p " +
    "WHERE NOT r.is_deleted AND r.status = 'R' " +
    "AND r.receipt_date <= p.as_of GROUP BY 1), " +
    "o AS (SELECT wo.due_date AS due, GREATEST(CASE " +
    "WHEN wo.status = 'C' THEN LEAST(wo.ordered, wo.received) " +
    "ELSE wo.ordered END - COALESCE(rec.qty, 0), 0) AS open, " +
    "money_base(it.cost, p.as_of) AS each, 1 AS ratio " +
    "FROM work_order wo JOIN item it ON it._pk = wo._item_item_pk " +
    "LEFT JOIN rec ON rec.wo_pk = wo._pk CROSS JOIN p " +
    "WHERE NOT wo.is_deleted " +
    "AND LEAST(wo.created::date, COALESCE(wo.start_date, " +
    "wo.created::date)) <= p.as_of) "
);

async function doGetProductionSchedule(obj) {
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
    "doGetProductionSchedule",
    doGetProductionSchedule
);
