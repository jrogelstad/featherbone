/*jslint devel */
// Rebuilds the "bi" sales fact table from the operational tables.
//
// Measures and their date anchors:
//   revenue   invoice.invoice_date      line amount, billed quantity
//   bookings  sales_order.order_date    line amount, ordered quantity
//   cogs      invoice.invoice_date      cost relieved by the shipment the
//                                       invoice bills, shipped quantity
//
// Revenue is taken from the invoice LINES, so it is product revenue at
// subtotal level and carries no tax or freight -- those sit on the invoice
// header. Verified against demo on 24 Oct 2026: the line sums match
// invoice.subtotal and invoice.total to the dollar in all thirteen months.
//
// The grain is one row per (measure, day, item, customer, site, region).
// Period windows -- WTD, MTD, QTD, YTD -- are summed from these daily
// buckets at read time, which is what lets the dashboard's "as of" date be a
// WHERE clause rather than a reason to re-run this, and makes sparklines and
// prior-period comparisons fall out of the same table.
//
// Safe to run twice: it rebuilds the whole table rather than appending, so a
// duplicate firing wastes work but cannot double-count. That matters because
// the CronJob module has no cross-node coordination yet.
//
// The tables themselves are created at deploy by sell/bi-schema.js, not
// here.

// Region comes from the ship-to address. Address.state is free text, not a
// relation to State, so this joins text to the SalesRegionState natural key.
// Rows that do not match keep a null region and are counted, so bad state
// data shows up rather than quietly landing in a bucket. "alias" is whichever
// table carries the ship-to address: the invoice for revenue, the order for
// bookings.
function regionJoin(alias) {
    return (
        "LEFT JOIN address a ON a._pk = " + alias + "._ship_to_address_pk " +
        "LEFT JOIN sales_region_state srs " +
        "ON srs.state = upper(btrim(a.state)) AND NOT srs.is_deleted " +
        "LEFT JOIN sales_region sr " +
        "ON sr._pk = srs._region_sales_region_pk AND NOT sr.is_deleted "
    );
}

async function doRefreshSalesBi(obj) {
    let built;
    let logged;
    let result;
    let unmapped;

    // The tables are created when the package is deployed, in
    // sell/bi-schema.js, and this no longer carries its own copy of the
    // DDL -- a service runs through new Function("f", ...) with no
    // module scope, so it cannot share the install script's copy, and
    // two copies of a schema is a schema with nobody owning it.
    let sqlBuilt = "SELECT to_regclass('bi.sales_daily') IS NOT NULL AS ok;";

    let insertRevenue = (
        "INSERT INTO bi.sales_daily " +
        "(measure, bucket_date, item_pk, customer_pk, site_pk, region, " +
        "amount, units) " +
        "SELECT 'revenue', i.invoice_date, il._item_item_pk, " +
        "i._customer_customer_pk, c._site_site_pk, sr.code, " +
        "SUM(money_base(il.amount, i.invoice_date)), SUM(il.billed) " +
        "FROM invoice_line il " +
        "JOIN invoice i ON i._pk = il._invoice_invoice_pk " +
        "AND NOT i.is_deleted " +
        "LEFT JOIN customer c ON c._pk = i._customer_customer_pk " +
        regionJoin("i") +
        "WHERE NOT il.is_deleted " +
        "GROUP BY 1, 2, 3, 4, 5, 6;"
    );

    let insertBookings = (
        "INSERT INTO bi.sales_daily " +
        "(measure, bucket_date, item_pk, customer_pk, site_pk, region, " +
        "amount, units) " +
        "SELECT 'bookings', so.order_date, sol._item_item_pk, " +
        "so._customer_customer_pk, c._site_site_pk, sr.code, " +
        "SUM(money_base(sol.amount, so.order_date)), SUM(sol.ordered) " +
        "FROM sales_order_line sol " +
        "JOIN sales_order so ON so._pk = " +
        "sol._sales_order_sales_order_pk AND NOT so.is_deleted " +
        "LEFT JOIN customer c ON c._pk = so._customer_customer_pk " +
        regionJoin("so") +
        "WHERE NOT sol.is_deleted " +
        "GROUP BY 1, 2, 3, 4, 5, 6;"
    );

    /*
        COGS from the 'Shipment' inventory transactions (SalesHistory has
        no cost), dated by the invoice so cost and revenue share a period.
        Stored positive.
    */
    let insertCogs = (
        "INSERT INTO bi.sales_daily " +
        "(measure, bucket_date, item_pk, customer_pk, site_pk, region, " +
        "amount, units) " +
        "SELECT 'cogs', si.invoice_date, t._item_item_pk, " +
        "si._customer_customer_pk, c._site_site_pk, sr.code, " +
        "-SUM(money_base(t.total_cost, t.date)), -SUM(t.quantity) " +
        "FROM inventory_transaction t " +
        "JOIN shipment s ON s.number = t.document " +
        "JOIN shipment_invoice si " +
        "ON si._shipment_sales_order_shipment_pk = s._pk " +
        "AND NOT si.is_deleted " +
        "LEFT JOIN customer c ON c._pk = si._customer_customer_pk " +
        regionJoin("si") +
        "WHERE t.type = 'Shipment' AND NOT t.is_deleted " +
        "GROUP BY 1, 2, 3, 4, 5, 6;"
    );

    let countUnmapped = (
        "SELECT count(*)::bigint AS n FROM bi.sales_daily " +
        "WHERE region IS NULL;"
    );

    let countBuckets = "SELECT count(*)::bigint AS n FROM bi.sales_daily;";

    // Hands back the moment it recorded, so the caller can say when the
    // figures it is about to show were built rather than guessing from
    // the browser's clock.
    let writeLog = (
        "INSERT INTO bi.refresh_log (job, buckets, unmapped_states) " +
        "VALUES ($1, $2, $3) RETURNING refreshed;"
    );

    // The request already runs in a transaction. Sending our own
    // BEGIN/COMMIT/ROLLBACK here would commit it early and run everything
    // after in autocommit, so we leave that to the request.
    try {
        // Says what is actually wrong, rather than letting TRUNCATE fail
        // with a relation-does-not-exist nobody can act on.
        built = await obj.client.query(sqlBuilt);
        if (!built.rows[0].ok) {
            return Promise.reject(new Error(
                "The sales rollup tables are not there. Deploy " +
                "SupplyChain to this instance, which creates them, " +
                "then refresh again."
            ));
        }

        await obj.client.query("TRUNCATE bi.sales_daily;");
        await obj.client.query(insertRevenue);
        await obj.client.query(insertBookings);
        await obj.client.query(insertCogs);

        result = await obj.client.query(countBuckets);
        unmapped = await obj.client.query(countUnmapped);

        logged = await obj.client.query(writeLog, [
            "sales",
            result.rows[0].n,
            unmapped.rows[0].n
        ]);

        return {
            buckets: Number(result.rows[0].n),
            refreshed: logged.rows[0].refreshed,
            unmappedStates: Number(unmapped.rows[0].n)
        };
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doRefreshSalesBi",
    doRefreshSalesBi
);
