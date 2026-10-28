/*jslint devel */
// Grouped measure tile data for every `bi` fact table: sales, purchase,
// production, inventory. One engine so the windows, comparison fallback,
// sparklines and top-N behave the same on every tile.
//
// Sales, purchase and production are flows: a measure is summed over the
// window. Inventory is a stock: a measure is the running total of the daily
// changes up to the reporting date, there is no window, "priorYear" is the
// balance a year earlier, "priorPeriod" the balance a month earlier, and the
// sparkline is the balance at each month end.
//
// Request (obj.data):
//   fact         "sales" | "purchase" | "production" | "inventory"
//   asOf         ISO date; omitted means current_date, resolved here
//   measure      one of the fact's MEASURES
//   dimension    one of the fact's dimensions
//   window       "WTD" | "MTD" | "QTD" | "YTD" (not for a stock fact)
//   comparison   "priorYear" | "priorPeriod" | "none"   (default priorYear)
//   sparkline    months of history, 0 for none (default 12)
//   limit        0 for all (default 0)
//   sort         "amount" (default) | "name"
//
// Response: {asOf, comparison, measure, rows, total, window, needsRefresh,
// refreshedAt}; rows carry key, label, amount, units, comparison,
// unitsComparison, pctOfTotal, spark.
//
// Fact, dimension, measure and window are structural, so they come from the
// whitelists below and nothing else is interpolated.

let ITEM = "LEFT JOIN item it ON it._pk = f.item_pk ";
let ITEM_DIMS = {
    item: {
        joins: ITEM,
        key: "it.id",
        // Product number, not description (John).
        label: "it.number"
    },
    itemCategory: {
        joins: (
            ITEM +
            "LEFT JOIN item_category ic " +
            "ON ic._pk = it._category_item_category_pk "
        ),
        key: "ic.id",
        label: "ic.description"
    },
    itemGroup: {
        joins: (
            ITEM +
            "LEFT JOIN item_group ig ON ig._pk = it._group_item_group_pk "
        ),
        key: "ig.id",
        label: "ig.description"
    },
    site: {
        joins: "LEFT JOIN site s ON s._pk = f.site_pk ",
        key: "s.id",
        label: "s.code"
    }
};

function plain(parts) {
    return {amount: "f.amount", parts, units: "f.units"};
}

let FACTS = {
    inventory: {
        dimensions: {
            item: ITEM_DIMS.item,
            itemCategory: ITEM_DIMS.itemCategory,
            itemGroup: ITEM_DIMS.itemGroup,
            itemSource: {
                joins: ITEM,
                // Never null: a null key cannot be told apart from
                // another null key when the rows are matched up.
                key: "COALESCE(it.source, '(none)')",
                label: (
                    "(CASE it.source WHEN 'P' THEN 'Purchased' " +
                    "WHEN 'M' THEN 'Manufactured' " +
                    "ELSE COALESCE(it.source, '(none)') END)"
                )
            }
        },
        job: "inventory",
        measures: {
            // The daily change in quantity rides in `units`.
            quantity: {
                amount: "f.units",
                parts: ["inventory"],
                units: "f.units"
            },
            value: plain(["inventory"])
        },
        stock: true,
        table: "bi.inventory_daily"
    },
    production: {
        dimensions: ITEM_DIMS,
        job: "production",
        measures: {
            produced: plain(["produced"])
        },
        table: "bi.production_daily"
    },
    purchase: {
        dimensions: Object.assign({
            supplier: {
                joins: "LEFT JOIN supplier su ON su._pk = f.supplier_pk ",
                key: "su.id",
                label: "su.name"
            }
        }, ITEM_DIMS),
        job: "purchasing",
        measures: {
            ordered: plain(["ordered"]),
            purchased: plain(["purchased"])
        },
        table: "bi.purchase_daily"
    },
    sales: {
        dimensions: Object.assign({
            customer: {
                joins: "LEFT JOIN customer c ON c._pk = f.customer_pk ",
                key: "c.id",
                label: "c.name"
            },
            customerCategory: {
                joins: (
                    "LEFT JOIN customer c ON c._pk = f.customer_pk " +
                    "LEFT JOIN customer_category cc " +
                    "ON cc._pk = c._category_customer_category_pk "
                ),
                key: "cc.id",
                label: "cc.description"
            },
            // Joined on code so a region deleted since the last refresh
            // falls back to its code rather than vanishing.
            region: {
                joins: (
                    "LEFT JOIN sales_region sr " +
                    "ON sr.code = f.region AND NOT sr.is_deleted "
                ),
                key: "COALESCE(sr.id, f.region, '(unmapped)')",
                label: "COALESCE(sr.description, f.region, '(unmapped)')"
            }
        }, ITEM_DIMS),
        job: "sales",
        measures: {
            bookings: plain(["bookings"]),
            cogs: plain(["cogs"]),
            // Revenue - cogs; units are revenue units.
            profit: {
                amount: (
                    "(CASE WHEN f.measure = 'cogs' THEN -f.amount " +
                    "ELSE f.amount END)"
                ),
                parts: ["revenue", "cogs"],
                units: (
                    "(CASE WHEN f.measure = 'revenue' THEN f.units " +
                    "ELSE 0 END)"
                )
            },
            revenue: plain(["revenue"])
        },
        table: "bi.sales_daily"
    }
};

// Window -> the date_trunc unit its to-date period starts from.
let WINDOWS = {
    MTD: "month",
    QTD: "quarter",
    WTD: "week",
    YTD: "year"
};

// Same shape shifted back: a year, or one unit of the window. Elapsed
// offset is kept, so half a month compares with half of the last.
function comparisonShift(comparison, unit) {
    if (comparison === "priorYear") {
        return "1 year";
    }
    if (comparison === "priorPeriod") {
        // Postgres has no "1 quarter" interval.
        return (
            unit === "quarter"
            ? "3 months"
            : "1 " + unit
        );
    }
    return null;
}

async function doGetBiTileData(obj) {
    let byKey = {};
    let data = obj.data || {};
    let fact = FACTS[data.fact || "sales"];
    let dim;
    let comparison = data.comparison || "priorYear";
    let limit = Number(data.limit) || 0;
    let measure;
    let amt;
    let qty;
    let parts;
    let months = (
        data.sparkline === undefined
        ? 12
        : Number(data.sparkline)
    );
    let out;
    let rows;
    let shift;
    let spark;
    let sqlSpark;
    let total = 0;
    let unit = WINDOWS[data.window];
    let asOf;
    let built = false;
    let meta;
    let refreshedAt = null;
    let table;

    if (!fact) {
        return Promise.reject("Unknown fact: " + String(data.fact));
    }
    table = fact.table;
    // A stock has no window; the month is only what "prior period" shifts
    // by (see comparisonShift).
    if (fact.stock) {
        unit = "month";
    }
    dim = fact.dimensions[data.dimension];
    measure = data.measure || Object.keys(fact.measures)[0];
    if (!dim) {
        return Promise.reject(
            "Unknown dimension: " + String(data.dimension)
        );
    }
    if (!unit) {
        return Promise.reject("Unknown window: " + String(data.window));
    }
    if (!fact.measures[measure]) {
        return Promise.reject("Unknown measure: " + measure);
    }
    amt = fact.measures[measure].amount;
    qty = fact.measures[measure].units;
    parts = fact.measures[measure].parts;
    shift = comparisonShift(comparison, unit);
    if (comparison !== "none" && shift === null) {
        return Promise.reject("Unknown comparison: " + comparison);
    }

    let sqlMeta = (
        "SELECT to_regclass('" + table + "') IS NOT NULL AS built, " +
        "to_regclass('bi.refresh_log') IS NOT NULL AS logged, " +
        "to_char(COALESCE($1::date, current_date), 'YYYY-MM-DD') AS as_of;"
    );

    // A refresh log row for this job is what says figures were built; an
    // empty table on a fresh instance means "not yet", not "nothing".
    let sqlLog = (
        "SELECT count(*) > 0 AS ever, max(refreshed) AS refreshed " +
        "FROM bi.refresh_log WHERE job = $1;"
    );

    // Is there any bucket in a shifted window? Drives the fallback.
    function sqlHasHistory(tryShift) {
        if (fact.stock) {
            return (
                "WITH p AS (SELECT COALESCE($2::date, current_date) " +
                "AS as_of) " +
                "SELECT EXISTS (SELECT 1 FROM " + table + " f, p " +
                "WHERE f.measure = ANY($1::text[]) " +
                "AND f.bucket_date <= " +
                "(p.as_of - interval '" + tryShift + "')::date) AS has;"
            );
        }
        return (
            "WITH p AS (SELECT COALESCE($2::date, current_date) " +
            "AS as_of) " +
            "SELECT EXISTS (SELECT 1 FROM " + table + " f, p " +
            "WHERE f.measure = ANY($1::text[]) " +
            "AND f.bucket_date >= date_trunc('" + unit + "', " +
            "p.as_of - interval '" + tryShift + "')::date " +
            "AND f.bucket_date <= " +
            "(p.as_of - interval '" + tryShift + "')::date) AS has;"
        );
    }

    function windowSum(expr, by) {
        let from = (
            by
            ? "p.as_of - interval '" + by + "'"
            : "p.as_of"
        );

        // A balance is everything up to the date, however long ago it
        // started.
        if (fact.stock) {
            return (
                "SUM(" + expr + ") FILTER (" +
                "WHERE f.bucket_date <= (" + from + ")::date)"
            );
        }
        return (
            "SUM(" + expr + ") FILTER (" +
            "WHERE f.bucket_date >= date_trunc('" + unit + "', " +
            from + ")::date AND f.bucket_date <= (" + from + ")::date)"
        );
    }

    // A stock keeps a row for everything ever held, so most of them would
    // sit at nothing; drop what is empty both now and at the comparison.
    function havingSql() {
        if (!fact.stock) {
            return "";
        }
        return (
            "HAVING COALESCE(" + windowSum(amt) + ", 0) <> 0 " +
            (
                shift === null
                ? ""
                : "OR COALESCE(" + windowSum(amt, shift) + ", 0) <> 0 "
            )
        );
    }

    // Built when called: the fallback may change the shift.
    function buildRowsSql() {
        return (
            "WITH p AS (SELECT COALESCE($2::date, current_date) AS as_of) " +
            "SELECT " + dim.key + " AS key, " + dim.label + " AS label, " +
            "COALESCE(" + windowSum(amt) + ", 0) AS amount, " +
            "COALESCE(" + windowSum(qty) + ", 0) AS units, " +
            (
                shift === null
                ? (
                    "NULL::numeric AS comparison, " +
                    "NULL::numeric AS units_comparison "
                )
                : (
                    windowSum(amt, shift) + " AS comparison, " +
                    windowSum(qty, shift) + " AS units_comparison "
                )
            ) +
            "FROM " + table + " f CROSS JOIN p " + dim.joins +
            "WHERE f.measure = ANY($1::text[]) AND f.bucket_date <= p.as_of " +
            "GROUP BY 1, 2 " +
            havingSql() +
            "ORDER BY amount DESC NULLS LAST"
        );
    }

    // Monthly history ending at the reporting date.
    if (fact.stock) {
        // The balance at each month end (at the reporting date for the
        // month in progress), so every month is a point.
        sqlSpark = (
            "WITH p AS (SELECT COALESCE($2::date, current_date) AS as_of), " +
            "m AS (SELECT (date_trunc('month', p.as_of) - " +
            "interval '1 month' * g)::date AS month " +
            "FROM p, generate_series(0, $3::int) AS g) " +
            "SELECT " + dim.key + " AS key, m.month AS month, " +
            "COALESCE(SUM(" + amt + ") FILTER (WHERE f.bucket_date <= " +
            "LEAST((m.month + interval '1 month')::date - 1, p.as_of)), 0) " +
            "AS amount " +
            "FROM " + table + " f CROSS JOIN p CROSS JOIN m " + dim.joins +
            "WHERE f.measure = ANY($1::text[]) AND f.bucket_date <= p.as_of " +
            "GROUP BY 1, 2 ORDER BY 1, 2"
        );
    } else {
        sqlSpark = (
            "WITH p AS (SELECT COALESCE($2::date, current_date) AS as_of) " +
            "SELECT " + dim.key + " AS key, " +
            "date_trunc('month', f.bucket_date)::date AS month, " +
            "SUM(" + amt + ") AS amount " +
            "FROM " + table + " f CROSS JOIN p " + dim.joins +
            "WHERE f.measure = ANY($1::text[]) AND f.bucket_date <= p.as_of " +
            "AND f.bucket_date >= (date_trunc('month', p.as_of) " +
            "- interval '1 month' * $3)::date " +
            "GROUP BY 1, 2 ORDER BY 1, 2"
        );
    }

    function answer(found) {
        return {
            asOf,
            comparison: (
                shift === null
                ? "none"
                : comparison
            ),
            measure,
            needsRefresh: !built,
            refreshedAt,
            rows: found,
            total,
            window: data.window
        };
    }

    try {
        meta = await obj.client.query(sqlMeta, [data.asOf || null]);
        asOf = meta.rows[0].as_of;

        if (meta.rows[0].built && meta.rows[0].logged) {
            let log = await obj.client.query(sqlLog, [fact.job]);

            built = log.rows[0].ever;
            refreshedAt = log.rows[0].refreshed;
        }

        // Never rolled up: ask for a refresh, not an honest-looking zero.
        if (!built) {
            refreshedAt = null;
            return answer([]);
        }

        // Prior year, else prior period when there is no history; decided
        // per tile so every row compares against the same basis.
        if (comparison === "priorYear") {
            let had = await obj.client.query(
                sqlHasHistory(shift),
                [parts, data.asOf || null]
            );

            if (!had.rows[0].has) {
                let alt = comparisonShift("priorPeriod", unit);
                let near = await obj.client.query(
                    sqlHasHistory(alt),
                    [parts, data.asOf || null]
                );

                if (near.rows[0].has) {
                    comparison = "priorPeriod";
                    shift = alt;
                }
            }
        }

        rows = await obj.client.query(
            buildRowsSql(),
            [parts, data.asOf || null]
        );

        rows.rows.forEach(function (row) {
            total += Number(row.amount);
        });

        out = rows.rows.map(function (row) {
            let record = {
                amount: Number(row.amount),
                comparison: (
                    row.comparison === null
                    ? null
                    : Number(row.comparison)
                ),
                key: row.key,
                label: row.label,
                pctOfTotal: (
                    total === 0
                    ? 0
                    : (Number(row.amount) / total) * 100
                ),
                spark: [],
                units: Number(row.units),
                unitsComparison: (
                    row.units_comparison === null
                    ? null
                    : Number(row.units_comparison)
                )
            };
            byKey[row.key] = record;
            return record;
        });

        if (months > 0) {
            spark = await obj.client.query(sqlSpark, [
                parts,
                data.asOf || null,
                months - 1
            ]);
            spark.rows.forEach(function (row) {
                let record = byKey[row.key];
                if (record) {
                    record.spark.push({
                        amount: Number(row.amount),
                        month: row.month
                    });
                }
            });
        }

        if (limit > 0) {
            out = out.slice(0, limit);
        }

        // By name, after the cut, so paired tiles line up.
        if (data.sort === "name") {
            out.sort(function (a, b) {
                return String(a.label || a.key || "").localeCompare(
                    String(b.label || b.key || "")
                );
            });
        }

        return answer(out);
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doGetBiTileData",
    doGetBiTileData
);
