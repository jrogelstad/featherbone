/*jslint devel */
// Purchasing numbers for the Key Metrics tile: Purchased YTD, MTD and WTD
// from bi.purchase_daily (the purchasing tiles' buckets), and On-Time
// Receipt live from the receipts, so it answers before any Refresh. Each
// with the figure a year earlier and twelve months of history.
//
// On-time receipt: share of posted receipt lines received by the date the
// supplier confirmed, else the planned delivery. A date the supplier later
// changed does not move the goalposts.

let WINDOWS = {
    MTD: "month",
    WTD: "week",
    YTD: "year"
};

let KPIS = [
    {key: "purchasedYtd", measure: "purchased", window: "YTD"},
    {key: "purchasedMtd", measure: "purchased", window: "MTD"},
    {key: "purchasedWtd", measure: "purchased", window: "WTD"}
];

let SPARK_MONTHS = 12;

/*
    Backlog: open order value at a date, read from doGetPurchaseSchedule so
    the KPI and the histogram agree. History is the backlog at each of the
    last eleven month ends, then the reporting date.
*/
function monthEnds(asOf) {
    let at = new Date(asOf + "T00:00:00Z");
    let out = [];
    let back = SPARK_MONTHS - 1;

    while (back > 0) {
        out.push(new Date(Date.UTC(
            at.getUTCFullYear(),
            at.getUTCMonth() - back + 1,
            0
        )).toISOString().slice(0, 10));
        back -= 1;
    }
    out.push(asOf);
    return out;
}

function yearBefore(asOf) {
    let at = new Date(asOf + "T00:00:00Z");

    at.setUTCFullYear(at.getUTCFullYear() - 1);
    return at.toISOString().slice(0, 10);
}

async function backlogKpis(obj, asOf, into) {
    async function at(date) {
        let resp = await f.datasource.request({
            client: obj.client,
            data: {asOf: date, bucket: "month"},
            method: "POST",
            name: "doGetPurchaseSchedule",
            user: obj.client.currentUser()
        }, true);
        let sum = {late: 0, total: 0};

        resp.rows.forEach(function (row) {
            sum.total += row.amount;
            if (row.late) {
                sum.late += row.amount;
            }
        });
        return sum;
    }
    let history = [];
    let dates = monthEnds(asOf);
    let prior = await at(yearBefore(asOf));
    let index = 0;
    let now;

    while (index < dates.length) {
        history.push(await at(dates[index]));
        index += 1;
    }
    now = history[history.length - 1];

    into.backlog = {
        comparison: prior.total,
        comparisonLabel: "a year ago",
        spark: history.map((one) => one.total),
        value: now.total
    };
    into.overdueBacklog = {
        comparison: prior.late,
        comparisonLabel: "a year ago",
        spark: history.map((one) => one.late),
        value: now.late
    };
}

// Share of receipts on time, NULL when there were none.
let ON_TIME = (
    "100.0 * count(*) FILTER (WHERE r.receipt_date <= " +
    "COALESCE(pol.confirmed_delivery, pol.planned_delivery, " +
    "pol.due_date, r.receipt_date)) / NULLIF(count(*), 0)"
);
let RECEIVED = (
    "FROM purchase_order_receipt_line rl " +
    "JOIN purchase_order_receipt r " +
    "ON r._pk = " +
    "rl._purchase_order_receipt_purchase_order_receipt_pk " +
    "AND NOT r.is_deleted AND r.status = 'R' " +
    "JOIN purchase_order_line pol " +
    "ON pol._pk = rl._purchase_order_line_purchase_order_line_pk " +
    "CROSS JOIN p WHERE NOT rl.is_deleted "
);

function sumSql(unit, shifted) {
    let anchor = (
        shifted
        ? "(p.as_of - interval '1 year')"
        : "p.as_of"
    );

    return (
        "(SELECT COALESCE(SUM(f.amount), 0) " +
        "FROM bi.purchase_daily f, p " +
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

async function doGetPurchaseKpis(obj) {
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
            "FROM bi.purchase_daily f, p WHERE f.measure = $3 " +
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
            "SELECT to_regclass('bi.purchase_daily') IS NOT NULL AS built, " +
            "to_regclass('bi.refresh_log') IS NOT NULL AS logged, " +
            "to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') " +
            "AS as_of;",
            [at]
        );

        if (meta.rows[0].built && meta.rows[0].logged) {
            let log = await obj.client.query(
                "SELECT count(*) > 0 AS ever, max(refreshed) AS refreshed " +
                "FROM bi.refresh_log WHERE job = 'purchasing';"
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
        out.onTimeReceipt = {
            comparison: orNull(onTime.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(onTimeSpark),
            value: orNull(onTime.rows[0].value)
        };

        await backlogKpis(obj, meta.rows[0].as_of, out);

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
    "doGetPurchaseKpis",
    doGetPurchaseKpis
);
