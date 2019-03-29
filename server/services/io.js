/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
**/
/*jslint node, this*/
(function (exports) {
    "use strict";

    const {CRUD} = require("./crud");
    const {Feathers} = require("./feathers");
    const f = require("../../common/core");
    const XLSX = require("xlsx");
    const fs = require("fs");
    const crud = new CRUD();
    const feathers = new Feathers();

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
            client,
            feather,
            properties,
            filter,
            dir,
            format,
            writeFile
        ) {
            return new Promise(function (resolve, reject) {
                let id = f.createId();
                let filename = dir + id + format;
                let payload = {
                    client: client,
                    name: feather,
                    filter: filter,
                    properties: properties
                };

                if (properties && properties.indexOf("objectType") === -1) {
                    properties.push("objectType");
                }

                function callback(resp) {
                    writeFile(filename, resp, format).then(
                        () => resolve(filename)
                    );
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(callback).catch(reject);
            });
        }

        function writeWorkbook(filename, data, format) {
            return new Promise(function (resolve) {
                let wb = XLSX.utils.book_new();
                let sheets = {};
                let keys;
                let key;
                let ws;

                function toSheets(d, rename) {
                    let type;
                    let tmp;
                    let c = 0;

                    function doRename(data, key) {
                        if (
                            key === "objectType" ||
                            key === "isDeleted" ||
                            key === "lock"
                        ) {
                            tmp[key] = data[key];
                        } else {
                            tmp[key.toName()] = data[key];
                        }
                    }

                    if (d.length) {
                        d.forEach(function (row) {
                            let pkey = row.objectType.toName() + " Id";
                            let pval = row.id;

                            Object.keys(row).forEach(function (key) {
                                let n;

                                if (
                                    Array.isArray(row[key]) &&
                                    row[key].length &&
                                    row[key][0].objectType
                                ) {
                                    // Add parent key in
                                    n = 0;
                                    row[key].forEach(function (r) {
                                        tmp = {};
                                        tmp[pkey] = pval;
                                        Object.keys(r).forEach(
                                            doRename.bind(null, r)
                                        );
                                        row[key][n] = tmp;
                                        n += 1;
                                    });
                                    toSheets(row[key], false);
                                    delete row[key];
                                } else if (
                                    row[key] !== null &&
                                    typeof row[key] === "object" &&
                                    row[key].id
                                ) {
                                    row[key] = row[key].id;
                                }
                            });

                            if (rename !== false) {
                                tmp = {};
                                Object.keys(row).forEach(
                                    doRename.bind(null, row)
                                );
                                d[c] = tmp;
                                c += 1;
                            }
                        });

                        type = d[0].objectType;
                        if (!sheets[type]) {
                            sheets[type] = d;
                        } else {
                            sheets[type] = sheets[type].concat(d);
                        }
                    }
                }

                toSheets(data);

                // Add worksheets in reverse order
                keys = Object.keys(sheets);
                while (keys.length) {
                    key = keys.pop();
                    sheets[key].forEach(tidy);
                    ws = XLSX.utils.json_to_sheet(sheets[key]);
                    XLSX.utils.book_append_sheet(wb, ws, key);
                }

                XLSX.writeFile(wb, filename, {bookType: format});
                resolve();
            });
        }

        /**
          Export as json.

          @param {Object} Database client
          @param {String} Feather name
          @param {Array} Properties
          @param {Object} Filter
          @param {String} Target file directory
          @return {String} Filename
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

    exports.Importer = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Import JSON file.

          @param {Object} Datasource
          @param {Object} Database client
          @param {String} Feather name
          @param {String} Source file
          @return {Array} Error log
        */
        that.json = function (datasource, client, feather, filename) {
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

                function callback(err, data) {
                    if (err) {
                        console.error(err);
                        return reject(err);
                    }

                    try {
                        data = JSON.parse(data);

                        data.forEach(function (item) {
                            let payload = {
                                method: "POST",
                                client: client,
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
                        reject(e);
                        return;
                    }

                    Promise.all(requests).then(
                        resolve.bind(null, log)
                    ).catch(reject);
                }

                fs.readFile(filename, "utf8", callback);
            });
        };

        /**
          Import Excel file.

          @param {Object} Datasource
          @param {Object} Database client
          @param {String} Feather name
          @param {String} Source file
          @return {Array} Error log
        */
        that.xlsx = function (datasource, client, feather, filename) {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let log = [];
                let wb = XLSX.readFile(filename);
                let sheets = {};
                let localFeathers = {};

                wb.SheetNames.forEach(function (name) {
                    sheets[name] = XLSX.utils.sheet_to_json(
                        wb.Sheets[name]
                    );
                });

                function error(err) {
                    log.push({
                        feather: this.name,
                        id: this.id,
                        error: err
                    });
                }

                function getFeather(name) {
                    return new Promise(function (resolve, reject) {
                        function getChildFeathers(resp) {
                            let frequests = [];
                            let props = resp.properties;

                            try {
                                localFeathers[name] = resp;

                                // Recursively get feathers for all children
                                Object.keys(props).forEach(function (key) {
                                    let type = props[key].type;

                                    if (
                                        typeof type === "object" &&
                                        type.parentOf
                                    ) {
                                        frequests.push(
                                            getFeather(
                                                type.relation
                                            )
                                        );
                                    }
                                });
                            } catch (e) {
                                reject(e);
                                return;
                            }

                            Promise.all(
                                frequests
                            ).then(resolve).catch(reject);
                        }

                        feathers.getFeather({
                            client,
                            data: {
                                name: name
                            }
                        }).then(getChildFeathers).catch(reject);
                    });
                }

                function buildRow(feather, row) {
                    let ret = {};
                    let props = localFeathers[feather].properties;
                    let ary;
                    let id = row.Id;

                    if (!id) {
                        throw new Error(
                            "Id is required for \"" + feather + "\""
                        );
                    }

                    try {
                        Object.keys(props).forEach(function (key) {
                            let value = row[key.toName()];
                            let pkey = feather.toName() + " Id";
                            let rel;

                            if (typeof props[key].type === "object") {
                                if (props[key].type.isParent) {
                                    rel = props[key].type.relation;
                                    ary = sheets[rel].filter(
                                        (r) => r[pkey] === id
                                    );
                                    ret[key] = ary.forEach(
                                        buildRow.bind(null, localFeathers[rel])
                                    );
                                } else if (value) {
                                    ret[key] = {id: value};
                                }
                            } else if (value !== undefined) {
                                ret[key] = value;
                            }
                        });
                    } catch (e) {
                        reject(e);
                        return;
                    }

                    return ret;
                }

                function doRequest(row) {
                    let payload = {
                        client: client,
                        method: "POST",
                        name: feather,
                        id: row.Id,
                        data: buildRow(feather, row)
                    };

                    requests.push(
                        datasource.request(payload).catch(
                            error.bind(payload)
                        )
                    );
                }

                function callback() {
                    sheets[feather].forEach(doRequest);

                    Promise.all(requests).then(
                        resolve.bind(null, log)
                    ).catch(reject);
                }

                getFeather(feather).then(callback).catch(reject);
            });
        };

        /**
          Import Open Document Spreadsheet file.

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

