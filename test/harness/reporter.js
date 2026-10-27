/*
    Test reporter: results only.

    The stock "spec" reporter prints a line for every test and, for a
    failure, the whole error: for a database error that is the full SQL
    statement, and a stack trace through node internals. A run of several
    hundred tests then buries the handful of lines that matter.

    This one prints one line per test file:

        ✔ api/crud.test.js      58 passed  2 todo           (4.1s)
        ✖ api/query.test.js     40 passed  1 failed         (2.3s)

    and, at the end, each failure once, as the test's name, the first line
    of its message (cut short, SQL and all) and the first line of its stack
    that is in the tests; then the totals. Known-defect (todo) tests are
    counted, never listed as failures. A todo test that now passes is
    named, because that is the signal to promote it to a live assertion.

    Anything a test prints to the console is dropped. The server's own
    output is in test/.artifacts/server-<db>.log.

    Use the stock reporter for the full detail with FB_TEST_REPORTER=spec.

    When FB_TEST_TALLY names a file (run.js sets it), each run appends its
    counts there instead of printing totals, and run.js prints one set of
    failures and totals for the whole session with summarize().
*/
/*jslint node*/
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_MESSAGE = 240;
const TESTS_DIR = path.resolve(__dirname, "..");

function isTodo(data) {
    return data.todo !== undefined && data.todo !== false;
}

function isSkip(data) {
    return data.skip !== undefined && data.skip !== false;
}

function isSuite(data) {
    return Boolean(data.details) && data.details.type === "suite";
}

function seconds(ms) {
    return (ms / 1000).toFixed(1) + "s";
}

function relative(file) {
    if (!file) {
        return "(unknown file)";
    }
    let abs = file.replace(/^file:\/\//, "");
    let pkgs = process.env.FB_TEST_MODULES_ROOT;

    // A package's tests read as <module>/<version>/..., not ../../modules
    if (pkgs && abs.startsWith(path.resolve(pkgs) + path.sep)) {
        return path.relative(pkgs, abs);
    }
    return path.relative(TESTS_DIR, abs);
}

// The error Node hands over wraps the one the test threw.
function inner(error) {
    let e = error;
    while (e && e.cause && typeof e.cause === "object") {
        e = e.cause;
    }
    return e || {};
}

function brief(error) {
    let e = inner(error);
    let message = String(e.message || e || "failed")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line)
        .slice(0, 3)
        .join(" | ")
        .replace(/\s+/g, " ");

    if (message.length > MAX_MESSAGE) {
        message = message.slice(0, MAX_MESSAGE) + "...";
    }
    return message;
}

// First stack line that is in the tests rather than in node or a library.
function where(error) {
    let e = inner(error);
    let lines = String(e.stack || "").split("\n");
    let found = lines.find(
        (line) => line.includes(path.sep + "test" + path.sep) &&
        !line.includes("node_modules") &&
        !line.includes(path.sep + "harness" + path.sep)
    );
    if (!found) {
        return "";
    }
    return found.trim().replace(/^at\s+/, "").replace(
        /\(?(?:file:\/\/)?([^()]*[\\/]test[\\/][^()]*)\)?$/,
        (all, file) => relative(file)
    );
}

function pad(text, width) {
    return text + " ".repeat(Math.max(0, width - text.length));
}

function fileLine(name, f, width) {
    let parts = [f.pass + " passed"];

    if (f.fail) {
        parts.push(f.fail + " failed");
    }
    if (f.todo) {
        parts.push(f.todo + " todo");
    }
    if (f.skip) {
        parts.push(f.skip + " skipped");
    }
    return (f.fail ? "✖ " : "✔ ") + pad(name, width) + "  " +
            parts.join("  ") + "  (" + seconds(f.ms) + ")";
}

function emptyTotals() {
    return {pass: 0, fail: 0, todo: 0, skip: 0, ms: 0};
}

function failureBlock(failures) {
    if (!failures.length) {
        return "";
    }
    let out = ["", "Failures (" + failures.length + "):"];

    failures.forEach(function (fail) {
        out.push("");
        out.push("✖ " + fail.file + " > " + fail.name);
        out.push("    " + fail.message);
        if (fail.where) {
            out.push("    at " + fail.where);
        }
    });
    return out.join("\n");
}

function fixedBlock(fixed) {
    if (!fixed.length) {
        return "";
    }
    let out = [
        "",
        "Known defects that now pass (" + fixed.length +
        "), promote to live assertions:"
    ];

    fixed.forEach((item) => out.push("  " + item.file + " > " + item.name));
    return "\n" + out.join("\n");
}

function totalsLine(t, fileCount) {
    let parts = [t.pass + " passed", t.fail + " failed"];

    parts.push(t.todo + " todo");
    if (t.skip) {
        parts.push(t.skip + " skipped");
    }
    return (t.fail ? "✖ " : "✔ ") + parts.join(", ") + " in " +
            fileCount + " file" + (fileCount === 1 ? "" : "s") + " (" +
            seconds(t.ms) + ")";
}

// One run's events in, one line per file out.
async function* report(source) {
    let files = new Map();
    let failures = [];
    let fixed = [];

    function entry(file) {
        let name = relative(file);

        if (!files.has(name)) {
            files.set(name, Object.assign(emptyTotals(), {name}));
        }
        return files.get(name);
    }

    for await (const event of source) {
        let data = event.data;

        if (event.type !== "test:pass" && event.type !== "test:fail") {
            continue;
        }
        // Only the top level carries a file's time; nested tests would count
        // it twice.
        if (data.nesting === 0) {
            entry(data.file).ms += (data.details && data.details.duration_ms) || 0;
        }
        if (isSuite(data)) {
            // A suite that failed outright (a hook, say) has no test of
            // its own to carry the error.
            if (event.type === "test:fail" && !isTodo(data) &&
                data.details.error && data.details.error.failureType &&
                data.details.error.failureType !== "subtestsFailed") {
                let f = entry(data.file);
                f.fail += 1;
                failures.push({
                    file: f.name,
                    name: data.name,
                    message: brief(data.details.error),
                    where: where(data.details.error)
                });
            }
            continue;
        }

        let f = entry(data.file);

        if (isSkip(data)) {
            f.skip += 1;
        } else if (isTodo(data)) {
            f.todo += 1;
            if (event.type === "test:pass") {
                fixed.push({file: f.name, name: data.name});
            }
        } else if (event.type === "test:pass") {
            f.pass += 1;
        } else {
            f.fail += 1;
            failures.push({
                file: f.name,
                name: data.name,
                message: brief(data.details && data.details.error),
                where: where(data.details && data.details.error)
            });
        }
    }

    // A todo test that passes is reported by node as a pass with the todo
    // flag; one that fails is a failure node does not count. Both are
    // todo here.
    let width = 0;
    let totals = emptyTotals();

    files.forEach(function (f) {
        width = Math.max(width, f.name.length);
        Object.keys(totals).forEach((key) => (totals[key] += f[key]));
    });
    files.forEach((f) => (f.total = fileLine(f.name, f, width)));

    let lines = [];
    files.forEach((f) => lines.push(f.total));
    yield lines.join("\n") + "\n";

    if (process.env.FB_TEST_TALLY) {
        fs.appendFileSync(process.env.FB_TEST_TALLY, JSON.stringify({
            files: files.size,
            totals,
            failures,
            fixed
        }) + "\n");
    } else {
        yield failureBlock(failures) + fixedBlock(fixed) + "\n\n" +
                totalsLine(totals, files.size) + "\n";
    }
}

// Read the tally file run.js asked every run to append to, and give back
// the session's failures and totals as text.
function summarize(tally) {
    let totals = emptyTotals();
    let failures = [];
    let fixed = [];
    let fileCount = 0;

    if (fs.existsSync(tally)) {
        fs.readFileSync(tally, "utf8").split("\n").filter(
            (line) => line
        ).forEach(function (line) {
            let run = JSON.parse(line);

            fileCount += run.files;
            Object.keys(totals).forEach((key) => (totals[key] += run.totals[key]));
            failures = failures.concat(run.failures);
            fixed = fixed.concat(run.fixed);
        });
    }
    return failureBlock(failures) + fixedBlock(fixed) + "\n\n" +
            totalsLine(totals, fileCount);
}

module.exports = report;
module.exports.summarize = summarize;
