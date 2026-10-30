/*jslint unordered*/
function getItemSites(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Item",
            properties: ["id", "sites"],
            client: obj.client,
            id: obj.data.id
        }, true).then(function (resp) {
            resp = resp || {};
            resolve(resp.sites);
        }).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetItemSites",
    getItemSites
);
