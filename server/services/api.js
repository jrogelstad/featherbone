/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
/*jslint node, devel unordered*/
/**
    API file generator methods called during installation.
    @module API
*/
(function (exports) {
    "use strict";

    const fs = require("fs");
    const f = require("../../common/core");

    /**
        Service for building Open API specification.

        @class API
        @constructor
        @namespace Services
    */
    exports.API = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Build client api specification. Creates api.js in client folder.

            @method buildClientApi
            @param {Object} datasource
            @param {String} username
            @return {Promise}
        */
        that.buildClientApi = function (datasource, username) {
            return new Promise(function (resolve, reject) {
                let content = "";
                let catalog;
                let payload;
                let keys;

                function callback(resp) {
                    let lastModule = "";
                    catalog = resp;

                    // Loop through each feather and append to api
                    keys = Object.keys(catalog);
                    keys.sort(function (a, b) {
                        if (catalog[a].module === catalog[b].module) {
                            return (
                                a < b
                                ? -1
                                : 1
                            );
                        }

                        return (
                            catalog[a].module < catalog[b].module
                            ? -1
                            : 1
                        );
                    });

                    keys.forEach(function (key) {
                        let feather = f.copy(catalog[key]);
                        let props = feather.properties || {};

                        if (feather.module !== lastModule) {
                            content += (
                                "/**\n" +
                                "    @module " + feather.module + "\n" +
                                "*/\n"
                            );
                        }

                        content += (
                            "/**\n" +
                            "    @class " + key + "\n" +
                            "    @static\n" +
                            "    @extends Models." +
                            (feather.inherits || "Object") + "\n" +
                            "    @namespace Models\n" +
                            "*/\n"
                        );

                        Object.keys(props).forEach(function (p) {
                            let prop = props[p];
                            let readOnly = (
                                prop.isReadOnly
                                ? "    __Read Only__\n\n"
                                : ""
                            );
                            let format = (
                                prop.format
                                ? "    __Format:__ " + prop.format + "\n\n"
                                : ""
                            );
                            let type = (
                                typeof prop.type === "object"
                                ? (
                                    "\n    __Type:__ " +
                                    "{{#crossLink \"" +
                                    prop.type.relation.toCamelCase(true) +
                                    "\"}}{{/crossLink}}" +
                                    "\n\n"
                                )
                                : (
                                    "\n    __Type:__ `" +
                                    prop.type.toCamelCase(true) + "`\n\n"
                                )
                            );
                            content += (
                                "/**\n" +
                                "    " + prop.description + ".\n" +
                                type + format + readOnly +
                                "    @property data." + p + "\n" +
                                "    @type Property" + (
                                    feather.inherits || "Object"
                                ) + "\n" +
                                "    @namespace Models\n" +
                                "*/\n"
                            );
                        });

                        lastModule = catalog[key].module;
                    });

                    // Save api file
                    fs.writeFile("./client/api.js", content, function (err) {
                        if (err) {
                            console.error(err);
                            return;
                        }
                        resolve();
                    });
                }

                // Real work starts here
                console.log("Building Client API specification");

                // Load the existing feather catalog from postgres
                payload = {
                    method: "GET",
                    name: "getSettings",
                    user: username,
                    data: {name: "catalog"},
                    tenant: false
                };

                datasource.request(payload, true).then(
                    callback
                ).catch(
                    reject
                );
            });
        };

        return that;
    };

}(exports));
