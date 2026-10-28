/*jslint devel unordered*/
async function getSO(obj) {
    let so = await f.datasource.request({
        method: "GET",
        name: "SalesOrder",
        properties: [
            "number",
            "shipTo",
            "shipMethod",
            "incoTerms",
            "site",
            "status",
            "purchaseOrder",
            "lines",
            "freight",
            "source",
            "customer",
            "requestedDate",
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
            "harmonizedTariffCode",
            "countryOfOrigin",
            "customsDescription",
            "customsValue",
            "freightCode",
            "weight"
        ],
        client: obj.client,
        filter: {criteria: [{
            property: "id",
            operator: "IN",
            value: so.lines.map((l) => l.item.id)
        }]}
    }, true);

    so.lines.forEach(function (ln) {
        let item = items.find((i) => i.id === ln.item.id);
        ln.item.harmonizedTariffCode = item.harmonizedTariffCode;
        ln.item.countryOfOrigin = item.countryOfOrigin;
        ln.item.customsDescription = item.customsDescription;
        ln.item.customsValue = item.customsValue;
        ln.item.freightCode = item.freightCode;
        ln.item.weight = item.weight;
    });

    return so;
}

f.datasource.registerFunction(
    "POST",
    "doGetSalesOrderShipData",
    getSO
);
