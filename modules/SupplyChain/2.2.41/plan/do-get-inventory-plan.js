/*jslint*/
async function getInvPlan(obj) {
    let inv = await f.datasource.request({
        client: obj.client,
        id: obj.data.id,
        method: "GET",
        name: "Inventory"
    }, true);

    if (!inv) {
        return Promise.reject("Inventory not found");
    }
    let sqlDmd = (
        "SELECT dmd.id, dmd.number, quantity_due - allocated AS quantity, " +
        "  due_date, " +
        "  to_camel_case(dmd.tableoid::regclass::text) AS object_type " +
        "FROM demand dmd " +
        "  JOIN item i ON i._pk=dmd._item_item_pk " +
        "  JOIN site s ON s._pk=dmd._site_site_pk " +
        "WHERE dmd.status != 'C' " +
        " AND quantity_due > 0 " +
        " AND NOT dmd.is_deleted " +
        " AND allocated < quantity_due " +
        " AND i.id = $1 " +
        " AND s.id = $2 "
    );
    let sqlSup = (
        "SELECT sup.id, sup.number, quantity - allocated AS quantity, " +
        "  due_date, " +
        "  to_camel_case(sup.tableoid::regclass::text) AS object_type " +
        "FROM supply sup " +
        "  JOIN item i ON i._pk=sup._item_item_pk " +
        "  JOIN site s ON s._pk=sup._site_site_pk " +
        "WHERE sup.status != 'C' " +
        " AND quantity > 0 " +
        " AND allocated < quantity " +
        " AND NOT sup.is_deleted " +
        " AND to_camel_case(sup.tableoid::regclass::text) != 'Inventory' " +
        " AND i.id = $1 " +
        " AND s.id = $2 "
    );

    let dmd = await obj.client.query(sqlDmd, [inv.item.id, inv.site.id]);
    let sup = await obj.client.query(sqlSup, [inv.item.id, inv.site.id]);
    let pln = [];
    let avl = inv.available.minus(inv.allocated);
    let safety = inv.itemSite.safetyStock.times(-1);

    pln = sup.rows.map(function (su) {
        return {
            demand: null,
            dueDate: su.due_date,
            quantity: Number(su.quantity),
            supply: {
                id: su.id,
                number: su.number,
                objectType: su.object_type
            }
        };
    });
    pln = pln.concat(dmd.rows.map(function (dm) {
        return {
            demand: {
                id: dm.id,
                number: dm.number,
                objectType: dm.object_type
            },
            dueDate: dm.due_date,
            quantity: Number(dm.quantity).times(-1),
            supply: null
        };
    }));
    pln.sort(function (a, b) {
        if (a.dueDate > b.dueDate) {
            return 1;
        }
        if (a.dueDate < b.dueDate) {
            return -1;
        }
        if (a.supply && !b.supply) {
            return 1;
        }
        if (b.supply && !a.supply) {
            return -1;
        }
        if (a.supply && a.supply.number > b.supply.number) {
            return 1;
        }
        if (a.supply) {
            return -1;
        }
        if (a.demand.number > b.demand.number) {
            return 1;
        }
        return -1;
    });
    if (safety) {
        pln.unshift({
            demand: {
                id: inv.itemSite.id,
                number: "Safety Stock",
                objectType: "ItemSite"
            },
            dueDate: null,
            quantity: safety,
            supply: ""
        });
    }
    pln.forEach(function (pl) {
        avl = avl.plus(pl.quantity);
        pl.available = avl;
    });
    return pln;
}

f.datasource.registerFunction(
    "POST",
    "doGetInventoryPlan",
    getInvPlan
);