/*
    JSLint over every JavaScript file in the project.

    The project's own linter (`client/jslint.mjs`, the one the script
    editor uses) is run over each `.js` and `.mjs` file, honouring the
    jslint directive comment the file carries. node_modules, the
    vendored archives, logs, the packages installed into
    `modules` at the root (each belongs to the repository it was built
    from -- the fixture packages under `test/fixtures` are this
    project's and are linted) and the
    generated `client/clientmin.js` and `client/api.js` are not the
    project's to lint. Nor is `test/harness/reporter.js`: a
    `node --test` reporter is an async generator, which jslint cannot
    parse at all -- it stops at the `*` and reports only what it read
    before that, which is worse than not checking the file. Everything skipped here is either git-ignored or
    another repository's.

    Not every file is clean yet, so the rule is a ratchet rather than
    zero: `test/lint-baseline.json` holds the warnings each file is
    known to have, and a file may not have more than that. Fixing
    warnings never fails; it just makes the baseline stale, and the
    report says so. To record the current state after fixing a file:

        FB_UPDATE_LINT=1 node test/run.js unit/lint

    For a file the baseline already names the update only ever lowers
    the count, or drops the file, so the baseline cannot be used to
    hide a regression. A file it has never seen is recorded at what it
    has, because some warnings cannot be cleared at all: Node's `fs`
    calls each raise "Weird property name", and a `try`/`finally` with
    no `catch` is flagged whatever it guards. Recording a new file is
    therefore a deliberate act -- the run names what it wrote down --
    and the number is the ceiling from then on.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs").promises;
const path = require("path");
const {pathToFileURL} = require("url");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(ROOT, "test", "lint-baseline.json");

// Directories that are not the project's own source.
const SKIP_DIRS = new Set([
    ".git",
    "files",
    "logs",
    "node_modules",
    "public",
    "vendor"
]);

/*
    Paths, relative to the root, that are not the project's own source:
    the packages installed on this server, which belong to whichever
    repository each was built from, tests included (ADR-003), and the
    copies a test run makes of them under test/.artifacts.
*/
const SKIP_PATHS = ["modules", "test/.artifacts"];

/*
    The linter itself, and two files the build writes: the client bundle
    and the API specification, which is generated from whatever modules
    are installed and so is not the same file twice.
*/
const SKIP_FILES = new Set([
    "client/api.js",
    "client/clientmin.js",
    "client/jslint.mjs",
    "test/harness/reporter.js"
]);

async function sources(dir) {
    let found = [];
    let ents = await fs.readdir(dir, {withFileTypes: true});
    let i = 0;

    while (i < ents.length) {
        let ent = ents[i];
        let full = path.join(dir, ent.name);
        let rel = path.relative(ROOT, full).split(path.sep).join("/");

        if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name) && !SKIP_PATHS.includes(rel)) {
                found = found.concat(await sources(full));
            }
        } else if (
            /\.(js|mjs|cjs)$/.test(ent.name) &&
            !SKIP_FILES.has(rel)
        ) {
            found.push(rel);
        }

        i += 1;
    }

    return found.sort();
}

function shown(warning) {
    return "    " + warning.line + ":" + warning.column + " " + warning.message;
}

describe("jslint: every project file", function () {
    it("has no more warnings than the baseline allows", async function () {
        let url = pathToFileURL(path.join(ROOT, "client", "jslint.mjs"));
        let jslint = (await import(url.href)).default;
        let baseline = await fs.readFile(BASELINE, "utf8").then(
            JSON.parse,
            () => ({})
        );
        let files = await sources(ROOT);
        let counts = {};
        let worse = [];
        let better = [];

        assert.ok(files.length > 100, "found the project's files");

        let n = 0;

        while (n < files.length) {
            let rel = files[n];
            let source = await fs.readFile(path.join(ROOT, rel), "utf8");
            let warnings = jslint.jslint(source, {}).warnings;
            let allowed = baseline[rel] || 0;

            counts[rel] = warnings.length;

            if (warnings.length > allowed) {
                worse.push(
                    rel + ": " + warnings.length + " warning(s), " +
                    allowed + " allowed\n" +
                    warnings.slice(0, 25).map(shown).join("\n")
                );
            } else if (warnings.length < allowed) {
                better.push(
                    rel + " (" + allowed + " -> " + warnings.length + ")"
                );
            }

            n += 1;
        }

        Object.keys(baseline).forEach(function (rel) {
            if (!counts.hasOwnProperty(rel)) {
                better.push(rel + " (gone)");
            }
        });

        if (process.env.FB_UPDATE_LINT === "1") {
            let next = {};

            let added = [];

            Object.keys(counts).forEach(function (rel) {
                let known = baseline.hasOwnProperty(rel);
                let was = baseline[rel] || 0;
                let now = (
                    known
                    ? Math.min(counts[rel], was)
                    : counts[rel]
                );

                if (!known && now > 0) {
                    added.push(rel + " (" + now + ")");
                }
                if (now > 0) {
                    next[rel] = now;
                }
            });
            await fs.writeFile(
                BASELINE,
                JSON.stringify(next, null, 4) + "\n"
            );
            console.log(
                "lint baseline lowered for " + better.length + " file(s)" + (
                    added.length
                    ? "; recorded for the first time: " + added.join(", ")
                    : ""
                )
            );
        } else if (better.length) {
            console.log(
                "jslint: fewer warnings than the baseline records in " +
                better.length + " file(s); run FB_UPDATE_LINT=1 node " +
                "test/run.js unit/lint to record it:\n  " +
                better.join("\n  ")
            );
        }

        assert.deepEqual(
            worse,
            [],
            "\n" + worse.join("\n") + "\n\nFix the warnings above."
        );
    });
});
