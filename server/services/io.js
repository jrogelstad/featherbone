/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint node, this, unordered*/
/**
    Import and export
    @module IO
*/
(function (exports) {
    "use strict";

    const {CRUD} = require("./crud");
    const {Feathers} = require("./feathers");
    const f = require("../../common/core");
    const XLSX = require("xlsx");
    const fs = require("fs");
    const crud = new CRUD();
    const feathers = new Feathers();

    function commit(client) {
        return new Promise(function (resolve) {
            client.query("COMMIT;").then(resolve);
        });
    }

    function rollback(client) {
        return new Promise(function (resolve) {
            client.query("ROLLBACK;").then(resolve);
        });
    }

    async function getBaseCurr(datasource, vClient) {
        let curr = await datasource.request({
            method: "GET",
            name: "Currency",
            user: vClient.currentUser(),
            properties: ["id", "code"],
            filter: {criteria: [{
                property: "isBase",
                value: true
            }], limit: 1},
            tenant: vClient.tenant()
        }, true);
        if (!curr.length) {
            throw "No base currency found";
        }
        return curr[0].code;
    }

    /**
        @class Exporter
        @constructor
        @namespace Services
    */
    exports.Exporter = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        function tidy(obj) {
            delete obj.objectType;
            delete obj.isDeleted;
            delete obj.lock;

            Object.keys(obj).forEach(function (key) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach(function (row) {
                        delete row.id;
                        tidy(row);
                    });
                }
            });
        }

        function doExport(
            pClient,
            pFeather,
            pProperties,
            pFilter,
            dir,
            format,
            writeFile,
            pSubscription
        ) {
            return new Promise(function (resolve, reject) {
                let id = f.createId();
                let filename = dir + id + "." + format;
                let props = (
                    pProperties
                    ? f.copy(pProperties)
                    : undefined
                );
                let payload = {
                    client: pClient,
                    name: pFeather,
                    filter: pFilter,
                    properties: pProperties
                };

                if (pProperties && pProperties.indexOf("objectType") === -1) {
                    pProperties.push("objectType");
                }

                async function callback(resp) {
                    try {
                        let process = f.datasource.createProcess({
                            client: pClient,
                            count: resp.length,
                            name: (
                                "Exporting " +
                                resp.length.toLocaleString() + " " +
                                pFeather + " records"
                            ),
                            subscription: pSubscription
                        });
                        await process.start();

                        await writeFile(
                            filename,
                            resp,
                            format,
                            pClient,
                            pFeather,
                            props,
                            process
                        );
                        resolve(filename);
                    } catch (e) {
                        reject(e);
                    }
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(callback).catch(reject);
            });
        }

        async function writeWorkbook(
            filename,
            data,
            format,
            client,
            feather,
            props,
            process
        ) {
            let wb = XLSX.utils.book_new();
            let sheets = {};
            let localFeathers = {};
            let keys;
            let key;
            let ws;

            function doRename(data, tmp, partial, key) {
                if (
                    !partial && (
                        key === "objectType" ||
                        key === "isDeleted" ||
                        key === "lock"
                    )
                ) {
                    tmp[key] = data[key];
                } else {
                    tmp[key.toName()] = data[key];
                }
            }

            function naturalKey(rel, value) {
                let fthr = localFeathers[rel];
                let kys = Object.keys(fthr.properties);
                let attr = kys.find(function (key) {
                    return fthr.properties[key].isNaturalKey;
                });
                if (attr) {
                    return value[attr];
                }
                return value.id;
            }

            function resolveProperty(key, fthr) {
                let idx = key.indexOf(".");
                let attr;
                let rel;

                if (idx !== -1) {
                    attr = key.slice(0, idx);
                    rel = fthr.properties[attr].type.relation;
                    fthr = localFeathers[rel];
                    key = key.slice(idx + 1, key.length);
                    return resolveProperty(key, fthr);
                }

                return fthr.properties[key];
            }

            function resolveValue(key, o) {
                let idx = key.indexOf(".");
                let attr;

                if (!o) {
                    return null;
                }

                if (idx !== -1) {
                    attr = key.slice(0, idx);
                    key = key.slice(idx + 1, key.length);
                    o = o[attr];
                    return resolveValue(key, o);
                }

                return o[key];
            }

            async function toSheets(d, rename, feather, vprops) {
                let cfeather = localFeathers[feather];
                let name = feather;
                let tmp;
                let c = 0;
                let cprops = vprops || Object.keys(cfeather.properties);

                let pkey = feather + " Id";
                let pval;
                let rel;
                let prop;
                let row;
                let i = 0;

                while (i < d.length) {
                    row = d[i];
                    i += 1;
                    pval = row.id;

                    cprops.forEach(function (key) {
                        prop = resolveProperty(key, cfeather);
                        let value = resolveValue(key, row);
                        let n;

                        if (key.indexOf(".") !== -1) {
                            key = key.replace(/\./g, "_").toCamelCase(true);
                        }

                        if (
                            prop &&
                            typeof prop.type === "object"
                        ) {
                            if (prop.type.parentOf) {
                                // Add parent key in
                                rel = prop.type.relation.toCamelCase(true);
                                n = 0;
                                row[key] = row[key] || [];
                                row[key].forEach(function (r) {
                                    tmp = {};
                                    tmp[pkey] = pval;
                                    // This shuffle makes sure pkey is first
                                    Object.keys(r).forEach(function (key) {
                                        tmp[key] = r[key];
                                    });
                                    row[key][n] = tmp;
                                    n += 1;
                                });
                                toSheets(row[key], true, rel);
                                delete row[key];
                            } else if (prop.type.isChild) {
                                rel = prop.type.relation.toCamelCase(true);

                                if (
                                    row[key] !== null &&
                                    row[key] !== undefined
                                ) {
                                    toSheets([row[key]], true, rel);
                                    row[key] = row[key].id;
                                }
                            } else {
                                if (value) {
                                    row[key] = naturalKey(
                                        prop.type.relation,
                                        value
                                    );
                                }
                            }
                        } else if (
                            prop.type === "object" &&
                            f.formats[prop.format].isMoney
                        ) {
                            row[key] = (
                                value
                                ? value.amount
                                : 0
                            );
                        } else {
                            row[key] = value;
                        }
                    });

                    if (rename !== false) {
                        tmp = {};
                        Object.keys(row).forEach(
                            doRename.bind(null, row, tmp, false)
                        );
                        d[c] = tmp;
                        c += 1;
                    }
                    await process.next();
                }

                if (!sheets[name]) {
                    sheets[name] = d;
                } else {
                    d.forEach(function (row) {
                        sheets[name].push(row);
                    });
                }
            }

            await feathers.getFeathers(
                client,
                feather,
                localFeathers
            );

            await toSheets(data, true, feather, props);

            // Add worksheets in reverse order
            keys = Object.keys(sheets);
            while (keys.length) {
                key = keys.pop();
                sheets[key].forEach(tidy);
                ws = XLSX.utils.json_to_sheet(sheets[key]);
                XLSX.utils.book_append_sheet(wb, ws, key);
            }

            XLSX.writeFile(wb, filename, {bookType: format});
            process.complete();
        }

        /**
            Export as json.

            @method json
            @param {Object} client Database client
            @param {String} feather Feather name
            @param {Array} properties
            @param {Object} filter
            @param {String} dir Target file directory
            @param {Object} [subscription] For progress tracking
            @return {Promise} Resolves filename of exported data
        */
        that.json = function (
            client,
            feather,
            properties,
            filter,
            dir,
            subscription
        ) {
            return new Promise(function (resolve, reject) {
                function writeFile(...args) {
                    let filename = args[0];
                    let data = args[1];
                    let process = args[6];
                    return new Promise(function (resolve) {
                        data.forEach(tidy);

                        fs.appendFile(
                            filename,
                            JSON.stringify(data, null, 4),
                            async function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                await process.complete();
                                resolve();
                            }
                        );
                    });
                }

                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "json",
                    writeFile,
                    subscription
                ).then(resolve).catch(reject);
            });
        };

        /**
            Export as Open Document spreadsheet.

            @method ods
            @param {Object} Database client
            @param {String} Feather name
            @param {Array} Properties
            @param {Object} Filter
            @param {String} Target file directory
            @param {Object} [subscription] For progress tracking
            @return {String} Filename
        */
        that.ods = function (
            client,
            feather,
            properties,
            filter,
            dir,
            subscription
        ) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "ods",
                    writeWorkbook,
                    subscription
                ).then(resolve).catch(reject);
            });
        };

        /**
            Export as Excel spreadsheet.

            @method xlsx
            @param {Object} Database client
            @param {String} Feather name
            @param {Array} Properties
            @param {Object} Filter
            @param {String} Target file directory
            @param {Object} [subscription] For progress tracking
            @return {String} Filename
        */
        that.xlsx = function (
            client,
            feather,
            properties,
            filter,
            dir,
            subscription
        ) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "xlsx",
                    writeWorkbook,
                    subscription
                ).then(resolve).catch(reject);
            });
        };

        return that;
    };

    /**
        @class Importer
        @constructor
        @namespace Services
    */
    exports.Importer = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Import JSON file.

            @method json
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @param {Object} [subscription] For progress tracking
            @return {Array} Error log
        */
        that.json = function (
            datasource,
            pClient,
            feather,
            filename,
            pSubscription
        ) {
            return new Promise(function (resolve, reject) {
                let log = [];

                function error(pError, pFeather, pData) {
                    if (typeof pError === "string") {
                        pError = new Error(pError);
                        pError.statusCode = 500;
                    }
                    log.push({
                        feather: pFeather,
                        error: {
                            statusCode: pError.statusCode,
                            message: pError.message
                        },
                        data: pData
                    });
                }

                function writeLog() {
                    let logname;

                    if (log.length) {
                        logname = "./files/downloads/" + f.createId() + ".json";
                        fs.appendFile(
                            logname,
                            JSON.stringify(log, null, 4),
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                fs.unlink(filename, function () {
                                    resolve(logname);
                                });
                            }
                        );
                        return;
                    }

                    fs.unlink(filename, resolve);
                }

                async function post(item) {
                    try {
                        await datasource.request({
                            method: "POST",
                            client: pClient,
                            name: feather,
                            id: item.id,
                            data: item
                        });
                    } catch (e) {
                        error(e, feather, item);
                    }
                }

                async function callback(err, data) {
                    if (err) {
                        console.error(err);
                        fs.unlink(filename, reject.bind(null, err));
                        return;
                    }
                    let process;
                    let item;
                    let i = 0;

                    try {
                        data = JSON.parse(data);
                        process = datasource.createProcess({
                            client: pClient,
                            count: data.length,
                            name: (
                                "Importing " +
                                data.length.toLocaleString() + " " +
                                feather + " records"
                            ),
                            subscription: pSubscription
                        });
                        await process.start();

                        while (i < data.length) {
                            item = data[i];
                            i += 1;
                            await post(item);
                            await process.next();
                        }
                        await commit(pClient);
                        await process.complete();
                        await writeLog();
                    } catch (e) {
                        await rollback();
                        fs.unlink(filename, reject.bind(null, e));
                        return;
                    }
                }

                fs.readFile(filename, "utf8", callback);
            });
        };

        /**
            Import Excel file.

            @method xlsx
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @param {Object} [subscription] For progress tracking
            @return {Array} Error log
        */
        that.xlsx = async function (
            datasource,
            pClient,
            feather,
            filename,
            pSubscription
        ) {
            let log = [];
            let wb = XLSX.readFile(filename);
            let sheets = {};
            let localFeathers = {};
            let memoize = {};
            let curr = await getBaseCurr(datasource, pClient);
            let process;
            let cnt = 0;

            wb.SheetNames.forEach(function (name) {
                sheets[name] = XLSX.utils.sheet_to_json(
                    wb.Sheets[name]
                );
                cnt += sheets[name].length;
            });

            process = datasource.createProcess({
                client: pClient,
                count: cnt,
                name: (
                    "Importing " +
                    cnt.toLocaleString() + " " +
                    feather + " records"
                ),
                subscription: pSubscription
            });
            await process.start();

            function error(pError, pFeather, pData) {
                if (typeof pError === "string") {
                    pError = new Error(pError);
                    pError.statusCode = 500;
                }
                log.push({
                    feather: pFeather,
                    error: {
                        statusCode: pError.statusCode,
                        message: pError.message
                    },
                    data: pData
                });
            }

            async function buildRow(feather, row) {
                let ret = {};
                let props = localFeathers[feather].properties;
                let ary;
                let id = row.Id;

                if (!id) {
                    throw (
                        "Id is required for \"" + feather + "\""
                    );
                }

                async function getRelationId(pKey, pValue) {
                    let rel = props[pKey].type.relation;
                    let relFthr = localFeathers[rel];
                    let nkey = Object.keys(
                        relFthr.properties
                    ).find(
                        (k) => relFthr.properties[k].isNaturalKey
                    );
                    let resp;

                    // No natural key, so assume value is id
                    if (!nkey) {
                        ret[pKey] = {id: pValue};
                        return;
                    }

                    // Check if we already queried for this one
                    if (memoize[rel] && memoize[rel][pValue]) {
                        ret[pKey] = {id: memoize[rel][pValue]};
                        return;
                    }

                    // Look for record with matching natural key
                    resp = await datasource.request({
                        method: "GET",
                        name: rel,
                        filter: {criteria: [{
                            property: nkey,
                            value: pValue
                        }]},
                        user: pClient.currentUser(),
                        tenant: pClient.tenant()
                    }, true);

                    // If found match, use it
                    if (resp.length) {
                        ret[pKey] = {id: resp[0].id};
                        // Remember to avoid querying again
                        if (!memoize[rel]) {
                            memoize[rel] = {};
                        }
                        memoize[rel][pValue] = resp[0].id;
                    }
                }

                let keys = Object.keys(props);
                let i = 0;
                let value;
                let pkey;
                let rel;
                let attrs;
                let key;
                let cary;
                let c;
                let item;

                while (i < keys.length) {
                    key = keys[i];
                    value = row[key.toName()];
                    pkey = feather.toName() + " Id";
                    i += 1;

                    // Handle child array
                    if (
                        props[key].type.parentOf &&
                        sheets[props[key].type.relation]
                    ) {
                        rel = props[key].type.relation;
                        ary = sheets[rel].filter(
                            (r) => r[pkey] === id
                        );
                        cary = [];
                        c = 0;
                        while (c < ary.length) {
                            item = ary[c];
                            cary.push(await buildRow(rel, item));
                            c += 1;
                        }
                        ret[key] = cary;

                    // Handle child object
                    } else if (props[key].type.isChild) {
                        rel = props[key].type.relation;
                        if (sheets[rel]) {
                            rel = props[key].type.relation;
                            ret[key] = sheets[rel].find(
                                (r) => r.Id === row[
                                    key.toName()
                                ]
                            );
                            ret[key] = await buildRow(rel, ret[key]);
                        }
                    } else if (value !== undefined) {
                        if (
                            typeof props[key].type === "object" &&
                            value
                        ) {
                            await getRelationId(key, value);
                        } else if (
                            props[key].type === "object" &&
                            f.formats[props[key].format].isMoney
                        ) {
                            value = String(value);
                            attrs = value.split(" ");
                            ret[key] = {
                                amount: Number(attrs[0]),
                                currency: attrs[1] || curr,
                                effective: attrs[2],
                                baseAmount: (
                                    attrs[3] !== undefined
                                    ? Number(attrs[3])
                                    : undefined
                                )
                            };
                        } else {
                            ret[key] = value;
                        }
                    }
                }

                return ret;
            }

            async function writeLog() {
                let logname;

                function appendFile() {
                    return new Promise(function (resolve) {
                        fs.appendFile(
                            logname,
                            JSON.stringify(log, null, 4),
                            resolve
                        );
                    });
                }

                if (log.length) {
                    logname = (
                        "./files/downloads/" +
                        f.createId() + ".json"
                    );
                    await appendFile();

                    return logname;
                }
            }

            async function post(item) {
                try {
                    await datasource.request({
                        method: "POST",
                        client: pClient,
                        name: feather,
                        id: item.id,
                        data: item
                    });
                } catch (e) {
                    error(e, feather, item);
                }
            }

            function unlink() {
                return new Promise(function (resolve) {
                    fs.unlink(filename, resolve);
                });
            }

            let row;
            let n = 0;
            let theData;

            if (!sheets[feather]) {
                throw (
                    "Expected sheet " +
                    feather + "not present in workbook"
                );
            }

            try {
                await feathers.getFeathers(
                    pClient,
                    feather,
                    localFeathers
                );

                while (n < sheets[feather].length) {
                    row = sheets[feather][n];
                    theData = await buildRow(feather, row);

                    console.log("adding row", row.Id);
                    await post(theData);
                    process.next();
                    n += 1;
                }

                await commit(pClient);
            } catch (ignore) {
                await rollback(pClient);
            } finally {
                await unlink();
                await process.complete();
            }

            return await writeLog();
        };

        /**
            Import Open Document Spreadsheet file.

            @method ods
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @param {Object} [subscription] For progress tracking
            @return {Array} Error log
        */
        that.ods = that.xlsx;

        return that;
    };

}(exports));

