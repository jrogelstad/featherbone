/*jslint browser devel unordered*/
/*global f*/

// Supply types that carry downsteam demand info.
const supwDemands = [
    "PlannedOrder",
    "PlannedPurchase",
    "PlannedWorkOrder",
    "PurchaseOrderLine",
    "WorkOrder"
];

/**
  Allocation handlers
  Some SQL in here for performance optimization
*/
function doHandleAllocate(obj) {
    return new Promise(function (resolve, reject) {
        let newRec = obj.newRec;
        let oldRec = obj.oldRec;
        let theRec = newRec || oldRec;
        let suppFeather = "Supply";
        let sql1 = (
            "SELECT id, number, allocated, " +
            "to_camel_case(tableoid::regclass::text) AS object_type " +
            "FROM demand WHERE id = $1 FOR UPDATE;"
        );
        let sql2;

        if (newRec && newRec.quantity <= 0) {
            reject("Allocation quantity must be positive");
            return;
        }

        async function callback(resp) {
            let dmd = resp[0].rows[0];
            dmd.allocated = Number(dmd.allocated);
            let sup = resp[1];
            let delta;
            let newDmdAlc;
            let newSupAlc;
            let params;
            let payload = {
                client: obj.client,
                data: {},
                method: "POST",
                name: "doUpdateWorkOrderPlanStatus"
            };

            if (oldRec && newRec) {
                delta = newRec.quantity.minus(oldRec.quantity);
            } else if (!newRec) { // Deletion
                delta = oldRec.quantity.times(-1);
            } else { // Insertion
                delta = newRec.quantity;
            }

            if (
                sup.item.type !== "I" &&
                sup.item.objectType !== "Service"
            ) {
                reject("Only inventory items or services may be allocated");
                return;
            }

            newSupAlc = sup.allocated.plus(delta);

            if (newSupAlc < 0) {
                reject(
                    "Allocation of " + Math.abs(newSupAlc) +
                    " would cause supply " +
                    sup.number + " allocation to drop below zero"
                );
                return;
            }

            if (newSupAlc > Math.max(sup.quantity, 0)) {
                reject(
                    "Allocation of " + newSupAlc + " for " +
                    dmd.number +
                    " would cause supply " +
                    "allocation to exceed supply of " + sup.number
                );
                return;
            }

            newDmdAlc = dmd.allocated.plus(delta);
            if (newDmdAlc < 0) {
                reject(
                    "Allocation of " + Math.abs(newDmdAlc) +
                    " would cause demand " +
                    "allocation for " + dmd.number + " to drop below zero"
                );
                return;
            }

            sql2 = "UPDATE %I SET allocated = $2";
            params = [sup.id, Math.max(newSupAlc, 0)];

            // Append sales information to supply if applicable
            if (
                obj.newRec &&
                obj.newRec.salesOrder &&
                supwDemands.indexOf(sup.objectType) !== -1
            ) {
                suppFeather = sup.objectType;
                sql2 += (
                    ", _sales_order_sales_order_pk = " +
                    "(SELECT _pk FROM sales_order WHERE id = $3) "
                );
                params.push(newRec.salesOrder.id);
            }
            sql2 += " WHERE id = $1;";
            sql2 = sql2.format([suppFeather.toSnakeCase()]);

            try {
                await Promise.all([
                    obj.client.query(
                        "UPDATE demand SET allocated = $1 WHERE id = $2",
                        [Math.max(newDmdAlc, 0), dmd.id]
                    ),
                    obj.client.query(sql2, params)
                ]);

                // Only update demand order when allocations reduced
                // Otherwise planning function does it once for whole order
                if (delta < 0) {
                    switch (dmd.object_type) {
                    case "OutsideProcess":
                        payload.data.outsideProcessIds = [dmd.id];
                        break;
                    case "SalesOrderLine":
                        payload.data.lineIds = [dmd.id];
                        payload.name = "doUpdateSalesOrderPlanStatus";
                        break;
                    case "SalesOrderRequirement":
                        payload.data.requirementIds = [dmd.id];
                        payload.name = "doUpdateSalesOrderPlanStatus";
                        break;
                    case "WorkOrderRequirement":
                        payload.data.requirementIds = [dmd.id];
                        break;
                    }
                    await f.datasource.request(payload, true);
                }
                resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        }

        Promise.all([
            obj.client.query(sql1, [theRec.demand.id]),
            f.datasource.request({
                method: "GET",
                name: "Supply",
                properties: [
                    "id",
                    "number",
                    "quantity",
                    "allocated",
                    "objectType",
                    "item"
                ],
                client: obj.client,
                id: theRec.supply.id,
                isForUpdate: true
            }, true)
        ]).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "Allocation",
    doHandleAllocate,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "Allocation",
    doHandleAllocate,
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "DELETE",
    "Allocation",
    function (obj) {
        obj.isHard = true;
    },
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "DELETE",
    "Allocation",
    doHandleAllocate,
    f.datasource.TRIGGER_AFTER
);