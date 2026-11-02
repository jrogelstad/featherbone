/*jslint devel */
// The handful of single numbers the dashboard's Key Metrics tile shows
// for sales, with the same figure a year earlier to judge each against
// and twelve months of history behind it.
//
// Read from bi.sales_daily, the same daily buckets the grouped measure
// tiles sum, so a KPI and a tile can never disagree about what revenue
// was. The reporting date is resolved server side for the same reason it
// is there: what a number means must not depend on the clock of the
// browser that asked.
//
// One service rather than one per number. Three round trips to compute
// three sums over the same table, each re-resolving the same date, would
// be three chances for them to disagree as well as three times the work.

let WINDOWS = {
    MTD: "month",
    QTD: "quarter",
    YTD: "year"
};

// Rollup KPIs: stored `parts` and how row `f` counts. Profit = revenue -
// cogs, as in the tile service.
let PLAIN = "f.amount";
let PROFIT = "(CASE WHEN f.measure = 'cogs' THEN -f.amount ELSE f.amount END)";
let KPIS = [
    {amount: PLAIN, key: "revenueYtd", parts: ["revenue"], window: "YTD"},
    {amount: PLAIN, key: "bookingsYtd", parts: ["bookings"], window: "YTD"},
    {amount: PLAIN, key: "revenueMtd", parts: ["revenue"], window: "MTD"},
    {amount: PLAIN, key: "revenueQtd", parts: ["revenue"], window: "QTD"},
    {
        amount: PROFIT,
        key: "profitYtd",
        parts: ["revenue", "cogs"],
        window: "YTD"
    }
];

/*
    Three of these do not come from the rollup at all.

    Average order size and new customers are questions about ORDERS, not
    about amounts in buckets: averaging a daily bucket would answer "the
    average day", and a customer's first order is a fact about that
    customer rather than a sum of anything. Both are cheap enough
    straight from sales_order, and the useful consequence is that they
    have an answer on an instance where nobody has pressed Refresh --
    which is why this service reports per KPI rather than refusing
    wholesale. On-time delivery likewise.
*/
let ORDER_UNITS = {
    MTD: "month",
    QTD: "quarter",
    YTD: "year"
};

let SPARK_MONTHS = 12;

/*
    Backlog: open order value at a date, read from doGetSalesSchedule so
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
            name: "doGetSalesSchedule",
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

/*
    Revenue QTD pipeline: ordered by the reporting date, promised by
    quarter end, not invoiced by the reporting date. Closed orders count
    only what they shipped; incomplete orders are excluded.
*/
let PIPELINE_SQL = (
    "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of), " +
    "q AS (SELECT as_of, (date_trunc('quarter', as_of) + " +
    "  interval '3 months' - interval '1 day')::date AS q_end FROM p), " +
    "inv AS (SELECT sl._sales_order_line_sales_order_line_pk AS line_pk, " +
    "  SUM(sl.quantity) AS qty " +
    "  FROM sales_order_shipment_line sl " +
    "  JOIN shipment_invoice si ON si._shipment_sales_order_shipment_pk = " +
    "  sl._sales_order_shipment_sales_order_shipment_pk " +
    "  AND NOT si.is_deleted " +
    "  CROSS JOIN q WHERE NOT sl.is_deleted " +
    "  AND si.invoice_date <= q.as_of GROUP BY 1) " +
    "SELECT COALESCE(SUM(money_base(sol.amount, q.as_of) / " +
    "  NULLIF(sol.ordered, 0) * GREATEST(" +
    "  CASE WHEN so.status = 'C' THEN LEAST(sol.ordered, sol.shipped) " +
    "  ELSE sol.ordered END - COALESCE(inv.qty, 0), 0)), 0) AS pending " +
    "FROM sales_order_line sol " +
    "JOIN sales_order so ON so._pk = sol._sales_order_sales_order_pk " +
    "LEFT JOIN inv ON inv.line_pk = sol._pk " +
    "CROSS JOIN q " +
    "WHERE NOT sol.is_deleted AND NOT so.is_deleted " +
    "AND so.status <> 'I' AND so.order_date <= q.as_of " +
    "AND COALESCE(sol.promise_date, so.promise_date, sol.due_date) " +
    "<= q.q_end;"
);

function sumSql(unit, shifted, amount) {
    let anchor = (
        shifted
        ? "(p.as_of - interval '1 year')"
        : "p.as_of"
    );

    return (
        "(SELECT COALESCE(SUM(" + amount + "), 0) " +
        "FROM bi.sales_daily f, p " +
        "WHERE f.measure = ANY($2::text[]) " +
        "AND f.bucket_date >= date_trunc('" + unit + "', " + anchor +
        ")::date " +
        "AND f.bucket_date <= " + anchor + "::date)"
    );
}

async function doGetSalesKpis(obj) {
    /*
        The REQUEST payload, not the wrapper around it. Read from the
        wrapper by mistake, every asOf here was undefined and every
        figure quietly fell back to current_date -- so a board pinned to
        a date showed its tiles at that date and its metrics at today's,
        side by side, with nothing to say they were different periods.
    */
    let data = obj.data || {};
    let asOf;
    let meta;
    let out = {};
    let refreshedAt = null;
    let built = false;
    let pipeline;

    let sqlMeta = (
        "SELECT to_regclass('bi.sales_daily') IS NOT NULL AS built, " +
        "to_regclass('bi.refresh_log') IS NOT NULL AS logged, " +
        "to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') AS as_of;"
    );

    let sqlEverBuilt = (
        "SELECT EXISTS (SELECT 1 FROM bi.refresh_log) AS ever, " +
        "max(refreshed) AS refreshed FROM bi.refresh_log;"
    );

    // Whole months, so a sparkline's last point is the month in
    // progress rather than a stub of a few days pretending to be one.
    function sqlSpark(amount) {
        return (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT to_char(date_trunc('month', f.bucket_date), 'YYYY-MM') " +
            "  AS month, " +
            "COALESCE(SUM(" + amount + "), 0) AS amount " +
            "FROM bi.sales_daily f, p " +
            "WHERE f.measure = ANY($2::text[]) AND f.bucket_date <= p.as_of " +
            "AND f.bucket_date >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $3)::date " +
            "GROUP BY 1 ORDER BY 1;"
        );
    }

    async function oneKpi(kpi) {
        let unit = WINDOWS[kpi.window];
        let sql = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT " + sumSql(unit, false, kpi.amount) + " AS value, " +
            sumSql(unit, true, kpi.amount) + " AS comparison;"
        );
        let sums = await obj.client.query(sql, [
            data.asOf || null,
            kpi.parts
        ]);
        let spark = await obj.client.query(sqlSpark(kpi.amount), [
            data.asOf || null,
            kpi.parts,
            SPARK_MONTHS - 1
        ]);

        out[kpi.key] = {
            comparison: Number(sums.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: spark.rows.map(function (row) {
                return Number(row.amount);
            }),
            value: Number(sums.rows[0].value)
        };
    }

    async function orderKpis(client, at, into) {
        let unit = ORDER_UNITS.YTD;
        let window = (
            "so.order_date >= date_trunc('" + unit + "', %ANCHOR%)::date " +
            "AND so.order_date <= %ANCHOR%::date"
        );
        let now = window.split("%ANCHOR%").join("p.as_of");
        let prior = window.split("%ANCHOR%").join(
            "(p.as_of - interval '1 year')"
        );
        let firstOrder = (
            "(SELECT so._customer_customer_pk AS customer_pk, " +
            "min(so.order_date) AS first_order " +
            "FROM sales_order so WHERE NOT so.is_deleted GROUP BY 1)"
        );
        let sqlSize = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT (SELECT " +
            "  COALESCE(AVG(money_base(so.total, so.order_date)), 0) " +
            "  FROM sales_order so, p " +
            "  WHERE NOT so.is_deleted AND " + now + ") AS value, " +
            "(SELECT COALESCE(AVG(money_base(so.total, so.order_date)), 0) " +
            "  FROM sales_order so, p " +
            "  WHERE NOT so.is_deleted AND " + prior + ") AS comparison;"
        );
        let sqlSizeSpark = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT to_char(date_trunc('month', so.order_date), " +
            "  'YYYY-MM') AS month, " +
            "COALESCE(AVG(money_base(so.total, so.order_date)), 0) AS amount " +
            "FROM sales_order so, p " +
            "WHERE NOT so.is_deleted AND so.order_date <= p.as_of " +
            "AND so.order_date >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $2)::date " +
            "GROUP BY 1 ORDER BY 1;"
        );
        let sqlNew = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of), " +
            "f AS " + firstOrder + " " +
            "SELECT (SELECT count(*) FROM f, p WHERE f.first_order >= " +
            "  date_trunc('year', p.as_of)::date " +
            "  AND f.first_order <= p.as_of) AS value, " +
            "(SELECT count(*) FROM f, p WHERE f.first_order >= " +
            "  date_trunc('year', (p.as_of - interval '1 year'))::date " +
            "  AND f.first_order <= (p.as_of - interval '1 year')::date" +
            ") AS comparison;"
        );
        let sqlNewSpark = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of), " +
            "f AS " + firstOrder + " " +
            "SELECT to_char(date_trunc('month', f.first_order), " +
            "  'YYYY-MM') AS month, count(*) AS amount " +
            "FROM f, p WHERE f.first_order <= p.as_of " +
            "AND f.first_order >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $2)::date " +
            "GROUP BY 1 ORDER BY 1;"
        );
        // On-time delivery: share of shipped sales order shipments sent by
        // the promise date (else requested date). NULL when none shipped.
        let onTime = (
            "100.0 * count(*) FILTER (WHERE ss.ship_date <= " +
            "COALESCE(so.promise_date, so.requested_date, ss.ship_date)) " +
            "/ NULLIF(count(*), 0)"
        );
        let shipped = (
            "FROM sales_order_shipment ss " +
            "JOIN sales_order so ON so._pk = ss._sales_order_sales_order_pk " +
            "CROSS JOIN p WHERE NOT ss.is_deleted AND ss.status = 'S' "
        );
        let sqlOtd = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT (SELECT " + onTime + " " + shipped +
            "  AND ss.ship_date >= date_trunc('year', p.as_of)::date " +
            "  AND ss.ship_date <= p.as_of) AS value, " +
            "(SELECT " + onTime + " " + shipped +
            "  AND ss.ship_date >= " +
            "  date_trunc('year', (p.as_of - interval '1 year'))::date " +
            "  AND ss.ship_date <= (p.as_of - interval '1 year')::date" +
            ") AS comparison;"
        );
        let sqlOtdSpark = (
            "WITH p AS (SELECT COALESCE($1::date, current_date) AS as_of) " +
            "SELECT to_char(date_trunc('month', ss.ship_date), " +
            "  'YYYY-MM') AS month, " + onTime + " AS amount " +
            shipped + "AND ss.ship_date <= p.as_of " +
            "AND ss.ship_date >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $2)::date " +
            "GROUP BY 1 ORDER BY 1;"
        );
        let months = SPARK_MONTHS - 1;
        let otd = await client.query(sqlOtd, [at]);
        let otdSpark = await client.query(sqlOtdSpark, [at, months]);
        let size = await client.query(sqlSize, [at]);
        let sizeSpark = await client.query(sqlSizeSpark, [at, months]);
        let fresh = await client.query(sqlNew, [at]);
        let freshSpark = await client.query(sqlNewSpark, [at, months]);

        function points(resp) {
            return resp.rows.map(function (row) {
                return Number(row.amount);
            });
        }

        into.avgOrderSize = {
            comparison: Number(size.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(sizeSpark),
            value: Number(size.rows[0].value)
        };
        function orNull(value) {
            return (
                value === null
                ? null
                : Number(value)
            );
        }

        into.onTimeDelivery = {
            comparison: orNull(otd.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(otdSpark),
            value: orNull(otd.rows[0].value)
        };
        into.newCustomers = {
            comparison: Number(fresh.rows[0].comparison),
            comparisonLabel: "a year ago",
            spark: points(freshSpark),
            value: Number(fresh.rows[0].value)
        };
    }

    try {
        meta = await obj.client.query(sqlMeta, [data.asOf || null]);
        asOf = meta.rows[0].as_of;

        if (meta.rows[0].built && meta.rows[0].logged) {
            let ever = await obj.client.query(sqlEverBuilt);

            built = ever.rows[0].ever;
            refreshedAt = ever.rows[0].refreshed;
        }

        // The order-based ones answer whether or not the rollup has run.
        await orderKpis(obj.client, data.asOf || null, out);
        await backlogKpis(obj, asOf, out);

        /*
            The rollup ones are left out entirely when nothing has been
            rolled up, rather than answered with zeroes. A zero is a
            number somebody can act on, and "no revenue" and "nobody has
            built the figures" are not the same thing. The tile shows a
            dash for a metric with no value.
        */
        if (built) {
            await Promise.all(KPIS.map(oneKpi));
            pipeline = await obj.client.query(PIPELINE_SQL, [
                data.asOf || null
            ]);
            out.revenueQtd.pending = Number(pipeline.rows[0].pending);
            out.revenueQtd.pendingLabel = "open orders due this quarter";
        }

        /*
            `asOf` is echoed back deliberately: it is the date these
            figures were actually computed at, and a caller that asked
            for one date and is handed another has been given numbers
            for a period it did not ask about.
        */
        return {
            asOf,
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
    "doGetSalesKpis",
    doGetSalesKpis
);
