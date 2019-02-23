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

    const AdmZip = require("adm-zip");
    const path = require("path");
    const {
        Tools
    } = require("./tools");
    const propTypes = [
        "description",
        "alias",
        "type",
        "format",
        "scale",
        "precision",
        "min",
        "max",
        "default",
        "autonumber",
        "isReadOnly",
        "isRequired",
        "isNaturalKey",
        "isLabelKey",
        "dataList",
        "isIndexed"
    ];

    const tools = new Tools();

    exports.Packager = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Package a module.

          @param {Object} Database client
          @param {String} Module
          @param {String} Username
          @return {Object}
        */
        that.package = function (client, name, ignore) {
            return new Promise(function (resolve, reject) {
                let zip = new AdmZip();
                let sql;
                let params = [name];
                let requests = [];

                function addModule(resp) {
                    let content = resp.rows[0].script;

                    zip.addFile(
                        "module.js",
                        Buffer.alloc(content.length, content),
                        "Client code"
                    );
                }

                function addFeathers(resp) {
                    let content;

                    content = tools.sanitize(resp.rows);
                    content.forEach(function (feather) {
                        let props = {};

                        feather.properties.forEach(function (prop) {

                            props[prop.name] = prop;

                            // Remove unnecessary properties
                            Object.keys(prop).forEach(function (key) {
                                if (propTypes.indexOf(key) === -1) {
                                    delete prop[key];
                                }
                            });

                            // Remove noise
                            if (
                                prop.type === "number" ||
                                prop.type === "integer"
                            ) {
                                if (prop.scale === -1) {
                                    delete prop.scale;
                                }

                                if (prop.precision === -1) {
                                    delete prop.precision;
                                }

                                if (prop.min === 0) {
                                    delete prop.min;
                                }

                                if (prop.max === 0) {
                                    delete prop.max;
                                }
                            } else {
                                delete prop.scale;
                                delete prop.precision;
                                delete prop.min;
                                delete prop.max;
                            }

                            if (prop.format === "") {
                                delete prop.format;
                            }

                            if (prop.alias === "") {
                                delete prop.alias;
                            }

                            if (prop.autonumber === null) {
                                delete prop.autonumber;
                            }

                            if (prop.isNaturalKey === false) {
                                delete prop.isNaturalKey;
                            }

                            if (prop.isLabelKey === false) {
                                delete prop.isLabelKey;
                            }

                            if (prop.isRequired === false) {
                                delete prop.isRequired;
                            }

                            if (prop.isReadOnly === false) {
                                delete prop.isReadOnly;
                            }

                            if (prop.isIndexed === false) {
                                delete prop.isIndexed;
                            }

                            if (prop.dataList === null) {
                                delete prop.dataList;
                            }

                            if (
                                prop.default === null &&
                                prop.format !== "date" &&
                                prop.format !== "dateTime"
                            ) {
                                delete prop.default;
                            }
                        });

                        if (Object.keys(props).length) {
                            feather.properties = props;
                        } else {
                            delete feather.properties;
                        }

                        props = {};
                        feather.overloads.forEach(function (o) {
                            let overload = {};

                            if (o.overloadDescription) {
                                overload.description = o.description;
                            }

                            if (o.overloadAlias) {
                                overload.alias = o.alias;
                            }

                            if (o.overloadType) {
                                overload.type = o.type;
                            }

                            if (o.overloadDefault) {
                                overload.default = o.default;
                            }

                            if (o.overloadDataList) {
                                overload.dataList = o.dataList;
                            }

                            props[overload.name] = overload;
                        });

                        if (Object.keys(props).length) {
                            feather.overloads = props;
                        } else {
                            delete feather.overloads;
                        }

                        if (feather.isReadOnly === false) {
                            delete feather.isReadOnly;
                        }

                        if (feather.isFetchOnStartup === false) {
                            delete feather.isFetchOnStartup;
                        }

                        if (feather.authorization === null) {
                            delete feather.authorization;
                        }

                        if (feather.plural === "") {
                            delete feather.plural;
                        }

                        if (feather.isChild === false) {
                            delete feather.isChild;
                        }

                        if (feather.isSystem === false) {
                            delete feather.isSystem;
                        }
                    });
                    content = JSON.stringify(content, null, 2);

                    zip.addFile(
                        "feathers.js",
                        Buffer.alloc(content.length, content),
                        "Feather definitions"
                    );
                }

                sql = "SELECT script FROM module WHERE name = $1";
                requests.push(client.query(sql, params));

                sql = (
                    "SELECT name, description, plural, \"module\", " +
                    "\"authorization\", \"inherits\", is_system, is_child, " +
                    "is_fetch_on_startup, is_read_only, " +
                    "to_json(properties) AS properties, " +
                    "to_json(overloads) AS overloads " +
                    "FROM _feather WHERE module = $1"
                );
                requests.push(client.query(sql, params));

                Promise.all(requests).then(function (resp) {
                    let filename = path.format(
                        {root: "./", base: "/packages/" + name + ".zip"}
                    );

                    addModule(resp[0]);
                    addFeathers(resp[1]);

                    zip.writeZip(
                        filename,
                        resolve.bind(null, true)
                    );
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));

