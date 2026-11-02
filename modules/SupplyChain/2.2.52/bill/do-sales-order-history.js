/*jslint unordered devel*/
async function doSoHist(obj) {
    let soId = obj.data.id;
    let requests = [];
    let result = [];
    let lastRow = {invoice: {number: ""}};
    let header;

    requests.push(
        f.datasource.request({
            client: obj.client,
            method: "GET",
            name: "SalesHistory",
            filter: {criteria: [{
                property: "salesOrder.id",
                value: soId
            }], sort: [{
                property: "invoice.invoiceDate"
            }, {
                property: "invoice.number"
            }, {
                property: "shipmentLine"
            }]}
        }, true)
    );

    requests.push(
        f.datasource.request({
            client: obj.client,
            method: "GET",
            name: "SalesOrderShipment",
            filter: {criteria: [{
                property: "salesOrder.id",
                value: soId
            }, {
                property: "isInvoiced",
                value: false
            }], sort: [{
                property: "shipDate"
            }, {
                property: "number"
            }]}
        }, true)
    );

    let res = await Promise.all(requests);
    let sales = res[0];
    let shipments = res[1];

    sales.filter((s) => s.invoice).forEach(function (row) {
        let item;

        if (lastRow.invoice.number !== row.invoice.number) {
            header = {
                created: row.created,
                createdBy: row.createdBy,
                description: row.invoice.objectType.toName(),
                id: f.createId(),
                invoice: row.invoice,
                isDeleted: false,
                lock: null,
                level: 0,
                product: row.invoice,
                quantity: row.quantity,
                shipment: row.shipment,
                shipDate: row.invoice.invoiceDate,
                amount: row.amount,
                updated: row.updated,
                updatedBy: row.updatedBy
            };
            item = header;
            result.push(header);
        } else {
            item = {
                created: row.created,
                createdBy: row.createdBy,
                description: row.description,
                invoice: row.invoice,
                id: row.id,
                isDeleted: false,
                lock: null,
                level: 1,
                product: row.item,
                quantity: row.quantity,
                shipment: null,
                amount: row.amount,
                updated: row.updated,
                updatedBy: row.updatedBy
            };
        }

        if (item === header) {
            item = f.copy(item);
            item.id = row.id;
            item.description = row.description;
            item.level = 1;
            item.product = (
                Boolean(row.item)
                ? row.item
                : row.taxType
            );
            item.shipDate = null;
            item.shipment = null;
        } else {
            header.quantity = header.quantity.plus(row.quantity);
            header.amount.amount = header.amount.amount.plus(row.amount.amount);
        }

        result.push(item);
        lastRow = row;
    });

    shipments.forEach(function (sh) {
        result.push({
            created: sh.created,
            createdBy: sh.createdBy,
            description: "Uninvoiced shipment",
            id: sh.id,
            isDeleted: false,
            lock: null,
            level: 0,
            quantity: sh.lines.reduce(function (prv, nxt) {
                return prv.plus(nxt.quantity);
            }, 0),
            shipment: sh,
            shipDate: sh.shipDate,
            amount: null,
            updated: sh.updated,
            updatedBy: sh.updatedBy
        });
        sh.lines.filter((l) => l.quantity).forEach(function (line) {
            result.push({
                created: line.created,
                createdBy: line.createdBy,
                description: line.item.description,
                id: line.id,
                isDeleted: false,
                lock: null,
                level: 1,
                product: line.item,
                quantity: line.quantity,
                shipment: null,
                amount: null,
                updated: line.updated,
                updatedBy: line.updatedBy
            });
        });
    });

    return result;
}

f.datasource.registerFunction(
    "POST",
    "doSalesOrderHistory",
    doSoHist
);