/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

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
/*jslint node, this, eval, unordered*/
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
    const {PDF} = require("./services/pdf");
    const {Mail} = require("./services/mailer");

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
    const pdf = new PDF();
    const mail = new Mail();
    const tenants = [];

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
            let client = obj.client;

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
            let client = obj.client;

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

    /**
        Return Process object.

        @method Process
        @param {Object} options
        @param {String} options.name Process name
        @param {Object} options.client
        @param {Integer} [count] Count of items to process. Default 100
        @param {Object} [subscription] Pass for client progress notification
        @param {string} [subscription.id] id Subscription id
        @param {string} [subscription.eventKey] eventKey Subscription event key
        @return {Object}
    */
    function createProcess(obj) {
        if (!obj.name) {
            throw "Name is required";
        }
        if (!obj.client) {
            throw "Client is required";
        }

        let pgProcessId = obj.client.processID;
        let pUser = obj.client.currentUser();
        let pId = f.createId();
        let subscr = obj.subscription;
        let datasource = this;
        let p = {
            id: pId,
            name: obj.name,
            user: obj.user
        };
        let maxPct = 100;
        let cnt;
        let incr;
        let pct;
        let last;

        obj.client.onRollback(async function (err) {
            let msg = (
                typeof err === "string"
                ? err
                : err.message
            );

            if (msg !== "canceling statement due to user request") {
                await f.datasource.request({
                    method: "PATCH",
                    name: "ServerProcess",
                    user: pUser,
                    id: pId,
                    data: [{
                        op: "replace",
                        path: "/status",
                        value: "E"
                    }, {
                        op: "replace",
                        path: "/errorMessage",
                        value: msg
                    }],
                    tenant: obj.client.tenant()
                }, true);
            }
        });

        p.start = async function () {
            await f.datasource.request({
                method: "POST",
                name: "ServerProcess",
                user: pUser, // Outside transaction
                data: {
                    id: pId,
                    name: obj.name,
                    processId: pgProcessId
                },
                tenant: obj.client.tenant()
            }, true);

            if (subscr) {
                await datasource.request({
                    method: "POST",
                    name: "subscribe",
                    id: pId,
                    subscription: subscr,
                    tenant: obj.client.tenant(),
                    user: pUser // Outside transaction
                });
            }
        };
        p.next = async function () {
            let resp;
            let sql1 = (
                "UPDATE server_process SET " +
                "  percent_complete = $1 " +
                "WHERE id = $2;"
            );
            pct = Math.floor(last.plus(incr));

            if (pct > last) {
                pct = Math.min(pct, maxPct);
                resp = await db.connect(obj.client.tenant());
                await resp.client.query(sql1, [pct, pId]);
                resp.done();
            }
            last = last.plus(incr);
        };
        p.complete = async function () {
            let resp = await db.connect(obj.client.tenant());
            let sql1 = (
                "UPDATE server_process SET " +
                "  percent_complete = 100, " +
                "  status = 'C', " +
                "  completed = CURRENT_DATE, " +
                "  updated = NOW() " +
                "WHERE id = $1;"
            );
            await resp.client.query(sql1, [pId]);
            resp.done();

            if (subscr) {
                await datasource.request({
                    method: "POST",
                    name: "unsubscribe",
                    subscription: subscr,
                    tenant: obj.client.tenant(),
                    user: pUser // Outside transaction
                });
            }
        };
        p.reset = function (count) {
            cnt = count || 100;
            incr = maxPct.div(cnt);
            pct = incr;
            last = 0;
        };
        p.reset(obj.count);
        return Object.freeze(p);
    }

    /**
        ...

        @method stopProcess
        @param {Object} options
        @param {String} options.processId Server process ID
        @return {Promise}
    */
    async function stopProcess(obj) {
        let resp = await db.connect(obj.tenant);
        let processId = obj.data.id;
        let sql1 = "SELECT process_id FROM server_process WHERE id=$1;";
        let sql2 = "SELECT pg_cancel_backend($1);";
        let sql3 = (
            "UPDATE server_process SET " +
            "  status = 'S', " +
            "  completed = now(), " +
            "  error_message = 'Stopped by user cancellation'" +
            "WHERE id = $1;"
        );
        let sql4 = "DELETE FROM \"$subscription\" WHERE objectid=$1;";
        let ret = await resp.client.query(sql1, [processId]);

        if (ret.rows.length) {
            await resp.client.query(sql2, [ret.rows[0].process_id]);
            await resp.client.query(sql3, [processId]);
            await resp.client.query(sql4, [processId]);
        }
        resp.done();
    }

    // ..........................................................
    // PUBLIC
    //
    that.createProcess = createProcess.bind(that);

    // For interrupted process cleanup after server restart
    that.cleanupProcesses = async function () {
        let resp;
        let sql1 = (
            "UPDATE server_process SET " +
            "  status = 'S', " +
            "  completed = now(), " +
            "  error_message = 'Stopped by server restart'" +
            "WHERE status = 'P';"
        );
        let tenant;
        let n = 0;
        while (n < tenants.length) {
            tenant = tenants[0];
            n += 1;
            resp = await db.connect(tenant);
            await resp.client.query(sql1);
            resp.done();
        }
    };

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
        Update user's own info.
        @method changeUserInfo
        @param {Object} payload
        @param {String} payload.name Role name
        @param {String} payload.firstName
        @param {String} payload.lastName
        @param {String} payload.email
        @param {String} payload.phone
        @param {Object} [tenant]
        @return {Promise}
    */
    that.changeUserInfo = function (obj, pTenant) {
        let conn;

        function begin(resp) {
            return new Promise(function (resolve) {
                let client = resp.client;

                conn = resp;
                client.query("BEGIN;").then(resolve);
            });
        }

        function commit() {
            return new Promise(function (resolve) {
                let client = conn.client;
                client.query("COMMIT;").then(resolve);
                conn.done();
            });
        }

        function rollback() {
            return new Promise(function (resolve) {
                let client = conn.client;
                client.query("ROLLBACK;").then(resolve);
                conn.done();
                resolve();
            });
        }

        function doUpdate() {
            return new Promise(function (resolve, reject) {
                that.request({
                    method: "GET",
                    name: "UserAccount",
                    user: obj.name,
                    client: conn.client,
                    filter: {
                        criteria: [{
                            property: "name",
                            value: obj.name
                        }]
                    }
                }, true).then(function (resp) {
                    let userAccount = resp[0];
                    let contactId = f.createId();

                    if (!userAccount) {
                        throw new Error(
                            "User " + obj.name + " not found."
                        );
                    }

                    if (userAccount.contact === null) {
                        // Create contact and link to user account
                        that.request({
                            method: "POST",
                            name: "Contact",
                            user: obj.name,
                            client: conn.client,
                            data: {
                                id: contactId,
                                firstName: obj.firstName,
                                lastName: obj.lastName,
                                phone: obj.phone,
                                email: obj.email
                            }
                        }, true).then(function () {
                            that.request({
                                method: "POST",
                                name: "UserAccount",
                                id: userAccount.id,
                                user: obj.name,
                                client: conn.client,
                                data: {
                                    contact: {
                                        id: contactId
                                    }
                                }
                            }, true).then(resolve).catch(reject);
                        }).catch(reject);
                    } else {
                        // Update existing contact
                        that.request({
                            method: "POST",
                            name: "Contact",
                            id: userAccount.contact.id,
                            user: obj.name,
                            client: conn.client,
                            data: {
                                firstName: obj.firstName,
                                lastName: obj.lastName,
                                phone: obj.phone,
                                email: obj.email
                            }
                        }, true).then(resolve).catch(reject);
                    }
                }).catch(reject);
            });
        }

        return new Promise(function (resolve) {
            Promise.resolve().then(
                db.connect.bind(null, pTenant)
            ).then(
                begin
            ).then(
                doUpdate
            ).then(
                commit
            ).then(
                resolve
            ).catch(
                rollback
            );
        });
    };

    /**
        Read configuration settings.

        @method config
        @return {Promise}
    */
    that.config = config.read;

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
                    user: resp.pgUser,
                    data: {
                        name: "catalog",
                        force: true
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
                    user: resp.pgUser
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
                    user: resp.pgUser
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
        @param {Object} [tenant]
        @return {Promise}
    */
    that.listen = function (callback, tenant) {
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
                db.connect.bind(null, tenant)
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

        If tenant not provided, all tenants unsubscribe

        @method unsubscribe
        @param {String} id
        @param {String} type
        @paranm {Object} [tenant] All tenants if not specified
        @return {Promise}
    */
    that.unsubscribe = async function (id, type, tenant) {
        let pTenants;
        if (tenant) {
            pTenants = [tenant];
        } else {
            pTenants = tenants;
        }
        let t;
        let n = 0;
        let resp;

        while (n < pTenants.length) {
            t = pTenants[0];
            n += 1;
            resp = await db.connect(t);
            await events.unsubscribe(
                resp.client,
                id || db.nodeId,
                type || "node"
            );
            resp.done();
        }
    };

    /**
        Lock record. Resolves to `true` if successful.
        Exposes {{#crossLink "Services.CRUD/lock:method"}}{{/crossLink}}
        via datasource.

        @method lock
        @param {String} id Object id
        @param {String} user User name
        @param {String} eventKey Browser instance event key
        @param {String} [process] Description of lock reason
        @param {Object} [client] Client connection
        @param {Object} [tenant] Tenant if no client specified
        @return {Promise}
    */
    that.lock = function (id, username, eventkey, pProcess, client, tenant) {
        return new Promise(function (resolve, reject) {
            if (client === undefined) {
                reject(
                    "No parameter passed for the client argument " +
                    "on lock attempt. Either a database client or " +
                    "`false` must be passed"
                );
                return;
            }
            let theClient;
            // Do the work
            function doLock(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        if (resp.done) {
                            resp.done();
                        }
                        resolve(ok);
                    }

                    crud.lock(
                        resp.client,
                        db.nodeId,
                        id,
                        username,
                        eventkey,
                        pProcess
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            if (client) {
                theClient = client;
                doLock({client: theClient}).then(resolve).catch(reject);
                return;
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
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
        @param {Object} [client] Client connection
        @param {Object} [tenant] Tenant if not client specified
        @return {Promise}
    */
    that.unlock = function (criteria, client, tenant) {
        return new Promise(function (resolve, reject) {
            let theClient;
            criteria = criteria || {};
            criteria.nodeId = db.nodeId;

            // Do the work
            function doUnlock(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ids) {
                        if (resp.done) {
                            resp.done();
                        }
                        resolve(ids);
                    }

                    crud.unlock(resp.client, criteria).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            if (client) {
                theClient = client;
                doUnlock({client: theClient}).then(resolve).catch(reject);
                return;
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
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
        @param {Object} [subscription] Subscription object for progress tracking
        @param {Object} [tenant] Tenant
        @return {Object} Promise
    */
    that.install = function (filename, username, subscription, tenant) {
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
                        username,
                        false,
                        subscription
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
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
        @param {Object} [tenant] Tenant
        @return {Promise}
    */
    that.package = function (name, username, tenant) {
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
                db.connect.bind(null, tenant)
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
        @param {Object} [subscription] For progress tracking
        @param {Object} [tenant] Tenant
        @return {Promise}
    */
    that.export = function (
        feather,
        properties,
        filter,
        dir,
        format,
        username,
        subscription,
        tenant
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
                        dir,
                        subscription
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
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
        @param {Object} [subscription] For progress tracking
        @param {Object} [tenant] Tenant
        @return {Promise}
    */
    that.import = function (
        feather,
        format,
        filename,
        username,
        subscription,
        tenant
    ) {
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
                        filename,
                        subscription
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
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
        Generate PDF form.
        Exposes {{#crossLink "Services.PDF"}}{{/crossLink}} via datasource.

        @method printPdfForm
        @param {String} form
        @param {Object|String|Array} input data or ids
        @param {String} dir Target directory
        @param {String} username
        @param {Object} [tenant] Tenant
        @return {Promise}
    */
    that.printPdfForm = function (
        form,
        data,
        filename,
        username,
        options,
        tenant
    ) {
        return new Promise(function (resolve, reject) {
            // Do the work
            function doPrint(resp) {
                return new Promise(function (resolve, reject) {
                    function callback(ok) {
                        resp.client.currentUser(undefined);
                        resp.done();
                        resolve(ok);
                    }

                    resp.client.currentUser(username);

                    pdf.printForm(
                        resp.client,
                        form,
                        data,
                        filename,
                        options
                    ).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            Promise.resolve().then(
                db.connect.bind(null, tenant)
            ).then(
                doPrint
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

    async function getOld(theClient, obj) {
        return await that.request({
            method: "GET",
            name: obj.name,
            id: obj.id,
            client: theClient
        }, true);
    }

    /**
        This function is the gateway for all
        {{#crossLinkModule "CRUD"}}{{/crossLinkModule}} requests and data
        service function calls. {{#crossLink "Datasource"}}{{/crossLink}} is
        attached to the `f` global variable in scripts to expose this
        capability.

        ### CRUD Methods
        These requests include the capitalized feather as the `name` argument.
        The following methods are supported:

        #### POST (Create)
        Use this method to insert new records. Any properties not included
        will be populated by default values. The
        {{#crossLink "Promise"}}{{/crossLink}} will resolve to a `PATCH` array
        describing all changes made on the server side due to feather defaults
        and changes caused by triggers. This `PATCH` can be applied by the
        originating requestor to ensure its own copy of the record exactly
        matches the server.The `id` will be checked for uniqueness, along with
        any properties on the feather set for `isUnique` equals `true`.

            let ds = f.datasource;

            function callback (resp) {
                console.log("PATCH->", resp);
            }

            function error (err) {
                console.error("ERROR->", err);
            }

            ds.request({
                method: "POST",
                name: "Contact",
                data: {
                    id: "m7akxiwvz22a",
                    firstName: "Caleb",
                    lastName: "Johnstone"
                }
            }).then(callback).catch(error);

        If the code above is run twice an error will be thrown because of
        a unique id violation, however, if the record id is included
        in a `POST` request, the request will be treated as an "Upsert" call,
        which is to say if a record with that id is not found it will be
        inserted, if one is found the values included in the data will be
        updated on the existing record. Post requests that include `id`
        are therefore idempotent.

            ...

            ds.request({
                method: "POST",
                name: "Contact",
                id: "m7akxiwvz22a", // Indicate upsert behavior
                data: {
                    firstName: "Caleb",
                    lastName: "Johnstone"
                }
            }).then(callback).catch(error);

        #### GET (Read)
        Use `GET` to retreive one or more records.

        Retreive one result by refering to the record id

            ...

            f.datasource.request({
                method: "GET",
                name: "Contact",
                id: "m7akxiwvz22a"
            }).then(callback).catch(error);

        Excluding the `id` will return all records

            ...

            f.datasource.request({
                method: "GET",
                name: "Contact"
            }).then(callback).catch(error);

        Requests can be paginated so records are returned in small groups
        using the {{#crossLink "Filter"}}{{/crossLink}} property.

            ...

            f.datasource.request({
                method: "GET",
                name: "Contact",
                filter: {
                    offset: 20, // Start page
                    limit: 10   // Page length
                }
            }).then(callback).catch(error);

        Of course filters can also logically limit and sort

            ...

            f.datasource.request({
                method: "GET",
                name: "Contact",
                filter: {
                    criteria: [{
                        property: "lastName",
                        operation: "equals",
                        criteria: "Doe"
                    }],
                    sort: [{
                        property: "firstName",
                        order: "ASC"
                    }]
                }
            }).then(callback).catch(error);

        #### PATCH (Update)

        Update records using `PATCH` where the `data` argument follows the
        <a href='https://tools.ietf.org/html/rfc6902'>rfc 6092</a>
        specification for JSON patch updates. As with `POST`, any property
        values that are updated as a side effect or wind up with different
        values than requested will be returned in a patch containing all
        the differences.

            ...

            ds.request({
                method: "PATCH",
                name: "Contact",
                id: "m7akxiwvz22a", // Which record to patch
                data: [{
                    op: "replace",
                    path: "/firstName",
                    value: "Joshua"
                }]
            }).then(callback).catch(error);

        #### DELETE

        Delete a record simply by referencing the `id`.

            ...

            ds.request({
                method: "DELETE",
                name: "Contact",
                id: "m7akxiwvz22a"
            }).then(callback).catch(error);

        ### Calling Registered Functions

        Requests can also call registered functions to run procedural logic.
        They are differentiated from CRUD requests by use of a camel case
        name argument. See
        {{#crossLink "Datasource/registerFunction:method"}}{{/crossLink}}
        for more information.

            // Requesting currency conversion
            ...

            ds.request({
                method: "POST",
                name: "convertCurrency",
                data: {
                    fromCurrency: "EUR",
                    amount: "100"
                }
            }).then(callback).catch(error);

        @method request
        @param {Object} Payload
        @param {String} payload.name Name of feather or registered function
        @param {String} payload.method Method to perform: `GET`, `POST`,
        `PUT`, `PATCH` or `DELETE`
        @param {String} [payload.id] Identifier for `GET`, `PATCH` and `DELETE`
        @param {String} [payload.data] Required for `POST` and `PATCH`
        calls
        @param {Filter} [payload.filter] Filter for `GET` requests
        @param {Client} [payload.client] Database client. If undefined one
        will be intialized by default and wrapped in a transaction if necessary.
        @param {Boolean} [isSuperUser] Bypass authorization checks.
        Default false.
        @return {Promise}
    */
    that.request = function (obj, isSuperUser) {
        return new Promise(function (resolve, reject) {
            isSuperUser = Boolean(isSuperUser);

            let theClient;
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

            async function begin() {
                if (!theClient.wrapped()) {
                    await crud.begin({client: theClient});
                    theClient.wrapped(true);
                }
            }

            // Add old/new record objects for convenience
            async function doPrepareTrigger(obj) {
                let result;

                if (!obj.newRec && !obj.oldRec) {
                    switch (obj.method) {
                    case "POST":
                        obj.newRec = f.copy(obj.data);
                        break;
                    case "PATCH":
                        obj.newRec = f.copy(obj.data);
                        await begin();
                        result = await getOld(theClient, obj);
                        obj.oldRec = result;
                        obj.newRec = f.copy(result);
                        jsonpatch.applyPatch(obj.newRec, obj.data);
                        break;
                    case "DELETE":
                        await begin();
                        result = await getOld(theClient, obj);
                        obj.oldRec = result;
                        break;
                    default:
                        throw "Unknown trigger method " + obj.method;
                    }

                    return;
                }

                theClient.isTriggering(true);
            }

            function close(resp) {
                return new Promise(function (resolve) {
                    //console.log("CLOSING");
                    theClient.currentUser(undefined);
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

            async function commit(resp) {
                // Forget about committing if recursive
                if (isTriggering || isExternalClient) {
                    return resp;
                }

                if (theClient.wrapped()) {
                    //console.log("COMMIT->", obj.name, obj.method);
                    try {
                        await crud.commit({client: theClient});

                        //console.log("COMMITED");
                        return resp;
                    } catch (err) {
                        return Promise.reject(err);
                    } finally {
                        theClient.currentUser(undefined);
                        theClient.wrapped(false);
                    }
                }

                return resp;
            }

            function rollback(err, callback) {
                // If external, let caller deal with transaction
                if (isExternalClient) {
                    callback(error(err));
                    return;
                }

                //console.log("ROLLBACK->", obj.name, obj.method);

                if (theClient.wrapped()) {
                    crud.rollback({
                        client: theClient,
                        error: err
                    }).then(function () {
                        //console.log("ROLLED BACK");
                        theClient.currentUser(undefined);
                        theClient.wrapped(false);
                        callback(error(err));
                        return;
                    });
                    return;
                }

                callback(err);

                return;
            }

            async function doExecute() {
                // console.log("EXECUTE->", obj.name, obj.method);
                if (wrap && !isTriggering) {
                    await begin();
                    return await transaction(obj, false, isSuperUser);
                }

                // Passed client must handle its own transaction wrapping
                return await transaction(obj, isChild, isSuperUser);
            }

            async function doMethod(name, trigger) {
                // console.log("METHOD->", obj.name, obj.method, name);
                let transactions;
                let resp;

                wrap = !obj.client && obj.method !== "GET";
                obj.data = obj.data || {};
                obj.data.id = obj.data.id || obj.id;
                obj.client = theClient;
                transactions = (
                    trigger
                    ? registered[obj.method][name][trigger].slice()
                    : [registered[obj.method][name]]
                );

                while (transactions.length) {
                    transaction = transactions.shift();
                    resp = await doExecute();
                }

                return resp;
            }

            function clearTriggerStatus() {
                if (!isTriggering) {
                    theClient.isTriggering(false);
                }
            }

            async function doTraverseAfter(name) {
                // console.log("TRAVERSE_AFTER->", obj.name, obj.method, name);
                let feather = settings.data.catalog.data[name];
                let parent = feather.inherits || "Object";

                if (obj.noTrigger) {
                    return await commit();
                }

                async function doTrigger() {
                    if (name === "Object") {
                        await doMethod(name, TRIGGER_AFTER);
                        clearTriggerStatus();
                        return await commit();
                    }

                    await doMethod(name, TRIGGER_AFTER);
                    clearTriggerStatus();
                    return await doTraverseAfter(parent);
                }

                // If business logic defined, do it
                if (isRegistered(obj.method, name, TRIGGER_AFTER)) {
                    await doPrepareTrigger(obj);
                    return await doTrigger();

                // If traversal done, finish transaction
                } else if (name === "Object") {
                    return await commit(obj.response);

                    // If no logic, but parent, traverse up the tree
                } else {
                    return doTraverseAfter(parent);
                }
            }

            async function doQuery() {
                // console.log("QUERY->", obj.name, obj.method);
                obj.client = theClient;
                isChild = false;

                switch (obj.method) {
                case "GET":
                    return crud.doSelect(obj, false, isSuperUser);
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

                obj.response = await doExecute();
                return await doTraverseAfter(obj.name);
            }

            async function doTraverseBefore(name) {
                // console.log("TRAVERSE_BEFORE->", obj.name, obj.method, name);
                let feather = settings.data.catalog.data[name];
                let parent = feather.inherits || "Object";

                if (obj.noTrigger) {
                    return doQuery();
                }

                async function doTrigger() {
                    if (name === "Object") {
                        await doMethod(name, TRIGGER_BEFORE);
                        clearTriggerStatus();
                        return await doQuery();
                    }

                    await doMethod(name, TRIGGER_BEFORE);
                    clearTriggerStatus();
                    return await doTraverseBefore(parent);
                }

                // If business logic defined, do it
                if (isRegistered(obj.method, name, TRIGGER_BEFORE)) {
                    await doPrepareTrigger(obj);
                    return await doTrigger();

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

                    return doQuery();

                    // If no logic, but parent, traverse up the tree
                } else {
                    return doTraverseBefore(parent);
                }
            }

            async function resolveType() {
                let resp;
                let payload = {
                    id: obj.id,
                    name: obj.name,
                    client: theClient,
                    properties: ["objectType"]
                };

                resp = await crud.doSelect(payload, false, isSuperUser);
                if (resp) {
                    obj.name = resp.objectType;
                }
                return obj.name;
            }

            // Determine with POST with id is insert or update
            async function doUpsert() {
                let payload = {
                    id: obj.id,
                    name: obj.name,
                    client: theClient
                };
                let resp;
                let patch;

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
                                if (
                                    newRec[key][n] !== undefined &&
                                    newRec[key][n] !== null
                                ) {
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

                resp = await crud.doSelect(payload, false, isSuperUser);
                if (resp) {
                    obj.name = resp.objectType;
                    overlay(obj.data, resp);
                    patch = jsonpatch.compare(
                        resp,
                        obj.data
                    );
                    obj.method = "PATCH";
                    obj.data = patch;
                    obj.cache = Object.freeze(f.copy(patch));
                } else {
                    // Cache original request that may get changed
                    // by triggers
                    if (obj.data) {
                        obj.cache = Object.freeze(f.copy(obj.data));
                    }
                    obj.data.id = obj.id;
                }
            }

            function doRequest(resp) {
                if (!isExternalClient) {
                    // Disallow SQL calls directly from db services by
                    // making client simply a reference object.
                    theClient = resp.client;
                    done = resp.done;
                }

                //console.log("REQUEST->", obj.name, obj.method);
                return new Promise(function (resolve, reject) {
                    let msg;

                    if (!theClient.currentUser() && !obj.user) {
                        msg = "User undefined. " + obj.method + " " + obj.name;
                        reject(msg);
                        return;
                    }

                    if (!theClient.currentUser()) {
                        theClient.currentUser(obj.user);
                    }

                    if (obj.subscription) {
                        obj.subscription.nodeId = db.nodeId;
                    }

                    // If alter data, process it
                    if (catalog[obj.name]) {
                        if (obj.method === "GET") {
                            doQuery().then(function (resp) {
                                if (!theClient.wrapped()) {
                                    theClient.currentUser(undefined);
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
                        } else if (
                            obj.method === "DELETE" || obj.method === "PATCH"
                        ) {
                            if (!obj.id) {
                                throw new Error(
                                    obj.method + " request requires an id"
                                );
                            }

                            // Cache original request that may get changed by
                            // triggers
                            if (obj.data) {
                                obj.cache = Object.freeze(f.copy(obj.data));
                            }

                            if (!isExternalClient) {
                                wrap = true;
                            }

                            begin().then(
                                resolveType // Make sure biz logic applied!
                            ).then(
                                doTraverseBefore
                            ).then(
                                resolve
                            ).catch(
                                function (err) {
                                    rollback(err, reject);
                                }
                            );
                        // Must be post new
                        } else {
                            // Cache original request that may get changed by
                            // triggers
                            if (obj.data) {
                                obj.cache = Object.freeze(f.copy(obj.data));
                            }

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
                theClient = obj.client;
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
                db.connect.bind(null, obj.tenant)
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
          * {{#crossLink "Services.Crud/autonumber:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Crud/doAggregate:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Role/changeOwnPassword:method"}}
          {{/crossLink}}
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
          * {{#crossLink "Services.Crud/savePoint:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Events/subscribe:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Events/unsubscribe:method"}}
          {{/crossLink}}
          * {{#crossLink "Services.Mail/sendMail:method"}}
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
            // (Assumed here to be executed within a data service script)
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
                console.log("Response->", resp);
            }

            // Trap for errors
            function error (err) {
                console.error("Erorr->", err);
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
        @param {String} name Camel case function name
        @param {Function} func
        @return {Object} Receiver
        @chainable
    */
    /**
        When a trigger is included as an argument in `registerFunction`,
        then the registered function is executed before or after a feather
        {{#crossLinkModule "CRUD"}}{{/crossLinkModule}}
        {{#crossLink "Datasource/request:method"}}{{/crossLink}}
        according to the method and trigger type. The `method`
        determines whether the function applies to a `POST`, `PATCH` or `DELETE`
        {{#crossLinkModule "CRUD"}}{{/crossLinkModule}}
        {{#crossLink "Datasource/request:method"}}{{/crossLink}},
        and the `trigger` determines whether the function is
        executed before or after the
        {{#crossLinkModule "CRUD"}}{{/crossLinkModule}}
        request is processed. The function must take in one
        {{#crossLink "Object"}}{{/crossLink}} as its sole argument
        and return a {{#crossLink "Promise"}}{{/crossLink}}.

        The following types of declarative business logic can be executed by
        registered triggers:
        * Validate values
        * Change values before processig (`before` trigger only)
        * Make data requests that create, update or delete other records.

        The design is meant to work similar to database triggers, except that
        object inheritence is honored so triggers will also be inherited by
        feather sub classes. Note this logic is declarative by definition, where
        a change caused by one trigger can potentially cascade to many other
        records which also have triggers.

        The function called in a trigger will be passed an
        object argument that includes the property `newRec` for `POST` and
        `PATCH` requests that contains new record properties that will be
        committed, and `oldRec` for `PATCH` and `DELETE` calls that contains
        the property values of the record before the request was made.

        To handle an invalid request, simply throw an error and
        the entire originating request transaction will be rolled back.

            let ds = f.datasource;

            function (obj) {
                return new Promise(function (resolve) {
                    if (newRec.lowest >= newRec.highest) {
                        throw new Error(
                            "'Lowest' value must be less than 'highest'"
                        );
                    }

                    resolve(); // Make sure to always resolve your promises!
                });
            }

            // Apply on `POST` record creation...
            ds.registerFunction("POST", "Foo", fn, ds.TRIGGER_BEFORE);

        If values on `newRec` are changed in a `before` trigger, those
        values are what will be committed, which provides a way to intercept
        and change values on proposed requests.

            let ds = f.datasource;

            function (obj) {
                return new Promise(function (resolve) {
                    if (newRec.lowest >= newRec.highest) {
                        newRec.highest = newRec.lowest + 1;
                    }

                    resolve();
                });
            }

            // We can run this same logic on both `POST` and `PATCH`
            ds.registerFunction("POST", "Foo", fn, ds.TRIGGER_BEFORE);
            ds.registerFunction("PATCH", "Foo", fn, ds.TRIGGER_BEFORE);

        If applicable, Properties can be compared between `oldRec` and `newRec`
        to determine if changes have been proposed.

            let ds = f.datasource;

            function (obj) {
                return new Promise(function (resolve) {
                    if (newRec.name !== oldRec.name) {
                        throw new Error("Name cannot be changed");
                    }

                    resolve();
                });
            }

            // Note this one applies only to `PATCH` updates
            ds.registerFunction("PATCH", "Foo", fn, ds.TRIGGER_BEFORE);

        If other records will be changed as a consequence of a request, it is
        a good practice to do this in an `after` trigger after all proposed
        property changes, including default values, have already been
        proceessed.

            let ds = f.datasource;

            function (obj) {
                return new Promise(function (resolve, reject) {
                    let msg;

                    // Create a log of some change. Note the updated
                    // time and user aren't set until after the update
                    // has been completed, so must use `after` trigger
                    if (newRec.description !== oldRec.description) {
                        msg = (
                            "Description changed from '" +
                            oldRec.description + "' to '" +
                            newRec.description + "' by " +
                            newRec.updatedBy + "."
                        );
                        fs.request({
                            method: "POST",
                            name: "FooLog",
                            client: obj.client,
                            data: {
                                message: msg,
                                logTime: newRec.updated
                            }
                        }).then(resolve).catch(reject);

                        return;
                    }

                    resolve();
                });
            }

            // Note this one applies only to `PATCH` updates
            ds.registerFunction("PATCH", "Foo", fn, ds.TRIGGER_AFTER);

        Note it is possible to register multiple triggers against the
        same method and trigger type. Registering triggers is additive.

        @method registerFunction
        @param {String} method `POST`, `PATCH`, or `DELETE`
        @param {String} name Upper case feather name
        @param {Function} func
        @param {Integer} trigger {{#crossLink
        "Datasource/TRIGGER_BEFORE:property"}}{{/crossLink}} or
        {{#crossLink "Datasource/TRIGGER_AFTER:property"}}{{/crossLink}}
        @return {Object} Receiver
        @chainable
    */
    that.registerFunction = function (method, name, func, trigger) {
        if (trigger) {
            if (!registered[method][name]) {
                registered[method][name] = {};
            }
            if (!registered[method][name][trigger]) {
                registered[method][name][trigger] = [];
            }
            registered[method][name][trigger].push(func);
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
        Append all npm dependencies defined in modules
        on to `f` global variable.

        @method loadModules
        @return {Promise}
    */
    that.loadNpmModules = async function (pUser, pClient) {
        let conf = await config.read();
        let mods = await that.request({
            method: "GET",
            name: "Module",
            user: pUser || conf.pgUser,
            client: pClient,
            properties: ["id", "npm"]
        }, true);

        // Instantiate npm packages listed on modules
        mods.forEach(function (mod) {
            mod.npm.forEach(function (pkg) {
                let pname = pkg.property || pkg.export || pkg.package;
                pname = pname.toCamelCase(true);

                if (pkg.export) {
                    f[pname] = require(pkg.package)[pkg.export];
                    return;
                }
                f[pname] = require(pkg.package);
            });
        });
    };

    /**
        Load all services into memory.

        Pass username and client reduce connection calls
        and avoid hanging if this request is made many consecutive
        times.

        @method loadServices
        @param {String} [username]
        @param {Object} [client]
        @return {Promise}
    */
    that.loadServices = function (pUser, pClient) {
        return new Promise(function (resolve, reject) {
            function unregisterTriggers() {
                function clearTriggers(fn, trigger) {
                    if (
                        fn[trigger] &&
                        fn[trigger].length
                    ) {
                        fn[trigger].length = 0;
                    }
                }

                Object.keys(registered).forEach(function (method) {
                    Object.keys(registered[method]).forEach(function (fn) {
                        let func = registered[method][fn];
                        clearTriggers(func, TRIGGER_BEFORE);
                        clearTriggers(func, TRIGGER_AFTER);
                    });
                });
            }

            function doLoadServices(resp) {
                let err;
                unregisterTriggers();

                resp.every(function (service) {
                    try {
                        new Function(
                            "f",
                            "\"use strict\";" + service.script
                        )(f);
                    } catch (e) {
                        err = e;
                        return false;
                    }
                    return true;
                });

                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            }

            if (pUser && pClient) {
                that.request({
                    method: "GET",
                    name: "getServices",
                    user: pUser,
                    client: pClient
                }, true).then(doLoadServices);
            } else {
                that.getServices().then(doLoadServices);
            }
        });
    };

    /**
        Load all tenant data into memory.

        @method loadTenants
        @return {Promise}
    */
    that.loadTenants = async function () {
        let conf = await config.read();
        let conn = await db.connect();
        let pClient = conn.client;
        let tservices = await that.request({
            client: pClient,
            method: "GET",
            name: "TenantService",
            properties: [
                "id",
                "pgHost",
                "pgPort",
                "pgUser",
                "pgPassword"
            ],
            user: conf.pgUser
        }, true);
        let pTenants = await that.request({
            client: pClient,
            filter: {criteria: [{
                property: "isActive",
                value: true
            }]},
            method: "GET",
            name: "Tenant",
            properties: ["company", "pgService", "pgDatabase"],
            user: conf.pgUser
        }, true);
        let tenant;
        let n = 0;
        let svc;
        conn.done();
        tenants.length = 0; // Clear previous global values
        while (n < pTenants.length) {
            tenant = pTenants[n];
            n += 1;
            svc = tservices.find((s) => s.id === tenant.pgService.id);
            tenant.pgService = svc;
            try {
                conn = await db.connect(tenant);
                tenants.push(tenant);
            } catch (ignore) {
                console.error(
                    "Could not connect to " +
                    tenant.pgDatabase +
                    ". Skipping."
                );
            }
        }

        tenants.unshift({
            company: "System default",
            pgService: {
                name: "Default service",
                pgHost: conf.pgHost,
                pgPort: conf.pgPort,
                pgUser: conf.pgUser,
                pgPassword: conf.pgPassword
            },
            pgDatabase: conf.pgDatabase
        });
        return tenants;
    };

    /**
        Return a registered function. If trigger argument is passed
        an array of functions is returned;

        @method getFunction
        @param {String} method Method name ("POST","PATCH","DELETE","PUT")
        @param {String} name Function name
        @param {Integer} trigger Trigger type
        @return {Function|Array} return a registered function
    */
    that.getFunction = function (method, name, trigger) {
        if (!registered[method]) {
            return;
        }

        if (trigger) {
            if (registered[method][name]) {
                return registered[method][name][trigger] || [];
            } else {
                return;
            }
        }

        return registered[method][name];
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
    that.registerFunction("POST", "autoNumber", crud.autonumber);
    that.registerFunction("POST", "changeOwnPassword", role.changeOwnPassword);
    that.registerFunction("POST", "changeRoleLogin", role.changeRoleLogin);
    that.registerFunction(
        "POST",
        "changeRolePassword",
        role.changeRolePassword
    );
    that.registerFunction("POST", "createRole", role.createRole);
    that.registerFunction("POST", "doAggregate", crud.doAggregate);
    that.registerFunction("POST", "dropRole", role.dropRole);
    that.registerFunction("POST", "grantMembership", role.grantMembership);
    that.registerFunction("POST", "revokeMembership", role.revokeMembership);
    that.registerFunction(
        "POST",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("POST", "savePoint", crud.savePoint);
    that.registerFunction("POST", "stopProcess", stopProcess);
    that.registerFunction("POST", "subscribe", subscribe);
    that.registerFunction("POST", "unsubscribe", unsubscribe);
    that.registerFunction(
        "PUT",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("POST", "sendMail", mail.sendMail);
    that.registerFunction("PUT", "saveFeather", feathers.saveFeather);
    that.registerFunction("PUT", "saveProfile", profile.saveProfile);
    that.registerFunction("PUT", "saveSettings", settings.saveSettings);
    that.registerFunction("PUT", "saveWorkbook", workbooks.saveWorkbook);
    that.registerFunction("DELETE", "deleteFeather", feathers.deleteFeather);
    that.registerFunction("DELETE", "deleteModule", installer.deleteModule);
    that.registerFunction("DELETE", "deleteWorkbook", workbooks.deleteWorkbook);

}(exports));