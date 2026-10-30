/*jslint devel */
// Rebuilds bi.inventory_daily from the inventory transactions: what each day
// did to the balance, in value and quantity.
//
//   inventory   transaction date   net total cost, net quantity
//
// Every transaction type counts -- receipts add, issues and shipments
// subtract, adjustments either way -- because the sum of the ledger IS the
// balance (it reconciles to Inventory's own quantity and total value for
// every product and site). Rebuilt whole, so a duplicate run wastes work but
// cannot double-count. Table: stock/bi-schema.js.

async function doRefreshInventoryBi(obj) {
    let insertBalance = (
        "INSERT INTO bi.inventory_daily " +
        "(measure, bucket_date, item_pk, site_pk, amount, units) " +
        "SELECT 'inventory', t.date, t._item_item_pk, t._site_site_pk, " +
        "SUM(COALESCE(money_base(t.total_cost, t.date), 0)), " +
        "SUM(COALESCE(t.quantity, 0)) " +
        "FROM inventory_transaction t " +
        "WHERE NOT t.is_deleted AND t.date IS NOT NULL " +
        "GROUP BY 1, 2, 3, 4;"
    );
    let built;
    let count;
    let logged;

    // The request owns the transaction; no BEGIN/COMMIT here.
    try {
        built = await obj.client.query(
            "SELECT to_regclass('bi.inventory_daily') IS NOT NULL AS ok;"
        );
        if (!built.rows[0].ok) {
            return Promise.reject(new Error(
                "The inventory rollup table is not there. Deploy " +
                "SupplyChain to this instance, then refresh again."
            ));
        }

        await obj.client.query("TRUNCATE bi.inventory_daily;");
        await obj.client.query(insertBalance);

        count = await obj.client.query(
            "SELECT count(*)::bigint AS n FROM bi.inventory_daily;"
        );
        logged = await obj.client.query(
            "INSERT INTO bi.refresh_log (job, buckets) " +
            "VALUES ('inventory', $1) RETURNING refreshed;",
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
    "doRefreshInventoryBi",
    doRefreshInventoryBi
);
