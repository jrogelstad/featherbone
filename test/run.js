#!/usr/bin/env node
/*
    Featherbone regression test runner.

    Usage:
        node test/run.js                 # unit + integration
        node test/run.js unit            # unit tests only (no database)
        node test/run.js integration     # api + supplychain (needs Postgres)
        node test/run.js api/crud        # files whose path contains "api/crud"

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

// Every run appends its counts here, so the session ends with one set of
// failures and totals instead of one per file.
const TALLY = path.join(
    os.tmpdir(),
    "fb-test-tally-" + process.pid + ".jsonl"
);

const UNIT_DIRS = ["unit"];
const INTEGRATION_DIRS = ["api", "supplychain"];

function findTests(dir) {
    let abs = path.join(settings.testDir, dir);
    let out = [];
    if (!fs.existsSync(abs)) {
        return out;
    }
    fs.readdirSync(abs, {withFileTypes: true}).forEach(function (ent) {
        let rel = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out = out.concat(findTests(rel));
        } else if (ent.name.endsWith(".test.js")) {
            out.push(path.join(settings.testDir, rel));
        }
    });
    return out.sort();
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
        let s = runNodeTest([file], extraEnv);
        status = status || s;
        if (isAlive && !isAlive()) {
            console.error(
                "# server exited during " + path.relative(settings.testDir, file) +
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
    let arg = process.argv[2] || "all";
    let unit = [];
    let integration = [];

    UNIT_DIRS.forEach((d) => (unit = unit.concat(findTests(d))));
    INTEGRATION_DIRS.forEach(
        (d) => (integration = integration.concat(findTests(d)))
    );

    if (arg === "unit") {
        integration = [];
    } else if (arg === "integration") {
        unit = [];
    } else if (arg !== "all") {
        unit = unit.filter((f) => f.includes(arg));
        integration = integration.filter((f) => f.includes(arg));
    }

    let status = runNodeTest(unit, {});

    if (integration.length) {
        const db = require("./harness/db");
        const server = require("./harness/server");
        let url;

        console.log(
            "# cloning " + settings.sourceDb + " -> " + settings.testDb
        );
        await db.clone();
        await db.bootstrap();
        /*
            The framework suites run against the fixture packages. The
            SupplyChain suites run against the server's real packages: a
            deployed module's code is read from its package on disk (it
            is never written to the database), so a server that does not
            hold SupplyChain has none of its functions registered.
        */
        let phases = [];
        let apiFiles = integration.filter((f) => !f.includes("supplychain"));
        let scFiles = integration.filter((f) => f.includes("supplychain"));

        if (apiFiles.length) {
            phases.push({files: apiFiles, options: {}});
        }
        if (scFiles.length) {
            phases.push({
                files: scFiles,
                options: {modulesDir: settings.realModulesDir}
            });
        }

        try {
            let at = 0;

            while (at < phases.length) {
                if (at > 0) {
                    await server.stop();
                }
                console.log("# starting server on port " + settings.port);
                url = await server.start(phases[at].options);
                let s2 = runSerially(
                    phases[at].files,
                    {FB_TEST_URL: url},
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
