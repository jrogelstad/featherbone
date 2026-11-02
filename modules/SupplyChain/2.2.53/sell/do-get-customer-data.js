/*jslint unordered*/
function getCust(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Customer",
            properties: [
                "billTo",
                "billToIsShipto",
                "contact",
                "creditStatus",
                "currency",
                "discount",
                "id",
                "incoTerms",
                "isActive",
                "name",
                "number",
                "site",
                "shipTo",
                "shipMethod",
                "terms",
                "taxable"
            ],
            client: obj.client,
            id: obj.data.id
        }, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetCustomerData",
    getCust
);
