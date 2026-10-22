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
/*
    Self upgrade at startup (John, Oct 2026).

    An installation with no shell cannot be upgraded the documented
    way, which is `node install.js --manager` and then
    `node install.js --instance <name>` for each instance. A hosted
    installation is exactly that case: the deployment is a restart and
    there is nowhere to type.

    Two switches, both off by default, both environment-overridable
    because that is how a hosted installation is configured:

    selfUpgradeManager
        When the server starts, compare the Core version the manager
        database carries with this checkout's `manifest.json`. If it
        is behind -- or the manager is missing -- run
        `install.js --manager`.

    selfUpgradeInstances
        When the server starts, do the same for every instance the
        manager has registered: each one whose Core version is behind
        (or absent) gets `install.js --instance <name>`. Instances are
        always the registry's; there is no list to keep.

    What runs is the command line itself, as a child process, so
    there is one installer to keep right and a child process keeps the
    installer's own catalog loading out of the caches the server is
    about to build. Every check asks first whether there is anything
    to do, so an ordinary restart of a current installation costs a
    few queries and runs nothing.
*/
(function (exports) {
    "use strict";

    const {Client} = require("pg");
    const {Config} = require("../config");
    const {Packages} = require("./packages");
    const child = require("child_process");
    const path = require("path");
    const fs = require("fs");

    const config = new Config();
    const packages = new Packages();

    // The checkout this server runs from: where install.js lives, and
    // the working directory it reads server/config.json relative to.
    const ROOT = path.resolve(__dirname, "..", "..");

    /*
        One upgrade at a time across every node (tenant plan E).
        `claimWork` is the usual primitive but it lives in the manager,
        which is the very thing that may not exist yet, so this takes a
        session advisory lock on the maintenance database instead. The
        lock is held, not tried: a node that loses has to wait, because
        the alternative is serving an application out of a database
        another node is halfway through upgrading. Having waited, it
        asks the same questions again and finds nothing left to do.
    */
    const LOCK = "featherbone.upgrade";

    exports.Upgrade = function () {
        let that = {};

        /**
            The version this checkout is: what the installer writes
            into a database's Core module row, from the framework's
            own manifest. An instance carrying less than this is
            behind, which is the whole of "needs upgrading" -- so the
            startup path and the Upgrade action on the Instances
            screen read it from here rather than each deciding for
            itself what current means.

            @method version
            @return {String}
        */
        that.version = function () {
            let manifest = path.join(ROOT, "manifest.json");

            return JSON.parse(fs.readFileSync(manifest, "utf8")).version;
        };

        /**
            Where the framework's own manifest lives: the directory an
            instance upgrade applies.

            @method root
            @return {String}
        */
        that.root = function () {
            return ROOT;
        };

        /**
            Whether a database carrying this Core version is behind
            the framework this server runs. One definition, so the
            startup path, the Instances screen and the Upgrade action
            cannot disagree about what "current" means. A database
            with no Core version at all predates the module row and
            is behind by definition.

            @method isBehind
            @param {String} [version] The Core version a database carries
            @return {Boolean}
        */
        that.isBehind = function (version) {
            if (version === undefined || version === null) {
                return true;
            }

            return packages.compareVersions(version, that.version()) < 0;
        };

        function ownVersion() {
            return that.version();
        }

        /**
            What this startup has to do, given what the databases say.
            Separated from the doing so the decision can be tested
            without a cluster: everything that could be got wrong --
            which steps, in what order, with which flags -- is here.

            @method plan
            @param {Object} state
            @param {String} [state.managerKind] "$db" kind of the
                manager database, undefined when it is absent or bare
            @param {String} [state.managerVersion] Core version the
                manager carries, undefined when it has none
            @param {Array} state.instances [{name, version}], version
                being the Core version that instance carries and
                undefined for a database with no Core module row
            @param {String} state.version The version this checkout is
            @param {Object} conf Configuration as returned by `read`
            @return {Array} [{step, args, why}]
        */
        that.plan = function (state, conf) {
            let steps = [];

            function behind(version) {
                return (
                    version === undefined ||
                    version === null ||
                    packages.compareVersions(version, state.version) < 0
                );
            }

            if (conf.selfUpgradeManager) {
                if (state.managerKind !== "manager") {
                    steps.push({
                        args: ["--manager"],
                        step: "manager",
                        why: (
                            state.managerKind === undefined
                            ? "no manager database"
                            : "manager database is a \"" +
                            state.managerKind + "\""
                        )
                    });
                } else if (behind(state.managerVersion)) {
                    steps.push({
                        args: ["--manager"],
                        step: "manager",
                        why: (
                            state.managerVersion === undefined
                            ? "manager carries no Core version"
                            : "manager carries Core " +
                            state.managerVersion + ", this server is " +
                            state.version
                        )
                    });
                }
            }

            if (conf.selfUpgradeInstances) {
                state.instances.forEach(function (instance) {
                    if (!behind(instance.version)) {
                        return;
                    }

                    steps.push({
                        args: ["--instance", instance.name],
                        step: "instance",
                        name: instance.name,
                        why: (
                            instance.version === undefined
                            ? "carries no Core version"
                            : "carries Core " + instance.version +
                            ", this server is " + state.version
                        )
                    });
                });
            }

            return steps;
        };

        // A client on the cluster's own maintenance database, which is
        // there whether or not anything of ours is.
        function maintenanceClient(conf) {
            return new Client({
                database: "postgres",
                host: conf.pgHost,
                password: conf.pgPassword,
                port: conf.pgPort,
                user: conf.pgUser
            });
        }

        function instanceClient(conf, database) {
            return new Client({
                database,
                host: conf.pgHost,
                password: conf.pgPassword,
                port: conf.pgPort,
                user: conf.pgUser
            });
        }

        async function exists(client, database) {
            let resp = await client.query(
                "SELECT datname FROM pg_database WHERE datname = $1",
                [database]
            );

            return resp.rows.length > 0;
        }

        // The "$db" marker's kind, or undefined when the database is
        // absent, unreachable or was never installed.
        async function markerKind(conf, database) {
            let client = instanceClient(conf, database);

            try {
                await client.connect();

                let resp = await client.query(
                    "SELECT kind FROM pg_tables, \"$db\" " +
                    "WHERE tablename = '$db' AND schemaname = 'public'"
                );

                return (
                    resp.rows.length
                    ? resp.rows[0].kind
                    : undefined
                );
            } catch (ignore) {
                return undefined;
            } finally {
                await client.end().catch(() => undefined);
            }
        }

        // What Core version a database carries, undefined when it has
        // no module row to read -- which is what an installation older
        // than the manager looks like.
        async function coreVersion(conf, database) {
            let client = instanceClient(conf, database);

            try {
                await client.connect();

                let resp = await client.query(
                    "SELECT version FROM module " +
                    "WHERE name = 'Core' AND NOT is_deleted"
                );

                return (
                    resp.rows.length
                    ? resp.rows[0].version
                    : undefined
                );
            } catch (ignore) {
                return undefined;
            } finally {
                await client.end().catch(() => undefined);
            }
        }

        // Every instance the registry holds. Empty when there is no
        // manager yet, and then there is nothing to upgrade.
        async function registered(conf) {
            let client = instanceClient(
                conf,
                config.managerDatabase(conf)
            );

            try {
                await client.connect();

                let resp = await client.query(
                    "SELECT pg_database FROM tenant " +
                    "WHERE NOT is_deleted ORDER BY pg_database"
                );

                return resp.rows.map((row) => row.pg_database);
            } catch (ignore) {
                return [];
            } finally {
                await client.end().catch(() => undefined);
            }
        }

        /*
            Hold an instance that failed to upgrade (ADR-002 question
            7), so the server can still start and a platform
            administrator can sign in and see why, rather than the
            process dying in a restart loop with the reason only in a
            log nobody can reach. Best effort: a manager too old to
            have the column, or absent, leaves nothing to mark.
        */
        async function hold(conf, database, logger) {
            let client = instanceClient(
                conf,
                config.managerDatabase(conf)
            );

            try {
                await client.connect();
                await client.query(
                    "UPDATE tenant SET is_maintenance = true " +
                    "WHERE pg_database = $1",
                    [database]
                );
                say(logger, "warn",
                    "Instance \"" + database + "\" is held for " +
                    "maintenance after a failed upgrade"
                );
            } catch (err) {
                say(
                    logger,
                    "warn",
                    "Could not hold \"" + database + "\": " + err.message
                );
            } finally {
                await client.end().catch(() => undefined);
            }
        }

        function named(one) {
            return (
                one.step === "manager"
                ? "manager"
                : "instance \"" + one.name + "\""
            );
        }

        /*
            Said to the log and, when the log is not already writing to
            the console, to the console as well. An upgrade can take
            minutes and runs before the server is listening, so without
            this a restart that is working looks exactly like one that
            is hung: the log goes to a file unless `consolelog` is on.
        */
        function say(logger, level, message) {
            let onConsole = Boolean(
                logger.transports &&
                logger.transports.some((one) => one.name === "console")
            );

            logger[level](message);

            if (!onConsole) {
                (
                    (level === "error" || level === "warn")
                    ? console.error
                    : console.log
                )(message);
            }
        }

        // Whole lines out of a stream that delivers arbitrary chunks.
        function lines(stream, each) {
            let held = "";

            stream.setEncoding("utf8");
            stream.on("data", function (chunk) {
                let text = held + chunk;
                let parts = text.split("\n");

                held = parts.pop();
                parts.filter(Boolean).forEach(each);
            });
            stream.on("end", function () {
                if (held) {
                    each(held);
                }
            });
        }

        // Run one command line act, the way it would be typed, passing
        // what it says along as it says it.
        function execute(step, logger) {
            return new Promise(function (resolve, reject) {
                let script = "install.js";
                let tail = [];
                let proc;

                proc = child.spawn(
                    process.execPath,
                    [path.join(ROOT, script)].concat(step.args),
                    {cwd: ROOT, env: process.env}
                );

                function keep(level) {
                    return function (line) {
                        tail.push(line);
                        tail = tail.slice(-20);
                        say(logger, level, "    " + line);
                    };
                }

                lines(proc.stdout, keep("info"));
                lines(proc.stderr, keep("warn"));

                proc.on("error", reject);
                proc.on("close", function (code) {
                    if (code) {
                        return reject(new Error(
                            "node " + script + " " + step.args.join(" ") +
                            " exited " + code + ": " + tail.join(" | ")
                        ));
                    }

                    resolve();
                });
            });
        }

        /**
            Bring this installation current, if it is asked to and
            anything is behind. Call it before the datasource is
            touched: the manager it connects to is one of the things
            this may have to create.

            Answers what it did. A failure to build the manager is
            fatal -- nothing works without one -- and the caller is
            expected to stop. A failure on one instance holds that
            instance and lets the rest of the server start.

            @method run
            @param {Object} conf Configuration as returned by `read`
            @param {Object} logger
            @return {Promise} {ran, failed, fatal}
        */
        that.run = async function (conf, logger) {
            let done = {failed: [], fatal: false, ran: []};

            if (!conf.selfUpgradeManager && !conf.selfUpgradeInstances) {
                return done;
            }

            let managerDb = config.managerDatabase(conf);
            let lock = maintenanceClient(conf);

            /*
                A hosted cluster does not always let the service
                account into the maintenance database. The lock is
                worth having and not worth failing over: one node with
                no shell -- the case this exists for -- has nobody to
                race. Say so rather than pretending, and carry on.
                `install.js` needs that database too, so if this is a
                real refusal the step after will say it plainly.
            */
            let locked = await lock.connect().then(
                () => true
            ).catch(function (err) {
                say(
                    logger,
                    "warn",
                    "Self upgrade is running without its lock: " +
                    err.message + ". Two nodes starting at once could " +
                    "both upgrade."
                );
                return false;
            });

            try {
                if (locked) {
                    /*
                        Held rather than tried. A node that loses has
                        to wait, because the alternative is serving an
                        application out of a database another node is
                        halfway through upgrading.
                    */
                    let got = await lock.query(
                        "SELECT pg_try_advisory_lock(hashtext($1)) AS got",
                        [LOCK]
                    );

                    if (!got.rows[0].got) {
                        say(
                            logger,
                            "info",
                            "Self upgrade: another node is upgrading; " +
                            "waiting for it to finish"
                        );
                        await lock.query(
                            "SELECT pg_advisory_lock(hashtext($1))",
                            [LOCK]
                        );
                    }
                }

                /*
                    Asked after the lock, never before: a node that
                    waited is looking at what the winner left, and the
                    whole point of waiting is to see it.
                */
                say(
                    logger,
                    "info",
                    "Self upgrade: checking the manager and instances " +
                    "against Core " + ownVersion()
                );

                let managerKind;
                let managerVersion;
                let instances = [];

                if (!locked || await exists(lock, managerDb)) {
                    managerKind = await markerKind(conf, managerDb);
                }

                if (managerKind === "manager") {
                    managerVersion = await coreVersion(conf, managerDb);
                }

                /*
                    Only a manager that is already there has a registry
                    to read. A manager built by this very boot has no
                    instances yet, so there is nothing for the second
                    switch to do until the next one.
                */
                if (conf.selfUpgradeInstances && managerKind === "manager") {
                    let names = await registered(conf);
                    let i = 0;

                    while (i < names.length) {
                        instances.push({
                            name: names[i],
                            version: await coreVersion(conf, names[i])
                        });
                        i += 1;
                    }
                }

                let steps = that.plan({
                    instances,
                    managerKind,
                    managerVersion,
                    version: ownVersion()
                }, conf);

                if (!steps.length) {
                    say(
                        logger,
                        "info",
                        "Self upgrade: nothing to do, everything is " +
                        "current"
                    );
                    return done;
                }

                let n = 0;

                say(
                    logger,
                    "info",
                    "Self upgrade: " + steps.length + " to do: " +
                    steps.map(named).join(", ") + ". The server starts " +
                    "when this is finished."
                );

                while (n < steps.length) {
                    let step = steps[n];
                    let began = Date.now();

                    say(
                        logger,
                        "info",
                        "Self upgrade [" + (n + 1) + "/" + steps.length +
                        "] " + named(step) + ": node install.js " +
                        step.args.join(" ") + " (" + step.why + ")"
                    );

                    try {
                        await execute(step, logger);
                        done.ran.push(step);
                        say(
                            logger,
                            "info",
                            "Self upgrade [" + (n + 1) + "/" +
                            steps.length + "] " + named(step) +
                            ": done in " +
                            Math.round((Date.now() - began) / 1000) + "s"
                        );
                    } catch (err) {
                        say(
                            logger,
                            "error",
                            "Self upgrade failed at " + named(step) +
                            ": " + err.message
                        );
                        done.failed.push(step);

                        if (step.step === "manager") {
                            /*
                                Without a manager there is no registry,
                                no identity and no session: there is
                                nothing to serve and nothing to hold.
                            */
                            done.fatal = true;
                            return done;
                        }

                        if (step.step === "instance") {
                            await hold(conf, step.name, logger);
                        }
                    }

                    n += 1;
                }

                say(
                    logger,
                    "info",
                    "Self upgrade: " + done.ran.length + " of " +
                    steps.length + " steps ran" + (
                        done.failed.length
                        ? "; " + done.failed.length + " failed"
                        : ""
                    )
                );

                return done;
            } finally {
                if (locked) {
                    await lock.query(
                        "SELECT pg_advisory_unlock(hashtext($1))",
                        [LOCK]
                    ).catch(() => undefined);
                    await lock.end().catch(() => undefined);
                }
            }
        };

        return that;
    };

}(exports));

