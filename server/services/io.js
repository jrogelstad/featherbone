/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint node, this*/
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
            writeFile
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

                function callback(resp) {
                    writeFile(
                        filename,
                        resp,
                        format,
                        pClient,
                        pFeather,
                        props
                    ).then(
                        () => resolve(filename)
                    ).catch(reject);
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(callback).catch(reject);
            });
        }

        function writeWorkbook(
            filename,
            data,
            format,
            client,
            feather,
            props
        ) {
            return new Promise(function (resolve, reject) {
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

                function toSheets(d, rename, feather) {
                    let cfeather = localFeathers[feather];
                    let name = feather;
                    let tmp;
                    let c = 0;

                    if (d.length) {
                        d.forEach(function (row) {
                            let pkey = feather + " Id";
                            let pval = row.id;
                            let rel;
                            let prop;

                            Object.keys(row).forEach(function (key) {
                                let n;

                                prop = cfeather.properties[
                                    key.replace(" ", "").toCamelCase()
                                ];

                                if (
                                    prop &&
                                    typeof prop.type === "object" &&
                                    prop.type.parentOf
                                ) {
                                    // Add parent key in
                                    rel = prop.type.relation.toCamelCase(true);
                                    n = 0;
                                    row[key] = row[key] || [];
                                    row[key].forEach(function (r) {
                                        tmp = {};
                                        tmp[pkey] = pval;
                                        Object.keys(r).forEach(
                                            doRename.bind(null, r)
                                        );
                                        row[key][n] = tmp;
                                        n += 1;
                                    });
                                    toSheets(row[key], false, rel);
                                    delete row[key];
                                } else if (
                                    prop && (
                                        typeof prop.type === "object" ||
                                        prop.type === "object"
                                    )
                                ) {
                                    if (prop.type.isChild) {
                                        rel = prop.type.relation.toCamelCase(
                                            true
                                        );

                                        if (
                                            row[key] !== null &&
                                            row[key] !== undefined
                                        ) {
                                            tmp = {};
                                            tmp.objectType = rel;
                                            Object.keys(row[key]).forEach(
                                                doRename.bind(null, row[key])
                                            );
                                            toSheets([tmp], false, rel);
                                            row[key] = row[key].id;
                                        }
                                    } else if (prop.format === "money") {
                                        if (row[key].effective) {
                                            row[key] = (
                                                row[key].amount + " " +
                                                row[key].currency + " " +
                                                row[key].effective + " " +
                                                row[key].baseAmount
                                            );
                                        } else {
                                            row[key] = (
                                                row[key].amount + " " +
                                                row[key].currency
                                            );
                                        }
                                    } else if (row[key] && row[key].id) {
                                        row[key] = row[key].id;
                                    }
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
                        });

                        if (!sheets[name]) {
                            sheets[name] = d;
                        } else {
                            sheets[name] = sheets[name].concat(d);
                        }
                    }
                }

                function toSheetsPartial(d, feather) {
                    let cfeather = localFeathers[feather];
                    let name = feather;
                    let tmp;
                    let c = 0;

                    function naturalKey(rel, value) {
                        let fthr = localFeathers[rel];
                        let kys = Object.keys(fthr.properties);
                        let attr = kys.find(function (key) {
                            return fthr.properties[key].isNaturalKey;
                        });
                        return value[attr];
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

                    if (d.length) {
                        d.forEach(function (row) {
                            let nrow = {};

                            props.forEach(function (key) {
                                let prop = resolveProperty(key, cfeather);
                                let value = resolveValue(key, row);

                                if (key.indexOf(".") !== -1) {
                                    key = key.replace(/\./g, "_").toCamelCase(true);
                                }

                                if (
                                    prop.type === "object" &&
                                    prop.format === "money"
                                ) {
                                    nrow[key] = (
                                        value
                                        ? value.amount
                                        : 0
                                    );
                                } else if (
                                    typeof prop.type === "object"
                                ) {
                                    if (value) {
                                        nrow[key] = naturalKey(
                                            prop.type.relation,
                                            value
                                        );
                                    }
                                } else {
                                    nrow[key] = value;
                                }
                            });

                            tmp = {};
                            Object.keys(nrow).forEach(
                                doRename.bind(null, nrow, tmp, true)
                            );
                            d[c] = tmp;
                            c += 1;
                        });

                        if (!sheets[name]) {
                            sheets[name] = d;
                        } else {
                            sheets[name] = sheets[name].concat(d);
                        }
                    }
                }

                function callback() {
                    if (props) {
                        toSheetsPartial(data, feather);
                    } else {
                        toSheets(data, true, feather);
                    }

                    // Add worksheets in reverse order
                    keys = Object.keys(sheets);
                    while (keys.length) {
                        key = keys.pop();
                        sheets[key].forEach(tidy);
                        ws = XLSX.utils.json_to_sheet(sheets[key]);
                        XLSX.utils.book_append_sheet(wb, ws, key);
                    }

                    try {
                        XLSX.writeFile(wb, filename, {bookType: format});
                    } catch (e) {
                        reject(e);
                        return;
                    }

                    resolve();
                }

                feathers.getFeathers(
                    client,
                    feather,
                    localFeathers
                ).then(callback).catch(reject);
            });
        }

        /**
            Export as json.

            @method json
            @param {Object} client Database client
            @param {String} feather Feather name
            @param {Array} properties
            @param {Object} filter
            @param {String} dir Target file directory
            @return {Promise} Resolves filename of exported data
        */
        that.json = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                function writeFile(filename, data) {
                    return new Promise(function (resolve) {
                        data.forEach(tidy);

                        fs.appendFile(
                            filename,
                            JSON.stringify(data, null, 4),
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

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
                    writeFile
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
            @return {String} Filename
        */
        that.ods = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "ods",
                    writeWorkbook
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
            @return {String} Filename
        */
        that.xlsx = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "xlsx",
                    writeWorkbook
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
            @return {Array} Error log
        */
        that.json = function (datasource, pClient, feather, filename) {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let log = [];

                function error(err) {
                    log.push({
                        feather: this.name,
                        id: this.id,
                        error: err
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

                function callback(err, data) {
                    if (err) {
                        console.error(err);
                        fs.unlink(filename, reject.bind(null, err));
                        return;
                    }

                    try {
                        data = JSON.parse(data);

                        data.forEach(function (item) {
                            let payload = {
                                method: "POST",
                                client: pClient,
                                name: feather,
                                id: item.id,
                                data: item
                            };

                            requests.push(
                                datasource.request(payload).catch(
                                    error.bind(payload)
                                )
                            );
                        });
                    } catch (e) {
                        fs.unlink(filename, reject.bind(null, e));
                        return;
                    }

                    Promise.all(requests).then(
                        commit.bind(null, pClient)
                    ).then(writeLog).catch(function (err) {
                        rollback().then(function () {
                            fs.unlink(filename, reject.bind(null, err));
                        });
                    });
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
            @return {Array} Error log
        */
        that.xlsx = function (datasource, pClient, feather, filename) {
            return new Promise(function (resolve, reject) {
                let log = [];
                let wb;
                let sheets = {};
                let localFeathers = {};
                let next;
                let memoize = {};

                try {
                    wb = XLSX.readFile(filename);
                } catch (e) {
                    reject(e);
                    return;
                }

                wb.SheetNames.forEach(function (name) {
                    sheets[name] = XLSX.utils.sheet_to_json(
                        wb.Sheets[name]
                    );
                });

                function error(err) {
                    log.push({
                        feather: this.name,
                        id: this.id,
                        error: {
                            message: err.message,
                            statusCode: err.statusCode
                        }
                    });
                    next();
                }

                function buildRow(feather, row) {
                    return new Promise(function (resolve, reject) {
                        let ret = {};
                        let props = localFeathers[feather].properties;
                        let ary;
                        let id = row.Id;
                        let requests = [];

                        if (!id) {
                            reject(
                                "Id is required for \"" + feather + "\""
                            );
                            return;
                        }

                        function getRelationId(pKey, pValue) {
                            return new Promise(function (resolve, reject) {
                                let rel = props[pKey].type.relation;
                                let relFthr = localFeathers[rel];
                                let nkey = Object.keys(
                                    relFthr.properties
                                ).find(
                                    (k) => relFthr.properties[k].isNaturalKey
                                );

                                // No natural key, so assume value is id
                                if (!nkey) {
                                    ret[pKey] = {id: pValue};
                                    resolve();
                                    return;
                                }

                                // Check if we already queried for this one
                                if (memoize[rel] && memoize[rel][pValue]) {
                                    ret[pKey] = {id: memoize[rel][pValue]};
                                    resolve();
                                    return;
                                }

                                function callback(resp) {
                                    // If found match, use it
                                    if (resp.length) {
                                        ret[pKey] = {id: resp[0].id};
                                        // Remember to avoid querying again
                                        if (!memoize[rel]) {
                                            memoize[rel] = {};
                                        }
                                        memoize[rel][pValue] = resp[0].id;
                                    }
                                    resolve();
                                }

                                // Look for record with matching natural key
                                datasource.request({
                                    method: "GET",
                                    name: rel,
                                    filter: {criteria: [{
                                        property: nkey,
                                        value: pValue
                                    }]},
                                    user: pClient.currentUser()
                                }, true).then(callback).catch(reject);
                            });
                        }

                        try {
                            Object.keys(props).forEach(function (key) {
                                let value = row[key.toName()];
                                let pkey = feather.toName() + " Id";
                                let rel;
                                let attrs;

                                if (value === undefined) {
                                    return; // No data, skip
                                }

                                if (typeof props[key].type === "object") {
                                    // Handle child array
                                    if (
                                        props[key].type.parentOf &&
                                        sheets[props[key].type.relation]
                                    ) {
                                        rel = props[key].type.relation;
                                        ary = sheets[rel].filter(
                                            (r) => r[pkey] === id
                                        );
                                        ret[key] = ary.map(
                                            buildRow.bind(null, rel)
                                        );

                                    // Handle child object
                                    } else if (props[key].type.isChild) {
                                        if (sheets[rel]) {
                                            rel = props[key].type.relation;
                                            ret[key] = sheets[rel].find(
                                                (r) => r.Id === row[
                                                    key.toName()
                                                ]
                                            );
                                            ret[key] = buildRow(rel, ret[key]);
                                        }

                                    // Regular relation
                                    } else if (value) {
                                        requests.push(
                                            getRelationId(key, value)
                                        );
                                    }
                                } else if (props[key].format === "money") {
                                    attrs = value.split(" ");
                                    ret[key] = {
                                        amount: Number(attrs[0]),
                                        currency: attrs[1],
                                        effective: attrs[2],
                                        baseAmount: Number(attrs[3])
                                    };
                                } else {
                                    ret[key] = value;
                                }
                            });
                        } catch (e) {
                            reject(e);
                            return;
                        }

                        Promise.all(requests).then(
                            resolve.bind(null, ret)
                        ).catch(reject);
                    });
                }

                function writeLog() {
                    return new Promise(function (resolve) {
                        let logname;

                        if (log.length) {
                            logname = (
                                "./files/downloads/" +
                                f.createId() + ".json"
                            );
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
                    });
                }

                function callback() {
                    if (!sheets[feather]) {
                        reject(
                            "Expected sheet " +
                            feather + "not present in workbook"
                        );
                        return;
                    }

                    next();
                }

                next = function () {
                    let row;
                    let payload;

                    if (!sheets[feather].length) {
                        commit(pClient).then(writeLog).then(resolve);
                        return;
                    }

                    function addNext(resp) {
                        payload = {
                            client: pClient,
                            data: resp,
                            id: row.Id,
                            method: "POST",
                            name: feather,
                            user: pClient.currentUser()
                        };

                        console.log("adding row", row.Id);
                        datasource.request(payload).then(next).catch(
                            error.bind(payload)
                        );
                    }

                    row = sheets[feather].shift();
                    buildRow(feather, row).then(addNext).catch(reject);
                };

                feathers.getFeathers(
                    pClient,
                    feather,
                    localFeathers
                ).then(callback).catch(function (err) {
                    rollback(pClient).then(function () {
                        fs.unlink.bind(filename, function () {
                            reject(err);
                        });
                    });
                });
            });
        };

        /**
            Import Open Document Spreadsheet file.

            @method ods
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @return {Array} Error log
        */
        that.ods = that.xlsx;

        return that;
    };

}(exports));

