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
/*jslint node, this, eval, devel*/
(function () {
    "use strict";
    require("./common/string.js");

    const datasource = require("./server/datasource");
    const express = require("express");
    const expressFileUpload = require("express-fileupload");
    const fs = require("fs");
    const bodyParser = require("body-parser");
    const f = require("./common/core");
    const qs = require("qs");
    const SSE = require("sse-nodejs");
    const cors = require("cors");
    const AdmZip = require("adm-zip");

    f.datasource = datasource;
    f.jsonpatch = require("fast-json-patch");

    let app = express();
    let services = [];
    let routes = [];
    let sessions = {};
    let port = process.env.PORT || 10001;
    let settings = datasource.settings();
    let dir = "./files";

    // Make sure file directories exist
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    dir = "./files/packages";
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }

    dir = "./files/install";
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

            // Execute
            Promise.resolve().then(
                datasource.getCatalog
            ).then(getServices).then(
                getRoutes
            ).then(
                datasource.unsubscribe
            ).then(
                datasource.unlock
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
            user: datasource.getCurrentUser(),
            sessionId: req.sessionId,
            id: req.params.id,
            data: req.body || {}
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload, false, true).then(
            function (data) {
                respond.bind(res, data)();
            }
        ).catch(
            error.bind(res)
        );
    }

    function doQueryRequest(req, res) {
        let payload = req.body || {};

        payload.name = resolveName(req.url);
        payload.method = "GET"; // Internally this is a select statement
        payload.user = datasource.getCurrentUser();
        payload.sessionId = req.sessionId;
        payload.filter = payload.filter || {};

        if (payload.showDeleted) {
            payload.showDeleted = payload.showDeleted === "true";
        }

        if (payload.subscription !== undefined) {
            payload.subscription.merge = payload.subscription.merge === "true";
        }

        payload.filter.offset = payload.filter.offset || 0;

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload, false, true).then(
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
            user: datasource.getCurrentUser(),
            data: {
                name: req.params.name
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload).then(respond.bind(res)).catch(
            error.bind(res)
        );
    }

    function doGetBaseCurrency(req, res) {
        let query = qs.parse(req.query);
        let payload = {
            method: "GET",
            name: "baseCurrency",
            user: datasource.getCurrentUser(),
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
            user: datasource.getCurrentUser(),
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

    function doGetModules(req, res) {
        doGetMethod("getModules", req, res);
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

    function registerDataRoutes() {
        let keys;
        let name;
        let catalog = settings.data.catalog.data;

        keys = Object.keys(catalog);
        keys.forEach(function (key) {
            name = key.toSpinalCase();

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
        });
    }

    function doSaveMethod(fn, req, res) {
        let payload = {
            method: "PUT",
            name: fn,
            user: datasource.getCurrentUser(),
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

    function doSaveFeather(req, res) {
        doSaveMethod("saveFeather", req, res);
    }

    function doSaveWorkbook(req, res) {
        doSaveMethod("saveWorkbook", req, res);
    }

    function doSaveSettings(req, res) {
        let payload = {
            method: "PUT",
            name: "saveSettings",
            user: datasource.getCurrentUser(),
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

    function doDeleteMethod(fn, req, res) {
        let payload = {
            method: "DELETE",
            name: fn,
            user: datasource.getCurrentUser(),
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

    function doDeleteFeather(req, res) {
        req.isCamelCase = true;
        doDeleteMethod("deleteFeather", req, res);
    }

    function doDeleteWorkbook(req, res) {
        doDeleteMethod("deleteWorkbook", req, res);
    }

    function doSubscribe(req, res) {
        let query = qs.parse(req.params.query);
        let payload = {
            method: "POST",
            name: "subscribe",
            user: datasource.getCurrentUser(),
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
            user: datasource.getCurrentUser(),
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
        let query = qs.parse(req.params.query);
        let username = datasource.getCurrentUser();

        console.log("Lock", query.id);
        datasource.lock(
            query.id,
            username,
            query.sessionId
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doUnlock(req, res) {
        let criteria;
        let query = qs.parse(req.params.query);
        let username = datasource.getCurrentUser();

        criteria = {
            id: query.id,
            username: username
        };

        console.log("Unlock", query.id);
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
        let username = datasource.getCurrentUser();

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

    function doInstallModule(req, res) {
        const DIR = "./files/install/";
        const TEMPFILE = DIR + "temp.zip";

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
                datasource.getCurrentUser()
            );

            res.json(true);
        });
    }

    function doExport(req, res) {
        console.log("Export", req.params.feather, req.params.format);

        datasource.export(
            req.params.feather,
            req.body.properties,
            req.body.filter || {},
            "./files/downloads/",
            req.params.format,
            datasource.getCurrentUser()
        ).then(
            respond.bind(res)
        ).catch(
            error.bind(res)
        );
    }

    function doImport(req, res) {
        let id = f.createId();
        let format = req.params.format;
        const DIR = "./files/import/";
        const TEMPFILE = DIR + id + "." + format;

        console.log("Import", format);

        // The name of the input field
        let file = req.files.data;

        // Move the file to a install folder
        file.mv(TEMPFILE, function (err) {
            if (err) {
                return res.status(500).send(err);
            }

            datasource.import(
                format,
                TEMPFILE,
                datasource.getCurrentUser()
            );

            res.json(true);
        });
    }

    function start() {
        // configure app to use bodyParser()
        // this will let us get the data from a POST
        app.use(bodyParser.urlencoded({
            extended: true
        }));
        app.use(bodyParser.json());

        // Relax CORS so API Doc (canary) can work
        app.use(cors());

        // static pages
        app.use(express.static(__dirname));

        // File upload
        app.use(expressFileUpload());

        // Create routes for each catalog object
        registerDataRoutes();

        // REGISTER CORE ROUTES -------------------------------
        console.log("Registering core routes");

        app.get("/currency/base", doGetBaseCurrency);
        app.get("/currency/convert", doConvertCurrency);
        app.post("/do/export/:format/:feather", doExport);
        app.post("/do/import/:format", doImport);
        app.post("/do/subscribe/:query", doSubscribe);
        app.post("/do/unsubscribe/:query", doUnsubscribe);
        app.post("/do/lock/:query", doLock);
        app.post("/do/unlock/:query", doUnlock);
        app.get("/feather/:name", doGetFeather);
        app.put("/feather/:name", doSaveFeather);
        app.delete("/feather/:name", doDeleteFeather);
        app.post("/module/package/:name", doPackageModule);
        app.post("/module/install", doInstallModule);
        app.get("/modules", doGetModules);
        app.get("/settings/:name", doGetSettingsRow);
        app.put("/settings/:name", doSaveSettings);
        app.get("/settings-definition", doGetSettingsDefinition);
        app.get("/workbooks", doGetWorkbooks);
        app.get("/workbook/:name", doGetWorkbook);
        app.put("/workbook/:name", doSaveWorkbook);
        app.delete("/workbook/:name", doDeleteWorkbook);

        // HANDLE PUSH NOTIFICATION -------------------------------
        // Receiver callback for all events, sends only to applicable session.
        function receiver(message) {
            let payload;
            let sessionId = message.payload.subscription.sessionid;
            let change = message.payload.subscription.change;
            let fn = sessions[sessionId];

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
                        user: datasource.getCurrentUser(),
                        id: message.payload.data.id
                    };
                    datasource.request(payload).then(callback).catch(err);
                    return;
                }

                callback();
            }
        }

        function handleEvents() {
            app.get("/sse", function (ignore, res) {
                let crier = new SSE(res);
                let sessionId = f.createId();

                // Instantiate address for session
                app.get("/sse/" + sessionId, function (ignore, res) {
                    let sessCrier = new SSE(res, {
                        heartbeat: 10
                    });

                    sessions[sessionId] = function (message) {
                        sessCrier.send({
                            message: message.payload
                        });
                    };

                    sessCrier.disconnect(function () {
                        delete sessions[sessionId];
                        datasource.unsubscribe(sessionId, "session");
                        datasource.unlock({
                            sessionId: sessionId
                        });
                        console.log("Closed session " + sessionId);
                    });

                    console.log("Listening for session " + sessionId);
                });

                crier.send(sessionId);

                crier.disconnect(function () {
                    console.log("Client startup done.");
                });
            });
        }

        datasource.listen(receiver).then(handleEvents).catch(console.error);

        // REGISTER MODULE SERVICES
        services.forEach(function (service) {
            console.log("Registering module service:", service.name);
            new Function("f", "\"use strict\";" + service.script)(f);
        });

        // REGISTER MODULE ROUTES
        routes.forEach(function (route) {
            let fullPath = "/" + route.module.toSpinalCase() + route.path;
            let doPostRequest = datasource.postFunction.bind(route.function);

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

    init().then(start).catch(process.exit);
}());