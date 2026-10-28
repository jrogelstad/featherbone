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
    const {Settings} = require("./settings");
    const config = new Config();
    const fs = require("fs");
    const path = require("path");
    const f = require("../../common/core");
    let isInstalling = false;

    f.jsonpatch = require("fast-json-patch");
    f.isInstalling = () => isInstalling;

    const api = new API();
    const db = new Database();
    const feathers = new Feathers();
    const settingsService = new Settings();

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
            @param {String} [options.processId] Caller-chosen ServerProcess
            id. With `isSuper`, this is also what decides whether progress
            is tracked at all: a command-line install has nobody to track
            it for and passes neither.
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
                // Work around linter dogma (as server.js does).
                let copyfile = "copyFile";
                let existssync = "existsSync";
                let mkdirsync = "mkdirSync";
                let filename = path.format({
                    root: "/",
                    dir: pDir,
                    base: MANIFEST
                });
                let installedFeathers = false;
                /*
                    Views are not made as each feather is saved when a
                    package is installed under an umbrella: that was
                    deferred to the end, to stay inside the database's
                    shared memory. A batch of records for a feather the
                    install itself created has no view to write through
                    until then, so it waits here and runs once the
                    views exist (`runDeferred`).

                    What it looked like: a package that seeded records
                    into its own new feather failed the whole install
                    on `relation "_sales_region" does not exist`
                    (John, Oct 2026). Nothing had done that before;
                    every batch wrote to a framework feather (Form,
                    Route, Style), whose views were already there.
                */
                /*
                    The id of the transaction the install opened, so a
                    failure can tell whether it is still inside it. See
                    rollback() for why that is worth asking.
                */
                let startTxid = null;
                let viewsDeferred = false;
                let newFeathers = [];
                let deferredBatches = [];
                // Package id -> id already here, from natural-key overwrites,
                // so later records pointing at the package's id still land.
                let heldIds = {};
                let pProcess;
                let pIsSuper = opts.isSuper;
                let pSubscr = opts.subscription;
                let pProcessId = opts.processId;
                /*
                    What the database being installed into is for:
                    "manager" or "instance" (tenant plan section 9). A
                    manifest entry may name a `target` of its own and is
                    skipped where it does not apply, which is how the
                    manager's feathers stay out of application databases.
                    A target of "both" on a file or a package means it
                    installs either side -- the framework itself does.
                */
                let pTarget = opts.target || "instance";
                let reqClient = pClient;
                let conn;
                /*
                    Whether this install writes to a database other
                    than the caller's own, which decides how it
                    finishes. One install's answer, not the process's:
                    it used to be module-level state that the first
                    deployment set and nothing ever cleared, so every
                    later install in that process took the remote path
                    whether or not it had a connection of its own to
                    take it on -- and the one that did not died on
                    `conn.done()` with nobody listening, leaving the
                    request unanswered and the instance held.
                */
                let isRemote = false;

                reqClient.currentUser(pUser);
                f.datasource = pDatasource;
                isInstalling = true;

                /*
                    The database this install writes to, and what kind
                    it is. Every path through this function needs it,
                    including the one that tracks no progress, so it is
                    its own step rather than part of the progress
                    set-up it used to sit in: an install aimed at
                    another database but sent down that path wrote to
                    the caller's own instead.
                */
                async function openTarget() {
                    // If target database is other than requestor's,
                    // connect to it
                    if (opts.tenant) {
                        conn = await db.connect(opts.tenant);
                        pClient = conn.client;
                        isRemote = true;

                        /*
                            Who this connection writes as. A trusted
                            install acts as the service account, which
                            is what the caller's own connection was
                            already given (datasource.install) and what
                            a deployment needs: the operator who asked
                            is generally not a user of the instance
                            being deployed to at all, and the ownership
                            checks are written for users of it. The
                            operator is in the audit, not in the rows.
                        */
                        if (pIsSuper) {
                            pClient.currentUser = reqClient.currentUser;
                        } else {
                            pClient.currentUser(pUser);
                        }
                    }

                    /*
                        Unless the caller said, take the kind from the
                        database itself, so installing a package through
                        the UI is checked the same way the command line
                        is. A database installed before the marker
                        existed has none, and accepts anything.
                    */
                    if (!opts.target) {
                        let marked = await pClient.query(
                            "SELECT kind FROM pg_tables, \"$db\" " +
                            "WHERE tablename = '$db' " +
                            "  AND schemaname = 'public'"
                        ).catch(function () {
                            return {rows: []};
                        });

                        if (marked.rows.length) {
                            pTarget = marked.rows[0].kind;
                        }
                    }
                }

                async function init() {
                    let pkgName;

                    await openTarget();

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
                        id: pProcessId,
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

                /*
                    A failed install gives back the connection it
                    opened, as a finished one does. It used to keep it:
                    the client stayed checked out of the instance's
                    pool for the life of the process, and since ending
                    a pool waits for its clients to come back, the next
                    thing needing that instance to itself -- a template
                    copy, a drop -- waited with it, forever. One failed
                    deployment was enough.
                */
                function rollback(reason, opts) {
                    /*
                        A caller holding the instance in maintenance
                        needs to know whether anything was committed
                        before it lets traffic back on, so the failure
                        says. Two ways it can say yes:

                        - The install never got as far as its own
                          COMMIT. The final COMMIT failing counts here
                          too, since Postgres then rolls the whole
                          transaction back itself (`commitFailed`).
                        - But a module's install script can issue its
                          own COMMIT -- the very bug plan item 2.1
                          removed from four SupplyChain services -- and
                          everything before it is then permanent while
                          everything after runs in autocommit. So this
                          asks Postgres whether it is still inside the
                          transaction the install opened. Same id: yes,
                          nothing has committed. A different id: some
                          of it has, so it is reported untagged and the
                          instance stays held. An aborted transaction
                          refuses the question with an error, which
                          also means it is the original one.
                    */
                    let err = (
                        (reason && typeof reason === "object")
                        ? reason
                        : new Error(String(reason))
                    );

                    function stillOurs() {
                        if (opts && opts.commitFailed) {
                            return Promise.resolve(true);
                        }
                        if (startTxid === null) {
                            // Refused before BEGIN: nothing was opened
                            return Promise.resolve(true);
                        }
                        return pClient.query(
                            "SELECT txid_current()::text AS t;"
                        ).then(function (resp) {
                            return resp.rows[0].t === startTxid;
                        }).catch(function () {
                            return true;
                        });
                    }

                    stillOurs().then(function (clean) {
                        err.nothingCommitted = clean;
                        finishRollback(err);
                    });
                }

                function finishRollback(err) {

                    /*
                        The install is over, failed or not. Only the
                        finish cleared this, so after any failure the
                        process went on believing it was installing for
                        the rest of its life -- and `f.isInstalling()`
                        is what a module's own code asks before it
                        starts anything (SupplyChain's ShipEngine
                        initialiser), so that waited for a restart.
                    */
                    isInstalling = false;
                    pClient.query("ROLLBACK;", async function () {
                        if (conn) {
                            try {
                                conn.done();
                            } catch (ignore) {
                                // Already given back
                            }
                            conn = undefined;
                        }
                        console.error(err);
                        console.error("Installation failed.");

                        /*
                            Say so on the install's progress record.
                            The hooks that mark it failed belong to the
                            caller's connection and run only when a
                            request rolls back through crud.rollback;
                            this ROLLBACK is the installer's own, on
                            the connection it opened, so the record was
                            left "processing" for ever and a screen
                            watching it never learned the install had
                            ended (John, Oct 2026: "Just said it was
                            deployed").
                        */
                        /*
                            Two connections, two sets of hooks. The
                            caller's (reqClient) hold the progress
                            record. The installer's own (pClient) hold
                            whatever services registered while doing
                            the work on it -- the settings service
                            registers one per settings row it wrote, to
                            drop that row's process-cache entry if the
                            write is rolled back. Running only the
                            caller's left the installer's cache entries
                            poisoned, which is improvement-plan 6.7:
                            one failed install making the next fail.
                        */
                        let own = pClient.rollbacks || [];
                        let theirs = reqClient.rollbacks || [];
                        let hooks = own.concat(theirs);

                        while (hooks.length) {
                            try {
                                await hooks.shift()(err);
                            } catch (hookErr) {
                                console.error(hookErr);
                            }
                        }

                        reject(err);
                    });
                }

                function runBatch(data, after) {
                    let nextItem;
                    let len = data.length;
                    let b = 0;

                    /*
                        Records for a feather this install created, whose
                        view is not made yet, wait for the end. Only
                        those: the same feather being saved again by an
                        upgrade still has the view it had, and a batch
                        that already worked keeps its place in the order.
                    */
                    let all = data.map((payload) => payload.name);
                    let names = all.filter((nm, idx) => (
                        newFeathers.includes(nm) &&
                        all.indexOf(nm) === idx
                    ));

                    if (!after && viewsDeferred && names.length) {
                        pClient.query(
                            (
                                "SELECT viewname FROM pg_views " +
                                "WHERE schemaname = 'public' " +
                                "  AND viewname = ANY($1);"
                            ),
                            [names.map((nm) => "_" + nm.toSnakeCase())]
                        ).then(function (resp) {
                            if (resp.rows.length < names.length) {
                                deferredBatches.push(data);
                                processFile();
                                return;
                            }

                            runBatch(data, processFile);
                        }).catch(rollback);
                        return;
                    }

                    after = after || processFile;

                    /*
                        A package's data is the package's to assert.
                        Where a record it carries collides with one
                        already here on a natural key, the two are the
                        same record under two ids -- the package's own
                        id is derived from its contents, so a database
                        that acquired the record another way has a
                        different one. The package wins: the write is
                        aimed at the record already there, which POST
                        with an id applies over the top of.

                        Refusing instead left the install half applied
                        and the operator with nothing to do but delete
                        rows by hand (John, Oct 2026).
                    */
                    function overwrite(payload, err) {
                        if (
                            (err || {}).code !== "natural_key_conflict" ||
                            !err.heldBy || payload.id === err.heldBy
                        ) {
                            rollback(err);
                            return;
                        }

                        console.log(
                            "  " + payload.name + " " +
                            err.naturalKey.property + " \"" +
                            err.naturalKey.value + "\" is already here " +
                            "under another id; the package's record " +
                            "replaces it"
                        );

                        heldIds[payload.id] = err.heldBy;

                        let again = Object.assign({}, payload, {
                            id: err.heldBy
                        });

                        again.data = Object.assign({}, payload.data, {
                            id: err.heldBy
                        });

                        pDatasource.request(again, true).then(
                            nextItem
                        ).catch(rollback);
                    }

                    // Relations naming a package id that overwrite() mapped
                    // to the record already here point at that record.
                    function heldRefs(value) {
                        if (Array.isArray(value)) {
                            return value.map(heldRefs);
                        }
                        if (value === null || typeof value !== "object") {
                            return value;
                        }
                        let out = {};

                        Object.keys(value).forEach(function (key) {
                            out[key] = (
                                (key === "id" && heldIds[value.id])
                                ? heldIds[value.id]
                                : heldRefs(value[key])
                            );
                        });
                        return out;
                    }

                    // Iterate recursively
                    nextItem = function () {
                        let payload;

                        if (b < len) {
                            payload = data[b];
                            if (payload.data) {
                                payload.data = heldRefs(payload.data);
                            }
                            if (heldIds[payload.id]) {
                                payload.id = heldIds[payload.id];
                            }
                            payload.user = pUser;
                            payload.client = pClient;
                            b += 1;
                            pDatasource.request(payload, true).then(
                                nextItem
                            ).catch(function (err) {
                                overwrite(payload, err);
                            });
                            return;
                        }

                        // We're done here
                        after();
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
                                dependencies: deps,
                                npm: pNpm
                            }
                        };

                        /*
                            A new module starts with no script. One that
                            exists keeps what its row holds: a POST over
                            an id is an upsert that leaves alone any
                            property it does not carry, so naming an
                            empty script here would blank, for the
                            modules that have no package on this server,
                            the only copy of their client code. Code is
                            never written by an install either way.
                        */
                        if (!found) {
                            payload.data.script = "";
                        }

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
                            newFeathers.push(feather.name);

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

                /*
                    Navigation categories arrive from a package by
                    NAME (see services/packager.js), never by id, so
                    that a package can't be broken by ids differing
                    between databases. Create whichever ones this
                    database doesn't have yet; the workbooks installed
                    after this file then bind to them by name, which
                    services/workbooks.js resolves to ids.

                    An existing category keeps its id -- so workbooks
                    already filed under it stay put -- and only takes
                    the package's icon and ordering where the package
                    actually supplies them (John, Oct 2026).
                */
                function saveNavigationCategories(categories) {
                    let len = categories.length;
                    let n = 0;
                    let nextCategory;

                    nextCategory = function () {
                        let cat;
                        let findSql = (
                            "SELECT id FROM \"$navigation_category\" " +
                            "WHERE name = $1;"
                        );

                        if (n >= len) {
                            processFile();
                            return;
                        }

                        cat = categories[n];
                        n += 1;

                        pClient.query(findSql, [cat.name], function (err, res) {
                            let sql;
                            let params;

                            if (err) {
                                rollback(err);
                                return;
                            }

                            if (res.rows.length) {
                                sql = (
                                    "UPDATE \"$navigation_category\" SET " +
                                    "icon=COALESCE($2, icon), " +
                                    "sequence=COALESCE($3, sequence), " +
                                    "updated=now(), updated_by=$4 " +
                                    "WHERE name=$1;"
                                );
                                params = [
                                    cat.name,
                                    cat.icon || null,
                                    (
                                        cat.sequence === undefined
                                        ? null
                                        : cat.sequence
                                    ),
                                    pUser
                                ];
                            } else {
                                sql = (
                                    "INSERT INTO \"$navigation_category\" " +
                                    "(_pk, id, name, icon, sequence, " +
                                    "created, created_by, updated, " +
                                    "updated_by, is_deleted) " +
                                    "VALUES (nextval('object__pk_seq'), " +
                                    "$1, $2, $3, $4, now(), $5, now(), " +
                                    "$5, false);"
                                );
                                params = [
                                    f.createId(),
                                    cat.name,
                                    cat.icon || "",
                                    cat.sequence || 0,
                                    pUser
                                ];
                            }

                            pClient.query(sql, params, function (e) {
                                if (e) {
                                    rollback(e);
                                    return;
                                }

                                nextCategory();
                            });
                        });
                    };

                    nextCategory();
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

                /*
                    Dashboard layouts a package carries. Saved one at a
                    time, in order, because the default flag is a switch
                    -- setting it on one layout takes it off the rest --
                    and sending them together would make which one ends
                    up the default depend on the order they happened to
                    be written in.

                    A layout the package has shipped before is replaced:
                    the module owns it, and an upgrade that could not
                    correct its own board would be worse than one that
                    can. What a person has CHOSEN is in their profile and
                    is untouched by this.
                */
                function saveDashboards(layouts) {
                    let queue = layouts.slice();

                    function next() {
                        let layout = queue.shift();

                        if (!layout) {
                            processFile();
                            return;
                        }
                        pDatasource.request({
                            method: "PUT",
                            name: "saveDashboard",
                            user: pUser,
                            client: pClient,
                            data: Object.assign({}, layout, {
                                // A package claims the default only
                                // where no administrator has chosen
                                // one -- see saveDashboard.
                                fromPackage: true
                            })
                        }, true).then(next).catch(rollback);
                    }

                    next();
                }

                /*
                    The package may carry a sibling file named
                    "<stem>.png"/".jpg"/".jpeg" (plus ".svg" for an
                    icon), by convention rather than a manifest.files
                    entry -- it bears the same relationship to the
                    package that "module"/"version" do. Returns its
                    path, or null. Shared by findDashboardImage and
                    findIconImage below.
                */
                function findBrandAsset(stem, extensions) {
                    let ext = extensions.find(function (candidate) {
                        return fs[existssync](path.format({
                            base: stem + candidate,
                            dir: pDir,
                            root: "/"
                        }));
                    });

                    if (!ext) {
                        return null;
                    }

                    return path.format({
                        base: stem + ext,
                        dir: pDir,
                        root: "/"
                    });
                }

                function findDashboardImage() {
                    return findBrandAsset("dashboard", [
                        ".png", ".jpg", ".jpeg"
                    ]);
                }

                // Unlike the wallpaper, an icon is as likely to be
                // drawn as a vector -- it is small and meant to stay
                // crisp at ribbon/favicon size.
                function findIconImage() {
                    return findBrandAsset("icon", [
                        ".png", ".jpg", ".jpeg", ".svg"
                    ]);
                }

                /*
                    The manifest's own "title", and the package's sibling
                    "dashboard"/"icon" images if it has either, merged
                    into the one shared `brandingSettings` row
                    (ribbon.js/dashboard.js/main.js read it
                    client-side). Whichever package last carried any of
                    the three wins -- the same "package wins" rule as a
                    natural-key conflict -- and a package naming none of
                    them leaves whatever is already there alone.
                */
                function saveBranding() {
                    let patch = {};

                    if (manifest.title) {
                        patch.title = manifest.title;
                    }

                    // Copies one sibling asset in, if the package has
                    // one, and records its upload name on patch under
                    // patchKey -- shared by the dashboard image and
                    // the icon below, which differ only in which file
                    // they look for and which setting they land in.
                    function copyAsset(srcPath, patchKey, suffix) {
                        if (!srcPath) {
                            return Promise.resolve();
                        }

                        return new Promise(function (resolve, reject) {
                            let ext = path.extname(srcPath).toLowerCase();
                            let uploadDir = path.join(
                                process.cwd(),
                                "files",
                                "upload"
                            );
                            let uploadName = (
                                manifest.module.toSpinalCase() +
                                "-" + suffix + ext
                            );

                            if (!fs[existssync](uploadDir)) {
                                fs[mkdirsync](uploadDir, {recursive: true});
                            }

                            fs[copyfile](
                                srcPath,
                                path.join(uploadDir, uploadName),
                                function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }
                                    patch[patchKey] = uploadName;
                                    resolve();
                                }
                            );
                        });
                    }

                    return Promise.all([
                        copyAsset(
                            findDashboardImage(),
                            "dashboardImage",
                            "dashboard"
                        ),
                        copyAsset(findIconImage(), "icon", "icon")
                    ]).then(function () {
                        if (
                            !patch.title &&
                            !patch.dashboardImage &&
                            !patch.icon
                        ) {
                            return Promise.resolve();
                        }

                        return pClient.query(
                            "SELECT data FROM \"$settings\" " +
                            "WHERE name='brandingSettings';"
                        ).then(function (resp) {
                            let row = resp.rows[0] || {};
                            let data = Object.assign(
                                {},
                                row.data || {},
                                patch
                            );

                            return settingsService.saveSettings({
                                client: pClient,
                                data: {
                                    data,
                                    name: "brandingSettings"
                                },
                                isInternal: true,
                                user: pUser
                            });
                        });
                    });
                }

                // Given the path inside the package dir, not the cwd's
                function execute(filepath) {
                    let exp = require(path.resolve(filepath));

                    exp.execute({
                        user: pUser,
                        client: pClient,
                        target: pTarget,
                        mode: opts.mode
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
                    viewsDeferred = true;
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

                        // Only a remote install opened one
                        if (conn) {
                            conn.done();
                        }
                    }

                    /*
                        Both endings answer the caller whatever
                        happens. A throw in here used to float away as
                        an unhandled rejection with the install's own
                        promise never settled, so the request that
                        asked for it waited for an answer that was
                        never coming -- and a deployment waiting like
                        that leaves the instance held.
                    */
                    function complete() {
                        isInstalling = false;
                        if (isRemote) {
                            updateTenant().then(
                                pProcess.complete
                            ).then(function () {
                                console.log("Remote installation completed!");
                                resolve();
                            }).catch(reject);
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
                        }).catch(reject);
                    }

                    // We deferred propagating views on every feather
                    // to avoid running out of shared memory, so follow
                    // up on that now
                    function handleFeathers() {
                        return new Promise(function (resolve, reject) {
                            feathers.disablePropagation(false);
                            viewsDeferred = false;
                            if (installedFeathers) {
                                feathers.propagateViews(pClient).then(
                                    resolve
                                ).catch(reject);
                                return;
                            }

                            resolve();
                        });
                    }

                    // The batches that waited for the views above
                    function runDeferred() {
                        return new Promise(function (resolve) {
                            function next() {
                                if (!deferredBatches.length) {
                                    resolve();
                                    return;
                                }

                                runBatch(deferredBatches.shift(), next);
                            }

                            next();
                        });
                    }

                    file = manifest.files[i];
                    i += 1;

                    // Not for this kind of database -- move along
                    while (
                        file && file.target &&
                        file.target !== "both" &&
                        file.target !== pTarget
                    ) {
                        file = manifest.files[i];
                        i += 1;
                    }

                    // If we've processed all the files, wrap this up
                    if (!file) {
                        /*
                            Up to and including the COMMIT, a failure
                            rolls back like any other: building the
                            views can fail -- a dependency loop, a
                            relation to nothing -- and that used to
                            reject straight past rollback(), so no
                            ROLLBACK was sent, the connection was never
                            given back, and the process thought it was
                            still installing. After the COMMIT the
                            schema has changed, so a failure there is
                            reported without the "nothing committed"
                            mark, and whoever is holding the instance
                            keeps holding it.
                        */
                        let committed = false;

                        let commitFailed = false;

                        saveBranding().then(handleFeathers).then(
                            runDeferred
                        ).then(function () {
                            return pClient.query("COMMIT;").catch(
                                function (commitErr) {
                                    commitFailed = true;
                                    return Promise.reject(commitErr);
                                }
                            );
                        }).then(function (resp) {
                            committed = true;
                            return resp;
                        }).then(
                            api.buildClientApi.bind(null, pDatasource, pUser)
                        ).then(complete).catch(function (err) {
                            if (!committed) {
                                rollback(err, {commitFailed});
                                return;
                            }
                            isInstalling = false;
                            if (conn) {
                                try {
                                    conn.done();
                                } catch (ignore) {
                                    // Already given back
                                }
                                conn = undefined;
                            }
                            reject(err);
                        });

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
                        /*
                            A manifest naming a file that is not there.
                            This used to log and return, so the install
                            never settled: the request waited for ever,
                            and a deployment waiting like that left the
                            instance held with nobody told why.
                        */
                        if (err) {
                            rollback(new Error(
                                "The package names " + filename +
                                ", which is not in it: " + err.message
                            ));
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
                                execute(filepath);
                                break;
                            case "module":
                                // The record of the module, never its code
                                saveModule(
                                    module,
                                    version,
                                    dependencies,
                                    npm
                                );
                                break;
                            case "service":
                                // Served from the package's file; code is
                                // never stored in the database
                                runBatch([]);
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
                            case "navigationCategory":
                                saveNavigationCategories(JSON.parse(content));
                                break;
                            case "workbook":
                                saveWorkbooks(JSON.parse(content));
                                break;
                            case "dashboard":
                                saveDashboards(JSON.parse(content));
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
                        /*
                            The refusals here come before BEGIN, so
                            nothing has been touched; they go through
                            rollback() all the same, which is what
                            gives the target connection back and marks
                            the failure as one that changed nothing.
                            (ROLLBACK with no transaction open is a
                            warning, not an error.)
                        */
                        if (err) {
                            rollback(err);
                            return;
                        }

                        try {
                            manifest = JSON.parse(data);
                        } catch (parseErr) {
                            rollback(new Error(
                                filename + " is not valid JSON: " +
                                parseErr.message
                            ));
                            return;
                        }

                        /*
                            A package says which kind of database it
                            belongs in. Application modules do not have
                            to say anything -- they default to
                            "instance", which is what keeps them off a
                            manager (tenant plan A.1). The framework's
                            own manifest declares "both".
                        */
                        if (
                            (manifest.target || "instance") !== "both" &&
                            (manifest.target || "instance") !== pTarget
                        ) {
                            rollback(new Error(
                                "Package " + (manifest.module || "") +
                                " installs into a \"" +
                                (manifest.target || "instance") +
                                "\" database, and this one is a \"" +
                                pTarget + "\" database."
                            ));
                            return;
                        }

                        pClient.query("BEGIN;").then(function () {
                            return pClient.query(
                                "SELECT txid_current()::text AS t;"
                            );
                        }).then(function (resp) {
                            startTxid = resp.rows[0].t;
                            processFile();
                        }).catch(rollback);
                    });
                }

                if (pIsSuper && !pProcessId) {
                    // Run from the command line, or from a screen that
                    // tracks its own progress: nobody is watching a
                    // ServerProcess, so there is none to keep. The
                    // target database is still the target database.
                    pProcess = {
                        next: () => true,
                        complete: () => true
                    };
                    openTarget().then(
                        () => registerNpmModules(true)
                    ).then(
                        doInstall
                    ).catch(
                        reject
                    );
                    return;
                }

                if (pIsSuper) {
                    /*
                        A platform operation with someone watching it
                        from a screen (Core upgrade, Deploy): skip the
                        super-user re-check -- a platform administrator
                        already had to pass one to get here, and the
                        database on the other end is not one the
                        caller has to be a user of -- but still track
                        and report progress, same as an ordinary
                        install.
                    */
                    init().then(
                        () => registerNpmModules(true)
                    ).then(
                        doInstall
                    ).catch(
                        reject
                    );
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
                        /*
                            The vendor's help links. A customer's own
                            belongs to no module (ADR-003), so the
                            bright line holds here too: removing a
                            module never takes their help with it.
                        */
                        vClient.query(
                            "DELETE FROM help_link WHERE module=$1",
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
