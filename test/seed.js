#!/usr/bin/env node
/*
    The database the tests are cloned from.

    A database somebody uses (demo, say) changes under the tests: one
    approved proposed cost in it fails every cost roll-up, and the golden
    files record whatever it holds that day. This builds one nobody uses
    from the installers themselves: Core, then the packages named in
    test/seed.json at the versions named there. It is built once and kept;
    the runner asks for it and it is rebuilt only when what it was built
    from has changed.

        node test/seed.js            build it if missing or out of date
        node test/seed.js --force    build it again

    "What it was built from" is the Core version, a hash of the scripts
    that build Core's schema, and the pinned modules. It is recorded in the
    database's own comment. A change to server code that makes different
    SQL, without a change to those, needs --force.

    The registry the installers want is a scratch manager, dropped when
    the build is done: the harness makes its own from the copy.
*/
/*jslint node*/
"use strict";

const crypto = require("crypto");
const {execFile} = require("child_process");
const fs = require("fs/promises");
const path = require("path");
const {promisify} = require("util");
const format = require("pg-format");
const db = require("./harness/db");
const settings = require("./harness/env");

const run = promisify(execFile);
const FORMAT = 1;
const SCRATCH = "fbtest_seed_manager";
const PINS = path.join(__dirname, "seed.json");

async function filesUnder(dir) {
    let out = [];
    let ents = await fs.readdir(dir, {withFileTypes: true});

    ents.sort((a, b) => a.name.localeCompare(b.name));
    await Promise.all(ents.map(async function (ent) {
        let full = path.join(dir, ent.name);

        if (ent.isDirectory() && ent.name !== "dev") {
            out = out.concat(await filesUnder(full));
        } else if (ent.isFile()) {
            out.push(full);
        }
    }));
    return out.sort();
}

// What the seed is built from
async function signature() {
    let manifest = JSON.parse(
        await fs.readFile(path.join(settings.root, "manifest.json"), "utf8")
    );
    let pins = JSON.parse(await fs.readFile(PINS, "utf8"));
    let hash = crypto.createHash("sha1");
    let files = await filesUnder(path.join(settings.root, "scripts"));

    let bodies = await Promise.all(files.map((file) => fs.readFile(file)));

    // Hashed in file order, whichever read came back first
    files.forEach(function (file, i) {
        hash.update(path.relative(settings.root, file));
        hash.update(bodies[i]);
    });
    return {
        core: manifest.version,
        format: FORMAT,
        modules: pins.modules,
        scripts: hash.digest("hex")
    };
}

async function recorded() {
    let note = await db.withClient("postgres", async function (client) {
        let resp = await client.query(
            "SELECT shobj_description(oid, 'pg_database') AS note " +
            "FROM pg_database WHERE datname = $1",
            [settings.seedDb]
        );

        return resp.rows[0] && resp.rows[0].note;
    });

    try {
        return JSON.parse(note);
    } catch (ignore) {
        return undefined;
    }
}

async function install(args) {
    let env = Object.assign({}, process.env, {
        managerDatabase: SCRATCH,
        modulesDir: settings.realModulesDir
    });

    let failed = await run(process.execPath, ["install.js"].concat(args), {
        cwd: settings.root,
        env,
        maxBuffer: 64 * 1024 * 1024
    }).then(() => undefined, (err) => err);

    if (failed) {
        throw new Error(
            "install.js " + args.join(" ") + " failed:\n" +
            String(
                failed.stderr || failed.stdout || failed.message
            ).slice(-2000)
        );
    }
}

async function dropBoth() {
    await db.withClient("postgres", async function (client) {
        await Promise.all([settings.seedDb, SCRATCH].map(
            (name) => client.query(format(
                "DROP DATABASE IF EXISTS %I WITH (FORCE)",
                name
            ))
        ));
    });
}

async function build(sig) {
    let pins = Object.keys(sig.modules);
    let held = [];

    /*
        Say so first if a pinned package is not on this server: the
        build is minutes of work to find that out at the end.
    */
    await Promise.all(pins.map(async function (name) {
        let dir = path.join(
            settings.realModulesDir,
            name,
            sig.modules[name]
        );

        held.push(await fs.stat(dir).then(() => true, () => false));
    }));
    if (held.includes(false)) {
        throw new Error(
            "test/seed.json pins " + pins.map(
                (name) => name + " " + sig.modules[name]
            ).join(", ") + ", and this server's modules directory (" +
            settings.realModulesDir + ") does not hold all of them. " +
            "Install one with `node install.js --package <dir>`, or " +
            "change the pin."
        );
    }

    console.log("# building " + settings.seedDb + " (Core " + sig.core + ")");
    await dropBoth();
    await install(["--manager"]);
    await install(["--instance", settings.seedDb]);
    // One at a time: each deploy holds the instance while it works
    await pins.reduce(function (chain, name) {
        return chain.then(function () {
            console.log("# deploying " + name + " " + sig.modules[name]);
            return install([
                "--deploy", name + "@" + sig.modules[name],
                "--instance", settings.seedDb
            ]);
        });
    }, Promise.resolve());

    await db.withClient("postgres", async function (client) {
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            SCRATCH
        ));
        await client.query(format(
            "COMMENT ON DATABASE %I IS %L",
            settings.seedDb,
            JSON.stringify(sig)
        ));
    });
}

/*
    Make sure the seed is there and current. Returns true when it was
    built.
*/
async function ensure(opts) {
    let sig = await signature();
    let have = await recorded();

    if (
        !(opts && opts.force) &&
        have &&
        JSON.stringify(have) === JSON.stringify(sig)
    ) {
        return false;
    }
    await build(sig);
    return true;
}

module.exports = {ensure, signature};

if (require.main === module) {
    ensure({force: process.argv.includes("--force")}).then(
        function (built) {
            console.log(
                built
                ? "# " + settings.seedDb + " is built"
                : "# " + settings.seedDb + " is up to date"
            );
        }
    ).catch(function (err) {
        console.error(err.message || err);
        process.exit(1);
    });
}
