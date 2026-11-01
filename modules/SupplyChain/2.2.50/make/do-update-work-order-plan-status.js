/*jslint devel*/
async function doUpdate(obj) {
    let sql;
    let woids;
    let n = 0;
    let wos;

    if (obj.data.requirementIds) {
        sql = (
            "SELECT DISTINCT w.id FROM work_order w " +
            "  JOIN work_order_requirement wor " +
            "    ON w._pk=wor._work_order_work_order_pk " +
            "WHERE wor.id IN (" + obj.data.requirementIds.map(function () {
                n += 1;
                return "$" + n;
            }).toString() + ");"
        );
        wos = await obj.client.query(sql, obj.data.requirementIds);
        woids = wos.rows.map((r) => r.id);
    } else if (obj.data.outsideProcessIds) {
        sql = (
            "SELECT DISTINCT wo.id AS id " +
            "FROM work_order wo JOIN  outside_process osp " +
            "  ON wo._pk=osp._work_order_work_order_pk " +
            "WHERE osp.id IN (" + obj.data.outsideProcessIds.map(function () {
                n += 1;
                return "$" + n;
            }).toString() + ");"
        );
        wos = await obj.client.query(sql, obj.data.outsideProcessIds);
        woids = wos.rows.map((r) => r.id);
    } else {
        woids = [obj.data.id];
    }

    async function updateWo(woid) {
        sql = (
            "SELECT DISTINCT wor._pk, wor.quantity_due, wor.allocated, " +
            "  to_camel_case(s.tableoid::regclass::text) AS supply_type " +
            "FROM work_order_requirement wor " +
            "  JOIN work_order wo ON (wo._pk=" +
            "    wor._work_order_work_order_pk) " +
            "  JOIN item_site i ON (i._item_item_pk=wor._item_item_pk" +
            "    AND i._site_site_pk=wor._site_site_pk) " +
            "  LEFT JOIN allocation a ON (wor._pk=" +
            "    a._demand_demand_pk) " +
            "  LEFT JOIN supply s ON (s._pk=" +
            "    a._supply_supply_pk) " +
            "WHERE wo.id=$1 " +
            "  AND wo.status != 'C' " +
            "  AND wor.status != 'C' " +
            "  AND i.planning_policy !='R' " +
            "  AND NOT wor.is_deleted " +
            "UNION " +
            "SELECT DISTINCT osp._pk, osp.quantity_due, osp.allocated, " +
            "  to_camel_case(s.tableoid::regclass::text) AS supply_type " +
            "FROM outside_process osp " +
            "  JOIN work_order wo ON (wo._pk=" +
            "    osp._work_order_work_order_pk) " +
            "  JOIN item_site i ON (i._item_item_pk=osp._item_item_pk" +
            "    AND i._site_site_pk=osp._site_site_pk) " +
            "  LEFT JOIN allocation a ON (osp._pk=" +
            "    a._demand_demand_pk) " +
            "  LEFT JOIN supply s ON (s._pk=" +
            "    a._supply_supply_pk) " +
            "WHERE wo.id=$1 " +
            "  AND wo.status != 'C' " +
            "  AND osp.status != 'C' " +
            "  AND NOT osp.is_deleted "
        );
        let params = [woid];
        let data = await obj.client.query(sql, params);
        let sts = "O";

        if (!data.rows.length) {
            sts = "C";
        } else if (data.rows.some(
            (r) => Number(r.allocated) < Number(r.quantity_due)
        )) {
            sts = "U";
        } else if (data.rows.every((r) => r.supply_type === "Inventory")) {
            sts = "I";
        } else if (data.rows.some(
            (r) => r.supply_type && r.supply_type.indexOf("Planned") !== -1
        )) {
            sts = "P";
        }

        params.push(sts);
        params.push(obj.client.currentUser());
        params.push(f.createId());
        sql = (
            "UPDATE work_order " +
            "SET plan_status=$2, updated=now(), updated_by=$3, etag=$4 " +
            "WHERE id=$1"
        );
        await obj.client.query(sql, params);
    }

    try {
        while (woids.length) {
            await updateWo(woids.shift());
        }
    } catch (e) {
        return Promise.reject(e);
    }
}

f.datasource.registerFunction(
    "POST",
    "doUpdateWorkOrderPlanStatus",
    doUpdate
);