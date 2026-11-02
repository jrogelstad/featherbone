/*jslint devel */
async function doClearAllocations(obj) {
    let sql;
    let wos;
    let sos;
    let sql2 = (
        "DELETE FROM allocation a " +
        "USING product p, supply s " +
        "WHERE s._item_item_pk=p._pk " +
        "  AND a._supply_supply_pk=s._pk;"
    );
    let sql3 = (
        "UPDATE supply s SET allocated = 0 " +
        "FROM product p " +
        "WHERE allocated > 0 " +
        "  AND s._item_item_pk=p._pk;"
    );
    let sql4 = (
        "UPDATE demand d SET allocated = 0 " +
        "FROM product p " +
        "WHERE allocated > 0 " +
        "  AND d._item_item_pk=p._pk;"
    );
    // The request already runs in a transaction. Sending our own
    // BEGIN/COMMIT/ROLLBACK here would commit it early and run
    // everything after in autocommit, so we leave that to the request.
    try {
        if (obj.data.updateOrders !== false) {
            sql = (
                "SELECT DISTINCT w.id " +
                "FROM work_order w " +
                "  JOIN work_order_requirement d ON w._pk=" +
                "    d._work_order_work_order_pk " +
                "WHERE NOT d.is_deleted " +
                "  AND d.allocated > 0;"
            );
            wos = await obj.client.query(sql);
            sql = (
                "SELECT s.id " +
                "FROM sales_order s " +
                "  JOIN sales_order_line d ON s._pk=" +
                "    d._sales_order_sales_order_pk " +
                "WHERE NOT d.is_deleted " +
                "  AND d.allocated > 0 " +
                "UNION " +
                "SELECT s.id " +
                "FROM sales_order s " +
                "  JOIN sales_order_line l ON s._pk=" +
                "    l._sales_order_sales_order_pk " +
                "  JOIN sales_order_requirement d ON l._pk=" +
                "    d._sales_order_line_sales_order_line_pk " +
                "WHERE NOT d.is_deleted " +
                "  AND d.allocated > 0;"
            );
            sos = await obj.client.query(sql);
        }
        await obj.client.query(sql2);
        await obj.client.query(sql3);
        await obj.client.query(sql4);

        if (obj.data.updateOrders !== false) {
            let ord;

            while (wos.rows.length) {
                ord = wos.rows.shift();
                await f.datasource.request({
                    client: obj.client,
                    data: {id: ord.id},
                    method: "POST",
                    name: "doUpdateWorkOrderPlanStatus"
                });
            }
            while (sos.rows.length) {
                ord = sos.rows.shift();
                await f.datasource.request({
                    client: obj.client,
                    data: {id: ord.id},
                    method: "POST",
                    name: "doUpdateSalesOrderPlanStatus"
                });
            }
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doClearAllocations",
    doClearAllocations
);