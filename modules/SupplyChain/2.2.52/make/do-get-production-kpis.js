/*jslint devel */
// Production numbers for the Key Metrics tile: Produced YTD, MTD and WTD
// from bi.production_daily (the production tiles' buckets), and On-Time
// Completions live from the work order receipts, so it answers before any
// Refresh. Each with the figure a year earlier and twelve months of history.
//
// On-time completions: share of posted work order receipts received by the
// work order's due date.

let WINDOWS = {
    MTD: "month",
    WTD: "week",
    YTD: "year"
};

let KPIS = [
    {key: "producedYtd", measure: "produced", window: "YTD"},
    {key: "producedMtd", measure: "produced", window: "MTD"},
    {key: "producedWtd", measure: "produced", window: "WTD"}
];

let SPARK_MONTHS = 12;

// Share of receipts on time, NULL when there were none.
let ON_TIME = (
    "100.0 * count(*) FILTER (WHERE r.receipt_date <= " +
    "COALESCE(wo.due_date, r.receipt_date)) / NULLIF(count(*), 0)"
);
let RECEIVED = (
    "FROM work_order_receipt r " +
    "JOIN work_order wo ON wo._pk = r._work_order_work_order_pk " +
    "CROSS JOIN p WHERE NOT r.is_deleted AND r.status = 'R' "
);

function sumSql(unit, shifted) {
    let anchor = (
        shifted
        ? "(p.as_of - interval '1 year')"
        : "p.as_of"
    );

    return (
        "(SELECT COALESCE(SUM(f.amount), 0) " +
        "FROM bi.production_daily f, p " +
        "WHERE f.measure = $2 " +
        "AND f.bucket_date >= date_trunc('" + unit + "', " + anchor +
        ")::date AND f.bucket_date <= " + anchor + "::date)"
    );
}

// Whole months, so the last point is the month in progress.
function sparkSql(value, from, dated) {
    return (
        "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
        "SELECT to_char(date_trunc('month', " + dated + "), 'YYYY-MM') " +
        "AS month, " + value + " AS amount " + from +
        "AND " + dated + " <= p.as_of " +
        "AND " + dated + " >= (date_trunc('month', p.as_of) " +
        "- interval '1 month' * $2)::date " +
        "GROUP BY 1 ORDER BY 1;"
    );
}

function points(resp) {
    return resp.rows.map(function (row) {
        return Number(row.amount);
    });
}

function orNull(value) {
    return (
        value === null
        ? null
        : Number(value)
    );
}

async function doGetProductionKpis(obj) {
    let data = obj.data || {};
    let at = data.asOf || null;
    let out = {};
    let built = false;
    let refreshedAt = null;
    let meta;
    let months = SPARK_MONTHS - 1;
    let sqlOnTime = (
        "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
        "SELECT (SELECT " + ON_TIME + " " + RECEIVED +
        "AND r.receipt_date >= date_trunc('year', p.as_of)::date " +
        "AND r.receipt_date <= p.as_of) AS value, " +
        "(SELECT " + ON_TIME + " " + RECEIVED +
        "AND r.receipt_date >= " +
        "date_trunc('year', (p.as_of - interval '1 year'))::date " +
        "AND r.receipt_date <= (p.as_of - interval '1 year')::date" +
        ") AS comparison;"
    );
    let onTime;
    let onTimeSpark;

    async function oneKpi(kpi) {
        let unit = WINDOWS[kpi.window];
        let sums = await obj.client.query(
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT " + sumSql(unit, false) + " AS value, " +
            sumSql(unit, true) + " AS comparison;",
            [at, kpi.measure]
        );
        let spark = await obj.client.query(
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT to_char(date_trunc('month', f.bucket_date), 'YYYY-MM') " +
            "AS month, COALESCE(SUM(f.amount), 0) AS amount " +
            "FROM bi.production_daily f, p WHERE f.measure = $3 " +
            "AND f.bucket_date <= p.as_of " +
            "AND f.bucket_date >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $2)::date " +
            "GROUP BY 1 ORDER BY 1;",
            [at, months, kpi.measure]
        );

        out[kpi.key] = {
            comparison: Number(sums.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(spark),
            value: Number(sums.rows[0].value)
        };
    }

    try {
        meta = await obj.client.query(
            "SELECT to_regclass('bi.production_daily') IS NOT NULL AS built, " +
            "to_regclass('bi.refresh_log') IS NOT NULL AS logged, " +
            "to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') " +
            "AS as_of;",
            [at]
        );

        if (meta.rows[0].built && meta.rows[0].logged) {
            let log = await obj.client.query(
                "SELECT count(*) > 0 AS ever, max(refreshed) AS refreshed " +
                "FROM bi.refresh_log WHERE job = 'production';"
            );

            built = log.rows[0].ever;
            refreshedAt = log.rows[0].refreshed;
        }

        onTime = await obj.client.query(sqlOnTime, [at]);
        onTimeSpark = await obj.client.query(sparkSql(
            ON_TIME,
            RECEIVED,
            "r.receipt_date"
        ), [at, months]);
        out.onTimeCompletion = {
            comparison: orNull(onTime.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(onTimeSpark),
            value: orNull(onTime.rows[0].value)
        };

        // Rollup figures only once built: a zero would read as "none".
        if (built) {
            await Promise.all(KPIS.map(oneKpi));
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
    "doGetProductionKpis",
    doGetProductionKpis
);
