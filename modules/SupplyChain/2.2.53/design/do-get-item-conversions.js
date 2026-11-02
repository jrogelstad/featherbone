/*jslint unordered*/
function getItemConversions(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Item",
            properties: ["id", "conversions"],
            client: obj.client,
            id: obj.data.id
        }, true).then(function (resp) {
            resp = resp || {};
            resolve(resp.conversions);
        }).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetItemConversions",
    getItemConversions
);
