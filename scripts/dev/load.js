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
/*jslint node, unordered*/
/*
    Run a developer data script against one instance database.

    DEVELOPER TOOL. Every script it runs changes data irreversibly, so it
    will not run anything that does not carry the header marker

        -- @featherbone-dev-script v1

    which is what stops `--script` being pointed at an arbitrary .sql or
    .js file by accident. It prints what it is about to do, to which
    database, and asks before doing it.

        npm run dev:load -- --script scripts/dev/demo-data/teardrop-campers.sql --db demo
        npm run dev:load -- --clear --script scripts/dev/demo-data/teardrop-campers.sql --db demo
        npm run dev:load -- --clear --db demo            (empty it, load nothing)
        npm run dev:load -- --list

    Connection settings come from server/config.json (and the environment,
    as everywhere else), so there is nothing to configure here. The data
    scripts are plain SQL run through psql, which must be on the PATH.

    The real safety checks live inside the scripts themselves and run in
    the database: they refuse a manager database, refuse a database that
    is not empty when the script needs an empty one, and do their work in
    one transaction. This tool is the warning and the prompt.
*/
(function () {
    "use strict";

    const {Client} = require("pg");
    const {Config} = require("../../server/config");
    const {spawn} = require("child_process");
    const fs = require("fs");
    const path = require("path");
    const readline = require("readline");

    const MARKER = "@featherbone-dev-script";
    const HEADER_LINES = 60;
    const ROOT = path.resolve(__dirname, "../..");
    const CLEAR = path.join(ROOT, "scripts/dev/clear-instance-data.sql");
    const DEMO_DIR = path.join(ROOT, "scripts/dev/demo-data");

    const config = new Config();
    let argv = process.argv;
    let scriptArg;
    let dbName;
    let doClear = false;
    let dryRun = false;
    let assumeYes = false;
    let allowProd = false;
    let clearOrphans = false;
    let keepList = "";
    let anchor = "";

    function fail(msg) {
        console.error("\n" + msg + "\n");
        process.exit(1);
    }

    function flagValue(name) {
        let i = argv.indexOf(name);

        if (i === -1 || i + 1 >= argv.length) {
            fail(name + " needs a value.");
        }
        return argv[i + 1];
    }

    function usage() {
        console.log(
            "\nUsage: npm run dev:load -- [options]\n\n" +
            "  --script <file>   developer data script to run; must carry the\n" +
            "                    \"" + MARKER + "\" header marker\n" +
            "  --db <database>   instance database to run it against\n" +
            "  --clear           empty the application tables first, with\n" +
            "                    scripts/dev/clear-instance-data.sql\n" +
            "  --keep <list>     comma separated feather names the clear step\n" +
            "                    should leave alone, e.g. Terms,ShipMethod,Site\n" +
            "  --clear-orphans   let the clear step also empty object-derived\n" +
            "                    tables that no installed feather accounts for\n" +
            "  --anchor <date>   the date the data script should treat as \"today\",\n" +
        "                    e.g. 2027-07-05; a script that carries no anchor\n" +
        "                    ignores it\n" +
        "  --allow-prod      permit a database whose $db.mode is \"prod\"\n" +
            "  --dry-run         show the plan and the clear step's report;\n" +
            "                    change nothing\n" +
            "  --yes             skip the confirmation prompt (for scripted use)\n" +
            "  --list            list the data scripts that are available\n"
        );
    }

    function listScripts() {
        let found = [];

        try {
            found = fs.readdirSync(DEMO_DIR).filter(function (name) {
                return name.endsWith(".sql");
            }).sort();
        } catch (ignore) {
            found = [];
        }
        if (!found.length) {
            console.log("\nNo data scripts in " + DEMO_DIR + "\n");
            return;
        }
        console.log("\nData scripts in " + DEMO_DIR + ":\n");
        found.forEach(function (name) {
            let head = readHeader(path.join(DEMO_DIR, name));
            let meta = headerTags(head);

            console.log(
                "  " + name +
                (
                    meta.name
                    ? "\n      " + meta.name
                    : ""
                ) +
                (
                    meta.rows
                    ? "  (" + meta.rows + " rows)"
                    : ""
                ) +
                (
                    meta.marker
                    ? ""
                    : "\n      NOT RUNNABLE: no " + MARKER + " marker"
                )
            );
        });
        console.log("");
    }

    function readHeader(file) {
        let text;

        try {
            text = fs.readFileSync(file, "utf8").split("\n", HEADER_LINES);
        } catch (err) {
            fail("Cannot read " + file + ": " + err.message);
        }
        return text.join("\n");
    }

    function headerTags(head) {
        function tag(name) {
            let re = new RegExp("@" + name + "\\s+(.+)");
            let hit = re.exec(head);

            return (
                hit
                ? hit[1].trim()
                : ""
            );
        }

        return {
            marker: head.indexOf(MARKER) !== -1,
            name: tag("name"),
            rows: tag("rows"),
            target: tag("target"),
            anchor: tag("anchor"),
            destructive: head.indexOf("@destructive") !== -1,
            requiresCleared: head.indexOf("@requires-cleared") !== -1
        };
    }

    function ask(question) {
        return new Promise(function (resolve) {
            let rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question(question, function (answer) {
                rl.close();
                resolve(answer.trim());
            });
        });
    }

    function psql(file, conf, settings) {
        return new Promise(function (resolve, reject) {
            let args = [
                "--host", String(conf.pgHost),
                "--port", String(conf.pgPort),
                "--username", String(conf.pgUser),
                "--dbname", dbName,
                "--no-password",
                "--quiet",
                "--no-psqlrc",
                "-v", "ON_ERROR_STOP=1",
                "-f", file
            ];
            let env = Object.assign({}, process.env, {
                PGPASSWORD: conf.pgPassword || ""
            });
            let opts = Object.keys(settings || {}).map(function (key) {
                return "-c " + key + "=" + settings[key];
            }).join(" ");
            let child;

            if (opts) {
                env.PGOPTIONS = opts;
            }
            child = spawn("psql", args, {env, stdio: "inherit"});
            child.on("error", function (err) {
                if (err.code === "ENOENT") {
                    return reject(new Error(
                        "psql was not found on the PATH. These data scripts " +
                        "are run through psql; install the PostgreSQL client " +
                        "tools, or run the file by hand:\n  psql -d " +
                        dbName + " -v ON_ERROR_STOP=1 -f " + file
                    ));
                }
                reject(err);
            });
            child.on("close", function (code) {
                if (code === 0) {
                    return resolve();
                }
                reject(new Error(
                    path.basename(file) + " failed (psql exit code " +
                    code + "). Nothing was committed."
                ));
            });
        });
    }

    async function inspect(conf) {
        let client = new Client({
            database: dbName,
            host: conf.pgHost,
            password: conf.pgPassword,
            port: conf.pgPort,
            user: conf.pgUser
        });
        let out = {};

        try {
            await client.connect();
        } catch (err) {
            fail(
                "Cannot connect to database \"" + dbName + "\" on " +
                conf.pgHost + ":" + conf.pgPort + " as " + conf.pgUser +
                ".\n" + err.message
            );
        }
        try {
            let marker = await client.query(
                "SELECT kind, mode FROM \"$db\" LIMIT 1"
            ).catch(function () {
                return {rows: []};
            });
            let busy = await client.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity " +
                " WHERE datname = current_database() AND pid <> pg_backend_pid()" +
                "   AND backend_type = 'client backend'"
            );
            let rows = await client.query(
                "SELECT coalesce(sum(n), 0)::bigint AS n FROM (" +
                "  SELECT (xpath('/row/n/text()', query_to_xml(" +
                "    format('select count(*) as n from only %I', c.relname)," +
                "    false, true, '')))[1]::text::bigint AS n" +
                "  FROM pg_class c" +
                "  JOIN public.feather f ON lower(regexp_replace(f.name," +
                "        '([a-z0-9])([A-Z])', '\\1_\\2', 'g')) = c.relname" +
                "  WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace" +
                "    AND NOT f.is_deleted AND f.module IS NOT NULL" +
                "    AND f.module <> 'Core') z"
            ).catch(function () {
                return {rows: [{n: null}]};
            });

            out.kind = (marker.rows[0] || {}).kind || null;
            out.mode = (marker.rows[0] || {}).mode || null;
            out.others = busy.rows[0].n;
            out.appRows = rows.rows[0].n;
        } finally {
            await client.end();
        }
        return out;
    }

    async function run() {
        let conf = await config.read();
        let scriptPath;
        let head;
        let meta = {};
        let state;
        let answer;
        let settings = {};

        if (argv.indexOf("--help") !== -1 || argv.indexOf("-h") !== -1) {
            usage();
            return;
        }
        if (argv.indexOf("--list") !== -1) {
            listScripts();
            return;
        }
        argv.forEach(function (arg) {
            if (arg === "--clear") {
                doClear = true;
            } else if (arg === "--dry-run") {
                dryRun = true;
            } else if (arg === "--yes" || arg === "-y") {
                assumeYes = true;
            } else if (arg === "--allow-prod") {
                allowProd = true;
            } else if (arg === "--clear-orphans") {
                clearOrphans = true;
            } else if (arg === "--script") {
                scriptArg = flagValue("--script");
            } else if (arg === "--db" || arg === "--instance") {
                dbName = flagValue(arg);
            } else if (arg === "--keep") {
                keepList = flagValue("--keep");
            } else if (arg === "--anchor") {
                anchor = flagValue("--anchor");
            } else if (arg.startsWith("--") && [
                "--help", "--list", "--clear", "--dry-run", "--yes",
                "--allow-prod", "--clear-orphans", "--script", "--db",
                "--instance", "--keep", "--anchor"
            ].indexOf(arg) === -1) {
                usage();
                fail("Unknown option " + arg + ".");
            }
        });

        if (!scriptArg && !doClear) {
            usage();
            fail("Nothing to do: give --script, or --clear, or both.");
        }
        dbName = dbName || conf.pgDatabase;
        if (!dbName) {
            fail("No database. Pass --db <database>.");
        }
        if (dbName === config.managerDatabase(conf)) {
            fail(
                "\"" + dbName + "\" is this installation's manager database. " +
                "These scripts only run against an instance."
            );
        }

        if (anchor && !(/^\d{4}-\d{2}-\d{2}$/).test(anchor)) {
            fail("--anchor wants a date as YYYY-MM-DD, not \"" + anchor + "\".");
        }
        if (scriptArg) {
            scriptPath = path.resolve(ROOT, scriptArg);
            if (!fs.existsSync(scriptPath)) {
                fail("No such file: " + scriptPath);
            }
            if (path.extname(scriptPath) !== ".sql") {
                fail(
                    "Only .sql data scripts are run here, and " +
                    path.basename(scriptPath) + " is not one."
                );
            }
            head = readHeader(scriptPath);
            meta = headerTags(head);
            if (!meta.marker) {
                fail(
                    "Refusing to run " + path.basename(scriptPath) + ": its " +
                    "first " + HEADER_LINES + " lines carry no \"" + MARKER +
                    "\" marker.\nThat marker is what distinguishes a developer " +
                    "data script from any other SQL file, so this tool will " +
                    "not run a file without it."
                );
            }
            if (meta.target && meta.target !== "instance") {
                fail(
                    path.basename(scriptPath) + " declares @target " +
                    meta.target + ", which this tool does not run."
                );
            }
        }

        state = await inspect(conf);
        if (state.kind === null) {
            fail(
                "\"" + dbName + "\" has no \"$db\" marker, so it is not a " +
                "Featherbone database this tool recognises."
            );
        }
        if (state.kind !== "instance") {
            fail(
                "\"" + dbName + "\" is kind \"" + state.kind + "\", not " +
                "\"instance\"."
            );
        }
        if (state.mode === "prod" && !allowProd) {
            fail(
                "\"" + dbName + "\" is marked mode=prod. Pass --allow-prod if " +
                "you really mean to change it."
            );
        }
        if (state.others > 0) {
            console.log(
                "\nNote: " + state.others + " other connection(s) are open on " +
                dbName + ". Stop the Featherbone server first, or the clear " +
                "step will refuse to run."
            );
        }

        console.log("\n" + (
            dryRun
            ? "DRY RUN - nothing will be changed."
            : "This will IRREVERSIBLY CHANGE DATA. There is no undo."
        ));
        console.log("\n  database   " + dbName + " on " + conf.pgHost + ":" +
                conf.pgPort + " as " + conf.pgUser);
        console.log("  mode       " + (state.mode || "(unset)"));
        console.log("  holds      " + (
            state.appRows === null
            ? "(could not count application rows)"
            : state.appRows + " application row(s) now"
        ));
        if (doClear) {
            console.log("  step 1     empty the application tables " +
                    "(clear-instance-data.sql)" + (
                keepList
                ? ", keeping " + keepList
                : ""
            ));
        }
        if (scriptPath) {
            console.log("  step " + (
                doClear
                ? "2"
                : "1"
            ) + "     load " + path.basename(scriptPath) + (
                meta.name
                ? " - " + meta.name
                : ""
            ) + (
                meta.rows
                ? " (" + meta.rows + " rows)"
                : ""
            ));
            if (anchor) {
                console.log("             with \"today\" at " + anchor);
            } else if (meta.anchor) {
                console.log("             with \"today\" at " + meta.anchor +
                        " (the script's own default)");
            }
            if (meta.requiresCleared && !doClear && state.appRows) {
                console.log(
                    "             this script needs an empty database and " +
                    "will refuse; add --clear"
                );
            }
        }
        console.log("");

        if (!dryRun && !assumeYes) {
            if (state.mode === "prod") {
                answer = await ask(
                    "This database is marked prod. Type its name (" + dbName +
                    ") to go ahead: "
                );
                if (answer !== dbName) {
                    fail("Name did not match. Nothing done.");
                }
            } else {
                answer = await ask("Do you mean to do this? [Y/n] ");
                if (answer && answer.toLowerCase()[0] !== "y") {
                    fail("Nothing done.");
                }
            }
        }

        if (doClear) {
            settings = {
                "featherbone.clear_confirm": dbName,
                "featherbone.clear_execute": (
                    dryRun
                    ? "off"
                    : "on"
                )
            };
            if (allowProd) {
                settings["featherbone.clear_allow_prod"] = "on";
            }
            if (clearOrphans) {
                settings["featherbone.clear_orphans"] = "on";
            }
            if (keepList) {
                settings["featherbone.clear_keep"] = keepList;
            }
            if (!fs.existsSync(CLEAR)) {
                fail("Cannot find " + CLEAR);
            }
            console.log("--- " + (
                dryRun
                ? "clear (dry run)"
                : "clearing"
            ) + " ---");
            await psql(CLEAR, conf, settings);
        }

        if (scriptPath && !dryRun) {
            console.log("--- loading " + path.basename(scriptPath) + " ---");
            await psql(scriptPath, conf, (
                anchor
                ? {"featherbone.load_anchor": anchor}
                : {}
            ));
        } else if (scriptPath) {
            console.log(
                "--- " + path.basename(scriptPath) + " not run (dry run) ---"
            );
        }

        console.log("\nDone." + (
            dryRun
            ? " Nothing was changed."
            : ""
        ) + "\n");
    }

    run().catch(function (err) {
        fail(err.message);
    });
}());
