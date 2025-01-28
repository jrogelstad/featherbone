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
/*jslint node unordered*/
/**
    @module Packager
*/
(function (exports) {
    "use strict";

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
        "objectType",
        "owner",
        "etag"
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
        "isIndexed",
        "isAlwaysLoad",
        "isEncrypted"
    ];

    const tools = new Tools();

    function getSortedModules(client, name) {
        return new Promise(function (resolve, reject) {
            let theOne;
            let sql = (
                "SELECT name, version, script, " +
                "to_json(dependencies) AS dependencies, " +
                "to_json(npm) as npm " +
                "FROM _module ORDER BY name;"
            );

            function callback(resp) {
                let modules = resp.rows;

                function resolveDependencies(module, tree) {
                    tree = tree || module.tree;

                    module.tree.forEach(function (dependency) {
                        let parent = modules.find(
                            (module) => module.name === dependency
                        );

                        parent.tree.forEach(
                            (pDepencency) => tree.push(pDepencency)
                        );

                        resolveDependencies(parent, tree);
                    });
                }

                // Simplify dependencies
                modules.forEach(function (module) {
                    module.dependencies = module.dependencies.map(
                        (dep) => dep.module.name
                    );
                    module.tree = module.dependencies.slice();
                });

                // Process modules, start by resolving,
                // then sorting on dependencies
                modules.forEach((module) => resolveDependencies(module));

                // Filter to only modules related to the one being packaged
                theOne = modules.find((module) => module.name === name);

                modules = modules.filter(function (module) {
                    return (
                        module.name === name ||
                        theOne.tree.indexOf(module.name) !== -1
                    );
                });

                // Sort
                modules = (function () {
                    let module;
                    let idx;
                    let ret = [];

                    function top(mod) {
                        return mod.tree.every(
                            (dep) => ret.some((added) => added.name === dep)
                        );
                    }

                    while (modules.length) {
                        module = modules.find(top);

                        ret.push(module);
                        idx = modules.indexOf(module);
                        modules.splice(idx, 1);
                    }

                    return ret;
                }());

                // Never package core
                modules = modules.filter((module) => module.name !== "Core");

                resolve(modules);
            }

            client.query(sql).then(callback).catch(reject);
        });
    }

    function removeExclusions(row) {
        Object.keys(row).forEach(function (key) {
            if (propExclusions.indexOf(key) !== -1) {
                delete row[key];
            } else if (Array.isArray(row[key])) {
                row[key].forEach(removeExclusions);
            }
        });
    }

    function addModule(manifest, zip, resp, folder) {
        let content;
        let filename = folder + "module.js";

        content = resp.slice().pop();

        manifest.module = content.name;
        manifest.version = content.version;
        manifest.dependencies = content.dependencies;
        manifest.npm = content.npm.map(function (r) {
            return {
                package: r.package,
                version: r.version,
                property: r.property,
                export: r.export
            };
        });
        manifest.files.push({
            type: "module",
            path: "module.js"
        });

        zip.addFile(
            filename,
            Buffer.alloc(content.script.length, content.script)
        );
    }

    function addFeathers(manifest, zip, resp, folder) {
        let content = [];
        let feathers = tools.sanitize(resp.rows);
        let filename = folder + "feathers.json";
        let found;

        feathers.forEach(function (feather) {
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

                if (prop.autonumber === null) {
                    delete prop.autonumber;
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

                if (prop.isEncrypted === false) {
                    delete prop.isEncrypted;
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

                if (o.overloadAutonumber) {
                    overload.autonumber = o.autonumber;
                }

                props[o.name] = overload;
            });

            if (Object.keys(props).length) {
                feather.overloads = props;
            } else {
                delete feather.overloads;
            }

            if (feather.authorization === null) {
                delete feather.authorization;
            }

            if (feather.plural === "") {
                delete feather.plural;
            }

            feather.dependencies = [];
            if (feather.inherits) {
                feather.dependencies.push(feather.inherits);
            }
        });

        // Establish dependencies
        feathers.forEach(function (fthr) {
            let pkeys = Object.keys(fthr.properties || {});

            if (fthr.name === "Object") {
                fthr.dependencies = [];
                return;
            }

            fthr.dependencies = [];

            if (feathers.some((fez) => fez.name === fthr.inherits)) {
                fthr.dependencies.push(fthr.inherits);
            }

            pkeys.forEach(function (pkey) {
                let prop = fthr.properties[pkey];
                let rel = prop.type.relation;

                if (
                    typeof prop.type === "object" &&
                    !prop.type.parentOf &&
                    feathers.some((fez) => fez.name === rel)
                ) {
                    fthr.dependencies.push(rel);
                }
            });
        });

        // Now build content array based on dependency order
        function contentExists(dep) {
            return content.find((fthr) => fthr.name === dep);
        }

        function candidate(feather) {
            return feather.dependencies.every(
                contentExists
            );
        }

        while (feathers.length) {
            found = feathers.find(candidate);
            delete found.dependencies;
            content.push(found);
            feathers.splice(feathers.indexOf(found), 1);
        }

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "feather",
                path: "feathers.json"
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addForms(manifest, zip, resp, folder) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let filename = folder + "forms.json";

        content = rows.map(function (row) {
            let rec = row.form;
            let ret = {
                name: rec.objectType,
                method: "POST",
                module: rec.module,
                id: rec.id,
                data: rec
            };

            if (!rec.focus) {
                delete rec.focus;
            }
            removeExclusions(rec);

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: "forms.json"
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addRelWidgets(manifest, zip, resp, folder) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let filename = folder + "relationWidgets.json";

        content = rows.map(function (row) {
            let rec = row.widget;
            let ret = {
                name: "RelationWidget",
                method: "POST",
                module: rec.module,
                id: rec.id,
                data: rec
            };

            removeExclusions(rec);

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: "relationWidgets.json"
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addServices(manifest, zip, resp, folder) {
        let content = resp.rows;

        if (content.length) {
            content.forEach(function (service) {
                let name = service.name.toSpinalCase() + ".js";
                let filename = folder + name;

                manifest.files.push({
                    type: "service",
                    name: service.name,
                    path: name
                });

                zip.addFile(
                    filename,
                    Buffer.alloc(service.script.length, service.script)
                );
            });
        }
    }

    function addSettings(manifest, zip, resp, folder) {
        let content = resp.rows;

        if (content.length) {
            content.forEach(function (settings) {
                let def = JSON.stringify(settings.definition, null, 4);
                let name = settings.name.toSpinalCase() + ".json";
                let filename = folder + name;

                manifest.files.push({
                    type: "settings",
                    name: settings.name,
                    path: name
                });

                zip.addFile(
                    filename,
                    Buffer.alloc(def.length, def)
                );
            });
        }
    }

    function addWorkbooks(manifest, zip, resp, folder) {
        let content = tools.sanitize(resp.rows);
        let name = "workbooks.json";
        let filename = folder + name;

        content.forEach(function (workbook) {
            removeExclusions(workbook);
            if (workbook.localConfig.length) {
                workbook.defaultConfig = workbook.localConfig;
            }

            delete workbook.localConfig;

            if (!Object.keys(workbook.launchConfig).length) {
                delete workbook.launchConfig;
            }
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "workbook",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    function addBatch(type, manifest, zip, resp, folder) {
        let content = [];
        let rows = tools.sanitize(resp.rows);
        let name = type.toCamelCase() + "s.json";
        let filename = folder + name;

        content = rows.map(function (rec) {
            let ret = {
                name: type,
                method: "POST",
                module: rec.module,
                id: rec.id,
                data: rec
            };

            if (!rec.focus) {
                delete rec.focus;
            }
            removeExclusions(rec);

            return ret;
        });

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "batch",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    exports.Packager = function () {
        // ..........................................................
        // PUBLIC
        //

        /**
            @class Packager
            @constructor
            @namespace Services
        */
        let that = {};

        function addDependencies(client, manifest, pzip, resp, user, folder) {
            return new Promise(function (resolve, reject) {
                let content;
                let requests = [];

                if (!resp.length) {
                    throw "Module not found";
                }

                content = resp.slice(0, resp.length - 1);

                content.forEach(function (mod) {
                    let name = mod.name;
                    let addPackage;

                    addPackage = new Promise(function (resolve, reject) {
                        function callback() {
                            manifest.dependencies.push(name);
                            manifest.files.push({
                                type: "install",
                                path: name.toSpinalCase() + "/manifest.json"
                            });

                            resolve();
                        }

                        that.package(
                            client,
                            name,
                            user,
                            {
                                zip: pzip,
                                folder: folder + name.toSpinalCase() + "/",
                                module: mod
                            }
                        ).then(callback).catch(reject);
                    });

                    requests.push(addPackage);
                });

                Promise.all(requests).then(resolve).catch(reject);
            });
        }

        /**
            Package a module and its submodules into a zip file.

            @method package
            @param {Client} client Database client
            @param {String} name Module name
            @param {String} user User name
            @param {Object} [sub] Sub module
            @return {Promise}
        */
        that.package = function (client, name, user, sub) {
            sub = sub || {};

            return new Promise(function (resolve, reject) {
                let sql;
                let params = [name];
                let requests = [];
                let manifest = {
                    module: "",
                    version: "",
                    dependencies: [],
                    files: []
                };
                let zip = sub.zip || new AdmZip();
                let folder = sub.folder || "";

                if (folder) {
                    // Create folder for sub module
                    zip.addFile(folder, Buffer.alloc(0, null));
                }

                // Module
                if (!sub.module) {
                    requests.push(getSortedModules(client, name));
                } else {
                    requests.push(Promise.resolve);
                }

                // Feathers
                sql = (
                    "SELECT name, description, plural, \"module\", " +
                    "\"inherits\", is_system, is_child, " +
                    "is_fetch_on_startup, is_read_only, " +
                    "to_json(properties) AS properties, " +
                    "to_json(overloads) AS overloads " +
                    "FROM _feather WHERE module = $1" +
                    " AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Forms
                sql = (
                    "SELECT to_json(_form) AS form " +
                    "FROM _form WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name"
                );
                requests.push(client.query(sql, params));

                // Services
                sql = (
                    "SELECT name, script " +
                    "FROM data_service WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Routes
                sql = (
                    "SELECT * FROM route WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY path;"
                );
                requests.push(client.query(sql, params));

                // Styles
                sql = (
                    "SELECT * FROM style WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Settings
                sql = (
                    "SELECT * FROM \"$settings\" WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Workbooks
                sql = (
                    "SELECT name, description, icon, launch_config, " +
                    "default_config, local_config, module, sequence, " +
                    "actions, label, is_template " +
                    "FROM \"$workbook\" WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name;"
                );
                requests.push(client.query(sql, params));

                // Relation widgets
                sql = (
                    "SELECT to_json(_relation_widget) as widget " +
                    "FROM _relation_widget WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY name"
                );
                requests.push(client.query(sql, params));

                // Help files
                sql = (
                    "SELECT *  FROM help_link WHERE module = $1 " +
                    "AND NOT is_deleted " +
                    "ORDER BY label"
                );
                requests.push(client.query(sql, params));

                Promise.all(requests).then(function (resp) {
                    let filename = name;
                    let pathname = path.format({
                        root: "./",
                        base: "files/downloads/"
                    });

                    function finishPackage() {
                        addFeathers(manifest, zip, resp[1], folder);
                        addRelWidgets(manifest, zip, resp[8], folder);
                        addServices(manifest, zip, resp[3], folder);
                        addBatch("HelpLink", manifest, zip, resp[9], folder);
                        addForms(manifest, zip, resp[2], folder);
                        addBatch("Route", manifest, zip, resp[4], folder);
                        addBatch("Style", manifest, zip, resp[5], folder);
                        addSettings(manifest, zip, resp[6], folder);
                        addWorkbooks(manifest, zip, resp[7], folder);

                        if (sub.module) {
                            addModule(manifest, zip, [sub.module], folder);
                        } else {
                            addModule(manifest, zip, resp[0], folder);
                        }

                        if (manifest.version) {
                            filename += "-v" + manifest.version;
                        }

                        manifest = JSON.stringify(manifest, null, 4);

                        zip.addFile(
                            folder + "manifest.json",
                            Buffer.alloc(manifest.length, manifest)
                        );

                        // Only write zip out the top level
                        if (folder) {
                            resolve();
                        } else {
                            filename += ".zip";
                            zip.writeZip(
                                pathname + filename,
                                resolve.bind(null, filename)
                            );
                        }
                    }

                    if (sub.module) {
                        finishPackage();
                    } else {
                        addDependencies(
                            client,
                            manifest,
                            zip,
                            resp[0],
                            user,
                            folder
                        ).then(finishPackage).catch(reject);
                    }
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));

