/*
    Regression test harness: golden files.

    matchGolden(name, value) compares value (after normalize) with
    test/golden/<name>.json. When the file is missing, or when
    FB_UPDATE_GOLDEN=1, it writes the file instead and the test passes.
    Commit golden files so a refactor is checked against them.
*/
/*jslint node*/
"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const settings = require("./env");

// Fields that change on every run and carry no behavior. They are only
// dropped from objects that look like records (have an objectType or an
// id AND an etag), so property maps and column lists keyed by these
// names survive. Pass {drop: new Set()} to keep everything.
const VOLATILE = new Set([
    "id", "created", "createdBy", "updated", "updatedBy", "etag", "lock",
    "owner", "_pk"
]);

function isRecord(v) {
    return (
        typeof v.objectType === "string" ||
        (typeof v.id === "string" && v.etag !== undefined)
    );
}

// Sort object keys, drop volatile fields from records, and optionally
// replace values with a placeholder (for ids, generated numbers and dates).
function normalize(value, opts) {
    opts = opts || {};
    const drop = opts.drop || VOLATILE;
    const mask = opts.mask || new Set();
    const recordsOnly = opts.drop === undefined;

    function walk(v) {
        if (Array.isArray(v)) {
            return v.map(walk);
        }
        if (v && typeof v === "object") {
            let out = {};
            let record = !recordsOnly || isRecord(v);
            Object.keys(v).sort().forEach(function (k) {
                if (record && drop.has(k)) {
                    return;
                }
                if (mask.has(k)) {
                    out[k] = (
                        v[k] === null || v[k] === undefined || v[k] === ""
                        ? v[k]
                        : "<" + k + ">"
                    );
                    return;
                }
                out[k] = walk(v[k]);
            });
            return out;
        }
        return v;
    }

    return walk(value);
}

function goldenPath(name) {
    return path.join(settings.goldenDir, name + ".json");
}

function matchGolden(name, value, opts) {
    let actual = normalize(value, opts);
    let file = goldenPath(name);

    if (settings.updateGolden || !fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
        return {written: true};
    }

    let expected = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(
        actual,
        expected,
        "Differs from golden file " + path.relative(settings.root, file) +
        " (FB_UPDATE_GOLDEN=1 to accept the new output)"
    );
    return {written: false};
}

module.exports = {VOLATILE, matchGolden, normalize};
