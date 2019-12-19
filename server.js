/*
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
*/
/*jslint node, this, eval*/
(function () {
    "use strict";
    require("./common/string.js");

    const datasource = require("./server/datasource");
    const express = require("express");
    const session = require("express-session");
    const PgSession = require("connect-pg-simple")(session);
    const expressFileUpload = require("express-fileupload");
    const fs = require("fs");
    const bodyParser = require("body-parser");
    const f = require("./common/core");
    const qs = require("qs");
    const SSE = require("sse-nodejs");
    const AdmZip = require("adm-zip");
    const path = require("path");
    const passport = require("passport");
    const LocalStrategy = require("passport-local").Strategy;
    const authenticate = passport.authenticate("local", {
        failureFlash: "Username or password invalid",
        failWithError: true
    });
    const {Config} = require("./server/config");
    const config = new Config();
    const check = [
        "data",
        "do",
        "feather",
        "module",
        "modules",
        "profile",
        "settings",
        "settings-definition",
        "workbook",
        "workbooks"
    ];

    /**
        @property datasource
        @type Datasource
        @for f
        @final
    */
    f.datasource = datasource;
    /**
        Fast json patch library per API documented here:
        https://github.com/Starcounter-Jack/JSON-Patch#api
        @property jsonpatch
        @type Datasource
        @for f
        @final
    */
    f.jsonpatch = require("fast-json-patch");

    let app = express();
    let services = [];
    let routes = [];
    let eventSessions = {};
    let sessions = {};
    let port;
    let mode;
    let settings = datasource.settings();
    let dir = "./files";
    let pgPool;
    let sessionTimeout;
    let secret;
    let systemUser;

    // Make sure file directories exist
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    dir = "./files/import";
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    dir = "./files/downloads";
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    /**
        Remove directory recursively.
        https://stackoverflow.com/a/42505874/3027390

        @method rimraf
        @param {string} dir_path
    */
    function rimraf(dir_path) {
        if (fs.existsSync(dir_path)) {
            fs.readdirSync(dir_path).forEach(function (entry) {
                let entry_path = path.join(dir_path, entry);

                if (fs.lstatSync(entry_path).isDirectory()) {
                    rimraf(entry_path);
                } else {
                    fs.unlinkSync(entry_path);
                }
            });
            fs.rmdirSync(dir_path);
        }
    }

    // Handle response
    function respond(resp) {
        if (resp === undefined) {
            this.statusCode = 204;
        }

        // No caching... ever
        this.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        this.setHeader("Pragma", "no-cache"); // HTTP 1.0.
        this.setHeader("Expires", "0");

        // Send back a JSON response
        this.json(resp);
    }

    // Handle datasource error
    function error(err) {
        if (typeof err === "string") {
            err = new Error(err);
        }
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        console.error(err.message);
        this.status(err.statusCode).json(err.message);
    }

    function init() {
        return new Promise(function (resolve, reject) {
            function getServices() {
                return new Promise(function (resolve, reject) {
                    datasource.getServices().then(
                        function (data) {
                            services = data;
                            resolve();
                        }
                    ).catch(
                        reject
                    );
                });
            }

            function getRoutes() {
                return new Promise(function (resolve, reject) {
                    datasource.getRoutes().then(
                        function (data) {
                            routes = data;
                            resolve();
                        }
                    ).catch(
                        reject
                    );
                });
            }

            function setPool(pool) {
                return new Promise(function (resolve) {
                    pgPool = pool;
                    resolve();
                });
            }

            function getConfig() {
                return new Promise(function (resolve) {
                    config.read().then(function (resp) {
                        let mods = resp.npmModules || [];

                        // Default 1 day.
                        sessionTimeout = resp.sessionTimeout || 86400000;
                        secret = resp.secret;
                        systemUser = resp.postgres.user;
                        mode = resp.mode || "prod";
                        port = resp.port || 10001;

                        // Add npm modules specified
                        mods.forEach(function (mod) {
                            let name = mod.property || mod.require;
                            f[name] = require(mod.require);
                        });
                        resolve();
                    });
                });
            }

            // Execute
            Promise.resolve().then(
                datasource.getCatalog
            ).then(
                getServices
            ).then(
                getRoutes
            ).then(
                datasource.unsubscribe
            ).then(
                datasource.unlock
            ).then(
                datasource.getPool
            ).then(
                setPool
            ).then(
                getConfig
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    }

    function resolveName(apiPath) {
        apiPath = apiPath.slice(1);
        apiPath = apiPath.slice(apiPath.indexOf("/"));

        let name;
        let keys;
        let found;
        let catalog = settings.data.catalog.data;

        if (apiPath.lastIndexOf("/") > 0) {
            name = apiPath.match("[/](.*)[/]")[1].toCamelCase(true);
        } else {
            name = apiPath.slice(1).toCamelCase(true);
        }

        if (catalog) {
            // Look for feather with same name
            if (catalog[name]) {
                return name;
            }

            // Look for plural version
            keys = Object.keys(catalog);
            found = keys.filter(function (key) {
                return catalog[key].plural === name;
            });

            if (found.length) {
                return found[0];
            }

            return;
        }
    }

    function doRequest(req, res) {
        let payload = {
            name: resolveName(req.url),
            method: req.method,
            user: req.user.name,
            eventKey: req.eventKey,
            id: req.params.id,
            data: req.body || {}
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doPostUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "POST",
            user: req.user.name,
            eventKey: req.eventKey,
            id: req.params.id,
            data: req.body || {}
        };
        let log = f.copy(payload);
        log.data.password = "****";

        console.log(JSON.stringify(log, null, 2));
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doPatchUserAccount(req, res) {
        let payload = {
            name: "UserAccount",
            method: "PATCH",
            user: req.user.name,
            eventKey: req.eventKey,
            id: req.params.id,
            data: req.body || []
        };
        let log = f.copy(payload);
        log.data.forEach(function (item) {
            if (item.path === "/password") {
                item.value = "****";
            }
        });
        log.data.password = "****";

        console.log(JSON.stringify(log, null, 2));
        datasource.request(payload, req.user.isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doQueryRequest(req, res) {
        let payload = req.body || {};
        let name = resolveName(req.url);
        let isSuper = (
            req.user.isSuper ||
            name === "Form" ||
            name === "Module" ||
            name === "Role"
        );

        payload.name = name;
        payload.method = "GET"; // Internally this is a select statement
        payload.user = req.user.name;
        payload.filter = payload.filter || {};

        if (payload.showDeleted) {
            payload.showDeleted = payload.showDeleted === "true";
        }

        if (payload.subscription !== undefined) {
            payload.subscription.merge = payload.subscription.merge === "true";
        }

        payload.filter.offset = payload.filter.offset || 0;

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload, isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doGetMethod(fn, req, res) {
        let payload = {
            method: "GET",
            name: fn,
            user: req.user.name,
            data: {
                name: req.params.name
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(
            payload,
            req.user.isSuper
        ).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetBaseCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "baseCurrency",
            user: req.user.name,
            data: {
                effective: query.effective
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doConvertCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "convertCurrency",
            user: req.user.name,
            data: {
                fromCurrency: query.fromCurrency,
                amount: query.amount,
                toCurrency: query.toCurrency,
                effective: query.effective
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetFeather(req, res) {
        req.params.name = req.params.name.toCamelCase(true);
        doGetMethod("getFeather", req, res);
    }

    function doGetSettingsRow(req, res) {
        doGetMethod("getSettingsRow", req, res);
    }

    function doGetSettingsDefinition(req, res) {
        doGetMethod("getSettingsDefinition", req, res);
    }

    function doGetWorkbook(req, res) {
        doGetMethod("getWorkbook", req, res);
    }

    function doGetWorkbooks(req, res) {
        doGetMethod("getWorkbooks", req, res);
    }

    function registerDataRoute(key) {
        let name = key.toSpinalCase();
        let catalog = settings.data.catalog.data;

        if (catalog[key].isReadOnly) {
            app.get("/data/" + name + "/:id", doRequest);
        } else {
            app.post("/data/" + name, doRequest);
            app.get("/data/" + name + "/:id", doRequest);
            app.patch("/data/" + name + "/:id", doRequest);
            app.delete("/data/" + name + "/:id", doRequest);
        }

        if (catalog[key].plural && !catalog[key].isChild) {
            name = catalog[key].plural.toSpinalCase();
            app.post("/data/" + name, doQueryRequest);
        }
    }

    function registerDataRoutes() {
        let keys;
        let catalog = settings.data.catalog.data;

        keys = Object.keys(catalog).filter((key) => key !== "UserAccount");
        keys.forEach(registerDataRoute);
    }

    function doSaveWorkbook(req, res) {
        let payload = {
            method: "PUT",
            name: "saveWorkbook",
            user: req.user.name,
            data: {
                specs: req.body
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            function () {
                registerDataRoutes();
                respond.bind(res)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doSaveSettings(req, res) {
        let payload = {
            method: "PUT",
            name: "saveSettings",
            user: req.user.name,
            data: {
                name: req.params.name,
                etag: req.body.etag,
                data: req.body.data
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            function () {
                registerDataRoutes();
                respond.bind(res)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doDeleteWorkbook(req, res) {
        let payload = {
            method: "DELETE",
            name: "deleteWorkbook",
            user: req.user.name,
            data: {
                name: req.params.name
            }
        };
        if (req.isCamelCase) {
            payload.data.name = payload.data.name.toCamelCase(true);
        }

        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "subscribe",
            user: req.user.name,
            id: query.id,
            subscription: query.subscription
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnsubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "unsubscribe",
            user: req.user.name,
            subscription: query.subscription
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(
            payload
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doLock(req, res) {
        let username = req.user.name;

        console.log("Lock", req.body.id);
        datasource.lock(
            req.body.id,
            username,
            req.body.eventKey
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnlock(req, res) {
        let criteria;
        let username = req.user.name;

        criteria = {
            id: req.body.id,
            username: username
        };

        console.log("Unlock", req.body.id);
        datasource.unlock(
            criteria
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doPackageModule(req, res) {
        let name = req.params.name;
        let username = req.user.name;

        console.log("Package", name);
        datasource.package(
            name,
            username
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doInstall(req, res) {
        const DIR = "./files/" + "tmp_" + f.createId();
        const TEMPFILE = DIR + ".zip";

        function cleanup() {
            rimraf(DIR); // Remove temp dir
            fs.unlink(TEMPFILE, () => res.json(true)); // Remove zip
        }

        fs.mkdirSync(DIR); // Create temp dir

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        console.log("Install");

        // The name of the input field
        let file = req.files.package;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            let zip = new AdmZip(TEMPFILE);

            zip.extractAllTo(DIR, true);
            datasource.install(
                DIR,
                req.user.name
            ).then(cleanup).catch(
                error.bind(res)
            );
        });
    }

    function doExport(req, res) {
        let apiPath = req.url.slice(10);
        let feather = resolveName(apiPath);
        console.log("Export", feather, req.params.format);

        datasource.export(
            feather,
            req.body.properties,
            req.body.filter || {},
            "./files/downloads/",
            req.params.format,
            req.user.name
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doImport(req, res) {
        let id = f.createId();
        let format = req.params.format;
        let apiPath = req.url.slice(10);
        let feather = resolveName(apiPath);
        const DIR = "./files/import/";
        const TEMPFILE = DIR + id + "." + format;

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        console.log("Import", format, feather);

        // The name of the input field
        let file = req.files.import;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            datasource.import(
                feather,
                format,
                TEMPFILE,
                req.user.name
            ).then(
                respond.bind(res)
            ).catch(
                error.bind(res)
            );
        });
    }

    function doGetDownload(req, res) {
        let filePath = "./files/downloads/" + req.params.sourcename;

        res.download(
            filePath,
            req.params.targetname || req.params.sourcename,
            function (err) {
                if (err) {
                    console.error(err);
                    return;
                }
                fs.unlink(filePath, function () {
                    return; //console.log("deleted " + filePath);
                });
            }
        );
    }

    function doGetFile(req, res) {
        let url = "." + req.url;
        let file = req.params.file || "";
        let suffix = (
            file
            ? file.slice(file.indexOf("."), file.length)
            : url.slice(url.lastIndexOf("."), url.length)
        );
        let mimetype;

        switch (suffix) {
        case ".mjs":
        case ".js":
            mimetype = {"Content-Type": "application/javascript"};
            break;
        case ".css":
            mimetype = {"Content-Type": "text/css"};
            break;
        case ".json":
            mimetype = {"Content-Type": "application/json"};
            break;
        case ".png":
            mimetype = {"Content-Type": "image/png"};
            break;
        case ".ttf":
            mimetype = {"Content-Type": "application/x-font-ttf"};
            break;
        case ".woff":
            mimetype = {"Content-Type": "font/woff"};
            break;
        case ".woff2":
            mimetype = {"Content-Type": "font/woff2"};
            break;
        default:
            throw new Error("Unknown file type " + suffix);
        }

        fs.readFile(url + file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, mimetype);
            res.write(resp);
            res.end();
        });
    }

    function doGetIndexFile(ignore, res) {
        fs.readFile("./index.html", function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "text/html"});
            res.write(resp);
            res.end();
        });
    }

    function doSignIn(req, res) {
        let message;
        req.flash = function (ignore, msg) {
            console.log(msg);
            message = msg;
        };

        function next(err) {
            if (err) {
                res.status(res.statusCode).json(message);
                return;
            }

            res.json(req.user);
        }

        return authenticate(req, res, next);
    }

    function doSignOut(req, res) {
        // Notify all instances on same session
        Object.keys(eventSessions).forEach(function (key) {
            if (eventSessions[key].sessionID === req.sessionID) {
                eventSessions[key]({
                    payload: {
                        subscription: {
                            subscriptionId: "",
                            change: "signedOut",
                            data: {}
                        }
                    }
                });
            }
        });
        req.logout();
        req.session.destroy();
        res.status(200).send();
    }

    function doGetProfile(req, res) {
        let payload = {
            method: "GET",
            name: "getProfile",
            user: req.user.name
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPutProfile(req, res) {
        let payload = {
            method: "PUT",
            name: "saveProfile",
            user: req.user.name,
            data: req.body
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doPatchProfile(req, res) {
        let payload = {
            method: "PATCH",
            name: "patchProfile",
            user: req.user.name,
            data: req.body
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "isAuthorized",
            user: req.user.name,
            data: {
                user: req.user.name,
                action: req.query.action
            }
        };

        if (req.query.id) {
            payload.data.id = req.query.id;
        } else if (req.query.feather) {
            payload.data.feather = req.query.feather;
        }

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doGetObjectAuthorizations(req, res) {
        let payload = {
            method: "GET",
            name: "getAuthorizations",
            user: req.user.name,
            data: {
                id: req.body.filter.criteria[0].value
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSaveAuthorization(req, res) {
        let payload = {
            method: "POST",
            name: "saveAuthorization",
            user: req.user.name,
            data: {
                user: req.user.name,
                id: req.body.id,
                role: req.body.role,
                actions: req.body.actions
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doWorkbookIsAuthorized(req, res) {
        let payload = {
            method: "GET",
            name: "workbookIsAuthorized",
            user: req.user.name,
            data: {
                name: req.params.name,
                user: req.user.name,
                action: req.query.action
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doChangePassword(req, res) {
        let payload = {
            method: "POST",
            name: "changeOwnPassword",
            user: req.user.name,
            data: {
                name: req.user.name,
                oldPassword: req.body.oldPassword,
                newPassword: req.body.newPassword
            }
        };

        console.log("Change password for " + req.user.name);
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doChangeUserInfo(req, res) {
        let payload = {
            name: req.user.name,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            email: req.body.email,
            phone: req.body.phone
        };

        console.log("Change User Info", JSON.stringify(payload, null, 2));
        datasource.changeUserInfo(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doConnect(req, res) {
        respond.bind(res)({
            data: {
                eventKey: f.createId(),
                authorized: req.user
            }
        });
    }

    // Listen for changes to feathers, update and broadcast to all
    function subscribeToFeathers() {
        return new Promise(function (resolve, reject) {
            let sid = f.createId();
            let eventKey = f.createId();
            let payload = {
                name: "Feather",
                method: "GET",
                user: systemUser,
                subscription: {
                    id: sid,
                    eventKey: eventKey
                }
            };

            function changeCallback(resp) {
                // Update all clients
                Object.keys(eventSessions).forEach(function (key) {
                    if (eventSessions[key].sessionID) {
                        eventSessions[key]({
                            payload: {
                                subscription: {
                                    change: "feather",
                                    deleted: false
                                },
                                data: resp
                            }
                        });
                    }
                });
            }

            // Response function in case a feather changes
            eventSessions[eventKey] = function (message) {
                let name;

                if (
                    message.payload.subscription.change === "create" ||
                    message.payload.subscription.change === "update"
                ) {
                    name = message.payload.data.name;

                    // Update server with route changes
                    registerDataRoute(name);

                    // Get feather to update client
                    datasource.request({
                        method: "GET",
                        name: "getFeather",
                        user: systemUser,
                        data: {
                            name: message.payload.data.name
                        }
                    }, true).then(changeCallback).catch(reject);
                } else if (message.payload.subscription.change === "delete") {
                     // Update all clients
                    Object.keys(eventSessions).forEach(function (key) {
                        if (eventSessions[key].sessionID) {
                            eventSessions[key]({
                                payload: {
                                    subscription: {
                                        change: "feather",
                                        deleted: true
                                    },
                                    data: message.payload.data
                                }
                            });
                        }
                    });
                }

                // Update subscription
                delete payload.client;
                datasource.request(payload, true);
            };

            datasource.request(payload, true).then(resolve).catch(reject);
        });
    }

    function start() {
        // Define exactly which directories and files are to be served
        let dirs = [
            "/client",
            "/client/components",
            "/client/models",
            "/common",
            "/node_modules/@fortawesome/fontawesome-free/webfonts",
            "/node_modules/codemirror/addon/lint",
            "/node_modules/codemirror/lib",
            "/node_modules/codemirror/mode/javascript",
            "/node_modules/codemirror/mode/css",
            "/node_modules/typeface-raleway/files"
        ];
        let files = [
            "/api.json",
            "/index.html",
            "/featherbone.png",
            "/css/featherbone.css",
            "/node_modules/big.js/big.mjs",
            "/node_modules/event-source-polyfill/src/eventsource.js",
            "/node_modules/fast-json-patch/dist/fast-json-patch.js",
            "/node_modules/dialog-polyfill/dialog-polyfill.js",
            "/node_modules/mithril/mithril.js",
            "/node_modules/qs/dist/qs.js",
            "/node_modules/purecss/build/pure-min.css",
            "/node_modules/purecss/build/grids-responsive-min.css",
            "/node_modules/@fortawesome/fontawesome-free/css/all.css",
            "/node_modules/dialog-polyfill/dialog-polyfill.css",
            "/node_modules/codemirror/theme/neat.css",
            "/node_modules/typeface-raleway/index.css"
        ];

        // configure app to use bodyParser()
        // this will let us get the data from a POST
        app.use(bodyParser.urlencoded({
            extended: true
        }));
        app.use(bodyParser.json());

        // Set up authentication with passport
        passport.use(new LocalStrategy(
            function (username, password, done) {
                //console.log("Login process:", username);
                datasource.authenticate(username, password).then(
                    function (user) {
                        return done(null, user);
                    }
                ).catch(
                    function (err) {
                        console.error("/signin: " + err);
                        return done(null, false, {
                            message: err.message
                        });
                    }
                );
            }
        ));

        passport.serializeUser(function (user, done) {
            //console.log("serialize ", user);
            done(null, user.name);
        });

        passport.deserializeUser(function (name, done) {
            //console.log("deserualize ", name);
            datasource.deserializeUser(name).then(
                function (user) {
                    //console.log("deserializeUser", user);
                    done(null, user);
                }
            ).catch(done);
        });

        // Initialize passport
        app.use(express.static("public"));
        app.use(session({
            store: new PgSession({
                pool: pgPool,
                tableName: "$session"
            }),
            secret: secret,
            resave: true,
            rolling: true,
            saveUninitialized: false,
            cookie: {
                secure: "auto",
                maxAge: sessionTimeout
            },
            genid: () => f.createId()
        }));
        app.use(bodyParser.urlencoded({extended: false}));
        app.use(passport.initialize());
        app.use(passport.session());

        app.post("/sign-in", doSignIn);
        app.post("/sign-out", doSignOut);

        // Block unauthorized requests to internal data
        app.use(function (req, res, next) {
            let target = req.url.slice(1);
            let interval = req.session.cookie.expires - new Date();
            target = target.slice(0, target.indexOf("/"));

            if (!req.user && check.indexOf(target) !== -1) {
                res.status(401).json("Unauthorized session");
                return;
            }

            if (req.session && sessions[req.sessionID]) {
                clearTimeout(sessions[req.sessionID]);
            }
            if (req.user) {
                req.user.mode = mode;
                sessions[req.sessionID] = setTimeout(function () {
                    console.log("Session " + req.sessionID + " timed out");
                    doSignOut(req, res);
                }, interval);
            }

            next();
        });

        // static pages
        app.get("/files/downloads/:sourcename", doGetDownload);
        app.get("/files/downloads/:sourcename/:targetname", doGetDownload);
        app.get("/", doGetIndexFile);
        dirs.forEach((dirname) => app.get(dirname + "/:filename", doGetFile));
        files.forEach((filename) => app.get(filename, doGetFile));

        // File upload
        app.use(expressFileUpload());

        // Create routes for each catalog object
        registerDataRoutes();

        // REGISTER CORE ROUTES -------------------------------
        console.log("Registering core routes");

        app.post("/connect", doConnect);
        app.post("/data/user-accounts", doQueryRequest);
        app.post("/data/user-account", doPostUserAccount);
        app.get("/data/user-account/:id", doRequest);
        app.patch("/data/user-account/:id", doPatchUserAccount);
        app.delete("/data/user-account/:id", doRequest);
        app.get("/currency/base", doGetBaseCurrency);
        app.get("/currency/convert", doConvertCurrency);
        app.get("/do/is-authorized", doIsAuthorized);
        app.post("/data/object-authorizations", doGetObjectAuthorizations);
        app.post("/do/change-password/", doChangePassword);
        app.post("/do/change-user-info/", doChangeUserInfo);
        app.post("/do/save-authorization", doSaveAuthorization);
        app.post("/do/export/:format/:feather", doExport);
        app.post("/do/import/:format/:feather", doImport);
        app.post("/do/subscribe/:query", doSubscribe);
        app.post("/do/unsubscribe/:query", doUnsubscribe);
        app.post("/do/lock", doLock);
        app.post("/do/unlock", doUnlock);
        app.get("/feather/:name", doGetFeather);
        app.post("/module/package/:name", doPackageModule);
        app.post("/module/install", doInstall);
        app.get("/profile", doGetProfile);
        app.put("/profile", doPutProfile);
        app.patch("/profile", doPatchProfile);
        app.get("/settings/:name", doGetSettingsRow);
        app.put("/settings/:name", doSaveSettings);
        app.get("/settings-definition", doGetSettingsDefinition);
        app.get("/workbooks", doGetWorkbooks);
        app.get("/workbook/is-authorized/:name", doWorkbookIsAuthorized);
        app.get("/workbook/:name", doGetWorkbook);
        app.put("/workbook/:name", doSaveWorkbook);
        app.delete("/workbook/:name", doDeleteWorkbook);

        // HANDLE PUSH NOTIFICATION -------------------------------
        // Receiver callback for all events, sends only to applicable instance.
        function receiver(message) {
            let payload;
            let eventKey = message.payload.subscription.eventkey;
            let change = message.payload.subscription.change;
            let fn = eventSessions[eventKey];

            function callback(resp) {
                if (resp) {
                    message.payload.data = resp;
                }

                fn(message);
            }

            function err(e) {
                console.error(e);
            }

            if (fn) {
                // If record change, fetch new record
                if (change === "create" || change === "update") {
                    payload = {
                        name: message.payload.data.table.toCamelCase(true),
                        method: "GET",
                        user: systemUser,
                        id: message.payload.data.id
                    };
                    datasource.request(payload, true).then(callback).catch(err);
                    return;
                }

                callback();
            }
        }

        function handleEvents() {
            // Instantiate address for instance
            app.get("/sse/:eventKey", function (req, res) {
                let eventKey = req.params.eventKey;
                let sessCrier = new SSE(res, {
                    heartbeat: 10
                });

                eventSessions[eventKey] = function (message) {
                    sessCrier.send({
                        message: message.payload
                    });
                };
                eventSessions[eventKey].sessionID = req.sessionID;

                sessCrier.disconnect(function () {
                    delete eventSessions[eventKey];
                    datasource.unsubscribe(eventKey, "instance");
                    datasource.unlock({
                        eventKey: eventKey
                    });
                    console.log("Closed instance " + eventKey);
                });

                console.log("Listening for events " + eventKey);
            });
        }

        datasource.listen(receiver).then(handleEvents).catch(console.error);

        // REGISTER MODULE SERVICES
        services.forEach(function (service) {
            console.log("Registering module service:", service.name);
            try {
                new Function("f", "\"use strict\";" + service.script)(f);
            } catch (e) {
                console.error(e);
            }
        });

        // REGISTER MODULE ROUTES
        function postify(req, res) {
            let payload = {
                method: "POST",
                name: this,
                user: req.user.name,
                data: req.body
            };

            console.log(JSON.stringify(payload, null, 2));
            datasource.request(
                payload
            ).then(
                respond.bind(res)
            ).catch(
                error.bind(res)
            );
        }

        routes.forEach(function (route) {
            let fullPath = "/" + route.module.toSpinalCase() + route.path;
            let doPostRequest = postify.bind(route.function);

            console.log("Registering module route:", fullPath);
            app.post(fullPath, doPostRequest);
        });

        // START THE SERVER
        // ====================================================================
        app.listen(port);
        console.log("Magic happens on port " + port);
    }

    // ..........................................................
    // FIRE IT UP
    //

    init().then(subscribeToFeathers).then(start).catch(process.exit);
}());