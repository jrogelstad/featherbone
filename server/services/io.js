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
/*jslint node*/
(function (exports) {
    "use strict";

    const {CRUD} = require("./crud");
    const f = require("../../common/core.js");
    const fs = require("fs");
    const crud = new CRUD();

    exports.Exporter = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        function removeType(obj) {
            delete obj.objectType;

            Object.keys(obj).forEach(function (key) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach(removeType);
                }
            });
        }

        /**
          Export as json.

          @param {Object} Database client
          @param {String} Feather name
          @param {Object} Filter
          @param {String} Target file directory
          @param {String} User name
          @return {String} Filename
        */
        that.json = function (client, feather, filter, dir) {
            return new Promise(function (resolve, reject) {
                let payload = {
                    client: client,
                    name: feather,
                    filter: filter
                };

                function writefile(resp) {
                    let id = f.createId();
                    let filename = dir + id + ".json";

                    resp.forEach(removeType);

                    fs.open(
                        filename,
                        JSON.stringify(resp, null, 4),
                        resolve.bind(null, filename)
                    );

                    resolve(filename);
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(writefile).catch(reject);
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
          Return routes.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @return {Object}
        */
        that.getRoutes = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "SELECT module, path, function FROM \"_route\" ";

                // Query routes
                obj.client.query(sql, function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(resp.rows);
                });
            });
        };

        return that;
    };

}(exports));

