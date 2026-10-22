/*
    JSLint over every JavaScript file in the project.

    The project's own linter (`client/jslint.mjs`, the one the script
    editor uses) is run over each `.js` and `.mjs` file, honouring the
    jslint directive comment the file carries. node_modules, the
    vendored archives, logs and the generated `client/clientmin.js` are
    not the project's to lint.

    Not every file is clean yet, so the rule is a ratchet rather than
    zero: `test/lint-baseline.json` holds the warnings each file is
    known to have, a file may not have more than that, and a file the
    baseline does not name (a new one) must have none. Fixing warnings
    never fails; it just makes the baseline stale, and the report says
    so. To record the current state after fixing a file:

        FB_UPDATE_LINT=1 node test/run.js unit/lint

    The update only ever lowers a count or drops a file -- it will not
    write down a regression, so the baseline cannot be used to hide
    one.
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

// The linter itself, and a bundle generated from the client files.
const SKIP_FILES = new Set([
    "client/clientmin.js",
    "client/jslint.mjs"
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
            if (!SKIP_DIRS.has(ent.name)) {
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

            Object.keys(counts).forEach(function (rel) {
                let was = baseline[rel] || 0;
                let now = Math.min(counts[rel], was);

                if (now > 0) {
                    next[rel] = now;
                }
            });
            await fs.writeFile(
                BASELINE,
                JSON.stringify(next, null, 4) + "\n"
            );
            console.log(
                "lint baseline lowered for " + better.length + " file(s)"
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
