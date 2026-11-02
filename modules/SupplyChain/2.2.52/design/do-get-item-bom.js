/*jslint unordered*/
function getItemBom(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Product",
            properties: ["id", "billOfMaterialItems"],
            client: obj.client,
            id: obj.data.id
        }, true).then(function (resp) {
            resp = resp || {};
            resolve(resp.billOfMaterialItems);
        }).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetItemBom",
    getItemBom
);
