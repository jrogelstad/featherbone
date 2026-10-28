/*jslint unordered*/
function getProductDocs(obj) {
    return new Promise(function (resolve, reject) {
        f.datasource.request({
            method: "GET",
            name: "Product",
            properties: ["id", "drawingLink", "documents"],
            client: obj.client,
            id: obj.data.id
        }, true).then(resolve).catch(reject);
    });
}

f.datasource.registerFunction(
    "POST",
    "doGetProductDocuments",
    getProductDocs
);
