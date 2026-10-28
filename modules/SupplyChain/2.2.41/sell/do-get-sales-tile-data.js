/*jslint devel */
// Sales tile data. Kept as its own route for existing callers; the work is
// done by doGetBiTileData (common/do-get-bi-tile-data.js), which serves the
// purchase and production tiles the same way. See that file for the request
// and response.

function doGetSalesTileData(obj) {
    return f.datasource.request({
        client: obj.client,
        data: Object.assign({}, obj.data, {fact: "sales"}),
        method: "POST",
        name: "doGetBiTileData",
        user: obj.client.currentUser()
    }, true);
}

f.datasource.registerFunction(
    "POST",
    "doGetSalesTileData",
    doGetSalesTileData
);
