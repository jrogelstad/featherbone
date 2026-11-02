/*jslint devel */
// Sales order lines open at the reporting date, by promise date, for the
// due-date histogram. Open = ordered by the reporting date less shipped by
// it, so a pinned board sees the backlog as it stood. Closed orders count
// only what they shipped; incomplete orders are left out.
//
// Request: {asOf, bucket: "day" | "week" | "month"}.
// Response: {asOf, rows: [{period, late, amount, units}]}, period being the
// bucket's first day; late when due before the reporting date. Amount is
// money; units are inventory units.

let BUCKETS = ["day", "month", "week"];

let OPEN = (
    "shp AS (SELECT sl._sales_order_line_sales_order_line_pk AS line_pk, " +
    "SUM(sl.quantity) AS qty FROM sales_order_shipment_line sl " +
    "JOIN sales_order_shipment ss " +
    "ON ss._pk = sl._sales_order_shipment_sales_order_shipment_pk " +
    "AND NOT ss.is_deleted AND ss.status = 'S' " +
    "CROSS JOIN p WHERE NOT sl.is_deleted AND ss.ship_date <= p.as_of " +
    "GROUP BY 1), " +
    "o AS (SELECT COALESCE(sol.promise_date, so.promise_date, " +
    "sol.due_date) AS due, GREATEST(CASE WHEN so.status = 'C' " +
    "THEN LEAST(sol.ordered, sol.shipped) ELSE sol.ordered END - " +
    "COALESCE(shp.qty, 0), 0) AS open, " +
    "money_base(sol.amount, p.as_of) / NULLIF(sol.ordered, 0) AS each, " +
    "1 AS ratio " +
    "FROM sales_order_line sol " +
    "JOIN sales_order so ON so._pk = sol._sales_order_sales_order_pk " +
    "LEFT JOIN shp ON shp.line_pk = sol._pk CROSS JOIN p " +
    "WHERE NOT sol.is_deleted AND NOT so.is_deleted " +
    "AND so.status <> 'I' AND so.order_date <= p.as_of) "
);

async function doGetSalesSchedule(obj) {
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
    "doGetSalesSchedule",
    doGetSalesSchedule
);
