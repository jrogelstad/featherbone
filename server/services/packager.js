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

    const fs = require('fs');
    const AdmZip = require("adm-zip");
    const path = require("path");
    const {
        Tools
    } = require("./tools");
    const propExclusions = [
        "id",
        "lock",
        "isDeleted",
        "created",
        "createdBy",
        "updated",
        "updatedBy",
        "objectType"
    ];
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

    function removeExclusions(row) {
        Object.keys(row).forEach(function (key) {
            if (propExclusions.indexOf(key) !== -1) {
                delete row[key];
            } else if (Array.isArray(row[key])) {
                row[key].forEach(removeExclusions);
            }
        });
    }

    function addModule(manifest, zip, resp) {
        let content;

        if (!resp.rows.length) {
            throw "Module not found";
        }

        content = resp.rows[0];

        manifest.module = content.name;
        manifest.version = content.version;
        manifest.dependencies = content.dependencies.map(
            (dep) => dep.module.name
        );
        manifest.files = [{
            type: "module",
            path: "module.js"
        }];

        zip.addFile(
            "module.js",
            Buffer.alloc(content.script.length, content.script),
            "Client script"
        );
    }

    function addFeathers(manifest, zip, resp) {
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
        content = JSON.stringify(content, null, 4);

        if (content.length) {
            manifest.files.push({
                type: "feather",
                path: "feathers.json"
            });

            zip.addFile(
                "feathers.js",
                Buffer.alloc(content.length, content),
                "Feather definitions"
            );
        }
    }

    function addForms(manifest, zip, resp) {
        let content = [];
        let rows = tools.sanitize(resp.rows);

        content = rows.map(function (row) {
            let data = row.form;
            let ret = {
                name: "Form",
                method: "POST",
                module: data.module,
                id: data.id,
                data: data
            };

            if (!data.focus) {
                delete data.focus;
            }
            removeExclusions(data);
            data.attrs.forEach(function (attr) {
                if (!attr.label) {
                    delete attr.label;
                }

                if (!attr.columns.length) {
                    delete attr.columns;
                } else {
                    attr.columns.forEach(function (col) {
                        if (!col.filter) {
                            delete col.filter;
                        }

                        if (!col.showCurrency) {
                            delete col.showCurrency;
                        }

                        if (!col.width) {
                            delete col.width;
                        }

                        if (!col.dataList) {
                            delete col.dataList;
                        }

                        if (!col.label) {
                            delete col.label;
                        }
                    });
                }

                if (!attr.dataList) {
                    delete attr.dataList;
                }

                if (!attr.disableCurrency) {
                    delete attr.disableCurrency;
                }

                if (!attr.relationWidget) {
                    delete attr.relationWidget;
                }

                if (!attr.filter) {
                    delete attr.filter;
                }

                if (attr.showLabel) {
                    delete attr.showLabel;
                }
            });

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: "forms.json"
            });

            zip.addFile(
                "forms.json",
                Buffer.alloc(content.length, content),
                "Form definitions"
            );
        }
    }

    function addServices(manifest, zip, resp) {
        let content = resp.rows;

        if (content.length) {
            content.forEach(function (service) {
                let filename = service.name.toSpinalCase() + ".js";

                manifest.files.push({
                    type: "service",
                    name: service.name,
                    path: filename
                });

                zip.addFile(
                    filename,
                    Buffer.alloc(service.script.length, service.script),
                    "Data service script"
                );
            });
        }
    }

    function addBatch(type, manifest, zip, resp) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let filename = type.toCamelCase() + "s.json";

        content = rows.map(function (data) {
            let ret = {
                name: type,
                method: "POST",
                module: data.module,
                id: data.id,
                data: data
            };

            if (!data.focus) {
                delete data.focus;
            }
            removeExclusions(data);

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: filename
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content),
                type + " definitions"
            );
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
                let manifest = {};
                let dir = './packages';

                if (!fs.existsSync(dir)){
                    fs.mkdirSync(dir);
                }

                // Module
                sql = (
                    "SELECT name, version, script, " +
                    "to_json(dependencies) AS dependencies " +
                    "FROM _module WHERE name = $1"
                );
                requests.push(client.query(sql, params));

                // Feathers
                sql = (
                    "SELECT name, description, plural, \"module\", " +
                    "\"authorization\", \"inherits\", is_system, is_child, " +
                    "is_fetch_on_startup, is_read_only, " +
                    "to_json(properties) AS properties, " +
                    "to_json(overloads) AS overloads " +
                    "FROM _feather WHERE module = $1"
                );
                requests.push(client.query(sql, params));

                // Forms
                sql = (
                    "SELECT to_json(_form) AS form " +
                    "FROM _form WHERE module = $1"
                );
                requests.push(client.query(sql, params));

                // Services
                sql = "SELECT name, script FROM data_service WHERE module = $1";
                requests.push(client.query(sql, params));

                // Routes
                sql = "SELECT * FROM route WHERE module = $1";
                requests.push(client.query(sql, params));

                // Styles
                sql = "SELECT * FROM style WHERE module = $1";
                requests.push(client.query(sql, params));

                Promise.all(requests).then(function (resp) {
                    let filename = name;
                    let pathname = path.format({
                        root: "./",
                        base: "/packages/"
                    });

                    addModule(manifest, zip, resp[0]);
                    addFeathers(manifest, zip, resp[1]);
                    addForms(manifest, zip, resp[2]);
                    addServices(manifest, zip, resp[3]);
                    addBatch("Route", manifest, zip, resp[4]);
                    addBatch("Style", manifest, zip, resp[5]);

                    if (manifest.version) {
                        filename += "-v" + manifest.version;
                    }

                    filename += ".zip";

                    manifest = JSON.stringify(manifest, null, 4);

                    zip.addFile(
                        "manifest.json",
                        Buffer.alloc(manifest.length, manifest),
                        "Describes files to be loaded for configuration"
                    );

                    zip.writeZip(
                        pathname + filename,
                        resolve.bind(null, filename)
                    );
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));

