/*jslint*/
/*global*/

async function doSoPlan(obj) {
    let so = await f.datasource.request({
        client: obj.client,
        id: obj.data.id,
        method: "GET",
        name: "SalesOrder",
        properties: [
            "orderDate",
            "lines"
        ]
    }, true);

    if (!so || !so.lines.length) {
        return [];
    }
    so.lines = so.lines.filter((l) => l.status !== "C" && l.quantityDue > 0);

    let ret = [];
    let line;
    let row;

    while (so.lines.length) {
        line = so.lines.shift();
        row = {};
        row.description = (
            "(" + line.number + ") " + line.item.number +
            " [Qty: " + line.quantityDue.toLocaleString() + "]"
        );
        row.detail = await f.datasource.request({
            client: obj.client,
            data: {id: line.id},
            method: "POST",
            name: "doGetSalesOrderLinePlan",
            properties: ["id", "created"]
        }, true);
        row.detail.forEach(function (d) {
            d.level += 1;
            d.description = "  " + d.description;
            d.parent = line.id;
        });
        row.dueDate = line.promiseDate || so.promiseDate || so.requestedDate;
        row.id = line.id;
        row.level = 0;
        row.links = [];
        row.number = {
            id: line.id,
            number: line.number,
            objectType: line.objectType
        };
        row.objectType = line.objectType;
        row.percent = line.shipped.div(line.ordered);
        row.quantity = line.quantityDue;
        row.startDate = so.orderDate;
        row.type = "group";
        ret.push(row);
    }

    return ret;
}

f.datasource.registerFunction(
    "POST",
    "doGetSalesOrderPlan",
    doSoPlan
);