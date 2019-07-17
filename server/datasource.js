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
/*jslint node, this, devel*/
/**
    @module Datasource
*/
(function (exports) {
    "use strict";

    require("../common/string");
    require("../common/number");
    require("../common/date");

    const {Database} = require("./database");
    const {Events} = require("./services/events");
    const {CRUD} = require("./services/crud");
    const {Currency} = require("./services/currency");
    const {Feathers} = require("./services/feathers");
    const {Importer, Exporter} = require("./services/io");
    const {Installer} = require("./services/installer");
    const {Profile} = require("./services/profile");
    const {Packager} = require("./services/packager");
    const {Routes} = require("./services/routes");
    const {Services} = require("./services/services");
    const {Settings} = require("./services/settings");
    const {Role} = require("./services/role");
    const {Tools} = require("./services/tools");
    const {Workbooks} = require("./services/workbooks");
    const {Config} = require("./config");

    const f = require("../common/core");
    const jsonpatch = require("fast-json-patch");
    const db = new Database();
    const events = new Events();
    const config = new Config();
    const crud = new CRUD();
    const currency = new Currency();
    const exporter = new Exporter();
    const feathers = new Feathers();
    const importer = new Importer();
    const installer = new Installer();
    const packager = new Packager();
    const profile = new Profile();
    const routes = new Routes();
    const services = new Services();
    const settings = new Settings();
    const role = new Role();
    const tools = new Tools();
    const workbooks = new Workbooks();
    /**
        Server datasource class.

        @class Datasource
        @static
    */
    const that = {};

    let registered;

    registered = {
        GET: {},
        POST: {},
        PUT: {},
        PATCH: {},
        DELETE: {}
    };

    const TRIGGER_BEFORE = 1;
    const TRIGGER_AFTER = 2;

    // ..........................................................
    // PRIVATE
    //

    function isRegistered(method, name, trigger) {
        let found = registered[method][name];

        if (trigger && found && found[trigger]) {
            return found[trigger];
        }

        if (trigger === undefined) {
            return found || false;
        }

        return false;
    }

    function subscribe(obj) {
        return new Promise(function (resolve, reject) {
            let client = db.getClient(obj.client);

            events.subscribe(
                client,
                obj.subscription,
                [obj.id]
            ).then(
                resolve.bind(null, true)
            ).catch(
                reject
            );
        });
    }

    function unsubscribe(obj) {
        return new Promise(function (resolve, reject) {
            let client = db.getClient(obj.client);

            events.unsubscribe(
                client,
                obj.subscription.id
            ).then(
                resolve.bind(null, true)
            ).catch(
                reject
            );
        });
    }

    // ..........................................................
    // PUBLIC
    //
    /**
        @property TRIGGER_BEFORE
        @type Integer
        @static
        @final
        @default 1
    */
    that.TRIGGER_BEFORE = TRIGGER_BEFORE;

    /**
        @property TRIGGER_AFTER
        @type Integer
        @static
        @final
        @default 2
    */
    that.TRIGGER_AFTER = TRIGGER_AFTER;

    /**
        Fetch feather catalog.

        @method getCatalog
        @return {Promise}
    */
    that.getCatalog = function () {
        return new Promise(function (resolve, reject) {
            function callback(resp) {
                let payload = {
                    method: "GET",
                    name: "getSettings",
                    user: resp.postgres.user,
                    data: {
                        name: "catalog"
                    }
                };

                that.request(payload).then(resolve).catch(reject);
            }

            config.read().then(callback);
        });
    };

    /**
        Fetch array of all services.

        @method getServices
        @return {Promise}
    */
    that.getServices = function () {
        return new Promise(function (resolve, reject) {
            function callback(resp) {
                let payload = {
                    method: "GET",
                    name: "getServices",
                    user: resp.postgres.user
                };

                that.request(payload).then(resolve).catch(reject);
            }

            config.read().then(callback);
        });
    };

    /**
        Fetch array of all routes.

        @method getRoutes
        @return {Promise}
    */
    that.getRoutes = function () {
        return new Promise(function (resolve, reject) {
            function callback(resp) {
                let payload = {
                    method: "GET",
                    name: "getRoutes",
                    user: resp.postgres.user
                };

                that.request(payload).then(resolve).catch(reject);
            }

            config.read().then(callback);
        });
    };

    /**
        Initialize listener. Message is passed to callback.
        Exposes {{#crossLink "Services.Events/listen:method"}}{{/crossLink}}
        via datasource.

        @method listen
        @param {Function} callback
        @return {Promise}
    */
    that.listen = function (callback) {
        function doListen(resp) {
            return new Promise(function (resolve, reject) {
                events.listen(
                    resp.client,
                    db.nodeId,
                    callback
                ).then(
                    resolve
                ).catch(
                    reject
                );
            });
        }

        return new Promise(function (resolve, reject) {
            Promise.resolve().then(
                db.connect
            ).then(
                doListen
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Unsubcribe from object or by type.
        Exposes
        {{#crossLink "Services.Events/unsubscribe:method"}}{{/crossLink}}
        via datasource.

        @method unsubscribe
        @param {String} id
        @param {String} type
        @return {Promise}
    */
    that.unsubscribe = function (id, type) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doUnsubscribe(resp) {
                return new Promise(function (resolve, reject) {
                    function callback() {
                        resp.done();
                        resolve();
                    }

                    events.unsubscribe(
                        resp.client,
                        id || db.nodeId,
                        type || "node"
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doUnsubscribe
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Lock record. Resolves to `true` if successful.
        Exposes {{#crossLink "Services.CRUD/lock:method"}}{{/crossLink}}
        via datasource.

        @method lock
        @param {String} id Object id
        @param {String} user User name
        @param {String} eventKey Browser instance event key
        @return {Promise}
    */
    that.lock = function (id, username, eventkey) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doLock(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        resp.done();
                        resolve(ok);
                    }

                    crud.lock(
                        resp.client,
                        db.nodeId,
                        id,
                        username,
                        eventkey
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doLock
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Unlock one or more records.
        Exposes {{#crossLink "Services.CRUD/unlock:method"}}{{/crossLink}}
        via datasource.

        @method unlock
        @param {Object} Criteria for what to unlock (at least one)
        @param {String} [criteria.id] Object id
        @param {String} [criteria.username] User name
        @param {String} [criteria.eventKey] Event key
        @return {Promise}
    */
    that.unlock = function (criteria) {
        return new Promise(function (resolve, reject) {
            criteria = criteria || {};
            criteria.nodeId = db.nodeId;

            // Do the work
            function doUnlock(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ids) {
                        resp.done();
                        resolve(ids);
                    }

                    crud.unlock(resp.client, criteria).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doUnlock
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Install a module from a specified manifest file name.
        Exposes {{#crossLink "Services.Installer/install:method"}}{{/crossLink}}
        via datasource.

        @method install
        @param {String} Manifest filename.
        @param {String} User name.
        @return {Object} Promise
    */
    that.install = function (filename, username) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doInstall(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(filename) {
                        resp.done();
                        resolve(filename);
                    }

                    installer.install(
                        that,
                        resp.client,
                        filename,
                        username
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doInstall
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Package a module.
        Exposes {{#crossLink "Services.Packager/package:method"}}{{/crossLink}}
        via datasource.

        @method package
        @param {String} name Module name
        @param {String} username User name
        @return {Promise}
    */
    that.package = function (name, username) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doPackage(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(filename) {
                        resp.done();
                        resolve(filename);
                    }

                    packager.package(
                        resp.client,
                        name,
                        username
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doPackage
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Export data.
        Exposes {{#crossLink "Services.Exporter"}}{{/crossLink}} via datasource.

        @method export
        @param {String} Feather
        @param {Array} [properties]
        @param {Filter} filter
        @param {String} dir Target directory
        @param {String} format `json`, `ods` or `xlsx`
        @param {String} username
        @return {Promise}
    */
    that.export = function (
        feather,
        properties,
        filter,
        dir,
        format,
        username
    ) {
        return new Promise(function (resolve, reject) {
            let formats = ["json", "ods", "xlsx"];

            if (formats.indexOf(format) === -1) {
                throw new Error("Unsupported format " + format);
            }

            // Do the work
            function doExport(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        resp.client.currentUser(undefined);
                        resp.done();
                        resolve(ok);
                    }

                    resp.client.currentUser(username);

                    exporter[format](
                        resp.client,
                        feather,
                        properties,
                        filter,
                        dir
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doExport
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Import data.
        Exposes {{#crossLink "Services.Importer"}}{{/crossLink}} via
        datasource.

        @method import
        @param {String} feather
        @param {String} format `json`, `ods` or `xlsx`
        @param {String} filename
        @param {String} username
        @return {Promise}
    */
    that.import = function (feather, format, filename, username) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doImport(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        resp.client.currentUser(undefined);
                        resp.done();
                        resolve(ok);
                    }

                    resp.client.currentUser(username);

                    importer[format](
                        that,
                        resp.client,
                        feather,
                        filename
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect
            ).then(
                doImport
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Check user and password.
        Exposes {{#crossLink "Database/authenticate:method"}}{{/crossLink}}
        via datasource.

        @method authenticate
        @param {String} Username
        @param {String} Password
        @return {Object} Promise
    */
    that.authenticate = db.authenticate;

    /**
        Resolves to {{#crossLink "User"}}{{/crossLink}} for passport
        management. Exposes
        {{#crossLink "Database/deserializeUser:method"}}{{/crossLink}}
        via datasource.

        @method deserializeUser
        @param {String} Username
        @return {Promise}
    */
    that.deserializeUser = db.deserializeUser;

    /**
        Return a configured postgres pool. Exposes
        {{#crossLink "Database/getPool:method"}}{{/crossLink}}
        via datasource.

        @method getPool
        @return {Object} Promise
    */
    that.getPool = db.getPool;

    function getOld(client, obj) {
        return new Promise(function (resolve, reject) {
            that.request({
                method: "GET",
                name: obj.name,
                id: obj.id,
                client: client
            }, true).then(resolve).catch(reject);
        });
    }

    /**
        Service request.

        @example
            // Example payload:
            let payload = {
                "name": "Contact",
                "method": "POST",
                "data": {
                    "id": "1f8c8akkptfe",
                    "created": "2015-04-26T12:57:57.896Z",
                    "createdBy": "admin",
                    "updated": "2015-04-26T12:57:57.896Z",
                    "updatedBy": "admin",
                    "fullName": "John Doe",
                    "birthDate": "1970-01-01T00:00:00.000Z",
                    "isMarried": true,
                    "dependentes": 2
                }
            }

        @method request
        @param {Object} Payload
        @param {String} payload.name Name of feather or registered function
        @param {String} payload.method Method to perform: `GET`, `POST`,
        `PUT`, `PATCH` or `DELETE`
        @param {String} [payload.id] Identifier for `GET`, `PATCH` and `DELETE`
        @param {String} [payload.data] Required for `POST` and `PATCH`
        calls
        @param {Client} [payload.client] Database client. If undefined one
        will be intialized by default and wrapped in a transaction if necessary.
        @param {Boolean} [isSuperUser] Bypass authorization checks.
        Default false.
        @return {Promise}
    */
    that.request = function (obj, isSuperUser) {
        return new Promise(function (resolve, reject) {
            isSuperUser = (
                isSuperUser === undefined
                ? false
                : isSuperUser
            );

            let client;
            let done;
            let transaction;
            let isChild;
            let catalog = (
                settings.data.catalog
                ? settings.data.catalog.data
                : {}
            );
            let isExternalClient = false;
            let wrap = false;
            let isTriggering = (
                obj.client
                ? obj.client.isTriggering()
                : false
            );

            // Cache original request that may get changed by triggers
            if (obj.data) {
                obj.cache = Object.freeze(f.copy(obj.data));
            }

            function begin() {
                return new Promise(function (resolve, reject) {
                    if (!client.wrapped()) {
                        db.getClient(client).query("BEGIN;").then(function () {
                            client.wrapped(true);
                            resolve();
                        }).catch(reject);
                        return;
                    }
                    resolve();
                });
            }

            // Add old/new record objects for convenience
            function doPrepareTrigger(obj) {
                return new Promise(function (resolve, reject) {
                    function setRec(result) {
                        obj.oldRec = result;
                        resolve();
                    }

                    function setRecs(result) {
                        obj.oldRec = result;
                        obj.newRec = f.copy(result);
                        jsonpatch.applyPatch(obj.newRec, obj.data);
                        resolve();
                    }

                    if (!obj.newRec && !obj.oldRec) {
                        switch (obj.method) {
                        case "POST":
                            obj.newRec = f.copy(obj.data);
                            resolve();
                            break;
                        case "PATCH":
                            obj.newRec = f.copy(obj.data);
                            begin().then(
                                getOld.bind(null, client, obj)
                            ).then(setRecs).catch(reject);
                            break;
                        case "DELETE":
                            begin().then(
                                getOld.bind(null, client, obj)
                            ).then(setRec).catch(reject);
                            break;
                        default:
                            throw "Unknown trigger method " + obj.method;
                        }

                        return;
                    }

                    client.isTriggering(true);

                    resolve();
                });
            }

            function close(resp) {
                return new Promise(function (resolve) {
                    //console.log("CLOSING");
                    client.currentUser(undefined);
                    done();
                    resolve(resp);
                });
            }

            function error(err) {
                //console.log("ERROR->", obj.name, obj.method);
                // Passed client will handle it's own connection
                console.error(err);
                if (typeof err === "string") {
                    err = new Error(err);
                }

                if (!err.statusCode) {
                    err.statusCode = 500;
                }

                if (!isExternalClient) {
                    done();
                }

                return err;
            }

            function commit(resp) {
                return new Promise(function (resolve, reject) {
                    // Forget about committing if recursive
                    if (isTriggering || isExternalClient) {
                        resolve(resp);
                        return;
                    }

                    if (client.wrapped()) {
                        //console.log("COMMIT->", obj.name, obj.method);
                        db.getClient(client).query("COMMIT;", function (err) {
                            client.currentUser(undefined);
                            client.wrapped(false);
                            if (err) {
                                reject(error(err));
                                return;
                            }

                            //console.log("COMMITED");
                            resolve(resp);
                        });
                        return;
                    }

                    resolve(resp);
                });
            }

            function rollback(err, callback) {
                // If external, let caller deal with transaction
                if (isExternalClient) {
                    callback(error(err));
                    return;
                }

                //console.log("ROLLBACK->", obj.name, obj.method);

                if (client.wrapped()) {
                    db.getClient(client).query("ROLLBACK;", function () {
                        //console.log("ROLLED BACK");
                        client.currentUser(undefined);
                        client.wrapped(false);
                        callback(error(err));
                        return;
                    });
                    return;
                }

                callback(err);

                return;
            }

            function doExecute() {
                // console.log("EXECUTE->", obj.name, obj.method);
                return new Promise(function (resolve, reject) {
                    if (wrap && !isTriggering) {
                        begin().then(function () {
                            transaction(obj, false, isSuperUser).then(
                                resolve
                            ).catch(
                                reject
                            );
                        }).catch(reject);
                        return;
                    }

                    // Passed client must handle its own transaction wrapping
                    transaction(obj, isChild, isSuperUser).then(
                        resolve
                    ).catch(
                        function (err) {
                            reject(err);
                        }
                    );
                });
            }

            function doMethod(name, trigger) {
                // console.log("METHOD->", obj.name, obj.method, name);
                return new Promise(function (resolve, reject) {
                    wrap = !obj.client && obj.method !== "GET";
                    obj.data = obj.data || {};
                    obj.data.id = obj.data.id || obj.id;
                    obj.client = client;
                    transaction = (
                        trigger
                        ? registered[obj.method][name][trigger]
                        : registered[obj.method][name]
                    );

                    Promise.resolve().then(
                        doExecute
                    ).then(
                        resolve
                    ).catch(
                        reject
                    );
                });
            }

            function clearTriggerStatus() {
                // console.log("CLEAR_TRIGGER->", obj.name, obj.method);
                return new Promise(function (resolve) {
                    if (!isTriggering) {
                        client.isTriggering(false);
                    }

                    resolve();
                });
            }

            function doTraverseAfter(name) {
                // console.log("TRAVERSE_AFTER->", obj.name, obj.method, name);
                return new Promise(function (resolve, reject) {
                    let feather = settings.data.catalog.data[name];
                    let parent = feather.inherits || "Object";

                    function doTrigger() {
                        if (name === "Object") {
                            Promise.resolve().then(
                                doMethod.bind(null, name, TRIGGER_AFTER)
                            ).then(
                                clearTriggerStatus
                            ).then(
                                commit
                            ).then(
                                resolve
                            ).catch(
                                reject
                            );
                            return;
                        }

                        Promise.resolve().then(
                            doMethod.bind(null, name, TRIGGER_AFTER)
                        ).then(
                            clearTriggerStatus
                        ).then(
                            doTraverseAfter.bind(null, parent)
                        ).then(
                            resolve
                        ).catch(
                            reject
                        );
                    }

                    // If business logic defined, do it
                    if (isRegistered(obj.method, name, TRIGGER_AFTER)) {
                        doPrepareTrigger(obj).then(
                            doTrigger
                        ).catch(
                            reject
                        );

                    // If traversal done, finish transaction
                    } else if (name === "Object") {
                        commit(obj.response).then(resolve).catch(reject);

                        // If no logic, but parent, traverse up the tree
                    } else {
                        doTraverseAfter(parent).then(resolve).catch(reject);
                    }
                });
            }

            function doQuery() {
                // console.log("QUERY->", obj.name, obj.method);
                return new Promise(function (resolve, reject) {
                    obj.client = client;
                    isChild = false;

                    switch (obj.method) {
                    case "GET":
                        crud.doSelect(obj, false, isSuperUser).then(
                            resolve
                        ).catch(
                            reject
                        );
                        return;
                    case "POST":
                        transaction = crud.doInsert;
                        break;
                    case "PATCH":
                        transaction = crud.doUpdate;
                        break;
                    case "DELETE":
                        transaction = crud.doDelete;
                        break;
                    default:
                        reject(error("method \"" + obj.method + "\" unknown"));
                        return;
                    }

                    doExecute().then(
                        function (resp) {
                            obj.response = resp;
                            doTraverseAfter(obj.name).then(
                                resolve
                            ).catch(
                                reject
                            );
                        }
                    ).catch(
                        reject
                    );
                });
            }

            function doTraverseBefore(name) {
                // console.log("TRAVERSE_BEFORE->", obj.name, obj.method, name);
                return new Promise(function (resolve, reject) {
                    let feather = settings.data.catalog.data[name];
                    let parent = feather.inherits || "Object";

                    function doTrigger() {
                        if (name === "Object") {
                            Promise.resolve().then(
                                doMethod.bind(null, name, TRIGGER_BEFORE)
                            ).then(
                                clearTriggerStatus
                            ).then(
                                doQuery
                            ).then(
                                resolve
                            ).catch(
                                reject
                            );
                            return;
                        }

                        Promise.resolve().then(
                            doMethod.bind(null, name, TRIGGER_BEFORE)
                        ).then(
                            clearTriggerStatus
                        ).then(
                            doTraverseBefore.bind(null, parent)
                        ).then(
                            resolve
                        ).catch(
                            reject
                        );
                    }

                    // If business logic defined, do it
                    if (isRegistered(obj.method, name, TRIGGER_BEFORE)) {
                        doPrepareTrigger(obj).then(
                            doTrigger
                        ).catch(
                            reject
                        );

                    // Traversal done
                    } else if (name === "Object") {
                        // Accept any changes made by triggers
                        if (obj.newRec) {
                            switch (obj.method) {
                            case "POST":
                                obj.data = obj.newRec;
                                break;
                            case "PATCH":
                                obj.data = jsonpatch.compare(
                                    obj.oldRec,
                                    obj.newRec
                                );
                                break;
                            }
                        }

                        doQuery().then(resolve).catch(reject);

                        // If no logic, but parent, traverse up the tree
                    } else {
                        doTraverseBefore(parent).then(resolve).catch(reject);
                    }
                });
            }

            // Determine with POST with id is insert or update
            function doUpsert() {
                return new Promise(function (resolve, reject) {
                    let payload = {
                        id: obj.id,
                        name: obj.name,
                        client: obj.client
                    };

                    // Apply properties of a new record over the top of an
                    // existing record assuming not all feather properties
                    // may be present. This is so jsonpatch doesn't remove
                    // properties not specified
                    function overlay(newRec, oldRec) {
                        let n;

                        oldRec = f.copy(oldRec);

                        Object.keys(oldRec).forEach(function (key) {
                            if (Array.isArray(oldRec[key])) {
                                if (
                                    newRec[key] === undefined ||
                                    newRec[key] === null
                                ) {
                                    newRec[key] = oldRec[key];
                                    return;
                                }

                                if (!Array.isArray(newRec[key])) {
                                    throw new Error(
                                        "Array expected for property \"" + key +
                                        "\" on " + oldRec.objectType +
                                        " record with id " +
                                        oldRec.id
                                    );
                                }

                                // We want old array rows deleted if they
                                // no longer exist in the new record
                                if (oldRec.length > newRec.length) {
                                    oldRec.length = newRec.length;
                                }

                                // Update children in array
                                n = 0;
                                oldRec[key].forEach(function (oldChild) {
                                    if (newRec[key][n] !== undefined) {
                                        overlay(newRec[key][n], oldChild);
                                    } else {
                                        newRec[key][n] = null;
                                    }
                                    n += 1;
                                });
                            } else if (newRec[key] === undefined) {
                                newRec[key] = oldRec[key];
                            }
                        });
                    }

                    function callback(resp) {
                        if (resp) {
                            overlay(obj.data, resp);
                            obj.method = "PATCH";
                            obj.data = jsonpatch.compare(
                                resp,
                                obj.data
                            );
                        } else {
                            obj.data.id = obj.id;
                        }

                        resolve();
                    }

                    crud.doSelect(payload, false, isSuperUser).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            function doRequest(resp) {
                if (!isExternalClient) {
                    // Disallow SQL calls directly from db services by
                    // making client simply a reference object.
                    client = resp.client;
                    done = resp.done;
                }

                //console.log("REQUEST->", obj.name, obj.method);
                return new Promise(function (resolve, reject) {
                    let msg;

                    if (!client.currentUser() && !obj.user) {
                        msg = "User undefined. " + obj.method + " " + obj.name;
                        reject(msg);
                        return;
                    }

                    if (!client.currentUser()) {
                        client.currentUser(obj.user);
                    }

                    if (obj.subscription) {
                        obj.subscription.nodeId = db.nodeId;
                    }

                    // If alter data, process it
                    if (catalog[obj.name]) {
                        if (obj.method === "GET") {
                            doQuery().then(function (resp) {
                                if (!client.wrapped()) {
                                    client.currentUser(undefined);
                                }
                                resolve(resp);
                            }).catch(reject);
                        } else if (obj.method === "POST" && obj.id) {
                            begin().then(
                                doUpsert
                            ).then(
                                doTraverseBefore.bind(null, obj.name)
                            ).then(
                                resolve
                            ).catch(
                                function (err) {
                                    rollback(err, reject);
                                }
                            );
                        } else {
                            if (!isExternalClient) {
                                wrap = true;
                            }

                            doTraverseBefore(obj.name).then(
                                resolve
                            ).catch(
                                function (err) {
                                    rollback(err, reject);
                                }
                            );
                        }

                    // If function, execute it
                    } else if (isRegistered(obj.method, obj.name)) {
                        Promise.resolve().then(
                            doMethod.bind(null, obj.name)
                        ).then(
                            commit
                        ).then(
                            resolve
                        ).catch(
                            function (err) {
                                rollback(err, reject);
                            }
                        );

                    // Young fool, now you will die.
                    } else {
                        msg = "Function " + obj.method + " ";
                        msg += obj.name + " is not registered.";
                        throw new Error(msg);
                    }
                });
            }

            if (obj.client) {
                isExternalClient = true;
                client = obj.client;
                Promise.resolve().then(
                    doRequest
                ).then(
                    resolve
                ).catch(
                    reject
                );
                return;
            }

            Promise.resolve().then(
                db.connect.bind(null, true)
            ).then(
                doRequest
            ).then(
                close
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    };

    /**
        Register a function that can be called as a service by a
        {{#crossLink "Datasource/request:method"}}{{/crossLink}}
        so that data services can be made available to other data services
        added via data service scripts. As a rule, all
        functions must accept one {{#crossLink "Object"}}{{/crossLink}}
        as an argument whose properties can be used as arguments within the
        target function. The
        {{#crossLink "Datasource/request:method"}}{{/crossLink}} will
        automatically append its
        {{#crossLink "Client"}}{{/crossLink}} 
        to the object argument to use
        for executing queries or other requests within the target function.

        The function should return a {{#crossLink "Promise"}}{{/crossLink}}
        that resolves to the result of the function, if any.

        Function names should be camel case which distinquishes them from
        {{#crossLinkModule "CRUD"}}{{/crossLinkModule}} requests
        where a capitalized feather name is used.
        
        The following is list of functions that come pre-registered from hard
        coded services:
        * __GET__
          * {{#crossLink "Services.Currency/baseCurrency:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Currency/convertCurrency:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Tools/getAuthorizations:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Feathers/getFeather:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Profile/getProfile:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Routes/getRoutes:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Services/getServices:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Settings/getSettings:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Settings/getSettingsRow:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Settings/getSettingsDefinition:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Workbooks/getWorkbook:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Workbooks/getWorkbooks:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Feathers/isAuthorized:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Tools/isSuperUser:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Workbooks/workbookIsAuthorized:method"}}
          {{/crossLink}}
        * __PUT__
          * {{#crossLink "Services.Feathers/saveAuthorization:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Feathers/saveFeather:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Profile/saveProfile:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Settings/saveSettings:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Workbooks/saveWorkbook:method"}}
          {{/crossLink}}
        * __POST__
          * {{#crossLink "Services.Role/changeRoleLogin:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/changeRolePassword:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/createRole:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/dropRole:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/grantMembership:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/revokeMembership:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Feathers/saveAuthorization:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Events/subscribe:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Events/unsubscribe:method"}}
          {{/crossLink}}
        * __PATCH__
          * {{#crossLink "Services.Profile/patchProfile:method"}}
          {{/crossLink}}
        * __DELETE__
          * {{#crossLink "Services.Feathers/deleteFeather:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Installer/deleteModule:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Workbooks/deleteWorkbook:method"}}
          {{/crossLink}}

        @example
            // Create a function that updates something specific
            // (Assumed to be executed within a data service script)
            function fn (obj) { // Note the single object argument
                return new Promise(function (resolve, reject) {
                    function callback() {
                        resolve(true); // Success results in boolean
                    }

                    // "f" is the global variable available in scripts
                    f.datasource.request({
                        method: "PATCH",
                        name: "Foo", // Capitalized name indicates CRUD request
                        client: obj.client, // Client is automatically included
                        id: obj.id, // Id is unique argument for this function
                        data: [{
                            op: "replace",
                            path: "/status",
                            value: "Closed"
                        }]
                    }).then(callback).catch(reject);
                });
            }

            // Register the function
            f.datasource.registerFunction("POST", "closeFoo", fn);

            // Define a callback to use when calling our function
            function callback (resp) {
                console.log("Query rows->", resp);
            }

            // Trap for errors
            function error (err) {
                console.error(err);
            }

            // Execute a request that calls our function and sends a response
            // via the callback
            datasource.request({
                method: "POST",
                name: "closeFoo",
                data: {
                    id: "HTJ28n"
                }
            }).then(callback).catch(error);

        @method registerFunction
        @param {String} method `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`
        @param {String} name
        @param {Function} callback
        @param {Integer} [trigger]
        @return {Object} Receiver
        @chainable
    */
    that.registerFunction = function (method, name, func, trigger) {
        if (trigger) {
            if (!registered[method][name]) {
                registered[method][name] = {};
            }
            registered[method][name][trigger] = func;
        } else {
            registered[method][name] = func;
        }
        return that;
    };

    /**
        @method registeredFunctions
        @return {Object} Object listing registered functions
    */
    that.registeredFunctions = function () {
        let keys = Object.keys(registered);
        let result = {};

        keys.forEach(function (key) {
            result[key] = Object.keys(registered[key]);
        });

        return result;
    };

    /**
        @method settings
        @return {Settings} Internal settings object maintained by service
    */
    that.settings = function () {
        return settings;
    };

    // Set properties on exports
    Object.keys(that).forEach(function (key) {
        exports[key] = that[key];
    });

    // Register certain functions
    that.registerFunction("GET", "baseCurrency", currency.baseCurrency);
    that.registerFunction("GET", "convertCurrency", currency.convertCurrency);
    that.registerFunction("GET", "getServices", services.getServices);
    that.registerFunction("GET", "getFeather", feathers.getFeather);
    that.registerFunction("GET", "getProfile", profile.getProfile);
    that.registerFunction("GET", "getRoutes", routes.getRoutes);
    that.registerFunction("GET", "getSettings", settings.getSettings);
    that.registerFunction("GET", "getSettingsRow", settings.getSettingsRow);
    that.registerFunction(
        "GET",
        "getSettingsDefinition",
        settings.getSettingsDefinition
    );
    that.registerFunction("GET", "getWorkbook", workbooks.getWorkbook);
    that.registerFunction("GET", "getWorkbooks", workbooks.getWorkbooks);
    that.registerFunction(
        "GET",
        "workbookIsAuthorized",
        workbooks.workbookIsAuthorized
    );
    that.registerFunction("GET", "isAuthorized", feathers.isAuthorized);
    that.registerFunction("GET", "isSuperUser", tools.isSuperUser);
    that.registerFunction("GET", "getAuthorizations", tools.getAuthorizations);
    that.registerFunction("PATCH", "patchProfile", profile.patchProfile);
    that.registerFunction("POST", "changeRoleLogin", role.changeRoleLogin);
    that.registerFunction("POST", "changeRolePassword", role.changeRolePassword);
    that.registerFunction("POST", "createRole", role.createRole);
    that.registerFunction("POST", "dropRole", role.dropRole);
    that.registerFunction("POST", "grantMembership", role.grantMembership);
    that.registerFunction("POST", "revokeMembership", role.revokeMembership);
    that.registerFunction(
        "POST",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("POST", "subscribe", subscribe);
    that.registerFunction("POST", "unsubscribe", unsubscribe);
    that.registerFunction(
        "PUT",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("PUT", "saveFeather", feathers.saveFeather);
    that.registerFunction("PUT", "saveProfile", profile.saveProfile);
    that.registerFunction("PUT", "saveSettings", settings.saveSettings);
    that.registerFunction("PUT", "saveWorkbook", workbooks.saveWorkbook);
    that.registerFunction("DELETE", "deleteFeather", feathers.deleteFeather);
    that.registerFunction("DELETE", "deleteModule", installer.deleteModule);
    that.registerFunction("DELETE", "deleteWorkbook", workbooks.deleteWorkbook);

}(exports));