/*jslint devel*/
async function doUpdate(obj) {
    let sql;
    let soids = [];
    let n = 0;
    let sos;

    if (obj.data.lineIds || obj.data.requirementIds) {
        if (
            obj.data.lineIds &&
            obj.data.lineIds.length
        ) {
            sql = (
                "SELECT DISTINCT s.id FROM sales_order s " +
                "  JOIN sales_order_line sol " +
                "    ON s._pk=sol._sales_order_sales_order_pk " +
                "WHERE sol.id IN (" + obj.data.lineIds.map(function () {
                    n += 1;
                    return "$" + n;
                }).toString() + ");"
            );
            sos = await obj.client.query(sql, obj.data.lineIds);
            soids = sos.rows.map((r) => r.id);
        }

        if (
            obj.data.requirementIds &&
            obj.data.requirementIds.length
        ) {
            n = 0;
            sql = (
                "SELECT DISTINCT s.id FROM sales_order s " +
                "  JOIN sales_order_line sol " +
                "    ON s._pk=sol._sales_order_sales_order_pk " +
                "  JOIN sales_order_requirement sor " +
                "    ON sol._pk=sor._sales_order_line_sales_order_line_pk " +
                "WHERE sor.id IN (" + obj.data.requirementIds.map(function () {
                    n += 1;
                    return "$" + n;
                }).toString() + ");"
            );
            sos = await obj.client.query(sql, obj.data.requirementIds);
            soids = soids.concat(sos.rows.map((r) => r.id));
        }
    } else {
        soids = [obj.data.id];
    }

    async function updateSo(soid) {
        sql = (
            "SELECT DISTINCT sor._pk, sor.quantity_due, " +
            "  a.quantity as allocated, " +
            "  to_camel_case(s.tableoid::regclass::text) AS supply_type " +
            "FROM sales_order_requirement sor " +
            "  JOIN sales_order_line sol ON (sol._pk=" +
            "    sor._sales_order_line_sales_order_line_pk) " +
            "  JOIN sales_order so ON (so._pk=" +
            "    sol._sales_order_sales_order_pk) " +
            "  JOIN item_site i ON (i._item_item_pk=sor._item_item_pk" +
            "    AND i._site_site_pk=sor._site_site_pk) " +
            "  JOIN item ON (item._pk=i._item_item_pk) " +
            "  LEFT JOIN allocation a ON (sor._pk=" +
            "    a._demand_demand_pk) " +
            "  LEFT JOIN supply s ON (s._pk=" +
            "    a._supply_supply_pk) " +
            "WHERE so.id=$1 " +
            "  AND so.status != 'C' " +
            "  AND sor.status != 'C' " +
            "  AND i.planning_policy !='R' " +
            "  AND item.type = 'I' " +
            "  AND NOT sor.is_deleted " +
            "UNION " +
            "SELECT DISTINCT sol._pk, sol.quantity_due, " +
            "  a.quantity as allocated, " +
            "  to_camel_case(s.tableoid::regclass::text) AS supply_type " +
            "FROM sales_order_line sol " +
            "  JOIN sales_order so ON (so._pk=" +
            "    sol._sales_order_sales_order_pk) " +
            "  JOIN item_site i ON (i._item_item_pk=sol._item_item_pk" +
            "    AND i._site_site_pk=sol._site_site_pk) " +
            "  JOIN item ON (item._pk=i._item_item_pk) " +
            "  LEFT JOIN allocation a ON (sol._pk=" +
            "    a._demand_demand_pk) " +
            "  LEFT JOIN supply s ON (s._pk=" +
            "    a._supply_supply_pk) " +
            "WHERE so.id=$1 " +
            "  AND so.status != 'C' " +
            "  AND sol.status != 'C' " +
            "  AND i.planning_policy !='R' " +
            "  AND item.type = 'I' " +
            "  AND NOT sol.is_deleted "
        );
        let params = [soid];
        let data = await obj.client.query(sql, params);
        let sts = "O";
        let dmds = [];
        let pk = "_pk"; // lint tyranny

        function notAllocated(p) {
            let lns = data.rows.filter((r) => r[pk] === p);
            let alc = lns.reduce(function (prv, nxt) {
                return prv.plus(Number(nxt.allocated));
            }, 0);
            return Boolean(Number(lns[0].quantity_due) > alc);
        }

        // Distill unique lines
        data.rows.forEach(function (r) {
            if (dmds.indexOf(r[pk]) === -1) {
                dmds.push(r[pk]);
            }
        });

        if (!data.rows.length) {
            sts = "C";
        } else if (
            data.rows.some((r) => !Boolean(Number(r.quantity_due))) ||
            dmds.some(notAllocated)
        ) {
            sts = "U";
        } else if (data.rows.every((r) => r.supply_type === "Inventory")) {
            sts = "I";
        } else if (data.rows.some(
            (r) => (
                r.supply_type &&
                r.supply_type.indexOf("Planned") !== -1
            )
        )) {
            sts = "P";
        }

        params.push(sts);
        params.push(obj.client.currentUser());
        params.push(f.createId());
        sql = (
            "UPDATE sales_order " +
            "SET plan_status=$2, updated=now(), updated_by=$3, etag=$4 " +
            "WHERE id=$1"
        );
        await obj.client.query(sql, params);
    }

    while (soids.length) {
        await updateSo(soids.shift());
    }
}

f.datasource.registerFunction(
    "POST",
    "doUpdateSalesOrderPlanStatus",
    doUpdate
);