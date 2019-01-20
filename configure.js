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
/*jslint node, eval */
(function () {
    "use strict";

    require("./common/string.js");

    const {
        Client
    } = require("pg");
    const {
        Config
    } = require("./server/config");
    const {
        API
    } = require("./scripts/api");
    const fs = require("fs");
    const path = require("path");
    const f = require("./common/core");
    const datasource = require("./server/datasource");
    const format = require("pg-format");
    const MANIFEST = "manifest.json";
    const api = new API();

    f.datasource = datasource;
    f.jsonpatch = require("fast-json-patch");

    let manifest;
    let file;
    let content;
    let execute;
    let name;
    let defineSettings;
    let saveModule;
    let saveService;
    let saveFeathers;
    let saveWorkbooks;
    let rollback;
    let connect;
    let commit;
    let begin;
    let processFile;
    let client;
    let user;
    let runBatch;
    let configure;
    let config = new Config();
    let dir = path.resolve(__dirname, process.argv[2] || ".");
    let filename = path.format({
        root: "/",
        dir: dir,
        base: MANIFEST
    });
    let exit = process.exit;
    let i = 0;

    connect = function (callback) {
        config.read().then(function (config) {
            user = config.postgres.user;
            client = new Client(config.postgres);

            client.connect(function (err) {
                if (err) {
                    return console.error(err);
                }

                callback();
            });
        });
    };

    begin = function () {
        //console.log("BEGIN");
        client.query("BEGIN;", processFile);
    };

    commit = function () {
        return new Promise(function (resolve) {
            client.query("COMMIT;", function () {
                //console.log("COMMIT");
                client.end();
                resolve();
            });
        });
    };

    rollback = function (err) {
        client.query("ROLLBACK;", function () {
            console.error(err);
            //console.log("ROLLBACK");
            console.error("Configuration failed.");
            client.end();
            process.exit();
        });
    };

    execute = function (filename) {
        let dep = path.resolve(filename);
        let exp = require(dep);

        exp.execute({
            user: user,
            client: client
        }).then(processFile).catch(rollback);
    };

    processFile = function () {
        let filepath;
        let module;
        let version;
        let dependencies;

        function done() {
            console.log("Configuration completed!");
            process.exit();
        }

        file = manifest.files[i];
        i += 1;

        // If we've processed all the files, wrap this up
        if (!file) {
            Promise.resolve().then(commit).then(api.build).then(done).catch(
                function (err) {
                    console.error(err);
                    process.exit();
                }
            );
            return;
        }

        filename = file.path;
        name = path.parse(filename).name;
        filepath = path.format({
            root: "/",
            dir: dir,
            base: filename
        });

        module = file.module || manifest.module;
        version = file.version || manifest.version;
        dependencies = file.dependencies || manifest.dependencies;

        fs.readFile(filepath, "utf8", function (err, data) {
            if (err) {
                console.error(err);
                return;
            }

            content = data;

            console.log("Configuring " + filename);

            switch (file.type) {
            case "configure":
                configure(filename);
                break;
            case "execute":
                execute(filename);
                break;
            case "module":
                saveModule(module, content, version, dependencies);
                break;
            case "service":
                saveService(file.name || name, module, content);
                break;
            case "feather":
                saveFeathers(JSON.parse(content), file.isSystem);
                break;
            case "batch":
                runBatch(JSON.parse(content));
                break;
            case "workbook":
                saveWorkbooks(JSON.parse(content));
                break;
            case "settings":
                defineSettings(JSON.parse(content));
                break;
            default:
                rollback("Unknown type.");
                return;
            }
        });
    };

    configure = function (filename) {
        let subman;
        let subfilepath = path.format({
            root: "/",
            dir: dir,
            base: filename
        });
        let subdir = path.parse(filename).dir;
        let n = i;

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
                file.dependencies = file.dependencies || subman.dependencies;
                file.dependencies = file.dependencies || manifest.dependencies;
                manifest.files.splice(n, 0, file);
                n += 1;
            });
            processFile();
        });
    };

    defineSettings = function (settings) {
        let sql;
        let params = [settings.name, settings];

        sql = "SELECT * FROM \"$settings\" WHERE name='";
        sql += settings.name + "';";

        client.query(sql, function (err, result) {
            if (err) {
                rollback(err);
                return;
            }
            if (result.rows.length) {
                sql = "UPDATE \"$settings\" SET ";
                sql += "definition=$2 WHERE name=$1;";
            } else {
                params.push(user);
                sql = "INSERT INTO \"$settings\" (name, definition, id, ";
                sql += "created, created_by, updated, updated_by,";
                sql += " is_deleted) ";
                sql += "VALUES ($1, $2, $1, now(), $3, now(), $3, false);";
            }

            client.query(sql, params, processFile);
        });
    };

    saveModule = function (name, script, version, dependencies) {
        dependencies = dependencies || [];
        let payload = {
            method: "POST",
            name: "Module",
            user: user,
            client: client,
            id: name,
            data: {
                id: name,
                name: name,
                version: version,
                script: script,
                dependencies: dependencies.map(function (dep) {
                    return {
                        module: {
                            id: dep
                        }
                    };
                })
            }
        };

        runBatch([payload]);
    };

    saveService = function (name, module, script) {
        let payload = {
            method: "POST",
            name: "DataService",
            user: user,
            client: client,
            id: name,
            data: {
                id: name,
                name: name,
                module: {
                    id: module
                },
                script: script
            }
        };

        runBatch([payload]);
    };

    saveFeathers = function (feathers, isSystem) {
        let payload;
        let data = [];

        // System feathers don't get to be tables
        if (isSystem) {
            payload = {
                method: "PUT",
                name: "saveFeather",
                user: user,
                client: client,
                data: {
                    specs: feathers
                }
            };

            datasource.request(payload).then(processFile).catch(rollback);
            return;
        }

        // Map feather structure to table structure
        feathers.forEach(function (feather) {
            let keys = Object.keys(feather.properties || {});
            let props = feather.properties;

            feather.properties = keys.map(function (key) {
                let prop = props[key];
                prop.name = key;
                return prop;
            });

            data.push({
                name: "Feather",
                method: "POST",
                id: feather.name,
                data: feather
            });
        });

        runBatch(data);
    };

    saveWorkbooks = function (workbooks) {
        let payload = {
            method: "PUT",
            name: "saveWorkbook",
            user: user,
            client: client,
            data: {
                specs: workbooks
            }
        };

        datasource.request(payload).then(processFile).catch(rollback);
    };

    runBatch = function (data) {
        let getServices;
        let nextItem;
        let len = data.length;
        let b = 0;

        getServices = function () {
            let payload;
            let after;

            after = function (resp) {
                resp.forEach(function (service) {
                    new Function("f", "\"use strict\";" + service.script)(f);
                });
                nextItem();
            };

            payload = {
                method: "GET",
                name: "getServices",
                user: "postgres",
                client: client
            };

            datasource.request(payload).then(after).catch(exit);
        };

        // Iterate recursively
        nextItem = function () {
            let payload;

            if (b < len) {
                payload = data[b];
                payload.user = user;
                payload.client = client;
                b += 1;
                datasource.request(payload).then(nextItem).catch(rollback);
                return;
            }

            // We're done here
            processFile();
        };

        // Start processing
        getServices();
    };

    /* Real work starts here */
    fs.readFile(filename, "utf8", function (err, data) {
        if (err) {
            console.error(err);
            return;
        }

        let exec = function () {
            manifest = JSON.parse(data);
            connect(begin);
        };

        config.read().then(function (config) {
            let pgclient;
            let conn;

            conn = "postgres://";
            conn += config.postgres.user + ":";
            conn += config.postgres.password + "@";
            conn += config.postgres.host + ":";
            conn += config.postgres.port + "/" + "postgres";

            pgclient = new Client({
                connectionString: conn
            });

            pgclient.connect(function (err) {
                if (err) {
                    return console.error(err);
                }

                let sql;

                sql = "SELECT datname FROM pg_database ";
                sql += "WHERE datistemplate = false AND datname = $1";

                pgclient.query(sql, [config.postgres.database], function (
                    err,
                    resp
                ) {
                    let msg;

                    if (err) {
                        return console.error(err);
                    }

                    // If database exists, get started
                    if (resp.rows.length === 1) {
                        datasource.getCatalog().then(exec).catch(exit);
                        // Otherwise create database first
                    } else {
                        msg = "Creating database \"";
                        msg += config.postgres.database + "\"";
                        console.log(msg);

                        sql = "CREATE DATABASE %I;";
                        sql = format(
                            sql,
                            config.postgres.database,
                            config.postgres.user
                        );
                        pgclient.query(sql, function () {
                            if (err) {
                                return console.error(err);
                            }
                            exec();
                        });
                    }
                });
            });
        });
    });
}());