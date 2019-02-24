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

    function addModule(zip, resp) {
        let content;

        if (!resp.rows.length) {
            throw "Module not found";
        }

        content = resp.rows[0].script;

        zip.addFile(
            "module.js",
            Buffer.alloc(content.length, content),
            "Client script"
        );
    }

    function addFeathers(zip, resp) {
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

            feather.dependencies = [];
            if (feather.inherits) {
                feather.dependencies.push(feather.inherits);
            }
        });

        // Determine feather's full inheritence dependencies
        function resolveDependencies(feather, dependencies) {
            dependencies = dependencies || feather.dependencies;

            feather.dependencies.forEach(function (dependency) {
                let parent = content.find(
                    (feather) => feather.name === dependency
                );

                if (parent) {
                    parent.dependencies.forEach(
                        (pDepencency) => dependencies.push(pDepencency)
                    );

                    resolveDependencies(parent, dependencies);
                }
            });
        }

        // Process feathers, start by sorting alpha, then resolving,
        // then sorting on dependencies
        content.sort(function (a, b) {
            if (a.name > b.name) {
                return 1;
            }

            return -1;
        });
        content.forEach((feather) => resolveDependencies(feather));
        content = (function () {
            let feather;
            let idx;
            let ret = [];
            let outsider = [];

            // See if every feather instance is already
            // accounted for
            function top(instance) {
                return instance.dependencies.every(function (dep) {
                    return (
                        ret.some((added) => added.name === dep) ||
                        outsider.indexOf(dep) > -1
                    );
                });
            }

            // Discount parents from other packages
            content.forEach(function (feather) {
                let parent = feather.inherits;

                function isParent(instance) {
                    return instance.name === parent;
                }

                if (!content.some(isParent)) {
                    outsider.push(feather.inherits);
                }
            });

            while (content.length) {
                feather = content.find(top);

                ret.push(feather);
                idx = content.indexOf(feather);
                content.splice(idx, 1);
            }

            return ret;
        }());

        // Now can remove dependency info
        content.forEach(function (feather) {
            delete feather.dependencies;
        });
        content = JSON.stringify(content, null, 2);

        if (content.length) {
            zip.addFile(
                "feathers.js",
                Buffer.alloc(content.length, content),
                "Feather definitions"
            );
        }
    }

    function addServices(zip, resp) {
        let content = resp.rows;

        if (content.length) {
            content.forEach(function (service) {
                zip.addFile(
                    service.name.toSpinalCase() + ".js",
                    Buffer.alloc(service.script.length, service.script),
                    "Data service script"
                );
            });
        }
    }

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

                sql = "SELECT name, script FROM data_service WHERE module = $1";
                requests.push(client.query(sql, params));

                Promise.all(requests).then(function (resp) {
                    let filename = path.format({
                        root: "./",
                        base: "/packages/" + name + ".zip"
                    });

                    addModule(zip, resp[0]);
                    addFeathers(zip, resp[1]);
                    addServices(zip, resp[2]);

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

