/*jslint unordered*/
function getItemSupplier(obj) {
    let itemId = obj.data.itemId;
    let supplierId = obj.data.supplierId;
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Item",
            properties: ["id", "suppliers"],
            client: obj.client,
            id: itemId
        }, true).then(function (resp) {
            let list;
            let ret;
            resp = resp || {};
            list = resp.suppliers || [];
            if (supplierId) {
                ret = list.find((i) => i.supplier.id === supplierId);
            } else {
                ret = list.find((i) => i.isPrimary) || list[0];
            }
            resolve(ret);
        }).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetItemSupplier",
    getItemSupplier
);