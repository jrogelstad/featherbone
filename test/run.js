#!/usr/bin/env node
/*
    Featherbone regression test runner.

    Usage:
        node test/run.js                 # core, then every deployed module
        node test/run.js core            # core only: unit + api
        node test/run.js unit            # unit tests only (no database)
        node test/run.js integration     # api + deployed modules
        node test/run.js SupplyChain     # one package's tests
        node test/run.js sell            # one module a package carries
        node test/run.js SupplyChain@2.2.32   # deploy that version first
        node test/run.js --package <dir> [module]   # a working copy
        node test/run.js api/crud        # files whose path contains "api/crud"

    Module tests live in each module's test/ folder (ADR-003). Only the
    version deployed in the source database is tested; @version and
    --package deploy into the throwaway copy, never the source.

    FB_TEST_SKIP is a comma separated list of path fragments to leave
    out, for a file too slow to sit through: FB_TEST_SKIP=upgrade runs
    everything but `api/upgrade.test.js`. Skipped files are named at the
    start of the run, so a green run cannot quietly be a partial one.

    Integration runs clone FB_TEST_SOURCE_DB (default "demo") into
    FB_TEST_DB (default "featherbone_test"), start a server on
    FB_TEST_PORT (default 3990), run the tests one file at a time, then
    stop the server and drop the copy (FB_TEST_KEEP_DB=1 keeps it).
    FB_UPDATE_GOLDEN=1 rewrites golden files instead of comparing.
*/
/*jslint node*/
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {spawnSync} = require("child_process");
const settings = require("./harness/env");
const reporter = require("./harness/reporter");
const {Packages} = require("../server/services/packages");

// Every run appends its counts here, so the session ends with one set of
// failures and totals instead of one per file.
const TALLY = path.join(
    os.tmpdir(),
    "fb-test-tally-" + process.pid + ".jsonl"
);

const SKIP_ASKED = process.env.FB_TEST_SKIP || "";
const SKIP = SKIP_ASKED.split(",").map(
    (part) => part.trim()
).filter((part) => part !== "");

const UNIT_DIRS = ["unit"];
const MODES = ["all", "core", "unit", "integration"];
const INTEGRATION_DIRS = ["api"];

// Where require("featherbone-test") resolves, for module tests
const EXPORT_PATH = [path.join(__dirname, "export")].concat(
    process.env.NODE_PATH
    ? [process.env.NODE_PATH]
    : []
).join(path.delimiter);

function findIn(abs) {
    let out = [];
    if (!fs.existsSync(abs)) {
        return out;
    }
    fs.readdirSync(abs, {withFileTypes: true}).forEach(function (ent) {
        let full = path.join(abs, ent.name);
        if (ent.isDirectory() && ent.name !== "node_modules") {
            out = out.concat(findIn(full));
        } else if (ent.name.endsWith(".test.js")) {
            out.push(full);
        }
    });
    return out.sort();
}

function findTests(dir) {
    return findIn(path.join(settings.testDir, dir));
}

let modulesRoot = settings.realModulesDir;

function relative(file) {
    if (file.startsWith(modulesRoot + path.sep)) {
        return path.relative(modulesRoot, file);
    }
    return path.relative(settings.testDir, file);
}

function manifestAt(dir) {
    try {
        return require(path.resolve(dir, "manifest.json"));
    } catch (ignore) {
        return undefined;
    }
}

// A package and the modules it carries by `install`: [{module, dir}]
function carried(dir, depth) {
    let manifest = manifestAt(dir) || {};
    let base = path.resolve(dir) + path.sep;
    let files = manifest.files || [];
    let out;

    if (!manifest.module) {
        return [];
    }
    out = [{dir, module: manifest.module}];
    if (depth > 4) {
        return out;
    }
    files.forEach(function (file) {
        let mfile = (file.path && path.resolve(dir, file.path)) || "";

        if (
            file.type === "install" &&
            mfile.startsWith(base) &&
            path.basename(mfile) === "manifest.json"
        ) {
            out = out.concat(carried(path.dirname(mfile), depth + 1));
        }
    });
    return out;
}

/*
    Every module name the server holds, or the working copy carries,
    lowercased, to its top-level package. Tells a module named on the
    command line from a path fragment, before any database exists.
*/
function moduleNames(packageSrc) {
    let pk = new Packages();
    let names = {};

    pk.scan(settings.realModulesDir);
    function add(dir, top) {
        carried(dir, 0).forEach(function (mod) {
            names[mod.module.toLowerCase()] = top;
        });
    }

    pk.installed().forEach(function (one) {
        add(pk.resolve(one.name, one.version).dir, one.name);
    });
    if (packageSrc) {
        add(packageSrc, manifestAt(packageSrc).module);
    }
    return names;
}

// Whether any installed package has a test file matching a fragment
function anyModuleTest(fragment) {
    let pk = new Packages();

    pk.scan(settings.realModulesDir);
    return pk.installed().some(
        (one) => carried(pk.resolve(one.name, one.version).dir, 0).some(
            (mod) => findIn(path.join(mod.dir, "test")).some(
                (f) => relative(f).includes(fragment)
            )
        )
    );
}

// Deploy into the throwaway copy only
function deploy(name, version, dir) {
    let result;

    console.log(
        "# deploying " + name + " " + version + " into " + settings.testDb
    );
    result = spawnSync(process.execPath, [
        "install.js", "--deploy", name + "@" + version,
        "--instance", settings.testDb
    ], {
        cwd: settings.root,
        encoding: "utf8",
        env: Object.assign({}, process.env, {
            managerDatabase: settings.managerDb,
            modulesDir: dir
        })
    });
    if (result.status !== 0) {
        throw new Error(
            "Deploying " + name + " " + version + " failed:\n" +
            String(result.stderr || result.stdout).slice(-2000)
        );
    }
}

/*
    A modules directory for a run against a working copy: the deployed
    packages copied in, then the working copy installed over its own
    version. The server's own modules directory is not touched.
*/
async function scratchModules(src, rows) {
    let dir = path.join(settings.artifacts, "modules");
    let pk = new Packages();
    let own = manifestAt(src);
    let copies;

    await fs.promises.rm(dir, {force: true, recursive: true});
    await fs.promises.mkdir(dir, {recursive: true});
    pk.scan(settings.realModulesDir);
    copies = rows.filter(
        (row) => row.name !== own.module && pk.installed().some(
            (one) => one.name === row.name && one.version === row.version
        )
    ).map(
        (row) => fs.promises.cp(
            pk.resolve(row.name, row.version).dir,
            path.join(dir, row.name, row.version),
            {recursive: true}
        )
    );
    await Promise.all(copies);
    pk.install(src, {dir});
    return dir;
}

/*
    The module test files for what the copy carries, after deploying
    what was asked for. want: {name, version, top, packageSrc}.
*/
async function moduleTests(want, fragment) {
    const db = require("./harness/db");
    const SQL = "SELECT name, version FROM module WHERE NOT is_deleted;";
    let rows = (await db.query(SQL)).rows;
    let pk = new Packages();
    let files = [];
    let top;

    if (want.packageSrc) {
        top = manifestAt(want.packageSrc);
        modulesRoot = await scratchModules(want.packageSrc, rows);
        deploy(top.module, top.version, modulesRoot);
    } else if (want.version) {
        deploy(want.top, want.version, modulesRoot);
    }
    if (want.packageSrc || want.version) {
        rows = (await db.query(SQL)).rows;
    }

    pk.scan(modulesRoot);
    rows.forEach(function (row) {
        let held = pk.installed().some(
            (one) => one.name === row.name && one.version === row.version
        );

        if (!held || (want.top && row.name !== want.top)) {
            return;
        }
        carried(pk.resolve(row.name, row.version).dir, 0).forEach(
            function (mod) {
                if (
                    want.name &&
                    want.name !== want.top.toLowerCase() &&
                    mod.module.toLowerCase() !== want.name
                ) {
                    return;
                }
                files = files.concat(findIn(path.join(mod.dir, "test")));
            }
        );
    });

    if (want.top && !files.length) {
        console.log(
            "# no tests in " + want.name + " as deployed in " +
            settings.sourceDb + " (" + rows.filter(
                (row) => row.name === want.top
            ).map((row) => row.name + " " + row.version).join("") + ")"
        );
    }
    if (fragment) {
        files = files.filter((f) => relative(f).includes(fragment));
    }
    return files;
}

/*
    What the command line asks for. A name the server or the working
    copy knows as a module is a module; anything else is a path fragment.
*/
function parse(argv) {
    let positional = [];
    let packageSrc;
    let at = 2;
    let arg;
    let names;
    let want = {};

    while (at < argv.length) {
        if (argv[at] === "--package") {
            at += 1;
            packageSrc = path.resolve(argv[at] || "");
        } else if (!argv[at].startsWith("--")) {
            positional.push(argv[at]);
        } else {
            throw new Error("Unknown option " + argv[at]);
        }
        at += 1;
    }
    if (packageSrc && !manifestAt(packageSrc)) {
        throw new Error("No manifest.json in " + packageSrc);
    }

    arg = positional[0] || (
        packageSrc
        ? manifestAt(packageSrc).module
        : "all"
    );
    if (MODES.includes(arg)) {
        return {arg, want: {packageSrc}};
    }

    names = moduleNames(packageSrc);
    want.name = arg.split("@")[0].toLowerCase();
    want.version = arg.split("@")[1];
    want.top = names[want.name];
    want.packageSrc = packageSrc;
    if (!want.top) {
        if (want.version) {
            throw new Error("No package " + want.name + " on this server");
        }
        return {arg, want: {packageSrc}};
    }
    if (want.version && want.name !== want.top.toLowerCase()) {
        throw new Error(
            want.name + " is carried by " + want.top + "; deploy " +
            want.top + "@<version> instead"
        );
    }
    if (packageSrc && want.top !== manifestAt(packageSrc).module) {
        throw new Error(want.name + " is not in " + packageSrc);
    }
    return {arg: "module", want};
}

/*
    Which file is in flight. The reporter says nothing until a file
    finishes, and a slow one -- `api/upgrade.test.js` runs a core
    upgrade per instance, which costs what the instance's data costs --
    otherwise looks like a hang. On a terminal the result line writes
    over this; in a redirected log it stays, so a run that really does
    stop says where.
*/
function announce(file) {
    let name = relative(file);

    if (process.stderr.isTTY) {
        process.stderr.write("  " + name + " ...\r");
    } else {
        process.stderr.write("# running " + name + "\n");
    }
}

function runNodeTest(files, extraEnv) {
    if (!files.length) {
        return 0;
    }
    let args = [
        "--test",
        "--test-reporter=" + (
            process.env.FB_TEST_REPORTER ||
            path.join(__dirname, "harness", "reporter.js")
        )
    ];
    let result = spawnSync(process.execPath, args.concat(files), {
        cwd: settings.root,
        stdio: "inherit",
        env: Object.assign({FB_TEST_TALLY: TALLY}, process.env, extraEnv)
    });
    return result.status;
}

// Integration files share one server and database, so run them one at a
// time (portable alternative to --test-concurrency=1).
function runSerially(files, extraEnv, isAlive) {
    let status = 0;
    files.some(function (file) {
        announce(file);
        let s = runNodeTest([file], extraEnv);
        status = status || s;
        if (isAlive && !isAlive()) {
            console.error(
                "# server exited during " + relative(file) +
                "; remaining files not run"
            );
            status = status || 1;
            return true;
        }
        return false;
    });
    return status;
}

async function main() {
    let {arg, want} = parse(process.argv);
    let unit = [];
    let integration = [];
    let withModules = arg !== "core" && arg !== "unit";
    let fragment;

    UNIT_DIRS.forEach((d) => (unit = unit.concat(findTests(d))));
    INTEGRATION_DIRS.forEach(
        (d) => (integration = integration.concat(findTests(d)))
    );

    if (SKIP.length) {
        let dropped = unit.concat(integration).filter(
            (f) => SKIP.some((part) => f.includes(part))
        );

        console.log(
            "# skipping (FB_TEST_SKIP): " +
            dropped.map(relative).join(", ")
        );
        unit = unit.filter((f) => !dropped.includes(f));
        integration = integration.filter((f) => !dropped.includes(f));
    }

    if (arg === "unit") {
        integration = [];
    } else if (arg === "integration") {
        unit = [];
    } else if (arg === "module") {
        unit = [];
        integration = [];
    } else if (arg !== "all" && arg !== "core") {
        fragment = arg;
        withModules = Boolean(want.packageSrc) || anyModuleTest(arg);
        unit = unit.filter((f) => f.includes(arg));
        integration = integration.filter((f) => f.includes(arg));
    }

    let status = runNodeTest(unit, {});

    if (integration.length || withModules) {
        const db = require("./harness/db");
        const server = require("./harness/server");
        let url;

        console.log(
            "# cloning " + settings.sourceDb + " -> " + settings.testDb
        );
        await db.clone();
        await db.bootstrap();

        try {
            /*
                Framework suites run against the fixture packages,
                module suites against the real ones: a deployed module's
                code is read from its package on disk.
            */
            let phases = [];
            let modFiles = (
                withModules
                ? await moduleTests(want, fragment)
                : []
            );

            if (SKIP.length) {
                modFiles = modFiles.filter(
                    (f) => !SKIP.some((part) => f.includes(part))
                );
            }
            if (integration.length) {
                phases.push({files: integration, options: {}});
            }
            if (modFiles.length) {
                phases.push({
                    files: modFiles,
                    options: {modulesDir: modulesRoot}
                });
            }

            let at = 0;

            while (at < phases.length) {
                if (at > 0) {
                    await server.stop();
                }
                console.log("# starting server on port " + settings.port);
                url = await server.start(phases[at].options);
                let s2 = runSerially(
                    phases[at].files,
                    {
                        FB_TEST_MODULES_ROOT: modulesRoot,
                        FB_TEST_URL: url,
                        NODE_PATH: EXPORT_PATH
                    },
                    server.isAlive
                );
                status = status || s2;
                at += 1;
            }
        } finally {
            await server.stop();
            await db.drop();
        }
    }

    if (!process.env.FB_TEST_REPORTER) {
        console.log(reporter.summarize(TALLY));
    }
    fs.rmSync(TALLY, {force: true});
    process.exit(status);
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
