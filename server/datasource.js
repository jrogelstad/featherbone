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
/*jslint node, this, eval, unordered*/
/**
    @module Datasource
*/
(function (exports) {
    "use strict";

    require("../common/string");
    require("../common/number");
    require("../common/date");

    const fs = require("fs");
    const path = require("path");
    const {Database} = require("./database");
    const {Events} = require("./services/events");
    const {CRUD} = require("./services/crud");
    const {Currency} = require("./services/currency");
    const {Feathers} = require("./services/feathers");
    const {Help} = require("./services/help");
    const {About} = require("./services/about");
    const {OpenApi} = require("./services/openapi");
    const {Importer, Exporter} = require("./services/io");
    const {Installer} = require("./services/installer");
    const {
        NavigationCategories
    } = require("./services/navigation-categories");
    const {Manager} = require("./services/manager");
    const {Meta} = require("./services/meta");
    const {Profile} = require("./services/profile");
    const {Packager} = require("./services/packager");
    const {Routes} = require("./services/routes");
    const {Services} = require("./services/services");
    const {Packages} = require("./services/packages");
    const {Settings} = require("./services/settings");
    const {Role} = require("./services/role");
    const {Dashboards} = require("./services/dashboards");
    const {Tools} = require("./services/tools");
    const {Workbooks} = require("./services/workbooks");
    const {Config} = require("./config");
    const {PDF} = require("./services/pdf");
    const {Mail} = require("./services/mailer");
    const {Client} = require("pg");

    const f = require("../common/core");
    const jsonpatch = require("fast-json-patch");
    const db = new Database();
    const events = new Events();
    const config = new Config();
    const crud = new CRUD();
    const currency = new Currency();
    const dashboards = new Dashboards();
    const exporter = new Exporter();
    const feathers = new Feathers();
    const help = new Help();
    const about = new About();
    const openApi = new OpenApi();
    const importer = new Importer();
    const installer = new Installer();
    const manager = new Manager();
    const navigationCategories = new NavigationCategories();
    const packager = new Packager();
    const profile = new Profile();
    const meta = new Meta();
    const routes = new Routes();
    const services = new Services();
    const settings = new Settings();
    const role = new Role();
    const tools = new Tools();
    const workbooks = new Workbooks();
    const pdf = new PDF();
    const mail = new Mail();
    const packages = new Packages();
    const tenants = [];

    /*
        The data type formats the server knows, hung on `f` so that a
        module's code can add its own: SupplyChain's Common module
        registers unitCost, salesPrice and purchasePrice this way, and
        `feathers.js` builds a column from the format a property
        declares.

        It belongs here rather than in server.js because this is what
        loads and runs module code, and install.js loads it too. When
        only server.js set it, `f.formats` was undefined in every
        install run from the command line, so SupplyChain's own money
        formats were never registered and `feathers.js`, finding no
        format by that name, fell back to the property's type and made
        the column `json` instead of `mono` (improvement item 0.11).
        The same install through the running server was correct, which
        is exactly how the defect was first described.
    */
    if (!f.formats) {
        f.formats = tools.formats;
    }

    /**
        Server datasource class.

        @class Datasource
        @static
    */
    const that = {};

    /*
        Functions a request may call. The base registry holds the
        framework's own registrations; each database gets a registry of
        its own on top of it, holding the service registrations of the
        modules deployed there -- loaded from the server's installed
        packages when the module is on disk, from the database's
        data_service rows when it is not (ADR-002). Two databases on
        different versions of one module therefore dispatch to
        different code in one process.
    */
    const baseRegistry = {
        GET: {},
        POST: {},
        PUT: {},
        PATCH: {},
        DELETE: {}
    };

    // Registry service scripts are loading into right now. Scripts run
    // synchronously, so this is set only for the duration of a build.
    let loadTarget = null;

    // database name -> built registry
    let dbRegistries = {};

    // database name -> {"<module>/<path>": function name}, the routes
    // of the module versions that database deployed
    let dbRoutes = {};

    // database name -> registry under construction, so a service that
    // issues a request while loading sees the partial registry instead
    // of deadlocking on its own build
    let dbBuilding = {};

    let packagesScanned = false;

    /*
        The package index, read once per process. Both the registry
        build and `install` need it -- install because what it will
        refuse depends on what this server holds, and it may be the
        first thing a process does.
    */
    async function ensurePackagesScanned() {
        if (!packagesScanned) {
            packagesScanned = true;
            packages.scan((await config.read()).modulesDir);
        }
    }

    const TRIGGER_BEFORE = 1;
    const TRIGGER_AFTER = 2;

    // ..........................................................
    // PRIVATE
    //

    function isRegistered(reg, method, name, trigger) {
        let found = reg[method][name];

        if (trigger && found && found[trigger]) {
            return found[trigger];
        }

        if (trigger === undefined) {
            return found || false;
        }

        return false;
    }

    /*
        `ModuleNpm` rows: libraries declared in a table rather than in
        the module's own package.json. Deprecated by ADR-002 question
        1 and read only for a module the server holds no package for.
        Loaded globally, as they always were, which is the collision
        the per-package directories exist to end.
    */
    let legacyWarned = false;

    async function loadLegacyLibraries(client, rows, onDisk) {
        let has = await client.query(
            "SELECT to_regclass('module_npm') IS NOT NULL AS found;"
        );
        let resp;
        let pending = rows.filter(
            (row) => onDisk[row.name] === undefined
        ).map((row) => row.name);

        if (!has.rows[0].found || !pending.length) {
            return;
        }

        resp = await client.query(
            (
                "SELECT m.name AS module, n.package, n.property, " +
                "  n.export FROM module_npm n " +
                "JOIN module m ON m._pk = n._module_module_pk " +
                "WHERE NOT n.is_deleted AND NOT m.is_deleted " +
                "  AND m.name = ANY($1)"
            ),
            [pending]
        );

        if (!resp.rows.length) {
            return;
        }

        if (!legacyWarned) {
            legacyWarned = true;
            console.warn(
                "ModuleNpm rows are deprecated (ADR-002): declare " +
                "libraries in the module's package.json and install " +
                "the module as a package. Still loading rows for: " +
                resp.rows.map((row) => row.module).filter(
                    (name, i, all) => all.indexOf(name) === i
                ).join(", ")
            );
        }

        resp.rows.forEach(function (row) {
            let property = (
                row.property ||
                row.export ||
                row.package
            ).toCamelCase(true);

            try {
                f[property] = (
                    row.export
                    ? require(row.package)[row.export]
                    : require(row.package)
                );
            } catch (err) {
                console.error(
                    "Unable to load npm module " + row.package +
                    " for " + row.module + ": " + err.message
                );
            }
        });
    }

    function routeKey(module, routePath) {
        return (
            module.toSpinalCase() + "/" +
            String(routePath).replace(/^\/+/, "")
        );
    }

    async function buildRegistry(client) {
        let reg = {
            GET: {},
            POST: {},
            PUT: {},
            PATCH: {},
            DELETE: {}
        };
        let mods;
        let onDisk = {};
        let sources;
        let run = [];

        Object.keys(baseRegistry).forEach(function (method) {
            Object.assign(reg[method], baseRegistry[method]);
        });

        await ensurePackagesScanned();

        // Which modules this database carries, and which of those the
        // server holds as packages on disk
        /*
            Probe for the table instead of catching a failed query: during
            a first install this runs inside a transaction, and a failed
            statement would leave that transaction aborted.
        */
        mods = {rows: []};
        let hasModules = await client.query(
            "SELECT to_regclass('module') IS NOT NULL AS found;"
        );
        if (hasModules.rows[0].found) {
            mods = await client.query(
                "SELECT name, version FROM module WHERE NOT is_deleted;"
            );
        }

        mods.rows.forEach(function (row) {
            if (packages.resolve(row.name, row.version)) {
                onDisk[row.name] = row.version;
            }
        });

        /*
            A module's libraries come from its own package, installed
            in its own version directory, and are loaded here --
            before its code runs, and per database, which is where
            everything else about a database's modules is decided
            (ADR-002 question 1, which retires `ModuleNpm`).

            The rows are still honored for a module with no package
            yet, so an installation that has not been repackaged keeps
            working, and they are read from this database rather than
            from the manager: the one-mode collapse left that loader
            pointed at `tenant: false`, so an instance's rows had
            quietly stopped being loaded at all.
        */
        Object.keys(onDisk).forEach(function (name) {
            packages.loadLibraries(name, onDisk[name], f);
        });

        await loadLegacyLibraries(client, mods.rows, onDisk);

        /*
            Routes follow the same rule as services: from the package
            on disk at the version this database deployed, and from the
            database's own rows only for a module with no package.
        */
        let routeMap = {};
        let hasRoutes = await client.query(
            "SELECT to_regclass('_route') IS NOT NULL AS found;"
        );
        let legacy = (
            hasRoutes.rows[0].found
            ? await routes.getRoutes({client})
            : []
        );

        function addRoute(row) {
            routeMap[routeKey(row.module, row.path)] = row.function;
        }

        let unpackaged = {};

        Object.keys(onDisk).forEach(function (name) {
            let declared = packages.routesOf(name, onDisk[name]);

            if (declared === undefined) {
                // On disk but without a routes.json: not repackaged
                // yet, so its routes stay where they were
                unpackaged[name] = true;
                return;
            }
            declared.forEach(addRoute);
        });
        legacy.forEach(function (row) {
            if (
                onDisk[row.module] === undefined ||
                unpackaged[row.module]
            ) {
                addRoute(row);
            }
        });
        dbRoutes[client.database] = routeMap;

        // A database mid-install has no service rows to load yet
        let hasServices = await client.query(
            "SELECT to_regclass('data_service') IS NOT NULL " +
            "AND to_regclass('_module') IS NOT NULL AS found;"
        );
        sources = (
            hasServices.rows[0].found
            ? await services.getServices({client})
            : []
        );

        /*
            Order comes from the module list, never from which modules
            happen to have rows: a module on disk has none, and ordering
            by rows put it last instead of where its dependencies say.
        */
        let order = (
            hasModules.rows[0].found
            ? await services.getModuleOrder({client})
            : []
        );

        run = that.serviceLoadOrder(
            order,
            onDisk,
            sources,
            packages.serviceSources
        );

        loadTarget = reg;
        dbBuilding[client.database] = reg;
        try {
            run.forEach(function (src) {
                new Function(
                    "f",
                    "\"use strict\";" + src.script
                )(f);
            });
        } finally {
            loadTarget = null;
            delete dbBuilding[client.database];
        }

        return reg;
    }

    async function registryFor(client) {
        let database = client.database;

        if (dbRegistries[database]) {
            return dbRegistries[database];
        }

        if (dbBuilding[database]) {
            return dbBuilding[database];
        }

        let reg = await buildRegistry(client);
        dbRegistries[database] = reg;
        return reg;
    }

    /*
        The function a route calls for the requesting database, or null
        when the version of the module that database deployed does not
        declare the route. The registry build has filled the map by the
        time any request reaches here.
    */
    function getRouteFunction(obj) {
        let map = dbRoutes[obj.client.database] || {};

        return Promise.resolve(map[obj.data.key] || null);
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

        @method createProcess
        @param {Object} options
        @param {String} options.name Process name
        @param {Object} options.client
        @param {Boolean} [options.canStop] Whether process can be stopped.
        @param {Integer} [options.count] Count of items to process. Default 100
        @param {String} [options.id] Caller-chosen process id, so a client
        that has no live subscription can poll for it by id instead.
        Defaults to a generated one.
        @param {Object} [options.subscription] Pass for client progress
        notification
        @param {string} [options.subscription.id] id Subscription id
        @param {string} [options.subscription.eventKey] eventKey Subscription
        event key
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
        let pId = obj.id || f.createId();
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
                    canStop: obj.canStop,
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
                "  completed = NOW(), " +
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

    /*
        Give up everything this process holds for an instance: its
        LISTEN connection and its connection pool. Called when an
        instance leaves the registry, and before a template build takes
        its database away. Never throws: the caller is already removing
        the instance, and a pool that cannot be ended must not stop
        that (tenant plan D.3).
    */
    async function releaseTenant(tenant) {
        if (!tenant) {
            return;
        }

        // A listen still opening its connection finishes first, or it
        // would land a connection on a pool that is about to end
        if (tenant.listenPending) {
            await tenant.listenPending.catch(function () {
                return;
            });
        }

        if (tenant.listenerConn) {
            try {
                tenant.listenerConn.done();
            } catch (err) {
                console.error(
                    "Could not release the listener connection of " +
                    tenant.pgDatabase + ": " + (err.message || err)
                );
            }
            delete tenant.listenerConn;
        }

        try {
            await db.endPool(tenant);
        } catch (err) {
            console.error(
                "Could not end the connection pool of " +
                tenant.pgDatabase + ": " + (err.message || err)
            );
        }
    }

    /**
        The service scripts a database runs, in the order it runs them:
        each module in dependency order, taking its code from the
        package on disk when the server holds one and from its rows
        when it does not.

        Order comes from `order` alone, so it does not matter which
        modules have rows -- a module on disk has none.

        Separate from
        {{#crossLink "Datasource/buildRegistry:method"}}{{/crossLink}}
        so the decision can be tested without a database or a packages
        directory (ADR-002).

        @method serviceLoadOrder
        @param {Array} order Module names in dependency order
        @param {Object} onDisk Versions the server holds, by module
        @param {Array} rows Service rows, in any order
        @param {Function} fromDisk (name, version) to a module's
        package sources
        @return {Array} Sources in load order
    */
    that.serviceLoadOrder = function (order, onDisk, rows, fromDisk) {
        let rowsFor = {};
        let run = [];

        rows.forEach(function (src) {
            if (rowsFor[src.module] === undefined) {
                rowsFor[src.module] = [];
            }
            rowsFor[src.module].push(src);
        });

        order.forEach(function (name) {
            let version = onDisk[name];
            let own = rowsFor[name] || [];

            if (version !== undefined) {
                fromDisk(name, version).forEach((src) => run.push(src));
                return;
            }

            own.forEach((src) => run.push(src));
        });

        return run;
    };

    /**
        The registered instances that are no longer registered, given
        what the manager now holds. The manager's own entry (id "-1")
        is not an instance and never leaves.

        Separate from
        {{#crossLink "Datasource/loadTenants:method"}}{{/crossLink}}
        so the decision can be tested without a cluster (tenant plan
        D.3).

        @method registryChanges
        @param {Array} current Registered instances
        @param {Array} incoming Instances the manager holds
        @return {Array} Instances to drop from the registry
    */
    that.registryChanges = function (current, incoming) {
        return current.filter(
            (tenant) => (
                tenant.id !== "-1" &&
                !incoming.some((row) => row.id === tenant.id)
            )
        );
    };

    /**
        The registry as it stands: one shallow copy per registered
        instance, so a reader cannot reach the live objects or the
        connections hanging off them.

        @method registeredTenants
        @return {Array}
    */
    that.registeredTenants = function () {
        return tenants.map(function (tenant) {
            return {
                edition: tenant.edition,
                id: tenant.id,
                isMaintenance: tenant.isMaintenance === true,
                name: tenant.name,
                pgDatabase: tenant.pgDatabase,
                pgService: (
                    tenant.pgService
                    ? {
                        id: tenant.pgService.id,
                        name: tenant.pgService.name,
                        pgHost: tenant.pgService.pgHost,
                        pgPort: tenant.pgService.pgPort,
                        pgUser: tenant.pgService.pgUser
                    }
                    : undefined
                ),
                isListening: Boolean(tenant.listenerConn),
                isPooled: db.hasPool(tenant)
            };
        });
    };

    /**
        The packages installed on this server, rescanned so one
        installed a moment ago is seen without a restart (ADR-002
        section 6). Each carries the newest version the server holds of
        that module, which is what "behind" is measured against.

        @method installedPackages
        @return {Promise} [{name, version, newest}]
    */
    that.installedPackages = async function () {
        let conf = await config.read();

        packages.scan(conf.modulesDir);

        return packages.installed().map(function (one) {
            return {
                isNewest: packages.newest(one.name) === one.version,
                name: one.name,
                newest: packages.newest(one.name),
                version: one.version
            };
        });
    };

    /**
        What each registered instance carries: one row per module with
        the version deployed into it (ADR-002 question 2), read from
        the instance itself rather than from the registry's cached
        copy, which only a module install through the UI ever updated.

        An instance that cannot be reached says so instead of being
        left out, because "I could not ask" and "it has nothing" are
        different answers.

        @method deployedModules
        @return {Promise} {database: {modules, error}}
    */
    that.deployedModules = async function () {
        let ret = {};
        let n = 0;
        let tenant;
        let conn;

        while (n < tenants.length) {
            tenant = tenants[n];
            n += 1;

            if (tenant.id === "-1") {
                continue;
            }

            try {
                conn = await db.connect(tenant);
            } catch (err) {
                ret[tenant.pgDatabase] = {
                    error: err.message,
                    modules: []
                };
                continue;
            }

            try {
                let resp = await conn.client.query(
                    (
                        "SELECT name, version FROM module " +
                        "WHERE NOT is_deleted ORDER BY lower(name)"
                    )
                );

                ret[tenant.pgDatabase] = {
                    modules: resp.rows.map(function (row) {
                        let newest = packages.newest(row.name);

                        return {
                            isBehind: Boolean(
                                newest &&
                                packages.compareVersions(
                                    row.version,
                                    newest
                                ) < 0
                            ),
                            isOnDisk: Boolean(
                                packages.resolve(row.name, row.version)
                            ),
                            /*
                                The server holds this module, but not
                                at the version this database carries,
                                so the database falls back to its rows
                                without saying so. Worth telling apart
                                from a module the server holds nothing
                                of: that one is simply not packaged
                                yet, this one has drifted.
                            */
                            isVersionMissing: Boolean(
                                newest &&
                                !packages.resolve(row.name, row.version)
                            ),
                            name: row.name,
                            newest,
                            version: row.version
                        };
                    })
                };
            } catch (err) {
                ret[tenant.pgDatabase] = {
                    error: err.message,
                    modules: []
                };
            } finally {
                conn.done();
            }
        }

        return ret;
    };

    /**
        The record a deployment owes the database it changed (ADR-002
        question 2): one `module` row per module with the version now
        in it. A manifest carrying a client module file writes this
        itself; one of services or feathers alone leaves nothing
        behind, so Deploy writes it either way.

        @method recordDeployed
        @param {String} database Instance database
        @param {String} name Module name
        @param {String} version
        @param {String} user
        @return {Promise}
    */
    that.recordDeployed = async function (database, name, version, user) {
        let tenant = tenants.find((t) => t.pgDatabase === database);
        let modules;
        let found;

        if (!tenant) {
            throw new Error(
                "Instance " + database + " is not registered here"
            );
        }

        /*
            The datasource owns the transaction here, which is why no
            client is lent to these requests: a lent client leaves the
            commit to the lender, so a write made on one and then
            released is rolled back.
        */
        modules = await that.request({
            method: "GET",
            name: "Module",
            properties: ["id", "name", "version"],
            tenant,
            user
        }, true);
        found = modules.find((row) => row.name === name);

        if (found && found.version === version) {
            return;
        }

        if (found) {
            await that.request({
                data: [{
                    op: "replace",
                    path: "/version",
                    value: version
                }],
                id: found.id,
                method: "PATCH",
                name: "Module",
                tenant,
                user
            }, true);
            return;
        }

        await that.request({
            data: {
                name,
                owner: user,
                script: "",
                version
            },
            id: Buffer.from(name).toString("base64"),
            method: "POST",
            name: "Module",
            tenant,
            user
        }, true);
    };

    /**
        The directory an installed package occupies, for Deploy.

        @method packageDir
        @param {String} name Module name
        @param {String} version
        @return {String|undefined}
    */
    /**
        Which instances carry each installed package, so a version
        nothing runs can be told from one something does. The answer
        is read from the instances themselves rather than from the
        registry's cached copy, for the same reason the fleet view is
        (ADR-002 question 2).

        `unknown` names the instances that could not be asked. They
        are not "not using it": a caller deciding whether a version is
        safe to remove has to treat an instance it cannot see as one
        that might be running it.

        @method packageUsage
        @return {Promise} {usage: {"name@version": [database]}, unknown}
    */
    that.packageUsage = async function () {
        let deployed = await that.deployedModules();
        let usage = {};
        let unknown = [];

        Object.keys(deployed).forEach(function (database) {
            let one = deployed[database] || {};

            if (one.error) {
                unknown.push(database);
                return;
            }

            (one.modules || []).forEach(function (mod) {
                let key = mod.name + "@" + mod.version;

                usage[key] = usage[key] || [];
                usage[key].push(database);
            });
        });

        return {unknown, usage};
    };

    /**
        Take an installed package off this server.

        @method removePackage
        @param {String} name
        @param {String} version
        @return {Promise} {name, version}
    */
    that.removePackage = async function (name, version) {
        let conf = await config.read();

        return packages.remove(name, version, {dir: conf.modulesDir});
    };

    /**
        Put a package on this server from a file somebody uploaded.

        @method installPackage
        @param {String} source Archive or directory
        @param {Object} [options]
        @return {Promise} {name, version, dir, libraries}
    */
    that.installPackage = async function (source, opts) {
        let conf = await config.read();

        return packages.install(source, Object.assign(
            {dir: conf.modulesDir},
            opts || {}
        ));
    };

    that.packageDir = function (name, version) {
        let pkg = packages.resolve(name, version);

        return (
            pkg
            ? pkg.dir
            : undefined
        );
    };

    /*
        Creating, cloning and dropping a database is the one place the
        framework hands out CREATE DATABASE, so the rules live here and
        module code cannot get round them (tenant plan D.2).
    */
    const DB_NAME = (/^[a-z_][a-z0-9_$]{0,62}$/);

    /**
        A database name this framework will act on, folded to lower
        case the way Postgres folds an unquoted identifier, or
        `undefined` when the name is not a plain one. A name that comes
        back can be compared with `pg_database` before it is used and
        cannot smuggle anything into a statement.

        @method databaseName
        @param {String} name
        @return {String} The normalized name, or undefined
    */
    that.databaseName = function (name) {
        let given = (
            (name === undefined || name === null)
            ? ""
            : String(name)
        );
        let normalized = given.trim().toLowerCase();

        return (
            DB_NAME.test(normalized)
            ? normalized
            : undefined
        );
    };

    function badNameMessage(name) {
        return (
            "\"" + name + "\" is not a database name this framework " +
            "will act on: a letter or underscore, then letters, " +
            "digits, underscores or dollar signs"
        );
    }

    /*
        Paths the server answers itself, with no database in them: the
        picker and the platform console (tenant plan G.1, G.2). An
        instance whose database had one of these names would be
        shadowed by them and could never be opened, so the name is
        refused rather than allowed and then found wanting.
    */
    const SERVED_PATHS = ["auth", "my", "platform"];

    /*
        The cluster's own databases and the manager are refused
        whatever the caller asks: dropping the manager would take the
        installation's registry, identities and sessions with it.
    */
    function isReserved(name, conf) {
        let reserved = ["postgres", "template0", "template1"];

        if (conf) {
            reserved.push(config.managerDatabase(conf));
        }

        return (
            reserved.indexOf(name) !== -1 ||
            SERVED_PATHS.indexOf(name) !== -1
        );
    }

    /**
        Why this name cannot be an instance of this installation, or
        undefined when it can. The guarded create and drop apply it
        through `writableName`; registering a database that already
        exists has no such path of its own and asks here.

        @method unservableName
        @param {String} name Database name
        @return {Promise} String or undefined
    */
    that.unservableName = async function (name) {
        let conf = await config.read();
        let checked = writableName(name, conf);

        return checked.message;
    };

    function reservedMessage(name) {
        return (
            "\"" + name + "\" is not an application database and " +
            "cannot be created or dropped from here"
        );
    }

    /*
        The normalized name of a database this framework may create
        over or drop, or a message saying why it may not. Saves every
        caller writing the same two checks.
    */
    function writableName(name, conf) {
        let normalized = that.databaseName(name);

        if (!normalized) {
            return {message: badNameMessage(name)};
        }

        if (isReserved(normalized, conf)) {
            return {message: reservedMessage(normalized)};
        }

        return {name: normalized};
    }

    /*
        Record what was done to the cluster in the manager's audit
        trail, next to the identity administration (ADR-001). Best
        effort: a trail that cannot be written must not undo a database
        that already exists.
    */
    async function auditDatabase(action, user, detail) {
        try {
            await manager.run(function (mclient) {
                return manager.audit(mclient, {
                    action,
                    by: user || "system",
                    detail
                });
            });
        } catch (err) {
            console.error(
                "Could not record " + action + " in the audit trail: " +
                (err.message || err)
            );
        }
    }

    /*
        Who may create, clone and drop a database, and who to record
        for it: a platform administrator. ADR-001 puts the cluster in
        Featherbone's own hands rather than a tenant's.

        Resolves to the caller's name, or to a denial to reject with.
        The check is inside these functions, so module code cannot
        reach CREATE DATABASE without passing it.
    */
    async function databaseActor(pClient, verb) {
        let user = (
            (pClient && typeof pClient.currentUser === "function")
            ? pClient.currentUser()
            : undefined
        );
        let tenant = tenants.find(
            (t) => t.pgDatabase === (pClient && pClient.database)
        );
        /*
            The platform console calls these with no instance of its
            own (tenant plan G.2), so there is no registry row to read
            the caller's organization from. It says which organization
            it signed in to instead, and the authority is still read
            from the identity rather than taken on trust.
        */
        let organizationId = (
            (pClient && typeof pClient.currentOrganization === "function")
            ? pClient.currentOrganization()
            : undefined
        );
        let allowed = await manager.run(async function (mclient) {
            let instance = await manager.instance(
                mclient,
                tenant
            ).catch(() => undefined);
            let organizationPk;

            if (instance) {
                organizationPk = instance.organizationPk;
            } else if (organizationId) {
                let home = await manager.organizationById(
                    mclient,
                    organizationId
                );

                organizationPk = (
                    home
                    ? home._pk
                    : undefined
                );
            }

            let actor = (
                organizationPk
                ? await manager.identity(mclient, user || "")
                : undefined
            );

            return Boolean(actor && actor.is_platform_admin);
        });

        return (
            allowed
            ? {user}
            : {
                message: (
                    "Only a platform administrator may " + verb +
                    " databases"
                )
            }
        );
    }

    /**
        Create a new application database from a template and bring the
        instance registered for it up to date.

        Refuses a name that is already taken, and drops only a database
        this call created: the rollback used to drop whatever name it
        was given, so creating over an existing name destroyed it
        (improvement plan 1.4, tenant plan D.2).

        @method createDatabase
        @param {Object} client Postgres client of the calling database
        @param {String} database Target database name
        @param {String} template Template database name
        @return {Object} Promise
    */
    that.createDatabase = async function (pClient, dbName, template) {
        let conf;
        let name;
        let source;
        let target;
        let actor;
        let user;
        let conn1;
        let conn2;
        let instances;
        let mods;
        let created = false;

        if (!template) {
            return Promise.reject(
                "Template argument is required to create database"
            );
        }

        conf = await config.read();
        target = writableName(dbName, conf);
        source = that.databaseName(template);

        if (target.message) {
            return Promise.reject(target.message);
        }

        if (!source) {
            return Promise.reject(badNameMessage(template));
        }

        name = target.name;
        actor = await databaseActor(pClient, "create");

        if (actor.message) {
            return Promise.reject(actor.message);
        }

        user = actor.user;
        conn1 = await db.connect();

        try {
            let taken = await conn1.client.query(
                "SELECT 1 FROM pg_database WHERE datname = $1",
                [name]
            );

            if (taken.rows.length) {
                /*
                    Never dropped by the rollback below: "created" is
                    still false, so nothing here made it (improvement
                    plan 1.4).
                */
                throw new Error(
                    "Database \"" + name + "\" already exists"
                );
            }

            /*
                A registered instance is never quiet while this process
                serves it: its pool holds a LISTEN connection. Cloning
                one as a template is legitimate (tenant plan D.1), so
                let go of our own connections first; the next registry
                read takes it back up. Anyone else's connections still
                make the clone refuse, which is the honest answer on a
                second node.
            */
            let held = tenants.find((t) => t.pgDatabase === source);

            if (held) {
                await releaseTenant(held);
            }

            let create = "CREATE DATABASE %I TEMPLATE %I;";

            await conn1.client.query(create.format([name, source]));
            created = true;

            /*
                Bring the instance's module list up to date from the
                database that was just built. Asked of the manager
                (tenant false), not the caller: Tenant lives only
                there, and a fresh instance's catalog has never heard
                of it (tenant plan D.1; before this it only worked on
                databases that predate the manager split). The pipeline
                checks out and commits its own connection -- a lent
                client's transaction is the lender's to commit, and an
                uncommitted PATCH here held the tenant row locked
                against the very step that activates it.
            */
            instances = await that.request({
                method: "GET",
                name: "Tenant",
                filter: {criteria: [{
                    property: "pgDatabase",
                    value: name
                }]},
                tenant: false,
                user
            }, true);

            if (!instances.length) {
                throw new Error(
                    "No instance is registered for database \"" +
                    name + "\""
                );
            }

            /*
                The new database, not the default connection: this used
                to pass the whole result array, which carries no
                pgDatabase, so the module list was read from whatever
                database the default connection pointed at.
            */
            conn2 = await db.connect(instances[0]);

            mods = await that.request({
                client: conn2.client,
                method: "GET",
                name: "Module",
                properties: ["name", "version"],
                user
            }, true);

            await that.request({
                id: instances[0].id,
                method: "PATCH",
                name: "Tenant",
                data: [{
                    op: "replace",
                    path: "/modules",
                    value: mods
                }],
                tenant: false,
                user
            }, true);
        } catch (err) {
            if (created) {
                let undo = "DROP DATABASE IF EXISTS %I WITH (FORCE);";

                try {
                    await conn1.client.query(undo.format([name]));
                } catch (dropErr) {
                    console.error(
                        "Could not drop \"" + name + "\" after a failed " +
                        "create, so it is left behind: " +
                        (dropErr.message || dropErr)
                    );
                }
            }

            /*
                Rethrown, not returned as a rejected promise: a
                rejected promise returned from a try is nobody's yet
                while the finally runs, and Node reports it as an
                unhandled rejection.
            */
            throw err;
        } finally {
            conn1.done();
            if (conn2) {
                conn2.done();
            }
        }

        await auditDatabase(
            "database.created",
            user,
            name + " from template " + source
        );
    };

    /*
        How long an expired demo is kept before the sweep drops it, in
        days. Closing is immediate; dropping waits, because somebody
        may yet say they want it back (John, Oct 2026). Zero or absent
        means it is never dropped, only closed.
    */
    function demoGraceDays(conf) {
        let days = Number((conf || {}).demoGraceDays);

        if (!Number.isFinite(days) || days <= 0) {
            return 0;
        }
        return Math.floor(days);
    }

    that.demoGraceDays = demoGraceDays;

    /**
        Delete an application database, taking its instance out of the
        registry first.

        The cluster's own databases and the manager are refused: the
        manager holds the registry, the identities and the sessions.

        @method deleteDatabase
        @param {Object} client Postgres client of the calling database
        @param {String} database Target database name
        @return {Object} Promise
    */
    /*
        The drop itself, once something has decided it may happen. Who
        decided is the caller's to establish: deleteDatabase asks
        databaseActor, and deleteExpiredDemo reads the registry, where
        the policy already says the instance is finished (tenant plan
        D.4).
    */
    async function dropDatabaseNow(name, user) {
        let conn1;
        let tenant;

        try {
            /*
                Take the instance out of the registry and give up what
                this process holds for it before the drop. The old
                splice passed a delete count of 0, so it removed
                nothing: the tenant stayed in the registry with its
                pool and its LISTEN connection, both pointing at a
                database that was about to disappear (tenant plan D.3).
            */
            tenant = tenants.find((t) => t.pgDatabase === name);
            if (tenant) {
                tenants.splice(tenants.indexOf(tenant), 1);
                await releaseTenant(tenant);
            }
            conn1 = await db.connect();

            let drop = "DROP DATABASE IF EXISTS %I WITH (FORCE);";

            await conn1.client.query(drop.format([name]));
        } finally {
            if (conn1) {
                conn1.done();
            }
        }

        await auditDatabase("database.dropped", user, name);
    }

    that.deleteDatabase = async function (pClient, dbName) {
        let conf = await config.read();
        let target = writableName(dbName, conf);
        let actor;

        if (target.message) {
            return Promise.reject(target.message);
        }

        actor = await databaseActor(pClient, "drop");

        if (actor.message) {
            return Promise.reject(actor.message);
        }

        await dropDatabaseNow(target.name, actor.user);
    };

    /**
        Drop a demo that ran out and was never asked for back (tenant
        plan D.4). Called by the sweep on the server's own clock, with
        nobody signed in.

        There is no actor to authorize it and none is wanted: the
        registry decides. The instance has to be a demo, closed, and
        past its expiration by the grace period, and this reads that
        for itself rather than taking the caller's word -- so the worst
        a caller can do by reaching it is drop a demo the policy had
        already finished with.

        @method deleteExpiredDemo
        @param {String} database Target database name
        @return {Promise} Boolean, whether it was dropped
    */
    that.deleteExpiredDemo = async function (dbName) {
        let conf = await config.read();
        let target = writableName(dbName, conf);
        let days = demoGraceDays(conf);

        if (target.message) {
            return Promise.reject(target.message);
        }
        if (!days) {
            return false;
        }

        let allowed = await manager.run(
            (mclient) => mclient.query(
                (
                    "SELECT 1 FROM tenant " +
                    "WHERE pg_database = $1 AND is_demo " +
                    "  AND NOT is_active AND NOT is_deleted " +
                    "  AND expiration IS NOT NULL " +
                    "  AND expiration < now() - ($2 || ' days')::interval"
                ),
                [target.name, String(days)]
            )
        );

        if (!allowed.rows.length) {
            return false;
        }

        await dropDatabaseNow(target.name, "system");
        return true;
    };

    /**
        Build a template database from an application database.

        The new copy is built under a working name and only swapped in
        once it is complete, so a build that fails leaves the template
        that was already there (tenant plan D.2). `CREATE DATABASE ...
        TEMPLATE` needs the source to have no other sessions, so this
        gives up the pool and the LISTEN connection this process holds
        and then refuses if anyone else is still connected, rather than
        taking a working database away from whoever is using it.

        @method createTemplateDatabase
        @param {String} superuser Postgres super user name
        @param {String} password Postgres super user password
        @param {String} database Source database name
        @param {String} template Template database name
        @return {Object} Promise
    */
    that.createTemplateDatabase = async function (
        superuser,
        superpwd,
        dbName,
        template
    ) {
        /*
            Credentials are optional since D.4: the service account owns
            the databases it installs, so it can clone and rename them.
            Only the pg_database template mark is a superuser's to set,
            and that mark is best effort below -- a template without it
            still provisions, because the service account owns the copy.
        */
        let marked = true;

        const sqlDrop = "DROP DATABASE IF EXISTS %I WITH (FORCE);";
        const sqlCopy = "CREATE DATABASE %I TEMPLATE %I;";
        const sqlRename = "ALTER DATABASE %I RENAME TO %I;";
        const sqlMark = "ALTER DATABASE %I WITH IS_TEMPLATE %s;";
        const sqlBusy = (
            "SELECT count(*)::int AS n FROM pg_stat_activity " +
            "WHERE datname = $1 AND pid <> pg_backend_pid()"
        );
        const sqlExists = "SELECT 1 FROM pg_database WHERE datname = $1";
        let conf = await config.read();
        let source = that.databaseName(dbName);
        let wanted = writableName(template, conf);
        let target;
        let stem;
        let building;
        let previous;
        let tenant;
        let swapped = false;
        let client;
        let busy;

        async function exists(name) {
            let resp = await client.query(sqlExists, [name]);

            return resp.rows.length > 0;
        }

        function drop(name) {
            return client.query(sqlDrop.format([name]));
        }

        async function mark(name, isTemplate) {
            try {
                await client.query(sqlMark.format([name, isTemplate]));
            } catch (err) {
                // insufficient_privilege: the mark needs a superuser
                if (err.code !== "42501") {
                    throw err;
                }
                marked = false;
            }
        }

        function rename(from, to) {
            return client.query(sqlRename.format([from, to]));
        }

        if (!source) {
            return Promise.reject(badNameMessage(dbName));
        }

        if (wanted.message) {
            return Promise.reject(wanted.message);
        }

        target = wanted.name;

        if (source === target) {
            return Promise.reject(
                "A database cannot be its own template"
            );
        }

        stem = target.slice(0, 52);
        building = stem + "_building";
        previous = stem + "_previous";
        tenant = tenants.find((t) => t.pgDatabase === source);

        client = new Client({
            database: config.managerDatabase(conf),
            host: conf.pgHost,
            password: superpwd || conf.pgPassword,
            port: conf.pgPort,
            user: superuser || conf.pgUser
        });

        // Let go of the source: a template copy needs it quiet
        await releaseTenant(tenant);

        try {
            await client.connect();

            busy = await client.query(sqlBusy, [source]);

            if (busy.rows[0].n) {
                // Nothing is built yet, so the undo below finds
                // nothing to put back
                throw new Error(
                    "\"" + source + "\" has " + busy.rows[0].n +
                    " other session(s). A template copy needs the " +
                    "database to itself, so no template was built."
                );
            }

            // Anything left from a build that did not finish
            await drop(building);
            await client.query(sqlCopy.format([building, source]));

            /*
                Swap, keeping the old template until the new one is in
                place. The old code dropped the template first and
                wrote datistemplate in pg_database by hand, so a build
                that failed left no template at all.
            */
            let had = await exists(target);

            if (had) {
                await mark(target, "false");
                await drop(previous);
                await rename(target, previous);
            }

            await rename(building, target);
            swapped = true;
            await mark(target, "true");
            await drop(previous);
        } catch (err) {
            if (!swapped) {
                try {
                    // Put the old template back, clear the attempt
                    await drop(building);

                    let gone = !(await exists(target));
                    let kept = await exists(previous);

                    if (gone && kept) {
                        await rename(previous, target);
                        await mark(target, "true");
                    }
                } catch (undoErr) {
                    console.error(
                        "Could not undo the template build of \"" +
                        target + "\". The copy being built is \"" +
                        building + "\" and the template that was there " +
                        "is \"" + previous + "\": " +
                        (undoErr.message || undoErr)
                    );
                }
            }

            /*
                Rethrown, not returned as a rejected promise: a
                rejected promise returned from a try whose finally
                awaits is nobody's while the finally runs, and Node
                reports it as an unhandled rejection.
            */
            throw err;
        } finally {
            await client.end();
            // Resume listening to events on the source database
            if (tenant) {
                that.listen(tenant).catch(function (err) {
                    console.error(
                        "Could not resume listening to " + source +
                        ": " + (err.message || err)
                    );
                });
            }
        }

        await auditDatabase(
            "database.templated",
            superuser || conf.pgUser,
            target + " from " + source
        );

        return {marked, template: target};
    };

    /**
        Claim a piece of named work for a window of time, so the same
        work runs once however many nodes are running (tenant plan E.1).
        First caller in wins and the rest are told no until the window
        passes; a claim is a row in the manager, so it survives the
        claimant dying and expires on its own rather than leaking.

        The scheduler calls this before firing a job -- claim the job's
        name for its interval, run it on a win, stay quiet on a loss.

        @method claimWork
        @param {String} key What is being claimed, e.g. a cron job name
        @param {Number} [seconds] How long the claim holds. Default 60.
        @return {Promise} Boolean, whether the caller holds the claim
    */
    that.claimWork = async function (key, seconds) {
        let window = Math.max(1, Math.floor(seconds || 60));
        let conn = await db.connect();

        try {
            /*
                The table is made on first use. CREATE TABLE IF NOT
                EXISTS is not safe against itself: two processes making
                it at the same instant can both pass the existence
                check and one then dies on the catalog's unique index
                (pg_type_typname_nsp_index). Look first, and when it has
                to be made serialize on an advisory lock so only one
                process makes it and the rest find it there.
            */
            let found = await conn.client.query(
                "SELECT to_regclass('\"$claim\"') IS NOT NULL AS found"
            );

            if (!found.rows[0].found) {
                await conn.client.query(
                    "SELECT pg_advisory_lock(hashtext('featherbone.claim'))"
                );
                try {
                    await conn.client.query(
                        "CREATE TABLE IF NOT EXISTS \"$claim\" (" +
                        "  key text PRIMARY KEY," +
                        "  claimed_by text NOT NULL DEFAULT ''," +
                        "  until timestamp with time zone NOT NULL" +
                        ")"
                    );
                } finally {
                    await conn.client.query(
                        "SELECT pg_advisory_unlock(" +
                        "hashtext('featherbone.claim'))"
                    );
                }
            }

            let resp = await conn.client.query(
                (
                    "INSERT INTO \"$claim\" (key, claimed_by, until) " +
                    "VALUES ($1, $2, now() + ($3 || ' seconds')" +
                    "::interval) " +
                    "ON CONFLICT (key) DO UPDATE SET " +
                    "  claimed_by = $2, " +
                    "  until = now() + ($3 || ' seconds')::interval " +
                    "WHERE \"$claim\".until < now() " +
                    "RETURNING key"
                ),
                [key, db.nodeId || "", String(window)]
            );

            return resp.rows.length > 0;
        } finally {
            conn.done();
        }
    };

    // Run an action against every registered tenant. A tenant that can't be
    // reached is reported and skipped so one bad tenant can't block startup.
    async function eachTenant(action) {
        let n = 0;
        let resp;
        let tenant;
        while (n < tenants.length) {
            tenant = tenants[n];
            n += 1;
            try {
                resp = await db.connect(tenant);
                try {
                    await action(resp.client, tenant);
                } finally {
                    resp.done();
                }
            } catch (err) {
                console.error(
                    "Startup cleanup skipped " + tenant.pgDatabase + ": " +
                    (err.message || err)
                );
            }
        }
    }

    /**
        Release record locks and subscriptions left by nodes that are no
        longer running, on every tenant. Never touches a live node's, so
        several nodes may share the same databases.

        @method cleanupNodes
        @return {Promise}
    */
    that.cleanupNodes = function () {
        return eachTenant((client) => events.cleanupNodes(client));
    };

    // For interrupted process cleanup after server restart. Only processes
    // whose Postgres backend is gone are stopped, so a restart of one node
    // leaves another node's in-flight processes alone.
    that.cleanupProcesses = function () {
        let sql1 = (
            "UPDATE server_process SET " +
            "  status = 'S', " +
            "  completed = now(), " +
            "  error_message = 'Stopped by server restart' " +
            "WHERE status = 'P' AND (" +
            "  (process_id IS NOT NULL AND NOT EXISTS (" +
            "    SELECT 1 FROM pg_stat_activity " +
            "    WHERE pid = server_process.process_id" +
            "    AND datname = current_database()))" +
            "  OR (process_id IS NULL AND " +
            "    created < now() - interval '5 minutes')" +
            ");"
        );
        return eachTenant((client) => client.query(sql1));
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
        @param {String} [payload.by] Who is making the change, when it is
        not the person themselves (an administrator)
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

        async function commit() {
            let client = conn.client;
            await client.query("COMMIT;");
            conn.done();
        }

        async function rollback() {
            let client = conn.client;
            await client.query("ROLLBACK;");
            conn.done();
        }

        /*
            What kind of contact a person with none gets. Core's is a
            Contact, but an installation with an Employee feather that
            inherits Contact (SupplyChain's Common module) takes the
            employee to be the person behind every user account: its
            trigger on UserAccount patches the account's contact *as an
            Employee*, so a plain Contact linked to an account failed
            there with "Cannot read properties of undefined (reading
            'type')" -- for an administrator saving a person's details,
            for an invitation, and for "Forgot password" alike (John,
            Oct 2026). An employee needs a number, which is a natural
            key someone chooses; the user name, upper case, is made to
            do, with a suffix if another employee already has it.
        */
        async function contactSeed(username) {
            let client = conn.client;
            let found = await client.query(
                (
                    "SELECT 1 FROM feather WHERE name = 'Employee' " +
                    "  AND inherits = 'Contact' AND NOT is_deleted"
                )
            );
            let number;
            let n = 1;
            let taken;

            if (!found.rows.length) {
                return {data: {}, feather: "Contact"};
            }

            number = String(username).toUpperCase();
            taken = async (one) => (await client.query(
                "SELECT 1 FROM employee WHERE number = $1",
                [one]
            )).rows.length > 0;

            while (await taken(number)) {
                n += 1;
                number = String(username).toUpperCase() + "-" + n;
            }

            return {
                data: {isActive: true, number},
                feather: "Employee"
            };
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
                        contactSeed(obj.name).then(function (seed) {
                            return that.request({
                                method: "POST",
                                name: seed.feather,
                                user: obj.by || obj.name,
                                client: conn.client,
                                data: Object.assign({
                                    id: contactId,
                                    firstName: obj.firstName,
                                    lastName: obj.lastName,
                                    phone: obj.phone,
                                    email: obj.email
                                }, seed.data)
                            }, true);
                        }).then(function () {
                            that.request({
                                method: "POST",
                                name: "UserAccount",
                                id: userAccount.id,
                                user: obj.by || obj.name,
                                client: conn.client,
                                data: {
                                    /*
                                        The user account trigger wants
                                        the address on the contact it
                                        is handed, as the account form
                                        sends the whole contact. A
                                        bare id was refused with
                                        "Contact must have a primary
                                        email address" for everyone
                                        whose profile was made at first
                                        sign-in, so they could never
                                        save their own details.
                                    */
                                    contact: {
                                        email: obj.email,
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
                            user: obj.by || obj.name,
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

        return new Promise(function (resolve, reject) {
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
                /*
                    Roll back, then say why. This used to roll back and
                    stop there, so a failed save never answered: the
                    dialog waited on a request that nothing finished.
                */
                async function (err) {
                    try {
                        if (conn) {
                            await rollback();
                        }
                    } catch (ignore) {
                        // The original failure is the one to report
                    }
                    reject(err);
                }
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
    that.getCatalog = async function () {
        let resp = await config.read();
        let dat = await that.request({
            method: "GET",
            name: "getSettings",
            user: resp.pgUser,
            data: {
                name: "catalog",
                force: true
            },
            tenant: false
        });

        return dat;
    };

    /**
        Read and cache a database's catalog, so name resolution and
        dispatch for that database work from its own feather set
        (ADR-002).

        @method primeCatalog
        @param {Object} tenant Tenant whose database to read
        @return {Promise}
    */
    that.primeCatalog = async function (tenant) {
        let resp = await config.read();

        return await that.request({
            method: "GET",
            name: "getSettings",
            user: resp.pgUser,
            data: {name: "catalog"},
            tenant
        });
    };

    /**
        Fetch array of all services.

        @method getServices
        @return {Promise}
    */
    that.getServices = async function () {
        try {
            let resp = await config.read();
            return await that.request({
                method: "GET",
                name: "getServices",
                user: resp.pgUser,
                tenant: false
            });
        } catch (err) {
            return Promise.reject(err);
        }
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
                    user: resp.pgUser,
                    tenant: false
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

        If unlisten is called on a tenant, listen can be called
        again without a callback and it will resume listening against
        the original callback.

        @method listen
        @param {Object} tenant
        @param {Function} [callback]
        @return {Promise}
    */
    that.listen = function (tenant, callback) {
        /*
            One listen at a time per instance. Two overlapping calls
            would each see no connection, open one apiece, and the
            second would wait for the node's advisory lock on the
            database the first already holds -- this process waiting
            on itself, with a pooled connection checked out for good.
            The second caller joins the first instead.
        */
        if (tenant.listenPending) {
            return tenant.listenPending;
        }

        let pending = (async function () {
            let resp = tenant.listenerConn;

            if (!resp) {
                resp = await db.connect(tenant);
                tenant.listenerConn = resp;
                tenant.listenerCallback = (
                    tenant.listenerCallback || callback
                );
            }

            if (!tenant.listenerCallback) {
                throw "Callback must be passed on first listen of tenant";
            }

            await events.listen(
                resp.client,
                db.nodeId,
                tenant.listenerCallback
            );
        }());
        let clear = function () {
            if (tenant.listenPending === pending) {
                delete tenant.listenPending;
            }
        };

        tenant.listenPending = pending;
        pending.then(clear, clear);

        return pending;
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
            t = pTenants[n];
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
    that.unlock = async function (criteria, client, tenant) {
        let theClient;
        let i = 0;
        criteria = criteria || {};
        criteria.nodeId = db.nodeId;

        // Do the work
        async function doUnlock(resp) {
            try {
                let ids = await crud.unlock(resp.client, criteria);
                if (resp.done) {
                    resp.done();
                }
                return ids;
            } catch (e) {
                return Promise.reject(e);
            }
        }

        try {
            if (client) {
                theClient = client;
                return await doUnlock({client: theClient});
            }

            if (tenant) {
                theClient = await db.connect(tenant);
                return await doUnlock(theClient);
            }
        } catch (e) {
            return Promise.reject(e);
        }

        while (i < tenants.length) {
            tenant = tenants[i];
            i += 1;
            try {
                theClient = await db.connect(tenant);
                await doUnlock(theClient);
            } catch (e) {
                console.error(e.message);
            }
        }
    };

    /**
        Install a module from a specified manifest file name.
        Exposes {{#crossLink "Services.Installer/install:method"}}{{/crossLink}}
        via datasource.

        @method install
        @param {String} Manifest filename.
        @param {String} User name.
        @param {Object} [options]
        @param {Object} [options.subscription] Object for progress tracking
        @param {String} [options.processId] Caller-chosen ServerProcess id,
        for a caller with no live subscription to poll for instead
        @param {Object} [options.tenant] Tenant making request
        @param {Object} [options.databases] Target tenant databases
        @return {Object} Promise
    */
    that.install = async function (filename, username, opts) {
        opts = opts || {};
        let target;
        let targets = [];
        let resp;
        let n = 0;

        if (opts.databases && opts.databases.length) {
            while (n < opts.databases.length) {
                target = tenants.find(
                    (t) => t.pgDatabase === opts.databases[n]
                );
                if (!target) {
                    let refused = new Error(
                        "Invalid target database " +
                        opts.databases[n] +
                        " passed"
                    );

                    // Refused before anything was opened, let alone
                    // changed.
                    refused.nothingCommitted = true;
                    throw refused;
                }
                n += 1;
                targets.push(target);
            }
        } else {
            targets.push(undefined);
        }

        resp = await db.connect(opts.tenant);

        /*
            Everything below runs through the connection just opened,
            and it is given back at the end whatever happens. It used
            to be given back only where the work finished: an install
            that threw -- a package naming a feather nothing defines,
            say -- left the client checked out of the instance's pool
            for the life of the process. Eight failed deploys emptied a
            ten-connection pool, and the next request that needed one
            waited for it for ever, so the instance was finished until
            the server restarted. Found 2026-10-24 by a suite that
            deploys a package built to fail (`api/deploy-failure`), as
            a hang in a later file.
        */
        async function work() {

            /*
                A trusted install acts as the service account, which is
                what the command line has always done (install.js sets the
                client's user to config's pgUser). The operator who asked
                is recorded in the audit, not impersonated in the database:
                a platform administrator deploying to a customer's instance
                is generally not a user of it at all, and the row-level
                ownership checks are written for users of the database.
            */
            if (opts.isSuper === true) {
                let conf = await config.read();

                resp.client.currentUser = () => conf.pgUser;
            }

            /*
                Code is never stored in the database. What a module runs
                is read from its package's files (ADR-002), so a directory
                that carries services or a client script has to be a
                package this server holds -- Core, or one put under the
                modules directory -- or there would be nowhere for the
                code to be served from. Refused here, before anything is
                changed, rather than installing a module with no code.
            */
            let said;

            await ensurePackagesScanned();

            try {
                said = JSON.parse(await fs.promises.readFile(
                    path.join(filename, "manifest.json"),
                    "utf8"
                ));
            } catch (ignore) {
                // No readable manifest: the installer will say so
                said = {};
            }

            let held = packages.resolve(said.module, said.version);
            let listed = said.files || [];
            let carriesCode = listed.some(
                (file) => file.type === "service" || file.type === "module"
            );

            if (carriesCode && !(held && (
                path.resolve(held.dir) === path.resolve(filename)
            ))) {
                let refused = new Error(
                    "\"" + said.module + " " + said.version + "\" in " +
                    filename + " is not a package this server holds, " +
                    "and code is never stored in the database. Install " +
                    "it as a package first, then deploy it."
                );

                refused.nothingCommitted = true;
                return Promise.reject(refused);
            }

            // Do the work
            while (targets.length) {
                /*
                    An install aimed at several databases commits each
                    as it goes, so a failure on the second has already
                    changed the first. Only a failure on the first can
                    honestly say nothing was committed.
                */
                if (done > 0) {
                    multiTarget = true;
                }
                await installer.install(
                    that,
                    resp.client,
                    filename,
                    username,
                    {
                        /*
                            "Super" here means a caller the installer need
                            not re-check: it skips the per-database super
                            user lookup, which is what the command line has
                            always passed. A Deploy has already required a
                            platform administrator, and the database it is
                            aimed at is not one the caller has to be a user
                            of, so it passes it too. It used to also skip
                            the ServerProcess progress record, on the
                            reasoning that nothing was watching -- true for
                            the command line, false for a platform admin
                            watching Upgrade or Deploy from the screen, so
                            that part now turns on progress tracking rather
                            than off it whenever the caller hands over a
                            processId to track it by (John, 2026-10-18: "I
                            get no idea of whether it's working or not").
                        */
                        isSuper: opts.isSuper === true,
                        processId: opts.processId,
                        subscription: opts.subscription,
                        tenant: targets.shift()
                    }
                );
                done += 1;
            }
            return filename;
        }

        let done = 0;
        let multiTarget = false;

        let installed;
        let failed;

        try {
            installed = await work();
        } catch (err) {
            failed = err;
        }

        resp.done();
        if (failed !== undefined) {
            if (
                multiTarget &&
                failed &&
                typeof failed === "object"
            ) {
                failed.nothingCommitted = false;
            }
            throw failed;
        }
        return installed;
    };

    /**
        Read one ServerProcess row's progress, for a caller with no
        live subscription of its own to it -- the platform console
        and the Instances screen, neither of which carries the SSE
        wiring the rest of the client uses, so they poll instead
        (John, 2026-10-18: "I get no idea of whether it's working or
        not").

        The row lives on the target tenant, not the manager: a Core
        upgrade or package deploy tracks its own progress on the
        instance it is changing, the same database `install` already
        connects to.

        @method processStatus
        @param {Object} options
        @param {Object} options.tenant Target tenant
        @param {Object} options.data
        @param {String} options.data.id Process id
        @return {Object} {status, percentComplete, errorMessage}, or
        undefined if the process has not been created yet (the caller
        polled before the first write landed)
    */
    that.processStatus = async function (obj) {
        let resp = await db.connect(obj.tenant);
        let sql = (
            "SELECT status, percent_complete AS \"percentComplete\", " +
            "  error_message AS \"errorMessage\" " +
            "FROM server_process WHERE id=$1;"
        );
        let ret = await resp.client.query(sql, [obj.data.id]);

        resp.done();
        return ret.rows[0];
    };

    /**
        Package a module.
        Exposes {{#crossLink "Services.Packager/package:method"}}{{/crossLink}}
        via datasource.

        @method package
        @param {String} name Module name
        @param {String} username User name
        @param {Object} [tenant] Tenant
        @param {Object} [options]
        @param {Boolean} [options.includeDashboard] Bundle the dashboard
        layouts this module owns and its wallpaper image, if any.
        Defaults true.
        @return {Promise}
    */
    that.package = function (name, username, tenant, options) {
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
                        username,
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
        Authenticate against an identity in the manager with no
        instance in play, for the picker at a URL that names no
        database (tenant plan G.1). Exposes
        {{#crossLink "Database/authenticateIdentityOnly:method"}}
        {{/crossLink}} via datasource.

        @method authenticateIdentityOnly
        @param {String} username
        @param {String} password
        @param {String} [organization] Organization name
        @return {Promise}
    */
    that.authenticateIdentityOnly = db.authenticateIdentityOnly;

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
        @param {Client} [payload.tenant] Must be provided if no client provided.
        @param {Boolean} [isSuperUser] Bypass authorization checks.
        Default false.
        @return {Promise}
    */
    that.request = async function (obj, isSuperUser) {
        isSuperUser = Boolean(isSuperUser);

        let theClient;
        let done;
        let transaction;
        let isChild;
        let catalog;
        let reg;
        let isExternalClient = false;
        let wrap = false;
        let isTriggering = (
            obj.client
            ? obj.client.isTriggering()
            : false
        );
        let resolved = false;

        async function begin() {
            if (!theClient.wrapped()) {
                await crud.begin({client: theClient});
                theClient.wrapped(true);
            }
        }

        // Add old/new record objects for convenience
        function doPrepareTrigger(obj) {
            if (!obj.newRec) {
                switch (obj.method) {
                case "POST":
                    obj.newRec = f.copy(obj.data);
                    break;
                case "PATCH":
                    obj.newRec = f.copy(obj.oldRec);
                    jsonpatch.applyPatch(obj.newRec, obj.data);
                    break;
                case "DELETE":
                    break;
                default:
                    throw "Unknown trigger method " + obj.method;
                }

                return;
            }

            theClient.isTriggering(true);
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

        async function rollback(err) {
            // If external, let caller deal with transaction
            if (isExternalClient) {
                return;
            }

            //console.log("ROLLBACK->", obj.name, obj.method);

            if (theClient.wrapped()) {
                await crud.rollback({
                    client: theClient,
                    error: err
                });
                //console.log("ROLLED BACK");
                theClient.currentUser(undefined);
                theClient.wrapped(false);
            }
        }

        async function doExecute() {
            // console.log("EXECUTE->", obj.name, obj.method);
            try {
                if (wrap && !isTriggering) {
                    await begin();
                    return await transaction(obj, false, isSuperUser);
                }

                // Passed client must handle its own transaction wrapping
                return await transaction(obj, isChild, isSuperUser);
            } catch (e) {
                return Promise.reject(e);
            }
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
                ? reg[obj.method][name][trigger].slice()
                : [reg[obj.method][name]]
            );

            try {
                while (transactions.length) {
                    transaction = transactions.shift();
                    resp = await doExecute();
                }

                return resp;
            } catch (e) {
                return Promise.reject(e);
            }
        }

        function clearTriggerStatus() {
            if (!isTriggering) {
                theClient.isTriggering(false);
            }
        }

        async function doTraverseAfter(name) {
            // console.log("TRAVERSE_AFTER->", obj.name, obj.method, name);
            let feather = catalog[name];
            let parent = feather.inherits || "Object";

            async function doTrigger() {
                try {
                    if (name === "Object") {
                        await doMethod(name, TRIGGER_AFTER);
                        clearTriggerStatus();
                        return await commit();
                    }

                    await doMethod(name, TRIGGER_AFTER);
                    clearTriggerStatus();
                    return await doTraverseAfter(parent);
                } catch (e) {
                    return Promise.reject(e);
                }
            }

            try {
                if (obj.noTrigger) {
                    return await commit();
                }

                // If business logic defined, do it
                if (isRegistered(reg, obj.method, name, TRIGGER_AFTER)) {
                    await doPrepareTrigger(obj);
                    return await doTrigger();

                // If traversal done, finish transaction
                } else if (name === "Object") {
                    return await commit(obj.response);

                    // If no logic, but parent, traverse up the tree
                } else {
                    return doTraverseAfter(parent);
                }
            } catch (e) {
                return Promise.reject(e);
            }
        }

        /*
            Code is never written to the database. The service and
            client scripts of a module are read from its package's
            files, so a row carrying one would be a second copy that is
            either ignored or, for a module with no package, source
            code in a table that the server executes. Nothing writes
            them, whoever asks and by whatever route: Install and
            Deploy included. Deleting what older installations hold is
            still allowed, and so is everything else about a Module.
        */
        function scriptWriteRefusal(payload) {
            let touches = false;
            let data = payload.data;

            if (payload.method === "DELETE") {
                return;
            }

            if (payload.name === "DataService") {
                touches = true;
            } else if (payload.name === "Module") {
                if (Array.isArray(data)) {
                    touches = data.some((op) => (
                        typeof op.path === "string" &&
                        op.path.split("/")[1] === "script" &&
                        op.op !== "remove" &&
                        op.value !== ""
                    ));
                } else {
                    touches = Boolean(data && data.script);
                }
            }

            if (!touches) {
                return;
            }

            return (
                "Code is not stored in the database. A module's " +
                "services and client script are read from its package, " +
                "so there is nothing to save here. Change the package " +
                "and deploy it."
            );
        }

        /*
            A module's client script comes from the installed package
            when the server holds one (ADR-002 section 2). The browser
            compiles `Module.script`, which is source code in a table
            that anyone with write access can change, so the same rule
            that governs server services governs the client half: a
            file on disk changes only by deployment access, and a
            module with no package on this server still answers from
            its row.

            Every caller gets the file, a super user included. This
            used to leave the rows as they were for any request made
            as a super user, meant for internal callers -- but
            `isSuperUser` is also the signed-in user's own flag (the
            query route passes it), and since an install no longer
            writes code to rows, every row a deployment touched is
            empty: a super user's browser was handed no code for Core
            or any packaged module. No internal caller reads
            `Module.script` through here (the packager reads its
            tables directly), and none could write one back.
        */
        function fromPackage(resp) {
            let rows;

            if (obj.name !== "Module" || !resp) {
                return resp;
            }

            rows = (
                Array.isArray(resp)
                ? resp
                : [resp]
            );
            rows.forEach(function (row) {
                let src;

                if (!row || !row.name || !row.version) {
                    return;
                }
                if (row.script === undefined) {
                    return;
                }

                src = packages.clientSource(row.name, row.version);

                if (src) {
                    row.script = src.script;
                }
            });

            return resp;
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
                return Promise.reject(error(
                    "method \"" + obj.method + "\" unknown"
                ));
            }

            try {
                obj.response = await doExecute();
                return await doTraverseAfter(obj.name);
            } catch (e) {
                return Promise.reject(e);
            }
        }

        async function doTraverseBefore(name) {
            // console.log("TRAVERSE_BEFORE->", obj.name, obj.method, name);
            let feather = catalog[name];
            let parent = feather.inherits || "Object";

            if (obj.noTrigger) {
                return doQuery();
            }

            async function doTrigger() {
                try {
                    if (name === "Object") {
                        await doMethod(name, TRIGGER_BEFORE);
                        clearTriggerStatus();
                        return await doQuery();
                    }

                    await doMethod(name, TRIGGER_BEFORE);
                    clearTriggerStatus();
                    return await doTraverseBefore(parent);
                } catch (e) {
                    return Promise.reject(e);
                }
            }

            try {
                // If business logic defined, do it
                if (
                    isRegistered(reg, obj.method, name, TRIGGER_BEFORE)
                ) {
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
            } catch (e) {
                return Promise.reject(e);
            }
        }

        async function resolveType() {
            if (resolved) {
                return obj.name;
            }
            let resp;
            let sql = (
                "SELECT tableoid::regclass::text AS object_type " +
                "FROM object WHERE id = $1;"
            );

            resp = await theClient.query(sql, [obj.id]);
            if (resp.rows.length) {
                obj.name = resp.rows[0].object_type.toCamelCase(true);
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
                        if (oldRec[key].length > newRec[key].length) {
                            oldRec[key].length = newRec[key].length;
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

            /*
                An id that is here but deleted. Deleting a record does
                not free its id -- the unique index on id covers deleted
                rows too -- so inserting would fail on a duplicate key,
                which is what a package deploy used to die on whenever
                somebody had deleted one of the records it carries
                (John, Oct 2026: the same deploy failure "for the
                umpteenth time"). A POST that names an id is asserting
                that record, so it comes back and the write lands on it.
            */
            if (!resp) {
                let gone = await crud.doSelect({
                    client: theClient,
                    id: obj.id,
                    name: obj.name,
                    showDeleted: true
                }, false, isSuperUser);

                if (gone) {
                    await theClient.query(
                        "UPDATE object SET is_deleted = false, " +
                        "  updated = now(), updated_by = $2 WHERE id = $1",
                        [obj.id, theClient.currentUser()]
                    );
                    resp = await crud.doSelect(payload, false, isSuperUser);
                }
            }

            if (resp) {
                obj.name = resp.objectType;
                obj.oldRec = Object.freeze(f.copy(resp));
                overlay(obj.data, resp);
                obj.newRec = f.copy(obj.data);
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
                obj.newRec.id = obj.id;
            }
        }

        async function doRequest(resp) {
            let resp2;
            if (!isExternalClient) {
                theClient = resp.client;
                done = resp.done;
            }

            /*
                The catalog of the database this request is for, never a
                process-wide copy: two databases served by one process
                may carry different modules at different versions
                (ADR-002).
            */
            catalog = await settings.catalogFor(theClient);
            reg = await registryFor(theClient);

            // No route writes code to the database (ADR-002)
            if (obj.method !== "GET") {
                let refusal = scriptWriteRefusal(obj);

                if (refusal) {
                    return Promise.reject({
                        message: refusal,
                        statusCode: 405
                    });
                }
            }

            /*
                A read-only feather's write protection used to be that no
                write route was mounted for it, which guarded exactly one
                database's feather list. Enforce it here instead, for
                whatever database the request reached. Internal calls
                pass isSuperUser and install content into read-only
                feathers, so only outside callers are refused.
            */
            if (
                !isSuperUser &&
                obj.method !== "GET" &&
                catalog[obj.name] &&
                catalog[obj.name].isReadOnly
            ) {
                return Promise.reject({
                    statusCode: 405,
                    message: (
                        "Feather \"" + obj.name + "\" is read only"
                    )
                });
            }

            //console.log("REQUEST->", obj.name, obj.method);
            let msg;

            if (!theClient.currentUser() && !obj.user) {
                msg = "User undefined. " + obj.method + " " + obj.name;
                return Promise.reject(msg);
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
                    resp2 = fromPackage(await doQuery());
                    if (!theClient.wrapped()) {
                        theClient.currentUser(undefined);
                    }
                    return resp2;
                } else if (obj.method === "POST" && obj.id) {
                    obj.newRec = f.copy(obj.data);
                    await begin();
                    await doUpsert();
                    return await doTraverseBefore(obj.name);
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
                    await begin();
                    let objectType = await resolveType();
                    obj.oldRec = await f.datasource.request({
                        method: "GET",
                        name: objectType,
                        id: obj.id,
                        client: theClient
                    }, true);

                    // Nothing to change or delete: answer clearly instead of
                    // failing later in the triggers on an undefined record
                    if (!obj.oldRec) {
                        // Soft deleted records are reported by crud; only
                        // answer here when the id does not exist at all
                        let found = await theClient.query(
                            "SELECT 1 FROM object WHERE id = $1;",
                            [obj.id]
                        );
                        if (!found.rows.length) {
                            let err = new Error(
                                "Record " + obj.id + " not found."
                            );
                            err.statusCode = 404;
                            await rollback(err);
                            throw err;
                        }
                    }
                    Object.freeze(obj.oldRec);

                    if (!isExternalClient) {
                        wrap = true;
                    }

                    await begin();
                    try {
                        resp2 = await resolveType();
                        return await doTraverseBefore(resp2);
                    } catch (err) {
                        await rollback(err);
                        return Promise.reject(err);
                    }
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

                    try {
                        obj.newRec = f.copy(obj.data);
                        return await doTraverseBefore(obj.name);
                    } catch (err) {
                        await rollback(err);
                        return Promise.reject(err);
                    }
                }

            // If function, execute it
            } else if (isRegistered(reg, obj.method, obj.name)) {
                try {
                    resp2 = await doMethod(obj.name);
                    await commit();
                    return resp2;
                } catch (err) {
                    await rollback(err);
                    return Promise.reject(err);
                }

            // Young fool, now you will die.
            } else {
                msg = "Function " + obj.method + " ";
                msg += obj.name + " is not registered.";
                return Promise.reject(msg);
            }
        }

        try {
            if (obj.client) {
                isExternalClient = true;
                theClient = obj.client;
                return await doRequest();
            }

            if (obj.tenant === undefined) {
                return Promise.reject(
                    "Either a client or tenant value must be " +
                    "included in the " + obj.method + " request for " +
                    obj.name
                );
            }

            let resp = await db.connect(obj.tenant);
            resp = await doRequest(resp);
            theClient.currentUser(undefined);
            return resp;
        } catch (err) {
            return Promise.reject(err);
        } finally {
            if (done) {
                done();
            }
        }
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
        // Core registrations land in the base registry; a loading
        // module's land in the registry being built for one database
        let target = loadTarget || baseRegistry;

        if (trigger) {
            /*
                A module trigger attaching to an entry this registry
                shares with the base registry must get its own copy
                first, or the trigger would leak into every other
                database's registry through the shared object.
            */
            if (
                loadTarget &&
                typeof target[method][name] === "function" &&
                target[method][name] === baseRegistry[method][name]
            ) {
                let shared = target[method][name];

                target[method][name] = function (...args) {
                    return shared.apply(this, args);
                };
            }

            if (!target[method][name]) {
                target[method][name] = {};
            }
            if (!target[method][name][trigger]) {
                target[method][name][trigger] = [];
            }
            target[method][name][trigger].push(func);
        } else {
            target[method][name] = func;
        }
        return that;
    };

    /**
        @method registeredFunctions
        @return {Object} Object listing registered functions
    */
    that.registeredFunctions = function () {
        let keys = Object.keys(baseRegistry);
        let result = {};

        keys.forEach(function (key) {
            result[key] = Object.keys(baseRegistry[key]);
        });

        return result;
    };

    /**
        Append all npm dependencies defined in modules
        on to `f` global variable.

        @method loadModules
        @return {Promise}
    */
    that.loadNpmModules = async function () {
        /*
            Libraries are loaded with the database's modules now, in
            the per-database registry build, from each package's own
            directory (ADR-002 question 1). This stayed as a no-op
            because the installer and the boot sequence both call it,
            and because it used to read `tenant: false` -- the manager
            -- so on a multi-instance installation it was loading the
            wrong database's rows anyway.
        */
        return;
    };

     /**
        Load the postgres encryption key into the crud instance.

        @method loadCryptoKey
        @return {Promise}
    */
    that.loadCryptoKey = async function () {
        let conf = await config.read();
        db.cryptoKey(conf.pgCryptoKey);
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
    that.loadServices = async function (ignore, pClient) {
        /*
            Service registrations live in per-database registries built
            on demand (ADR-002), so loading is invalidation: the next
            request for the database rebuilds its registry from the
            server's packages and the database's own rows. With no
            client every registry is dropped, which is what boot and a
            package installation on the server want.
        */
        if (pClient && pClient.database) {
            delete dbRegistries[pClient.database];
            delete dbRoutes[pClient.database];
            return;
        }

        dbRegistries = {};
        dbRoutes = {};
        packagesScanned = false;
    };

    /**
        Load all tenant data into memory.

        @method loadTenants
        @return {Promise}
    */
    that.loadTenants = async function () {
        let conf = await config.read();
        let conn = await db.connect();
        let tservices = await that.request({
            client: conn.client,
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
            client: conn.client,
            method: "GET",
            name: "Tenant",
            properties: ["id", "name", "pgService", "pgDatabase", "edition"],
            user: conf.pgUser
        }, true);
        /*
            Maintenance is read on its own (ADR-002 question 7) rather
            than as a Tenant property, so the registry still loads
            against a manager that has not been upgraded for it.
        */
        let maintenance = await manager.maintenanceFlags(conn.client);
        let tenant;
        let n = 0;
        let svc;
        let found;
        conn.done();

        while (n < pTenants.length) {
            tenant = pTenants[n];
            n += 1;
            found = tenants.find((t) => t.id === tenant.id);

            /*
                An instance already in the registry keeps its live
                objects -- its pool and its LISTEN connection hang off
                this one -- but the fields the manager owns are read
                again, because loadTenants runs on every Tenant change
                and those changes have to reach the process. Before,
                only new rows were looked at, so flipping a flag in
                the manager changed nothing until a restart.
            */
            if (found) {
                found.name = tenant.name;
                found.edition = tenant.edition;
                found.isMaintenance = maintenance[tenant.id] === true;
            }

            if (!found) {
                svc = tservices.find((s) => s.id === tenant.pgService.id);
                tenant.pgService = svc;

                try {
                    // Test connection
                    conn = await db.connect(tenant);
                    conn.done();
                } catch (ignore) {
                    /*
                        Registered either way: the registry says what
                        the manager holds, not what answered just now,
                        and a database that is down must come back
                        without a restart. The old message said
                        "Skipping" while registering it anyway.
                    */
                    console.error(
                        "Could not connect to " +
                        tenant.pgDatabase +
                        ". Registered, but requests to it will fail " +
                        "until it answers."
                    );
                }

                tenant.isMaintenance = maintenance[tenant.id] === true;
                tenants.push(tenant);
            }
        }

        /*
            Instances the manager no longer holds leave the registry,
            and this process gives up their pool and LISTEN connection.
            loadTenants runs again whenever a Tenant row changes, so
            this is where a deleted or unregistered instance actually
            goes away; before, the registry only ever grew (tenant plan
            D.3).
        */
        let dropped = that.registryChanges(tenants, pTenants);
        let d = 0;

        while (d < dropped.length) {
            tenant = dropped[d];
            d += 1;
            tenants.splice(tenants.indexOf(tenant), 1);
            await releaseTenant(tenant);
        }

        /*
            The manager database, which the registry does not list
            because it is not an instance (tenant plan section 9). It is
            here so requests that name no instance -- sessions, the
            registry itself -- have a connection to reach.
        */
        if (!tenants.find((t) => t.id === "-1")) {
            tenants.unshift({
                id: "-1",
                name: "Manager",
                pgService: {
                    name: "Default service",
                    pgHost: conf.pgHost,
                    pgPort: conf.pgPort,
                    pgUser: conf.pgUser,
                    pgPassword: conf.pgPassword
                },
                pgDatabase: config.managerDatabase(conf)
            });
        }
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
        // The registry a module is loading into when called at load
        // time, the base registry otherwise (ADR-002)
        let reg = loadTarget || baseRegistry;

        if (!reg[method]) {
            return;
        }

        if (trigger) {
            if (reg[method][name]) {
                return reg[method][name][trigger] || [];
            } else {
                return;
            }
        }

        return reg[method][name];
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
    that.registerFunction("GET", "getHelpContents", help.getContents);
    that.registerFunction("GET", "getHelpFile", help.getFile);
    that.registerFunction("GET", "getHelpTopic", help.getTopic);
    that.registerFunction("GET", "getAbout", about.getAbout);
    that.registerFunction("GET", "getOpenApi", openApi.getSpec);
    that.registerFunction("GET", "getProfile", profile.getProfile);
    that.registerFunction("GET", "getRoutes", routes.getRoutes);
    that.registerFunction("GET", "getRouteFunction", getRouteFunction);
    that.registerFunction("GET", "getSettings", settings.getSettings);
    that.registerFunction(
        "GET",
        "settingIsAuthorized",
        settings.settingIsAuthorized
    );
    that.registerFunction("GET", "getSettingsRow", settings.getSettingsRow);
    that.registerFunction(
        "GET",
        "getSettingsDefinition",
        settings.getSettingsDefinition
    );
    that.registerFunction("GET", "getDashboard", dashboards.getDashboard);
    that.registerFunction("GET", "getDashboards", dashboards.getDashboards);
    that.registerFunction(
        "GET",
        "getDashboardTargets",
        dashboards.getDashboardTargets
    );
    that.registerFunction("GET", "getWorkbook", workbooks.getWorkbook);
    that.registerFunction("GET", "getWorkbooks", workbooks.getWorkbooks);
    that.registerFunction(
        "GET",
        "getNavigationCategories",
        navigationCategories.getNavigationCategories
    );
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
    that.registerFunction(
        "POST",
        "saveAuthorization",
        feathers.saveAuthorization
    );
    that.registerFunction("POST", "saveMeta", meta.saveMeta);
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
    that.registerFunction("PUT", "saveDashboard", dashboards.saveDashboard);
    that.registerFunction(
        "PUT",
        "saveDashboardTarget",
        dashboards.saveDashboardTarget
    );
    that.registerFunction("PUT", "saveWorkbook", workbooks.saveWorkbook);
    that.registerFunction(
        "PUT",
        "saveNavigationCategories",
        navigationCategories.saveNavigationCategories
    );
    that.registerFunction("DELETE", "deleteFeather", feathers.deleteFeather);
    that.registerFunction("DELETE", "deleteModule", installer.deleteModule);
    that.registerFunction(
        "DELETE",
        "deleteDashboard",
        dashboards.deleteDashboard
    );
    that.registerFunction(
        "DELETE",
        "deleteDashboardTarget",
        dashboards.deleteDashboardTarget
    );
    that.registerFunction("DELETE", "deleteWorkbook", workbooks.deleteWorkbook);

    /*
        Service scripts loaded by the registry builder call
        `f.datasource.registerFunction(...)`, and they load on the first
        request whether this process is the server or the installer, so
        the datasource wires itself up rather than relying on the entry
        point to do it.
    */
    f.datasource = that;

}(exports));