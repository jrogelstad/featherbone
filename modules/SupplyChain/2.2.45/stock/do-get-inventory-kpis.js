/*jslint devel */
// Inventory numbers for the Key Metrics tile: Inventory Value, from
// bi.inventory_daily (the inventory tiles' daily changes). Value is a
// balance, not a flow, so "now" is the running total up to the reporting
// date, the comparison is the same running total a year earlier, and the
// history is the balance at each of the last twelve month ends (the last
// point is the balance at the reporting date, the month in progress).
//
// No comparison (null) when the ledger has nothing that old: a balance of
// zero a year ago reads as "up infinity percent", which is not an answer.

let SPARK_MONTHS = 12;
// Most late postings the figure lists ids for (see latePostings below).
let LATE_IDS = 500;

function orNull(value) {
    return (
        value === null
        ? null
        : Number(value)
    );
}

async function doGetInventoryKpis(obj) {
    let data = obj.data || {};
    let at = data.asOf || null;
    let built = false;
    let refreshedAt = null;
    let meta;
    let totals;
    let spark;
    let close;
    let late;
    let out = {};

    try {
        meta = await obj.client.query(
            "SELECT to_regclass('bi.inventory_daily') IS NOT NULL AS built, " +
            "to_regclass('bi.refresh_log') IS NOT NULL AS logged, " +
            "to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') " +
            "AS as_of;",
            [at]
        );

        if (meta.rows[0].built && meta.rows[0].logged) {
            let log = await obj.client.query(
                "SELECT count(*) > 0 AS ever, max(refreshed) AS refreshed " +
                "FROM bi.refresh_log WHERE job = 'inventory';"
            );

            built = log.rows[0].ever;
            refreshedAt = log.rows[0].refreshed;
        }

        // Rollup figures only once built: a zero would read as "none".
        if (built) {
            totals = await obj.client.query(
                "WITH p AS (SELECT COALESCE($1::date, current_date) " +
                "AS as_of) " +
                "SELECT COALESCE(SUM(f.amount) FILTER (" +
                "WHERE f.bucket_date <= p.as_of), 0) AS value, " +
                "CASE WHEN bool_or(f.bucket_date <= " +
                "(p.as_of - interval '1 year')::date) THEN " +
                "COALESCE(SUM(f.amount) FILTER (WHERE f.bucket_date <= " +
                "(p.as_of - interval '1 year')::date), 0) END " +
                "AS comparison " +
                "FROM bi.inventory_daily f CROSS JOIN p " +
                "WHERE f.measure = 'inventory';",
                [at]
            );
            spark = await obj.client.query(
                "WITH p AS (SELECT COALESCE($1::date, current_date) " +
                "AS as_of), " +
                "m AS (SELECT (date_trunc('month', p.as_of) - " +
                "interval '1 month' * g)::date AS month " +
                "FROM p, generate_series(0, $2::int) AS g) " +
                "SELECT to_char(m.month, 'YYYY-MM') AS month, " +
                "COALESCE(SUM(f.amount) FILTER (WHERE f.bucket_date <= " +
                "LEAST((m.month + interval '1 month')::date - 1, " +
                "p.as_of)), 0) AS amount " +
                "FROM m CROSS JOIN p LEFT JOIN bi.inventory_daily f " +
                "ON f.measure = 'inventory' AND f.bucket_date <= p.as_of " +
                "GROUP BY m.month ORDER BY m.month;",
                [at, SPARK_MONTHS - 1]
            );

            out.inventoryValue = {
                comparison: orNull(totals.rows[0].comparison),
                comparisonLabel: "a year ago",
                spark: spark.rows.map((row) => Number(row.amount)),
                value: Number(totals.rows[0].value)
            };
        }

        /*
            Late postings: what has been entered since the latest closing
            snapshot with a date on or before it -- the difference between
            what the ledger says now and what was reported at close, and
            what accountants chase the week after month end. Read from the
            ledger itself, not the rollup, so it needs no refresh. No
            closing snapshot, no figure.
        */
        close = await obj.client.query(
            "SELECT v.id, v._pk AS pk, " +
            "to_char(v.as_of, 'YYYY-MM-DD') AS as_of, " +
            "s.id AS site_id, s.code AS site_code, " +
            "(v.total_value).amount AS reported " +
            "FROM inventory_value v LEFT JOIN site s " +
            "ON s._pk = v._site_site_pk " +
            "WHERE v.is_closing AND NOT v.is_deleted " +
            "AND v.as_of <= COALESCE($1::date, current_date) " +
            "ORDER BY v.as_of DESC, (v._site_site_pk IS NULL) DESC, " +
            "v._pk DESC LIMIT 1;",
            [at]
        );
        if (close.rows.length) {
            /*
                Entered after the close is a larger key than the closing
                snapshot's, not a later timestamp: keys come from one
                sequence, and timestamps lie in demo data. The ids travel
                with the figure so the drill-down lists exactly these --
                a list filter cannot compare keys -- and there should be
                few of them; past LATE_IDS the list says it is showing
                the first ones.
            */
            late = await obj.client.query(
                "SELECT COUNT(*) AS n, " +
                "COALESCE(SUM(money_base(t.total_cost, t.date)), 0) " +
                "AS value, " +
                "(array_agg(t.id ORDER BY t._pk))[1:$4] AS ids " +
                "FROM inventory_transaction t " +
                "WHERE NOT t.is_deleted AND t.date <= $1::date " +
                "AND t._pk > $2 " +
                "AND ($3::text IS NULL OR t._site_site_pk = " +
                "(SELECT _pk FROM site WHERE id = $3));",
                [
                    close.rows[0].as_of,
                    close.rows[0].pk,
                    close.rows[0].site_id,
                    LATE_IDS
                ]
            );
            out.latePostings = {
                close: {
                    asOf: close.rows[0].as_of,
                    id: close.rows[0].id,
                    reported: Number(close.rows[0].reported),
                    site: close.rows[0].site_id,
                    siteCode: close.rows[0].site_code
                },
                count: Number(late.rows[0].n),
                ids: late.rows[0].ids || [],
                value: Number(late.rows[0].value)
            };
        }

        return {
            asOf: meta.rows[0].as_of,
            kpis: out,
            needsRefresh: !built,
            refreshedAt
        };
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doGetInventoryKpis",
    doGetInventoryKpis
);
