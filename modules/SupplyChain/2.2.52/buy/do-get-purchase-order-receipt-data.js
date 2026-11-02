/*jslint unordered*/
async function getPO(obj) {
    let po = await f.datasource.request({
        method: "GET",
        name: "PurchaseOrder",
        properties: [
            "number",
            "site",
            "status",
            "lines"
        ],
        client: obj.client,
        id: obj.data.id
    }, true);

    return po;
}

f.datasource.registerFunction(
    "POST",
    "doGetPurchaseOrderReceiptData",
    getPO
);
