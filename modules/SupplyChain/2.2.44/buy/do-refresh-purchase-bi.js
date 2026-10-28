/*jslint devel */
// Rebuilds bi.purchase_daily from the operational tables.
//
//   purchased  receipt date   the receipt line's own amount (received x
//                              the line's unit price, set when it posted)
//   ordered    order date     line amount
//
// Units are inventory units (purchase quantity x line ratio), so they sit
// on one scale with sales and production. Rebuilt whole, so a duplicate run
// wastes work but cannot double-count. Table: buy/bi-schema.js.

async function doRefreshPurchaseBi(obj) {
    let fields = (
        "INSERT INTO bi.purchase_daily " +
        "(measure, bucket_date, item_pk, supplier_pk, site_pk, " +
        "amount, units) "
    );
    let ratio = "COALESCE(NULLIF(pol.ratio, 0), 1)";
    let lines = (
        "JOIN purchase_order po " +
        "ON po._pk = pol._purchase_order_purchase_order_pk " +
        "AND NOT po.is_deleted "
    );
    let insertPurchased = (
        fields +
        "SELECT 'purchased', r.receipt_date, pol._item_item_pk, " +
        "po._supplier_supplier_pk, r._site_site_pk, " +
        "SUM(COALESCE(money_base(rl.amount, r.receipt_date), rl.quantity * " +
        "COALESCE(money_base(pol.amount, r.receipt_date) / " +
        "NULLIF(pol.ordered, 0), 0))), " +
        "SUM(rl.quantity * " + ratio + ") " +
        "FROM purchase_order_receipt_line rl " +
        "JOIN purchase_order_receipt r " +
        "ON r._pk = rl._purchase_order_receipt_purchase_order_receipt_pk " +
        "AND NOT r.is_deleted AND r.status = 'R' " +
        "JOIN purchase_order_line pol " +
        "ON pol._pk = rl._purchase_order_line_purchase_order_line_pk " +
        lines +
        "WHERE NOT rl.is_deleted AND r.receipt_date IS NOT NULL " +
        "GROUP BY 1, 2, 3, 4, 5;"
    );
    let insertOrdered = (
        fields +
        "SELECT 'ordered', po.order_date, pol._item_item_pk, " +
        "po._supplier_supplier_pk, " +
        "COALESCE(pol._site_site_pk, po._site_site_pk), " +
        "SUM(money_base(pol.amount, po.order_date)), " +
        "SUM(pol.ordered * " + ratio + ") " +
        "FROM purchase_order_line pol " + lines +
        "WHERE NOT pol.is_deleted AND po.order_date IS NOT NULL " +
        "GROUP BY 1, 2, 3, 4, 5;"
    );
    let built;
    let count;
    let logged;

    // The request owns the transaction; no BEGIN/COMMIT here.
    try {
        built = await obj.client.query(
            "SELECT to_regclass('bi.purchase_daily') IS NOT NULL AS ok;"
        );
        if (!built.rows[0].ok) {
            return Promise.reject(new Error(
                "The purchasing rollup table is not there. Deploy " +
                "SupplyChain to this instance, then refresh again."
            ));
        }

        await obj.client.query("TRUNCATE bi.purchase_daily;");
        await obj.client.query(insertPurchased);
        await obj.client.query(insertOrdered);

        count = await obj.client.query(
            "SELECT count(*)::bigint AS n FROM bi.purchase_daily;"
        );
        logged = await obj.client.query(
            "INSERT INTO bi.refresh_log (job, buckets) " +
            "VALUES ('purchasing', $1) RETURNING refreshed;",
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
    "doRefreshPurchaseBi",
    doRefreshPurchaseBi
);
