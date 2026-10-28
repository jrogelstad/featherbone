/*jslint devel unordered*/
async function getPO(obj) {
    let po = await f.datasource.request({
        method: "GET",
        name: "PurchaseOrder",
        properties: [
            "number",
            "shipTo",
            "site",
            "status",
            "reference",
            "lines",
            "freight",
            "contact"
        ],
        client: obj.client,
        id: obj.data.id
    }, true);
    let items = await f.datasource.request({
        method: "GET",
        name: "Item",
        properties: [
            "id",
            "freightCode",
            "weight"
        ],
        client: obj.client,
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: po.lines.map((l) => l.item.id)
        }]}
    }, true);

    po.lines.forEach(function (ln) {
        let item = items.find((i) => i.id === ln.item.id);
        ln.item.freightCode = item.freightCode;
        ln.item.weight = item.weight;
    });

    return po;
}

f.datasource.registerFunction(
    "POST",
    "doGetPurchaseOrderShipData",
    getPO
);
