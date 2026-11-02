/*jslint devel unordered*/

/**
  Update onOrder, demand, shortage and reorder attributes
  on inventory based on current supply and demand
*/
async function recalc(obj) {
    let sql1 = (
        "SELECT inv.quantity, inv.shortage, inv.reorder, its.planning_policy " +
        "FROM inventory inv, item, site, item_site its " +
        "  WHERE item._pk=inv._item_item_pk " +
        "   AND site._pk=inv._site_site_pk " +
        "   AND item._pk=its._item_item_pk " +
        "   AND site._pk=its._site_site_pk " +
        "   AND item.id=$1 " +
        "   AND site.id=$2 " +
        "   AND NOT inv.is_deleted "
    );
    let sql2 = (
        "UPDATE inventory inv SET " +
        " (demand, on_order, projected, shortage, reorder, etag, " +
        "   updated, updated_by) = " +
        " ( " +
        "  SELECT " +
        "     demand_sum, " +
        "     order_sum, " +
        "     inv.available + dat.order_sum - dat.demand_sum - " +
        "       dat.safety_stock, " +
        "     (inv.available + dat.order_sum - " +
        "       dat.demand_sum - dat.safety_stock) < 0, " +
        "     (inv.available + dat.order_sum - " +
        "       dat.demand_sum - dat.safety_stock - dat.reorder_point) < 0, " +
        "     $3, now(), $4 " +
        "  FROM ( " +
        "    SELECT " +
        "      COALESCE(( " +
        "        SELECT SUM(d.quantity_due) " +
        "        FROM demand d " +
        "        WHERE NOT d.is_deleted " +
        "           AND i._item_item_pk=d._item_item_pk " +
        "           AND i._site_site_pk=d._site_site_pk " +
        "           AND d.status != 'C' " +
        "           AND d.quantity_due > 0 " +
        "     ), 0) AS demand_sum, " +
        "     COALESCE(( " +
        "       SELECT SUM(s.quantity) " +
        "         FROM supply s " +
        "         WHERE NOT s.is_deleted " +
        "           AND i._item_item_pk=s._item_item_pk " +
        "           AND i._site_site_pk=s._site_site_pk " +
        "           AND s.status != 'C' " +
        "           AND s.quantity > 0 " +
        "           AND s.tableoid::regclass::text != 'inventory' " +
        "     ), 0) AS order_sum, " +
        "     i.reorder_point, " +
        "     i.safety_stock " +
        "   FROM item_site i " +
        "   WHERE i._pk=inv._item_site_item_site_pk " +
        "   ) AS dat " +
        ") FROM item, site " +
        "  WHERE item._pk=inv._item_item_pk " +
        "   AND site._pk=inv._site_site_pk " +
        "   AND item.id=$1 " +
        "   AND site.id=$2 " +
        "   AND NOT inv.is_deleted " +
        "RETURNING inv.id, inv.number, inv.quantity, inv.reorder, " +
        "   inv.shortage, inv.projected; "
    );

    let res = await obj.client.query(sql1, [
        obj.data.itemId,
        obj.data.siteId
    ]);
    if (!res.rows.length) {
        return; // Non-inventory item
    }
    let oldRec = res.rows[0];
    res = await obj.client.query(sql2, [
        obj.data.itemId,
        obj.data.siteId,
        f.createId(),
        obj.client.currentUser()
    ]);
    let newRec = res.rows[0];
    let theSeverity = "";
    let txt = `Inventory ${newRec.number} `;
    let projected = Number(newRec.projected);
    let nQty = Number(newRec.quantity);

    if (
        nQty >= 0 &&
        oldRec.planning_policy === "R"
    ) { // Inventory trigger takes care of negatives
        if (!oldRec.shortage && newRec.shortage) {
            theSeverity = "Warning";
            txt += `has a projected shortage of ${projected}`;
        } else if (!oldRec.reorder && newRec.reorder) {
            theSeverity = "Information";
            txt += (
                `projected quantity of ${projected} ` +
                `has fallen below the reorder point and is due for reorder`
            );
        }
    }

    if (theSeverity) {
        let theTenant = obj.client.tenant();
        let currUser = obj.client.currentUser();
        let nr = newRec.number;
        let theId = newRec.id;

        obj.client.onCommit(function () {
            f.datasource.request({
                data: {
                    category: "Inventory",
                    message: txt,
                    relation: {
                        code: nr,
                        id: theId,
                        objectType: "Inventory"
                    },
                    severity: theSeverity
                },
                method: "POST",
                name: "Alert",
                tenant: theTenant,
                user: currUser
            }, true);
        });
    }
}

f.datasource.registerFunction(
    "POST",
    "doRecalcInventoryOrders",
    recalc
);