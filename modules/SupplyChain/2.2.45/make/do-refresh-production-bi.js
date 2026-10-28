/*jslint devel */
// Rebuilds bi.production_daily from the Work Order Receipt inventory
// transactions: what was finished, when, at the standard cost it went into
// stock at.
//
//   produced   transaction date   total cost, quantity received
//
// Rebuilt whole, so a duplicate run wastes work but cannot double-count.
// Table: make/bi-schema.js.

async function doRefreshProductionBi(obj) {
    let insertProduced = (
        "INSERT INTO bi.production_daily " +
        "(measure, bucket_date, item_pk, site_pk, amount, units) " +
        "SELECT 'produced', t.date, t._item_item_pk, t._site_site_pk, " +
        "SUM(COALESCE(money_base(t.total_cost, t.date), 0)), " +
        "SUM(t.quantity) " +
        "FROM inventory_transaction t " +
        "WHERE t.type = 'Work Order Receipt' AND NOT t.is_deleted " +
        "AND t.date IS NOT NULL " +
        "GROUP BY 1, 2, 3, 4;"
    );
    let built;
    let count;
    let logged;

    // The request owns the transaction; no BEGIN/COMMIT here.
    try {
        built = await obj.client.query(
            "SELECT to_regclass('bi.production_daily') IS NOT NULL AS ok;"
        );
        if (!built.rows[0].ok) {
            return Promise.reject(new Error(
                "The production rollup table is not there. Deploy " +
                "SupplyChain to this instance, then refresh again."
            ));
        }

        await obj.client.query("TRUNCATE bi.production_daily;");
        await obj.client.query(insertProduced);

        count = await obj.client.query(
            "SELECT count(*)::bigint AS n FROM bi.production_daily;"
        );
        logged = await obj.client.query(
            "INSERT INTO bi.refresh_log (job, buckets) " +
            "VALUES ('production', $1) RETURNING refreshed;",
            [count.rows[0].n]
        );

        return {
            buckets: Number(count.rows[0].n),
            refreshed: logged.rows[0].refreshed
        };
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doRefreshProductionBi",
    doRefreshProductionBi
);
