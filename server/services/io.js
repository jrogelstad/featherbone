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
    const f = require("../../common/core.js");
    const XLSX = require("xlsx");
    const fs = require("fs");
    const crud = new CRUD();

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

                function callback(resp) {
                    resp.forEach(tidy);
                    writeFile(filename, resp).then(() => resolve(filename));
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(callback).catch(reject);
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
                function writeFile(filename, data) {
                    return new Promise(function (resolve) {
                        let wb = XLSX.utils.book_new();
                        let ws = XLSX.utils.json_to_sheet(data);

                        XLSX.utils.book_append_sheet(wb, ws, feather);
                        XLSX.writeFile(wb, filename);
                        resolve();
                    });
                }

                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "xlxs",
                    writeFile
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
          @param {String} User name
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

                    data = JSON.parse(data);

                    data.forEach(function (item) {
                        let payload = {
                            method: "POST",
                            client: client,
                            name: feather,
                            id: item.id,
                            data: item
                        };
                        console.log("Trying this one: ", item.id);
                        requests.push(
                            datasource.request(payload).catch(
                                error.bind(payload)
                            )
                        );
                    });

                    Promise.all(requests).then(
                        resolve.bind(null, log)
                    ).catch(reject);
                }

                fs.readFile(filename, "utf8", callback);
            });
        };

        return that;
    };

}(exports));

