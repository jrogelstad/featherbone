/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*global Promise*/
/*jslint node, this, eval, es6*/
(function () {
    "use strict";
    require('./common/extend-string.js');

    var datasource = require("./server/datasource"),
        express = require("express"),
        bodyParser = require("body-parser"),
        f = require("./common/core"),
        qs = require("qs"),
        SSE = require('sse-nodejs'),
        app = express(),
        controllers = [],
        routes = [],
        sessions = {},
        port = process.env.PORT || 10001,
        doRouter = express.Router(),
        dataRouter = express.Router(),
        featherRouter = express.Router(),
        moduleRouter = express.Router(),
        settingsRouter = express.Router(),
        settingsDefinitionRouter = express.Router(),
        workbookRouter = express.Router(),
        settings = datasource.settings();

    // Handle response
    function respond(resp) {
        if (resp === undefined) {
            this.statusCode = 204;
        }

        // No caching... ever
        this.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
        this.setHeader("Pragma", "no-cache"); // HTTP 1.0.
        this.setHeader("Expires", "0"); //

        // Send back a JSON response
        this.json(resp);
    }

    // Handle datasource error
    function error(err) {
        if (!err.statusCode) {
            err.statusCode = 500;
        }
        console.error(err.message);
        this.status(err.statusCode).json(err.message);
    }

    function init(callback) {
        function getControllers() {
            return new Promise(function (resolve, reject) {
                datasource.getControllers()
                    .then(function (data) {
                        controllers = data;
                        resolve();
                    })
                    .catch(reject);
            });
        }

        function getRoutes() {
            return new Promise(function (resolve, reject) {
                datasource.getRoutes()
                    .then(function (data) {
                        routes = data;
                        resolve();
                    })
                    .catch(reject);
            });
        }

        // Execute
        Promise.resolve()
            .then(datasource.getCatalog)
            .then(getControllers)
            .then(getRoutes)
            .then(datasource.unsubscribe)
            .then(datasource.unlock)
            .then(callback)
            .catch(process.exit);
    }

    function resolveName(apiPath) {
        var name, keys, found,
                catalog = settings.catalog.data;

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
        var params = req.params,
            name = resolveName(req.url),
            payload = req.body || {},
            id = params.id,
            query = params.query
                ? qs.parse(params.query)
                : {},
            properties = query.properties,
            filter = query.filter || {};

        payload.name = name;
        payload.method = req.method;
        payload.user = datasource.getCurrentUser();
        payload.sessionId = req.sessionId;

        if (id) {
            payload.id = id;
        } else if (req.method !== "POST") {
            payload.properties = properties;
            payload.filter = filter;
            if (query.showDeleted) {
                payload.showDeleted = query.showDeleted === "true";
            }

            if (query.subscription !== undefined) {
                payload.subscription = query.subscription;
                payload.subscription.merge = query.subscription.merge === "true";
            }
            filter.offset = filter.offset || 0;
        }

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload, false, true)
            .then(function (data) {
                respond.bind(res, data)();
            })
            .catch(error.bind(res));
    }

    function doGetMethod(fn, req, res) {
        var payload = {
            method: "GET",
            name: fn,
            user: datasource.getCurrentUser(),
            data: {
                name: req.params.name
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload)
            .then(respond.bind(res))
            .catch(error.bind(res));
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
        var keys, name,
                catalog = settings.catalog.data;

        keys = Object.keys(catalog);
        keys.forEach(function (key) {
            name = key.toSpinalCase();
            dataRouter.route("/" + name + "/:id")
                .post(doRequest)
                .get(doRequest)
                .patch(doRequest)
                .delete(doRequest);

            if (catalog[key].plural) {
                name = catalog[key].plural.toSpinalCase();
                dataRouter.route("/" + name)
                    .get(doRequest)
                    .post(doRequest);
                dataRouter.route("/" + name + "/:query")
                    .get(doRequest);
            }
        });
    }

    function doSaveMethod(fn, req, res) {
        var payload = {
            method: "PUT",
            name: fn,
            user: datasource.getCurrentUser(),
            data: {
                specs: req.body
            }
        };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload)
            .then(registerDataRoutes)
            .catch(error.bind(res));
    }

    function doSaveFeather(req, res) {
        doSaveMethod("saveFeather", req, res);
    }

    function doSaveWorkbook(req, res) {
        doSaveMethod("saveWorkbook", req, res);
    }

    function doSaveSettings(req, res) {
        var payload = {
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
        datasource.request(payload)
            .then(registerDataRoutes)
            .catch(error.bind(res));
    }

    function doDeleteMethod(fn, req, res) {
        var name = req.params.name.toCamelCase(true),
            payload = {
                method: "DELETE",
                name: fn,
                user: datasource.getCurrentUser(),
                data: {
                    name: name
                }
            };

        datasource.request(payload)
            .then(res.json)
            .catch(error);
    }

    function doDeleteFeather(req, res) {
        doDeleteMethod("deleteFeather", req, res);
    }

    function doDeleteWorkbook(req, res) {
        doDeleteMethod("deleteWorkbook", req, res);
    }

    function doSubscribe(req, res) {
        var query = qs.parse(req.params.query),
            payload = {
                method: "POST",
                name: "subscribe",
                user: datasource.getCurrentUser(),
                id: query.id,
                subscription: query.subscription
            };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload)
            .catch(error.bind(res));
    }

    function doUnsubscribe(req, res) {
        var query = qs.parse(req.params.query),
            payload = {
                method: "POST",
                name: "unsubscribe",
                user: datasource.getCurrentUser(),
                subscription: query.subscription
            };

        console.log(JSON.stringify(payload, null, 2));
        datasource.request(payload)
            .catch(error.bind(res));
    }

    function doLock(req, res) {
        var query = qs.parse(req.params.query),
            username = datasource.getCurrentUser();

        console.log("Lock", query.id);
        datasource.lock(query.id, username, query.sessionId)
            .then(function () {
                res.json();
            })
            .catch(error.bind(res));
    }

    function doUnlock(req, res) {
        var criteria,
            query = qs.parse(req.params.query),
            username = datasource.getCurrentUser();

        criteria = {
            id: query.id,
            username: username
        };

        console.log("Unlock", query.id);
        datasource.unlock(criteria)
            .then(function (resp) {
                res.json(resp);
            })
            .catch(error.bind(res));
    }

    // ..........................................................
    // ROUTES
    //

    init(function () {
        // configure app to use bodyParser()
        // this will let us get the data from a POST
        app.use(bodyParser.urlencoded({
            extended: true
        }));
        app.use(bodyParser.json());

        // static pages
        app.use(express.static(__dirname));

        // middleware to use for all requests
        dataRouter.use(function (...args) {
            args[2](); // make sure we go to the 'next' routes and don't stop here
        });

        // Create routes for each catalog object
        registerDataRoutes();

        doRouter.route("/subscribe/:query")
            .post(doSubscribe);
        doRouter.route("/unsubscribe/:query")
            .post(doUnsubscribe);
        doRouter.route("/lock/:query")
            .post(doLock);
        doRouter.route("/unlock/:query")
            .post(doUnlock);
        featherRouter.route("/:name")
            .get(doGetFeather)
            .put(doSaveFeather)
            .delete(doDeleteFeather);
        moduleRouter.route("/")
            .get(doGetModules);
        settingsRouter.route("/:name")
            .get(doGetSettingsRow)
            .put(doSaveSettings);
        settingsDefinitionRouter.route("/")
            .get(doGetSettingsDefinition);
        workbookRouter.route("/")
            .get(doGetWorkbooks);
        workbookRouter.route("/:name")
            .get(doGetWorkbook)
            .put(doSaveWorkbook)
            .delete(doDeleteWorkbook);

        // REGISTER CORE ROUTES -------------------------------
        console.log("Registering core routes");
        app.use('/do', doRouter);
        app.use('/data', dataRouter);
        app.use('/feather', featherRouter);
        app.use('/module', moduleRouter);
        app.use('/modules', moduleRouter);
        app.use('/settings', settingsRouter);
        app.use('/settings-definition', settingsDefinitionRouter);
        app.use('/workbook', workbookRouter);
        app.use('/workbooks', workbookRouter);


        // HANDLE PUSH NOTIFICATION -------------------------------
        // Receiver callback for all events, but sends only to applicable session.
        function receiver(message) {
            var sessionId = message.payload.subscription.sessionid,
                fn = sessions[sessionId];

            //console.log("Received message for session " + sessionId);
            if (fn) {
                //console.log("Sending message for " + sessionId, message);
                fn(message);
            }
        }

        function handleEvents() {
            app.get('/sse', function (ignore, res) {
                var crier = new SSE(res),
                    sessionId = f.createId();

                // Instantiate address for session
                app.get('/sse/' + sessionId, function (ignore, res) {
                    var sessCrier = new SSE(res, {
                        heartbeat: 10
                    });

                    sessions[sessionId] = function (message) {
                        sessCrier.send({
                            message: message.payload
                        });
                    };

                    sessCrier.disconnect(function () {
                        delete sessions[sessionId];
                        datasource.unsubscribe(sessionId, 'session');
                        datasource.unlock({
                            sessionId: sessionId
                        });
                        console.log("Closed session " + sessionId);
                    });

                    console.log('Listening for session ' + sessionId);
                });

                crier.send(sessionId);

                crier.disconnect(function () {
                    console.log("Client startup done.");
                });
            });
        }

        datasource.listen(receiver)
            .then(handleEvents)
            .catch(console.error);

        // REGISTER MODULE CONTROLLERS
        controllers.forEach(function (controller) {
            console.log("Registering module controller:", controller.name);
            eval(controller.script);
        });

        // REGISTER MODULE ROUTES
        routes.forEach(function (route) {
            console.log("Registering module route:", route.name);
            eval(route.script);
        });

        // START THE SERVER
        // ========================================================================
        app.listen(port);
        console.log('Magic happens on port ' + port);
    });
}());