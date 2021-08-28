/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
    const WebSocket = require("ws");
    const wss = new WebSocket.Server({noServer: true});
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
    const winston = require("winston");
    require("winston-daily-rotate-file");
    const argv = process.argv;
    let loglevel;
    let consolelog;
    let debug;

    argv.forEach(function (arg) {
        switch (arg) {
        case "--loglevel":
            loglevel = argv[argv.indexOf("--loglevel") + 1];
            break;
        case "-L":
            loglevel = argv[argv.indexOf("-L") + 1];
            break;
        case "--consolelog":
        case "-C":
            consolelog = true;
            break;
        }
    });

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
    let routes = [];
    let eventSessions = {};
    let eventKeys = {};
    let sessions = {};
    let port;
    let mode;
    let settings = datasource.settings();
    let dir = "./files";
    let pgPool;
    let sessionTimeout;
    let thesecret;
    let systemUser;
    let logger;
    // Work around linter dogma
    let existssync = "existsSync";
    let lstatsync = "lstatSync";
    let unlinksync = "unlinkSync";
    let readdirsync = "readdirSync";
    let mkdirsync = "mkdirSync";
    let rmdirsync = "rmdirSync";

    // Make sure file directories exist
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/import";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./files/downloads";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    dir = "./logs";
    if (!fs[existssync](dir)) {
        fs[mkdirsync](dir);
    }

    /**
        Remove directory recursively.
        https://stackoverflow.com/a/42505874/3027390

        @method rimraf
        @param {string} dir_path
    */
    function rimraf(dir_path) {
        // Linter really hates "sync" methods
        if (fs[existssync](dir_path)) {
            fs[readdirsync](dir_path).forEach(function (entry) {
                let entry_path = path.join(dir_path, entry);

                if (fs[lstatsync](entry_path).isDirectory()) {
                    rimraf(entry_path);
                } else {
                    fs[unlinksync](entry_path);
                }
            });
            fs[rmdirsync](dir_path);
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
        logger.error(err.message);
        this.status(err.statusCode).json(err.message);
        datasource.getCatalog().catch(function (e) {
            console.log(e);
        });
    }

    function init() {
        return new Promise(function (resolve, reject) {
            function configLogger() {
                return new Promise(function (resolve) {
                    config.read().then(function (resp) {
                        let log = {
                            level: resp.logLevel,
                            zippedArchive: resp.logZippedArchive,
                            maxSize: resp.logMaxSize,
                            maxFiles: resp.logMaxFiles,
                            silent: resp.logSilent
                        };
                        let fmt = winston.format.combine(
                            winston.format.timestamp(),
                            winston.format.json()
                        );

                        logger = winston.createLogger({
                            format: fmt,
                            level: loglevel || log.level || "info",
                            transports: [],
                            silent: Boolean(log.silent)
                        });

                        if (consolelog) {
                            logger.add(new winston.transports.Console({
                                format: winston.format.prettyPrint()
                            }));
                        }

                        logger.add(
                            new(winston.transports.DailyRotateFile)({
                                format: fmt,
                                filename: "./logs/featherbone-%DATE%.log",
                                datePattern: "YYYY-MM-DD-HH",
                                zippedArchive: Boolean(log.zippedArchive),
                                maxSize: log.maxSize || "20m",
                                maxFiles: log.maxFiles || "7d"
                            })
                        );

                        logger.info("Featherbone server starting");
                        resolve();
                    });
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

                        debug = Boolean(resp.debug);

                        // Default 1 day.
                        sessionTimeout = resp.sessionTimeout || 86400000;
                        thesecret = resp.secret;
                        systemUser = resp.pgUser;
                        mode = resp.mode || "prod";
                        port = process.env.PORT || resp.clientPort || 80;

                        // Add npm modules specified
                        mods.forEach(function (mod) {
                            let name;
                            if (mod.properties) {
                                mod.properties.forEach(function (p) {
                                    f[p.property] = require(
                                        mod.require
                                    )[p.export];
                                });
                                return;
                            }

                            name = mod.require;
                            f[name.toCamelCase()] = require(mod.require);
                        });
                        resolve();
                    });
                });
            }

            // Execute
            Promise.resolve().then(
                configLogger
            ).then(
                datasource.getCatalog
            ).then(
                datasource.loadServices
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

        logger.verbose(payload);
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

        logger.verbose(log);
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

        logger.verbose(log);
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
            name === "Role" ||
            name === "UserAccount"
        );

        payload.name = name;
        payload.method = "GET"; // Internally this is a select statement
        payload.user = req.user.name;
        payload.filter = payload.filter || {};

        if (payload.showDeleted) {
            payload.showDeleted = (
                payload.showDeleted === "true" || payload.showDeleted === true
            );
        }

        if (payload.subscription !== undefined) {
            payload.subscription.merge = (
                payload.subscription.merge === "true" ||
                payload.subscription.merge === true
            );
        }

        payload.filter.offset = payload.filter.offset || 0;

        logger.verbose(payload);
        datasource.request(payload, isSuper).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doAggregate(req, res) {
        let payload = {
            method: "POST",
            name: "doAggregate",
            user: req.user.name,
            data: req.body
        };

        logger.verbose(payload);
        datasource.request(payload).then(respond.bind(res)).catch(
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        if (catalog[key].plural) {
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

        logger.verbose(payload);
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

        logger.verbose(payload);
        datasource.request(payload).then(
            function (resp) {
                registerDataRoutes();
                respond.bind(res, resp)();
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose("Lock " + req.body.id);
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
        let usr = req.user.name;

        criteria = {
            id: req.body.id,
            username: usr
        };

        logger.verbose("Unlock " + req.body.id);
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

        logger.verbose("Package " + name);
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

        fs[mkdirsync](DIR); // Create temp dir

        if (Object.keys(req.files).length === 0) {
            return res.status(400).send("No files were uploaded.");
        }

        logger.verbose("Install");

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
        logger.verbose("Export", feather, req.params.format);

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

        logger.verbose("Import", format, feather);

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

    function doOpenPdf(req, res) {
        let filepath = "./files/downloads/";
        let file = filepath + req.params.file;

        fs.readFile(file, function (err, resp) {
            if (err) {
                error.bind(res)(new Error(err));
                return;
            }
            res.writeHeader(200, {"Content-Type": "application.pdf"});
            res.write(resp);
            res.end();
            fs.unlink(file, function () {
                return;
            });
        });
    }

    function doPrintPdfForm(req, res) {
        logger.verbose("Print PDF Form", req.body.form);

        datasource.printPdfForm(
            req.body.form,
            req.body.id || req.body.ids,
            req.body.filename,
            req.user.name
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doSendMail(req, res) {
        let payload = {
            method: "POST",
            name: "sendMail",
            user: req.user.name,
            data: {
                message: {
                    from: req.body.message.from,
                    to: req.body.message.to,
                    cc: req.body.message.cc,
                    bcc: req.body.message.bcc,
                    subject: req.body.message.subject,
                    text: req.body.message.text,
                    html: req.body.message.html
                },
                pdf: {
                    form: req.body.pdf.form,
                    ids: req.body.pdf.id || req.body.pdf.ids,
                    filename: req.body.pdf.filename
                }
            }
        };

        logger.verbose("Send mail");
        logger.verbose(payload);
        datasource.request(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
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
        case ".map":
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
        let file = (
            debug
            ? "./index_debug.html"
            : "./index.html"
        );
        fs.readFile(file, function (err, resp) {
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
            logger.verbose(msg);
            message = msg;
        };

        function next(err) {
            if (err) {
                res.status(res.statusCode).json(message);
                return;
            }

            req.user.mode = mode;
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose(payload);
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

        logger.verbose("Change password for " + req.user.name);
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

        logger.verbose("Change User Info", JSON.stringify(payload, null, 2));
        datasource.changeUserInfo(payload).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doConnect(req, res) {
        let key = f.createId();
        eventKeys[key] = {
            sessionID: req.sessionID
        };

        respond.bind(res)({
            data: {
                authorized: req.user,
                eventKey: key
            }
        });
    }

    // Listen for changes to feathers, update and broadcast to all
    function subscribeToFeathers() {
        return new Promise(function (resolve, reject) {
            let sid = f.createId();
            let eKey = f.createId();
            let payload = {
                name: "Feather",
                method: "GET",
                user: systemUser,
                subscription: {
                    id: sid,
                    eventKey: eKey
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
            eventSessions[eKey] = function (message) {
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
            "/node_modules/typeface-raleway/files",
            "/node_modules/print-js/dist"
        ];
        let files = [
            "/api.json",
            "/index.html",
            "/featherbone.png",
            "/css/featherbone.css",
            "/css/print.css",
            "/node_modules/big.js/big.mjs",
            "/node_modules/event-source-polyfill/src/eventsource.js",
            "/node_modules/fast-json-patch/dist/fast-json-patch.js",
            "/node_modules/fast-json-patch/dist/fast-json-patch.min.js",
            "/node_modules/dialog-polyfill/dialog-polyfill.js",
            "/node_modules/mithril/mithril.js",
            "/node_modules/mithril/mithril.min.js",
            "/node_modules/qs/dist/qs.js",
            "/node_modules/purecss/build/pure-min.css",
            "/node_modules/purecss/build/grids-responsive-min.css",
            "/node_modules/@fortawesome/fontawesome-free/css/all.css",
            "/node_modules/dialog-polyfill/dialog-polyfill.css",
            "/node_modules/codemirror/theme/neat.css",
            "/node_modules/typeface-raleway/index.css",
            "/node_modules/gantt/dist/gantt.min.js"
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
            secret: thesecret,
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
                    logger.verbose("Session " + req.sessionID + " timed out");
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
        logger.info("Registering core routes");

        app.post("/connect", doConnect);
        app.post("/data/user-accounts", doQueryRequest);
        app.post("/data/user-account", doPostUserAccount);
        app.get("/data/user-account/:id", doRequest);
        app.get("/pdf/:file", doOpenPdf);
        app.patch("/data/user-account/:id", doPatchUserAccount);
        app.delete("/data/user-account/:id", doRequest);
        app.get("/currency/base", doGetBaseCurrency);
        app.get("/currency/convert", doConvertCurrency);
        app.get("/do/is-authorized", doIsAuthorized);
        app.post("/do/aggregate/", doAggregate);
        app.post("/data/object-authorizations", doGetObjectAuthorizations);
        app.post("/do/change-password/", doChangePassword);
        app.post("/do/change-user-info/", doChangeUserInfo);
        app.post("/do/save-authorization", doSaveAuthorization);
        app.post("/do/export/:format/:feather", doExport);
        app.post("/do/import/:format/:feather", doImport);
        app.post("/do/print-pdf/form/", doPrintPdfForm);
        app.post("/do/send-mail", doSendMail);
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
            // Instantiate event key for web socket connection
            wss.on("connection", function connection(ws) {
                let eKey;

                ws.on("message", function incoming(key) {
                    let sessionID;

                    eKey = key;

                    if (eventKeys[key]) {
                        sessionID = eventKeys[key].sessionID;
                    } else {
                        ws.send("Invalid event key " + key);
                        return;
                    }

                    eventSessions[eKey] = function (message) {
                        let data = JSON.stringify({
                            message: message.payload
                        });
                        ws.send(data);
                    };
                    eventSessions[eKey].sessionID = sessionID;

                    logger.verbose("Listening for events " + eKey);
                });

                ws.on("close", function close() {
                    delete eventSessions[eKey];
                    datasource.unsubscribe(eKey, "instance");
                    datasource.unlock({
                        eventKey: eKey
                    });

                    logger.info("Closed instance " + eKey);
                });
            });
        }

        datasource.listen(receiver).then(handleEvents).catch(console.error);

        // REGISTER MODULE ROUTES
        function postify(req, res) {
            let payload = {
                method: "POST",
                name: this,
                user: req.user.name,
                data: req.body
            };

            logger.info(payload);
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

            logger.info("Registering module route: " + fullPath);
            app.post(fullPath, doPostRequest);
        });

        // START THE SERVER
        // ====================================================================
        const server = app.listen(port);
        // Enable web sockets to listen on the same port as http
        server.on("upgrade", function (request, socket, head) {
            wss.handleUpgrade(request, socket, head, function (socket) {
                wss.emit("connection", socket, request);
            });
        });
        console.log("Magic happens on port " + port);
    }

    // ..........................................................
    // FIRE IT UP
    //

    init().then(subscribeToFeathers).then(start).catch(process.exit);
}());