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
/*jslint node, this, devel*/
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
    const {Modules} = require("./services/modules");
    const {Packager} = require("./services/packager");
    const {Routes} = require("./services/routes");
    const {Services} = require("./services/services");
    const {Settings} = require("./services/settings");
    const {Role} = require("./services/role");
    const {Workbooks} = require("./services/workbooks");

    const f = require("../common/core");
    const jsonpatch = require("fast-json-patch");
    const db = new Database();
    const events = new Events();
    const crud = new CRUD();
    const currency = new Currency();
    const exporter = new Exporter();
    const feathers = new Feathers();
    const importer = new Importer();
    const installer = new Installer();
    const modules = new Modules();
    const packager = new Packager();
    const routes = new Routes();
    const services = new Services();
    const settings = new Settings();
    const role = new Role();
    const workbooks = new Workbooks();
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
            events.subscribe(
                obj.client,
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
            events.unsubscribe(
                obj.client,
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

    that.TRIGGER_BEFORE = TRIGGER_BEFORE;
    that.TRIGGER_AFTER = TRIGGER_AFTER;

    /**
      Fetch catalog.

      @returns {Object} promise
    */
    that.getCatalog = function () {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "GET",
                name: "getSettings",
                user: that.getCurrentUser(),
                data: {
                    name: "catalog"
                }
            };

            that.request(payload).then(resolve).catch(reject);
        });
    };

    /**
      Fetch Services.

      @returns {Object} promise
    */
    that.getServices = function () {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "GET",
                name: "getServices",
                user: that.getCurrentUser()
            };

            that.request(payload).then(resolve).catch(reject);
        });
    };

    that.getCurrentUser = function () {
        // TODO: Make this real
        return "postgres";
    };

    /**
      Fetch routes.

      @returns {Object} promise
    */
    that.getRoutes = function () {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "GET",
                name: "getRoutes",
                user: that.getCurrentUser()
            };

            that.request(payload).then(resolve).catch(reject);
        });
    };

    /**
      Initialize listener.

      @returns {Object} promise
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
      Unsubcribe.

      @returns {Object} promise
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
      Lock.

      @param {String} Object id.
      @param {String} User name.
      @param {String} Session id.
      @returns {Object} Promise
    */
    that.lock = function (id, username, sessionid) {
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
                        sessionid
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
      Unlock.

      @param {Object} Criteria for what to unlock.
      @param {String} [criteria.id] Object id.
      @param {String} [criteria.username] User name.
      @param {String} [criteria.sessionId] Session id.
      @returns {Object} Promise
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

      @param {String} Manifest filename.
      @param {String} User name.
      @returns {Object} Promise
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

      @param {String} Module name.
      @param {String} User name.
      @returns {Object} Promise
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

      @param {String} Feather
      @param {Array} Properties (Optional)
      @param {String} Filter
      @param {String} Diretory
      @param {String} Format
      @param {String} Username
      @returns {Object} Promise
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
                        resp.done();
                        resolve(ok);
                    }

                    resp.client.currentUser = username;

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

      @param {String} Feather
      @param {String} Format
      @param {String} Filename
      @param {String} Username
      @returns {Object} Promise
    */
    that.import = function (feather, format, filename, username) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doImport(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        resp.done();
                        resolve(ok);
                    }

                    resp.client.currentUser = username;

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


    // Add old/new record objects for convenience
    function doPrepareTrigger(client, obj) {
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
                    getOld(client, obj).then(setRecs).catch(reject);
                    break;
                case "DELETE":
                    getOld(client, obj).then(setRec).catch(reject);
                    break;
                default:
                    throw "Unknown trigger method " + obj.method;
                }

                return;
            }

            resolve();
        });
    }

    /**
      Request.

      Example payload:
          {
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

      @param {Object} Payload
      @param {String} [payload.name] Name of feather or function
      @param {String} [payload.method] Method to perform: "GET", "POST",
        "PUT", "PATCH" or "DELETE"
      @param {String} [payload.id] Identifier for "GET", "PATCH" ond "DELETE"
      @param {String} [payload.data] Data for "POST" and "PATCH" or functions
      @param {Object} [payload.client] Database client. If undefined one will
        be intialized by default and wrapped in a transaction if necessary.
      @param {String} [payload.callback] Callback
      @param {Boolean} Bypass authorization checks. Default = false.
      @param {Boolean} Ignore registration and treat as data. Default = false.
      @return receiver
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
                ? obj.client.isTriggering
                : false
            );

            // Cache original request that may get changed by triggers
            if (obj.data) {
                obj.cache = Object.freeze(f.copy(obj.data));
            }

            function close(resp) {
                return new Promise(function (resolve) {
                    //console.log("CLOSING");
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

                err.statusCode = 500;

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

                    if (client.wrapped) {
                        //console.log("COMMIT->", obj.name, obj.method);
                        client.query("COMMIT;", function (err) {
                            client.wrapped = false;
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

                if (client.wrapped) {
                    client.query("ROLLBACK;", function () {
                        //console.log("ROLLED BACK");
                        client.wrapped = false;
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
                    if (wrap && !client.wrapped && !isTriggering) {
                        client.query(
                            "BEGIN;",
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                //console.log("BEGAN");

                                client.wrapped = true;
                                transaction(obj, false, isSuperUser).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            }
                        );
                        return;
                    }

                    // Passed client must handle its own transaction wrapping
                    transaction(obj, isChild, isSuperUser).then(
                        resolve
                    ).catch(
                        reject
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
                        client.isTriggering = false;
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
                        client.isTriggering = true;

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
                        doPrepareTrigger(client, obj).then(
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
                        client.isTriggering = true;

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
                        doPrepareTrigger(client, obj).then(
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
                                    overlay(newRec[key][n], oldChild);
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
                    client = resp.client;
                    done = resp.done;
                }

                //console.log("REQUEST->", obj.name, obj.method);
                return new Promise(function (resolve, reject) {
                    let msg;

                    if (!client.currentUser && !obj.user) {
                        msg = "User undefined. " + obj.method + " " + obj.name;
                        reject(msg);
                        return;
                    }

                    if (!client.currentUser) {
                        client.currentUser = obj.user;
                    }

                    if (obj.subscription) {
                        obj.subscription.nodeId = db.nodeId;
                    }

                    // If alter data, process it
                    if (catalog[obj.name]) {
                        if (obj.method === "GET") {
                            doQuery().then(resolve).catch(reject);
                        } else if (obj.method === "POST" && obj.id) {
                            doUpsert().then(
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
                db.connect
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
      Register a function that can be called by a method type. Use
      this to expose function calls via `request`. As a rule, all
      functions must accept an object as an argument whose properties
      can be used to calculate the result. The object should be passed
      as `data` on the request.

      The object should include a callback to forward a response on
      completion. The callback should accept an error as the first
      argument and a response as the second.

      The request will automatically append an active client to the object
      to use for executing queries.

        var fn, callback, datasource = require(./datasource);

        // Create a function that updates something specific
        fn = function (obj) {
          var sql = "UPDATE foo SET bar = false WHERE id=$1;",
            params = [obj.id];

          obj.client.query(sql, params, function (err, resp) {
            obj.callback(err, resp.rows);
          })
        }

        // Register the function
        datasource.registerFunction("POST", "myUpdate", fn);

        // Define a callback to use when calling our function
        callback = function (err, resp) {
          if (err) {
            console.error(err);
            return;
          }

          console.log("Query rows->", resp);
        }

        // Execute a request that calls our function and sends a response
        // via the callback
        datasource.request({
          method: "GET",
          name: "myUpdate",
          callback: callback,
          data: {
            id: "HTJ28n"
          }
        });

      @seealso requestFunction
      @param {String} Function name
      @param {String} Method. "GET", "POST", "PUT", "PATCH", or "DELETE"
      @param {Function} Function
      @param {Number} Constant TRIGGER_BEFORE or TRIGGER_AFTER
      @return receiver
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
      @return {Object} Object listing register functions
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
      @return {Object} Internal settings object maintained by service
    */
    that.settings = function () {
        return settings;
    };

    /**
      Helper to expose a registered function to the public API. Use by binding
      the name of the registered function to be called. The function will
      transform the data on a routed requset to the proper format to make a
      `POST` request on the registered function.

        // Expose the example function described on `registerFunction` to a
        // router.
        (function (app, datasource) {
          "strict";

          // Register route to the public
          var express = require("express");
            router = express.Router(),
            func = datasource.postFunction.bind("myUpdate");

          router.route("/my-update").post(func);
          app.use("/my-app", router);

        }(app, datasource));

      @param {Object} Request
      @param {Object} Response
      @seealso registerFunction
      @return receiver
    */
    that.postFunction = function (req, res) {
        let payload;
        let args = req.body;

        function error(err) {
            if (typeof err === "string") {
                err = new Error(err);
            }

            if (!err.statusCode) {
                err.statusCode = 500;
            }

            this.status(err.statusCode).json(err.message);
        }

        function callback(resp) {
            if (resp === undefined) {
                res.statusCode = 204;
            }

            // No caching... ever
            res.setHeader(
                "Cache-Control",
                "no-cache, no-store,must-revalidate"
            ); // HTTP 1.1.
            res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
            res.setHeader("Expires", "0"); //
            res.json(resp);
        }

        payload = {
            method: "POST",
            name: this,
            user: "postgres", //getCurrentUser(),
            data: args
        };

        console.log(JSON.stringify(payload, null, 2));
        that.request(payload).then(callback).catch(error.bind(res));
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
    that.registerFunction("GET", "getModules", modules.getModules);
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
    that.registerFunction("GET", "isAuthorized", feathers.isAuthorized);
    that.registerFunction("POST", "changePassword", role.changePassword);
    that.registerFunction("POST", "createRole", role.createUser);
    that.registerFunction("POST", "subscribe", subscribe);
    that.registerFunction("POST", "unsubscribe", unsubscribe);
    that.registerFunction(
        "PUT",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("PUT", "saveFeather", feathers.saveFeather);
    that.registerFunction("PUT", "saveSettings", settings.saveSettings);
    that.registerFunction("PUT", "saveWorkbook", workbooks.saveWorkbook);
    that.registerFunction("DELETE", "deleteFeather", feathers.deleteFeather);
    that.registerFunction("DELETE", "deleteWorkbook", workbooks.deleteWorkbook);

}(exports));