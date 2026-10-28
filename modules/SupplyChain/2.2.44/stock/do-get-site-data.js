/*jslint devel unordered*/
async function getSite(obj) {
    return await f.datasource.request({
        method: "GET",
        name: "Site",
        client: obj.client,
        id: obj.data.id
    }, true);
}

f.datasource.registerFunction(
    "POST",
    "doGetSiteData",
    getSite
);
