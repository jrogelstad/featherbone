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
    @module Installer
*/
(function (exports) {
    "use strict";

    const MANIFEST = "manifest.json";

    const {API} = require("./api");
    const {Config} = require("../config");
    const {Database} = require("../database");
    const {Feathers} = require("./feathers");
    const config = new Config();
    const fs = require("fs");
    const path = require("path");
    const f = require("../../common/core");
    let isInstalling = false;
    let isRemote = false;

    f.jsonpatch = require("fast-json-patch");
    f.isInstalling = () => isInstalling;

    const api = new API();
    const db = new Database();
    const feathers = new Feathers();

    function btoa(str) {
        return Buffer.from(str.toString(), "binary").toString("base64");
    }

    /**
        Install and uninstall packaged modules.
        @class Installer
        @constructor
        @namespace Services
    */
    exports.Installer = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Install a package in a specified directory.

            @method install
            @param {Object} datsource Initialized datasource (catalog loaded)
            @param {Object} client
            @param {String} dir Directory of manifest
            @param {String} user User name
            @param {Object} [options]
            @param {Boolean} [options.isSuper] Force as super user
            @param {Object} [options.subscription] Subscription for client
            progress bar
            @param {String} [options.tenant] Target tenant
            @return {Promise}
        */
        that.install = function (
            pDatasource,
            pClient,
            pDir,
            pUser,
            opts
        ) {
            return new Promise(function (resolve, reject) {
                opts = opts || {};
                let manifest;
                let processFile;
                let i = 0;
                let file;
                let filename = path.format({
                    root: "/",
                    dir: pDir,
                    base: MANIFEST
                });
                let installedFeathers = false;
                let pProcess;
                let pIsSuper = opts.isSuper;
                let pSubscr = opts.subscription;
                let reqClient = pClient;
                let conn;

                reqClient.currentUser(pUser);
                f.datasource = pDatasource;
                isInstalling = true;

                async function init() {
                    let pkgName;

                    // If target database is other than requestor's,
                    // connect to it
                    if (opts.tenant) {
                        conn = await db.connect(opts.tenant);
                        pClient = conn.client;
                        pClient.currentUser(pUser);
                        isRemote = true;
                    }

                    function getCount(loc) {
                        return new Promise(function (resolve) {
                            async function handleCount(err, dat) {
                                if (err) {
                                    console.error(err);
                                    return;
                                }
                                let data = JSON.parse(dat);
                                if (!pkgName) {
                                    pkgName = (
                                        "Install package " +
                                        data.module + " v" +
                                        data.version
                                    );
                                    if (opts.tenant) {
                                        pkgName += (
                                            " on " + opts.tenant.pgDatabase
                                        );
                                    }
                                }
                                let count = data.files.filter(
                                    (f) => f.type !== "install"
                                ).length;
                                let installs = data.files.filter(
                                    (f) => f.type === "install"
                                );
                                let install;
                                while (installs.length) {
                                    install = installs.shift();
                                    count += await getCount(install.path);
                                }
                                resolve(count);
                            }
                            let cpath = path.format({
                                root: "/",
                                dir: pDir,
                                base: loc
                            });
                            fs.readFile(cpath, "utf8", handleCount);
                        });
                    }
                    let pCount = await getCount(MANIFEST);
                    pProcess = f.datasource.createProcess({
                        canStop: !isRemote,
                        client: reqClient,
                        count: pCount,
                        name: pkgName,
                        subscription: pSubscr
                    });
                    await pProcess.start();
                }

                function registerNpmModules(isSuper) {
                    return new Promise(function (resolve) {
                        if (isRemote) {
                            resolve(isSuper);
                        }

                        config.read().then(function (resp) {
                            let mods = resp.npmModules || [];

                            // Add npm modules specified
                            mods.forEach(function (mod) {
                                try {
                                    let vName;
                                    if (mod.properties) {
                                        mod.properties.forEach(function (p) {
                                            f[p.property] = require(
                                                mod.require
                                            )[p.export];
                                        });
                                        return;
                                    }

                                    vName = mod.require;
                                    f[vName] = require(mod.require);
                                } catch {
                                    console.log(
                                        "Unable to load npm module->",
                                        mod
                                    );
                                }
                            });
                            resolve(isSuper);
                        });
                    });
                }

                function rollback(err) {
                    pClient.query("ROLLBACK;", function () {
                        console.error(err);
                        console.error("Installation failed.");
                        reject(err);
                    });
                }

                function runBatch(data) {
                    let nextItem;
                    let len = data.length;
                    let b = 0;

                    // Iterate recursively
                    nextItem = function () {
                        let payload;

                        if (b < len) {
                            payload = data[b];
                            payload.user = pUser;
                            payload.client = pClient;
                            b += 1;
                            pDatasource.request(payload, true).then(
                                nextItem
                            ).catch(rollback);
                            return;
                        }

                        // We're done here
                        processFile();
                    };

                    // Start processing
                    if (isRemote) {
                        Promise.resolve().then(nextItem).catch(rollback);
                        return;
                    }

                    pDatasource.loadServices(pUser, pClient).then(
                        nextItem
                    ).catch(
                        rollback
                    );
                }

                function saveModule(
                    pName,
                    pScript,
                    pVersion,
                    pDependencies,
                    pNpm
                ) {
                    function callback(modules) {
                        pDependencies = pDependencies || [];
                        let found = modules.find((r) => r.name === pName);
                        let modId = (
                            found
                            ? found.id
                            : btoa(pName)
                        );
                        let err;
                        let deps = pDependencies.map(function (dep) {
                            let dfound = modules.find((r) => r.name === dep);
                            if (!dfound) {
                                err = "Dependant module " + dep + " not found";
                                return;
                            }
                            return {
                                module: {
                                    id: dfound.id
                                }
                            };
                        });
                        let payload;

                        if (err) {
                            rollback(err);
                            return;
                        }

                        payload = {
                            method: "POST",
                            name: "Module",
                            user: pUser,
                            client: pClient,
                            id: modId,
                            data: {
                                name: pName,
                                version: pVersion,
                                owner: pUser,
                                script: pScript,
                                dependencies: deps,
                                npm: pNpm
                            }
                        };

                        runBatch([payload]);
                    }

                    // Get all modules for mapping
                    pDatasource.request({
                        method: "GET",
                        name: "Module",
                        client: pClient,
                        properties: ["id", "name"]
                    }, true).then(callback).catch(rollback);
                }

                function saveFeathers(feathers, isSystem) {
                    function callback(resp) {
                        let payload;
                        let data = [];

                        installedFeathers = true;

                        // System feathers don't get to be tables
                        if (isSystem) {
                            payload = {
                                method: "PUT",
                                name: "saveFeather",
                                user: pUser,
                                client: pClient,
                                data: {
                                    specs: feathers
                                }
                            };

                            pDatasource.request(payload, true).then(
                                processFile
                            ).catch(rollback);
                            return;
                        }

                        // Map feather structure to table structure
                        feathers.forEach(function (feather) {
                            let keys = Object.keys(feather.properties || {});
                            let auths = feather.authorizations;
                            let props = feather.properties;
                            let overloads = feather.overloads || {};
                            let existing = resp.find(
                                (ex) => ex.name === feather.name
                            ) || {};
                            let existingId = existing.id;

                            function toFeather(auth) {
                                return {
                                    role: auth.role,
                                    canCreate: auth.actions.canCreate,
                                    canRead: auth.actions.canRead,
                                    canUpdate: auth.actions.canUpdate,
                                    canDelete: auth.actions.canDelete
                                };
                            }

                            if (auths) {
                                feather.authorizations = auths.map(toFeather);
                            }

                            feather.properties = keys.map(function (key) {
                                let prop = props[key];

                                prop.name = key;

                                return prop;
                            });

                            keys = Object.keys(feather.overloads || {});
                            feather.overloads = keys.map(function (key) {
                                let overload = overloads[key] || {};
                                let row = {};

                                row.name = key;

                                if (overload.description !== undefined) {
                                    row.overloadDescription = true;
                                    row.description = overload.description;
                                } else {
                                    row.overloadDescription = false;
                                    row.description = "";
                                }

                                if (overload.alias !== undefined) {
                                    row.overloadAlias = true;
                                    row.alias = overload.alias;
                                } else {
                                    row.overloadAlias = false;
                                    row.alias = "";
                                }

                                if (overload.type !== undefined) {
                                    row.overloadType = true;
                                    row.type = overload.type;
                                } else {
                                    row.overloadType = false;
                                    row.type = null;
                                }

                                if (overload.default !== undefined) {
                                    row.overloadDefault = true;
                                    row.default = overload.default;
                                } else {
                                    row.overloadDefault = false;
                                    row.default = null;
                                }

                                if (overload.dataList !== undefined) {
                                    row.overloadDataList = true;
                                    row.dataList = overload.dataList;
                                } else {
                                    row.overloadDataList = false;
                                    row.dataList = null;
                                }

                                if (overload.autonumber !== undefined) {
                                    row.overloadAutonumber = true;
                                    row.autonumber = overload.autonumber;
                                } else {
                                    row.overloadAutonumber = false;
                                    row.autonumber = null;
                                }

                                return row;
                            });

                            if (existingId) {
                                feather.id = existingId;
                            }
                            data.push({
                                name: "Feather",
                                method: "POST",
                                id: existingId || feather.id || feather.name,
                                data: feather
                            });
                        });

                        runBatch(data);
                    }

                    if (isSystem) {
                        callback();
                        return;
                    }

                    pDatasource.request({
                        method: "GET",
                        name: "Feather",
                        user: pUser,
                        client: pClient,
                        properties: ["id", "name"]
                    }, true).then(callback).catch(rollback);
                }

                function saveService(pName, pModule, pScript) {
                    function callback(resp) {
                        let vId = btoa("ds" + pName);
                        let payload;

                        if (resp.length) {
                            vId = resp[0].id;
                        }

                        payload = {
                            method: "POST",
                            name: "DataService",
                            user: pUser,
                            client: pClient,
                            id: vId,
                            data: {
                                name: pName,
                                module: pModule,
                                script: pScript,
                                owner: pUser
                            }
                        };

                        runBatch([payload]);
                    }

                    pDatasource.request({
                        method: "GET",
                        name: "DataService",
                        user: pUser,
                        client: pClient,
                        filter: {
                            criteria: [{
                                property: "name",
                                value: pName
                            }, {
                                property: "module",
                                value: pModule
                            }]
                        }
                    }, true).then(callback).catch(rollback);
                }

                function saveWorkbooks(workbooks) {
                    let payload = {
                        method: "PUT",
                        name: "saveWorkbook",
                        user: pUser,
                        client: pClient,
                        data: {
                            specs: workbooks
                        }
                    };

                    // Disable authorization updates
                    workbooks.forEach(function (wb) {
                        wb.authorizations = false;
                        wb.localConfig = [];
                    });
                    pDatasource.request(payload, true).then(
                        processFile
                    ).catch(rollback);
                }

                function execute(filename) {
                    let dep = path.resolve(filename);
                    let exp = require(dep);

                    exp.execute({
                        user: pUser,
                        client: pClient
                    }).then(processFile.bind(pClient)).catch(rollback);
                }

                function install(filename) {
                    let subman;
                    let subfilepath = path.format({
                        root: "/",
                        dir: pDir,
                        base: filename
                    });
                    let subdir = path.parse(filename).dir;
                    let n = i;

                    feathers.disablePropagation(true);
                    fs.readFile(subfilepath, "utf8", function (err, data) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        subman = JSON.parse(data);
                        subman.files.forEach(function (file) {
                            file.path = subdir + "/" + file.path;
                            file.module = file.module || subman.module;
                            file.module = file.module || manifest.module;
                            file.version = file.version || subman.version;
                            file.version = file.version || manifest.version;
                            file.dependencies = (
                                file.dependencies || subman.dependencies
                            );
                            file.dependencies = (
                                file.dependencies || manifest.dependencies
                            );
                            file.npm = file.npm || subman.npm || manifest.npm;
                            manifest.files.splice(n, 0, file);
                            n += 1;
                        });
                        processFile();
                    });
                }

                function defineSettings(pSettings, pModule) {
                    let sql;
                    let params = [pSettings.name, pSettings];

                    sql = "SELECT * FROM \"$settings\" WHERE name='";
                    sql += pSettings.name + "';";

                    pClient.query(sql, function (err, result) {
                        if (err) {
                            rollback(err);
                            return;
                        }
                        if (result.rows.length) {
                            sql = "UPDATE \"$settings\" SET ";
                            sql += "definition=$2 WHERE name=$1;";
                        } else {
                            params.push(pUser);
                            params.push(pModule);
                            sql = (
                                "INSERT INTO \"$settings\" " +
                                "(name, definition, id, created, " +
                                "created_by, updated, updated_by, " +
                                "is_deleted, module) " +
                                "VALUES ($1, $2, $1, now(), $3, now(), $3, " +
                                "false, $4);"
                            );
                        }

                        pClient.query(sql, params, processFile);
                    });
                }

                processFile = function () {
                    let filepath;
                    let module;
                    let version;
                    let dependencies;
                    let content;
                    let name;
                    let npm;

                    async function updateTenant() {
                        let tmods;
                        if (opts.tenant) {
                            tmods = await pDatasource.request({
                                client: pClient,
                                method: "GET",
                                name: "Module",
                                properties: ["name", "version"],
                                user: pUser
                            }, true);
                            let acSettings = await pDatasource.request({
                                client: reqClient,
                                method: "GET",
                                name: "getSettings",
                                user: pUser,
                                data: {name: "adminConsoleSettings"}
                            }, true);
                            await pDatasource.request({
                                data: [{
                                    op: "replace",
                                    path: "/modules",
                                    value: tmods
                                }],
                                id: opts.tenant.id,
                                method: "PATCH",
                                name: "Tenant",
                                user: pUser,
                                tenant: false
                            }, true);

                            if (acSettings) {
                                if (tmods.some(function (tmod) {
                                    return (
                                        tmod.name === acSettings.module &&
                                        tmod.version === acSettings.version
                                    );
                                })) {
                                    opts.tenant.hasValidModule = true;
                                }
                            }
                        }
                        conn.done();
                    }

                    function complete() {
                        isInstalling = false;
                        if (isRemote) {
                            updateTenant().then(
                                pProcess.complete
                            ).then(function () {
                                console.log("Remote installation completed!");
                                resolve();
                            });
                            return;
                        }

                        // Some services won't initialize while installing
                        // so do it again now to make sure they're started
                        console.log("Applying npm packages...");
                        pDatasource.loadNpmModules(
                            pUser,
                            pClient
                        ).then(function () {
                            console.log("Reloading data services...");
                            return pDatasource.loadServices(
                                pUser,
                                pClient
                            );
                        }).then(pProcess.complete).then(function () {
                            console.log("Installation completed!");
                            resolve();
                        });
                    }

                    // We deferred propagating views on every feather
                    // to avoid running out of shared memory, so follow
                    // up on that now
                    function handleFeathers() {
                        return new Promise(function (resolve, reject) {
                            feathers.disablePropagation(false);
                            if (installedFeathers) {
                                feathers.propagateViews(pClient).then(
                                    resolve
                                ).catch(reject);
                                return;
                            }

                            resolve();
                        });
                    }

                    file = manifest.files[i];
                    i += 1;

                    // If we've processed all the files, wrap this up
                    if (!file) {
                        handleFeathers().then(function () {
                            return new Promise(function (resolve) {
                                pClient.query("COMMIT;").then(resolve);
                            });
                        }).then(
                            api.buildClientApi.bind(null, pDatasource, pUser)
                        ).then(
                            api.buildRestApi.bind(null, pDatasource, pUser)
                        ).then(complete).catch(reject);

                        return;
                    }

                    filename = file.path;
                    name = path.parse(filename).name;
                    filepath = path.format({
                        root: "/",
                        dir: pDir,
                        base: filename
                    });

                    module = file.module || manifest.module;
                    version = file.version || manifest.version;
                    dependencies = file.dependencies || manifest.dependencies;
                    npm = file.npm || manifest.npm;

                    fs.readFile(filepath, "utf8", function (err, data) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        content = data;

                        console.log("Installing " + filename);
                        pProcess.next();

                        try {
                            switch (file.type) {
                            case "install":
                                install(filename);
                                break;
                            case "execute":
                                execute(filename);
                                break;
                            case "module":
                                saveModule(
                                    module,
                                    content,
                                    version,
                                    dependencies,
                                    npm
                                );
                                break;
                            case "service":
                                saveService(file.name || name, module, content);
                                break;
                            case "feather":
                                saveFeathers(
                                    JSON.parse(content),
                                    file.isSystem
                                );
                                break;
                            case "batch":
                                runBatch(JSON.parse(content));
                                break;
                            case "workbook":
                                saveWorkbooks(JSON.parse(content));
                                break;
                            case "settings":
                                defineSettings(JSON.parse(content), module);
                                break;
                            default:
                                rollback("Unknown type.");
                                return;
                            }
                        } catch (e) {
                            rollback(e);
                        }
                    });
                };

                function doInstall(resp) {
                    if (!resp) {
                        throw new Error(
                            "You must have superuser privileges to " +
                            "perform installations."
                        );
                    }

                    fs.readFile(filename, "utf8", function (err, data) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        manifest = JSON.parse(data);
                        pClient.query("BEGIN;").then(processFile);
                    });
                }

                if (pIsSuper) {
                    // Run from command line, so ignore process stuff
                    pProcess = {
                        next: () => true,
                        complete: () => true
                    };
                    registerNpmModules(true).then(doInstall);
                    return;
                }

                async function checkSuper() {
                    let is = await f.datasource.request({
                        method: "GET",
                        name: "isSuperUser",
                        client: pClient
                    });
                    return is;
                }

                init().then(
                    checkSuper
                ).then(
                    registerNpmModules
                ).then(
                    doInstall
                ).catch(
                    reject
                );
            });
        };

        /**
            Uninstall a module.

            @method deleteModule
            @param {Object} payload
            @param {String | Object} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Module name
            @return {Promise}
        */
        that.deleteModule = function (obj) {
            return new Promise(function (resolve, reject) {
                let vClient = obj.client;
                let name = obj.data.name;
                let requests;
                let sql = (
                    "SELECT * FROM module_dependency " +
                    "  JOIN module ON module._pk=_module_script_pk " +
                    "WHERE module.name=$1 " +
                    "  AND NOT module_dependency.is_deleted;"
                );

                function callback(resp) {
                    if (resp.rows.length) {
                        throw new Error(
                            "Can not delete module " + name +
                            " because other modules are dependant on it"
                        );
                    }
                    requests = [
                        vClient.query(
                            (
                                "DELETE FROM form_attr_column WHERE EXISTS (" +
                                "  SELECT * FROM form_attr, form " +
                                "  WHERE form_attr._pk=_parent_form_attr_pk " +
                                "    AND form._pk=form_attr._parent_form_pk " +
                                "    AND form.module=$1);"
                            ),
                            [name]
                        ),
                        vClient.query(
                            (
                                "DELETE FROM form_attr WHERE EXISTS (" +
                                "  SELECT * FROM form " +
                                "  WHERE form._pk=form_attr._parent_form_pk " +
                                "    AND form.module=$1);"
                            ),
                            [name]
                        ),
                        vClient.query(
                            (
                                "DELETE FROM form_tab WHERE EXISTS (" +
                                "  SELECT * FROM form " +
                                "    WHERE form._pk=form_tab._parent_form_pk " +
                                "    AND form.module=$1);"
                            ),
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM form WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            (
                                "DELETE FROM relation_search_column " +
                                "WHERE EXISTS (" +
                                "  SELECT * FROM relation_widget " +
                                "  WHERE relation_widget._pk=" +
                                "    _parent_relation_widget_pk " +
                                "    AND relation_widget.module=$1);"
                            ),
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM relation_widget WHERE module = $1",
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM data_service WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM route WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM style WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM \"$workbook\" WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM \"$settings\" WHERE module=$1",
                            [name]
                        ),
                        vClient.query(
                            (
                                "DELETE FROM module_dependency WHERE EXISTS (" +
                                "  SELECT * FROM module " +
                                "  WHERE _parent_module_pk=module._pk " +
                                "    AND module.name = $1);"
                            ),
                            [name]
                        ),
                        vClient.query(
                            "DELETE FROM module WHERE name = $1",
                            [name]
                        )
                    ];

                    Promise.all(requests).then(function () {
                        let found;

                        function deleteFeather(resp) {
                            if (found === undefined) {
                                found = resp.rows;
                            }

                            if (found.length) {
                                feathers.deleteFeather({
                                    client: vClient,
                                    data: {
                                        name: found.pop().name
                                    }
                                }, true).then(deleteFeather).catch(reject);
                                return;
                            }

                            sql = "DELETE FROM feather WHERE module=$1";
                            vClient.query(
                                sql,
                                [name]
                            ).then(resolve).catch(reject);
                        }

                        sql = (
                            "SELECT name FROM feather WHERE module=$1 " +
                            " AND NOT is_deleted " +
                            "ORDER BY _pk;"
                        );
                        vClient.query(
                            sql,
                            [name]
                        ).then(deleteFeather).catch(reject);
                    }).catch(reject);
                }

                f.datasource.request({
                    method: "GET",
                    name: "isSuperUser",
                    client: vClient
                }).then(function (isSuperUser) {
                    if (!isSuperUser) {
                        throw new Error(
                            "You must have superuser priviliges to " +
                            "uninstall packages."
                        );
                    }
                    vClient.query(sql, [name]).then(callback).catch(reject);
                }).catch(reject);
            });
        };

        return that;
    };

}(exports));
