/*jslint devel browser this unordered*/

/**
  Sales order shipment handler
*/
async function doUpsertSoShipment(obj) {
    if (obj.oldRec && obj.oldRec.status === "S") {
        return;
    }

    let allPacked = true;
    obj.newRec.packStatus = (
        obj.newRec.status === "S"
        ? "C"
        : "N"
    );

    if (!obj.newRec.salesOrder) {
        throw "Sales order is required";
    }

    let so = await f.datasource.request({
        method: "GET",
        name: "SalesOrder",
        client: obj.client,
        id: obj.newRec.salesOrder.id,
        properties: ["id", "lines"]
    }, true);

    obj.newRec.containerCount = obj.newRec.containers.filter((c) => c).length;
    obj.newRec.lines.filter((ln) => ln).forEach(function (line) {
        let sol = so.lines.find(
            (sl) => line.salesOrderLine.id === sl.id
        );
        if (line.quantity > sol.quantityDue) {
            throw (
                "Ship quantity can not be greater than quantity due"
            );
        }
        if (line.quantity) {
            obj.newRec.packStatus = "P";
            if (line.quantity < sol.quantityDue) {
                allPacked = false;
            }
        } else {
            allPacked = false;
        }
    });
    if (allPacked) {
        obj.newRec.packStatus = "C";
    }
}

f.datasource.registerFunction(
    "POST",
    "SalesOrderShipment",
    doUpsertSoShipment,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "PATCH",
    "SalesOrderShipment",
    doUpsertSoShipment,
    f.datasource.TRIGGER_BEFORE
);

f.datasource.registerFunction(
    "POST",
    "SalesOrderShipment",
    async function (obj) {
        if (!obj.newRec.salesOrder) {
            throw ("Sales order is required");
        }

        if (!obj.newRec.site) {
            throw ("Site is required");
        }

        obj.newRec.status = "P"; // Has to be pending

        let found = await f.datasource.request({
            method: "GET",
            name: "SalesOrderShipment",
            client: obj.client,
            filter: {criteria: [{
                property: "salesOrder.id",
                value: obj.newRec.salesOrder.id
            }, {
                property: "site.id",
                value: obj.newRec.site.id
            }, {
                property: "status",
                value: "P"
            }]}
        }, true);

        if (found.length) {
            throw (
                "Sales order " + found[0].salesOrder.number +
                " already has an active shipment " + found[0].number +
                " at " + found[0].site.description
            );
        }
    },
    f.datasource.TRIGGER_BEFORE
);

const updateInShippingSql = (
    "UPDATE sales_order_line sol " +
    "SET in_shipping = COALESCE(( " +
    "SELECT SUM(quantity) " +
    "FROM sales_order_shipment_line shl, " +
    "    sales_order_shipment sh " +
    "WHERE sh._pk=" +
    "      shl._sales_order_shipment_sales_order_shipment_pk " +
    "AND sh.status = 'P' " +
    "AND NOT sh.is_deleted " +
    "AND NOT shl.is_deleted " +
    "AND sol._pk=shl._sales_order_line_sales_order_line_pk " +
    "), 0) " +
    "FROM sales_order so " +
    "WHERE so._pk=sol._sales_order_sales_order_pk " +
    "    AND so.id = $1; "
);

f.datasource.registerFunction(
    "POST",
    "SalesOrderShipment",
    async function (obj) {
        await f.datasource.request({
            method: "PATCH",
            name: "SalesOrder",
            client: obj.client,
            id: obj.newRec.salesOrder.id,
            data: [{
                op: "replace",
                path: "/status",
                value: "S"
            }]
        }, true);

        await obj.client.query(
            updateInShippingSql,
            [obj.newRec.salesOrder.id]
        );
    },
    f.datasource.TRIGGER_AFTER
);

f.datasource.registerFunction(
    "PATCH",
    "SalesOrderShipment",
    async function (obj) {
        if (obj.oldRec.status === "S") {
            return;
        }
        await obj.client.query(
            updateInShippingSql,
            [obj.newRec.salesOrder.id]
        );
    },
    f.datasource.TRIGGER_AFTER
);

function doBeforeDeleteSoShipment(obj) {
    if (obj.oldRec.status === "S") {
        return Promise.reject("Shipped shipment may not be deleted");
    }
    if (obj.oldRec.labelId && !obj.oldRec.labelVoid) {
        return Promise.reject(
            "Label must be void before shipment may be deleted"
        );
    }
    return Promise.resolve();
}

f.datasource.registerFunction(
    "DELETE",
    "SalesOrderShipment",
    doBeforeDeleteSoShipment,
    f.datasource.TRIGGER_BEFORE
);

function doAfterDeleteSoShipment(obj) {
    return new Promise(function (resolve, reject) {
        async function callback(resp) {
            // If still shipments at other sites or backorder, bail out
            if (resp.length) {
                resolve();
                return;
            }

            await f.datasource.request({
                method: "PATCH",
                name: "SalesOrder",
                client: obj.client,
                id: obj.oldRec.salesOrder.id,
                data: [{
                    op: "replace",
                    path: "/status",
                    value: "A"
                }]
            }, true);

            await obj.client.query(
                updateInShippingSql,
                [obj.oldRec.salesOrder.id]
            );

            resolve();
        }

        f.datasource.request({
            method: "GET",
            name: "SalesOrderShipment",
            client: obj.client,
            filter: {
                criteria: [{
                    property: "salesOrder.id",
                    value: obj.oldRec.salesOrder.id
                }, {
                    property: "id",
                    operator: "!=",
                    value: obj.oldRec.id
                }, {
                    property: "status",
                    value: "P"
                }]
            }
        }, true).then(callback).catch(reject);
    });
}

f.datasource.registerFunction(
    "DELETE",
    "SalesOrderShipment",
    doAfterDeleteSoShipment,
    f.datasource.TRIGGER_AFTER
);
