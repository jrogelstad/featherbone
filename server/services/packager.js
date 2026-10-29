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
/*jslint node unordered*/
/**
    @module Packager
*/
(function (exports) {
    "use strict";

    const AdmZip = require("adm-zip");
    const fs = require("fs");
    const path = require("path");
    const {
        Config
    } = require("../config");
    const {
        Packages
    } = require("./packages");
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
        "etag",
        "meta"
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
    const config = new Config();
    const packages = new Packages();

    /*
        Code comes out of a package the same way it goes in: from the
        files on disk, at the version this database deployed (ADR-002
        section 2). Reading the rows instead was how an export of a
        deployed module came out wrong -- a deployment writes no code to
        rows, so `module.script` was empty and the zip carried an empty
        module.js, while the `data_service` rows it did find were
        pre-ADR-002 copies the runtime had long since stopped loading.

        A module the server holds no package for still answers from its
        rows, which is where a module that has never been repackaged
        lives.
    */
    function diskSources(mod) {
        let src;

        if (
            !mod || !mod.name || !mod.version ||
            !packages.resolve(mod.name, mod.version)
        ) {
            return undefined;
        }

        src = packages.clientSource(mod.name, mod.version);

        return {
            script: (
                src === undefined
                ? undefined
                : src.script
            ),
            services: packages.serviceSources(mod.name, mod.version)
        };
    }

    // Packaging is rare and user-initiated, and a package may have been
    // installed since this process started, so the scan is not cached.
    function scanPackages() {
        return config.read().then(function (conf) {
            packages.scan(conf.modulesDir);
        });
    }

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

    function addModule(manifest, zip, resp, folder, disk) {
        let content;
        let script;
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

        script = (
            (disk && disk.script !== undefined)
            ? disk.script
            : content.script
        );
        script = script || "";

        zip.addFile(
            filename,
            Buffer.alloc(script.length, script)
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

    function addServices(manifest, zip, resp, folder, disk) {
        let content = (
            disk === undefined
            ? resp.rows
            : disk.services
        );

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

    /*
        The navigation categories this module's workbooks are filed
        under, carried by NAME with their icon and presentation order
        -- never by id, so importing into another database can't be
        broken by ids differing there. The installer creates whichever
        of these don't exist yet and then binds the workbooks that
        follow to them by name, which is why this has to land in the
        manifest BEFORE workbooks.json: the order of manifest.files is
        the installer's only sequencing mechanism (John, Oct 2026).
    */
    function addNavigationCategories(manifest, zip, resp, folder) {
        let content = tools.sanitize(resp.rows);
        let name = "navigation-categories.json";
        let filename = folder + name;

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "navigationCategory",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    /*
        The dashboard layouts this module owns. A layout is one JSON
        document keyed on a name -- no ids, so it cannot be broken by
        ids differing between databases, and a module that ships one
        arrives with a board rather than with a board to assemble.

        The `isDefault` flag travels with it. Installing a module that
        claims the default moves everybody who has not chosen a layout
        of their own onto it, which is the point: a package's board is
        no use if every user has to go and find it. Anyone who HAS
        chosen keeps their choice, because that lives in their profile
        and nothing here touches it.
    */
    function addDashboards(manifest, zip, resp, folder, owner) {
        let content = tools.sanitize(resp.rows).map(function (layout) {
            // A layout saved from the Home tab has no module of its own
            // (see the query); once packaged it belongs to this one.
            return Object.assign({}, layout, {
                module: layout.module || owner
            });
        });
        let name = "dashboards.json";
        let filename = folder + name;

        if (content.length) {
            content = JSON.stringify(content, null, 4);

            manifest.files.push({
                type: "dashboard",
                path: name
            });

            zip.addFile(
                filename,
                Buffer.alloc(content.length, content)
            );
        }
    }

    /*
        The app title currently in use (brandingSettings, set by
        whichever package's manifest last carried one -- see
        installer.js's saveBranding). Carried as a manifest.title,
        the same shape saveBranding reads back in on install -- never
        a manifest.files entry, same as it never needs one coming in.

        Unlike the wallpaper below, the title travels with every
        export regardless of the dashboard checkbox: it names the
        application, which is not "the dashboard board" the checkbox
        describes, and a package re-exported with that box unchecked
        should not silently go back to calling itself Featherbone.
    */
    function addTitle(manifest, resp) {
        let row = resp.rows[0] || {};
        let data = row.data || {};

        if (data.title) {
            manifest.title = data.title;
        }
    }

    /*
        One brandingSettings image, carried as a sibling "<stem>"
        image file, the same shape saveBranding reads back in on
        install. Shared by addWallpaper and addIcon below, which
        differ only in which brandingSettings key they read and which
        stem they write the sibling file under.

        A value that is a pasted web address rather than a file this
        server holds has nothing to add to the zip.
    */
    function addBrandAsset(zip, resp, folder, key, stem) {
        // Work around linter dogma (as server.js does).
        let existssync = "existsSync";
        let readfilesync = "readFileSync";
        let row = resp.rows[0] || {};
        let data = row.data || {};
        let value = data[key];
        let uploadPath;
        let ext;

        if (value && !value.startsWith("http")) {
            ext = path.extname(value).toLowerCase() || ".png";
            uploadPath = path.join(
                process.cwd(),
                "files",
                "upload",
                value
            );

            if (fs[existssync](uploadPath)) {
                zip.addFile(
                    folder + stem + ext,
                    fs[readfilesync](uploadPath)
                );
            }
        }
    }

    /*
        The dashboard wallpaper currently in use. Part of what the
        dashboard checkbox means by "the dashboard board", so it
        travels only when that is checked -- see addDashboards.
    */
    function addWallpaper(zip, resp, folder) {
        addBrandAsset(zip, resp, folder, "dashboardImage", "dashboard");
    }

    /*
        The ribbon/tab icon currently in use, in place of the
        Featherbone quill. Like the title (addTitle above) rather than
        the wallpaper: it names the application rather than being part
        of "the dashboard board", so it travels with every export
        regardless of the dashboard checkbox -- see the call site.
    */
    function addIcon(zip, resp, folder) {
        addBrandAsset(zip, resp, folder, "icon", "icon");
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

        function addDependencies(
            client,
            manifest,
            pzip,
            resp,
            user,
            folder,
            includeDashboard
        ) {
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
                                includeDashboard,
                                module: mod,
                                scanned: true
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

            /*
                Once per export, not once per submodule: the index is
                read on the way in, and addDependencies passes `scanned`
                when it recurses through here.
            */
            if (!sub.scanned) {
                sub.scanned = true;
                return scanPackages().then(
                    () => that.package(client, name, user, sub)
                );
            }

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
                let includeDashboard = sub.includeDashboard !== false;

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

                // Workbooks. The navigation category comes out as its
                // NAME rather than the id "$workbook".category
                // actually stores, so a package carries no ids and
                // can't be broken by ids differing between databases
                // (John, Oct 2026).
                sql = (
                    "SELECT workbook.name, workbook.description, " +
                    "workbook.icon, workbook.launch_config, " +
                    "workbook.default_config, workbook.local_config, " +
                    "workbook.module, workbook.sequence, " +
                    "workbook.actions, workbook.label, " +
                    "workbook.is_template, " +
                    "(SELECT category.name " +
                    "  FROM \"$navigation_category\" AS category " +
                    "  WHERE category.id = workbook.category) AS category " +
                    "FROM \"$workbook\" AS workbook " +
                    "WHERE workbook.module = $1 " +
                    "AND NOT workbook.is_deleted " +
                    "ORDER BY workbook.name;"
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

                // Navigation categories this module's workbooks use
                sql = (
                    "SELECT DISTINCT category.name, category.icon, " +
                    "category.sequence " +
                    "FROM \"$navigation_category\" AS category, " +
                    "  \"$workbook\" AS workbook " +
                    "WHERE workbook.category = category.id " +
                    "AND workbook.module = $1 " +
                    "AND NOT workbook.is_deleted " +
                    "AND NOT category.is_deleted " +
                    "ORDER BY category.sequence, category.name;"
                );
                requests.push(client.query(sql, params));

                // Dashboard layouts. Save Layout never records a module,
                // so a layout somebody built on the Home tab has a blank
                // one and would belong to no export at all. The module
                // being exported (not a dependency packaged beneath it)
                // therefore takes the unowned layouts too -- see
                // addDashboards, which stamps them with its name.
                sql = (
                    "SELECT name, label, description, module, " +
                    "sequence, is_default, config " +
                    "FROM \"$dashboard\" WHERE " +
                    "(module = $1 OR (module = '' AND $2::boolean)) " +
                    "AND NOT is_deleted " +
                    "ORDER BY sequence, name;"
                );
                requests.push(client.query(sql, [name, !sub.module]));

                // App title and dashboard wallpaper currently in use --
                // see addTitle and addWallpaper
                sql = (
                    "SELECT data FROM \"$settings\" " +
                    "WHERE name = 'brandingSettings' " +
                    "AND NOT is_deleted;"
                );
                requests.push(client.query(sql));

                Promise.all(requests).then(function (resp) {
                    let filename = name;
                    let pathname = path.format({
                        root: "./",
                        base: "files/downloads/"
                    });

                    function finishPackage() {
                        /*
                            The module row this package is built from --
                            the same one addModule writes to the
                            manifest, read here because the services go
                            in before it and need to know which version
                            on disk to take their code from.
                        */
                        let modRow = (
                            sub.module ||
                            resp[0].slice().pop()
                        );
                        let disk = diskSources(modRow);

                        addFeathers(manifest, zip, resp[1], folder);
                        addRelWidgets(manifest, zip, resp[8], folder);
                        addServices(manifest, zip, resp[3], folder, disk);
                        addBatch("HelpLink", manifest, zip, resp[9], folder);
                        addForms(manifest, zip, resp[2], folder);
                        addBatch("Route", manifest, zip, resp[4], folder);
                        addBatch("Style", manifest, zip, resp[5], folder);
                        addSettings(manifest, zip, resp[6], folder);
                        // Before the workbooks, which reference these
                        // by name -- see addNavigationCategories.
                        addNavigationCategories(
                            manifest,
                            zip,
                            resp[10],
                            folder
                        );
                        addWorkbooks(manifest, zip, resp[7], folder);

                        // Branding is instance-wide, not module-scoped
                        // like everything else packaged here, so it
                        // belongs on the manifest somebody is actually
                        // choosing to export -- not restamped onto every
                        // dependency's own manifest underneath it.
                        if (!sub.module) {
                            addTitle(manifest, resp[12]);
                            addIcon(zip, resp[12], folder);
                            if (includeDashboard) {
                                addWallpaper(zip, resp[12], folder);
                            }
                        }
                        if (includeDashboard) {
                            addDashboards(
                                manifest,
                                zip,
                                resp[11],
                                folder,
                                name
                            );
                        }

                        if (sub.module) {
                            addModule(
                                manifest,
                                zip,
                                [sub.module],
                                folder,
                                disk
                            );
                        } else {
                            addModule(manifest, zip, resp[0], folder, disk);
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
                            folder,
                            includeDashboard
                        ).then(finishPackage).catch(reject);
                    }
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));

