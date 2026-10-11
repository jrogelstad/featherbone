/*
    Fixture service. The version in the answer is the whole point: two
    databases deployed at different versions must each get their own.
*/
function doFbtestVersion(obj) {
    "use strict";
    return new Promise(function (resolve) {
        resolve({
            version: "1.1.0",
            source: "disk",
            database: obj.client.database
        });
    });
}

f.datasource.registerFunction("POST", "fbtestVersion", doFbtestVersion);
