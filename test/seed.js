#!/usr/bin/env node
/*
    The databases the tests are cloned from.

    A database somebody uses (demo, say) changes under the tests: one
    approved proposed cost in it fails every cost roll-up, and the golden
    files record whatever it holds that day. This builds one nobody uses
    from the installers themselves: Core, then the packages named in
    test/seed.json at the versions named there. It is built once and kept;
    the runner asks for it and it is rebuilt only when what it was built
    from has changed.

        node test/seed.js            build them if missing or out of date
        node test/seed.js core       one of them
        node test/seed.js --force    build them again

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

async function seeds() {
    return JSON.parse(await fs.readFile(PINS, "utf8")).seeds;
}

// What a seed is built from
async function signature(name) {
    let manifest = JSON.parse(
        await fs.readFile(path.join(settings.root, "manifest.json"), "utf8")
    );
    let pin = (await seeds())[name];
    let hash = crypto.createHash("sha1");
    let files = await filesUnder(path.join(settings.root, "scripts"));

    let bodies = await Promise.all(files.map((file) => fs.readFile(file)));

    // Hashed in file order, whichever read came back first
    files.forEach(function (file, i) {
        hash.update(path.relative(settings.root, file));
        hash.update(bodies[i]);
    });
    let sig = {
        core: manifest.version,
        format: FORMAT,
        modules: pin.modules,
        scripts: hash.digest("hex")
    };

    /*
        A package kept in the tests changes without a new version, so
        what is in it is part of what the seed was built from. A real
        package is pinned by its version.
    */
    if (pin.modulesDir) {
        let own = crypto.createHash("sha1");
        let dirs = Object.keys(pin.modules).sort().map(
            (mod) => path.resolve(
                settings.root,
                pin.modulesDir,
                mod,
                pin.modules[mod]
            )
        );
        let lists = await Promise.all(dirs.map(filesUnder));
        let all = [].concat(...lists);
        let pkgBodies = await Promise.all(all.map((file) => fs.readFile(file)));

        all.forEach(function (file, i) {
            own.update(path.relative(settings.root, file));
            own.update(pkgBodies[i]);
        });
        sig.packages = own.digest("hex");
    }
    return sig;
}

async function recorded(database) {
    let note = await db.withClient("postgres", async function (client) {
        let resp = await client.query(
            "SELECT shobj_description(oid, 'pg_database') AS note " +
            "FROM pg_database WHERE datname = $1",
            [database]
        );

        return resp.rows[0] && resp.rows[0].note;
    });

    try {
        return JSON.parse(note);
    } catch (ignore) {
        return undefined;
    }
}

async function install(args, modulesDir) {
    let env = Object.assign({}, process.env, {
        managerDatabase: SCRATCH,
        modulesDir
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

async function dropBoth(database) {
    await db.withClient("postgres", async function (client) {
        await Promise.all([database, SCRATCH].map(
            (name) => client.query(format(
                "DROP DATABASE IF EXISTS %I WITH (FORCE)",
                name
            ))
        ));
    });
}

async function build(database, sig, modulesDir) {
    let pins = Object.keys(sig.modules);
    let held = [];

    /*
        Say so first if a pinned package is not on this server: the
        build is minutes of work to find that out at the end.
    */
    await Promise.all(pins.map(async function (name) {
        let dir = path.join(
            modulesDir,
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
            modulesDir + ") does not hold all of them. " +
            "Install one with `node install.js --package <dir>`, or " +
            "change the pin."
        );
    }

    console.log("# building " + database + " (Core " + sig.core + ")");
    await dropBoth(database);
    await install(["--manager"], modulesDir);
    await install(["--instance", database], modulesDir);
    // One at a time: each deploy holds the instance while it works
    await pins.reduce(function (chain, name) {
        return chain.then(function () {
            console.log("# deploying " + name + " " + sig.modules[name]);
            return install([
                "--deploy", name + "@" + sig.modules[name],
                "--instance", database
            ], modulesDir);
        });
    }, Promise.resolve());

    await db.withClient("postgres", async function (client) {
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            SCRATCH
        ));
        await client.query(format(
            "COMMENT ON DATABASE %I IS %L",
            database,
            JSON.stringify(sig)
        ));
    });
}

// Where a seed's packages are: the real ones, unless it says otherwise
function where(pin) {
    return (
        pin.modulesDir
        ? path.resolve(settings.root, pin.modulesDir)
        : settings.realModulesDir
    );
}

/*
    The names of the seeds, and the database each is built into.
*/
async function names() {
    let all = await seeds();

    return Object.keys(all).map((name) => ({
        database: all[name].database,
        name
    }));
}

/*
    Make sure a seed is there and current; returns its database name.
*/
async function ensure(name, opts) {
    let pin = (await seeds())[name];

    if (!pin) {
        throw new Error("test/seed.json has no seed called \"" + name + "\"");
    }
    let sig = await signature(name);
    let have = await recorded(pin.database);

    if (
        !(opts && opts.force) &&
        have &&
        JSON.stringify(have) === JSON.stringify(sig)
    ) {
        return pin.database;
    }
    await build(pin.database, sig, where(pin));
    return pin.database;
}

module.exports = {ensure, names, signature};

if (require.main === module) {
    (async function () {
        let force = process.argv.includes("--force");
        let wanted = process.argv.slice(2).filter(
            (arg) => !arg.startsWith("--")
        );
        let all = await names();

        await all.filter(
            (seed) => !wanted.length || wanted.includes(seed.name)
        ).reduce(function (chain, seed) {
            return chain.then(async function () {
                await ensure(seed.name, {force});
                console.log("# " + seed.database + " is ready");
            });
        }, Promise.resolve());
    }()).catch(function (err) {
        console.error(err.message || err);
        process.exit(1);
    });
}
