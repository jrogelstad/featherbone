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
            database: obj.client.database,
            /*
                The library this package declares in its own
                package.json, loaded from its own directory rather
                than from a ModuleNpm row (ADR-002 question 1).
            */
            library: typeof f.fbtestBig
        });
    });
}

f.datasource.registerFunction("POST", "fbtestVersion", doFbtestVersion);
