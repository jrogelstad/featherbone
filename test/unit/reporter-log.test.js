/*
    Failures reach FB_TEST_FAILURE_LOG with their full detail as they
    happen, not only as a clipped line once the whole run is over.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {execFile} = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const {promisify} = require("util");

const run_ = promisify(execFile);

const REPORTER = path.resolve(__dirname, "..", "harness", "reporter.js");

let dir;

async function run(source) {
    let file = path.join(dir, "sample.js");
    let log = path.join(dir, "failures.log");
    let env = Object.assign({}, process.env, {FB_TEST_FAILURE_LOG: log});

    /*
        Inherited, the first makes the nested run behave as one of our
        own, and the second adds its deliberate failures to the totals of
        the run that is running this.
    */
    delete env.NODE_TEST_CONTEXT;
    delete env.FB_TEST_TALLY;
    await fs.writeFile(file, source);
    await fs.rm(log, {force: true});
    // A failing sample makes node exit non-zero, which is the point
    await run_(
        process.execPath,
        ["--test", "--test-reporter=" + REPORTER, file],
        {env}
    ).catch(() => undefined);
    return fs.readFile(log, "utf8").catch(() => "");
}

describe("failure log", function () {
    before(async function () {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-reporter-"));
    });

    after(async function () {
        await fs.rm(dir, {force: true, recursive: true});
    });

    it("holds the whole message and stack of a failure", async function () {
        let long = "x".repeat(600);
        let text = await run(
            "const t = require('node:test');\n" +
            "t.it('breaks', () => {\n" +
            "    throw new Error('first line\\n" + long + "');\n" +
            "});\n"
        );

        assert.ok(text.includes("sample.js > breaks"));
        assert.ok(text.includes(long), "message not clipped");
        assert.match(text, /at .*sample\.js/);
    });

    it("keeps the properties a driver error carries", async function () {
        let text = await run(
            "const t = require('node:test');\n" +
            "t.it('driver', () => {\n" +
            "    let e = new Error('relation missing');\n" +
            "    e.code = '42P01';\n" +
            "    e.hint = 'create it first';\n" +
            "    throw e;\n" +
            "});\n"
        );

        assert.match(text, /42P01/);
        assert.match(text, /create it first/);
    });

    it("has nothing for a run that passes", async function () {
        let text = await run(
            "const t = require('node:test');\n" +
            "t.it('fine', () => {});\n" +
            "t.it('known', {todo: 'plan 1.1'}, () => {\n" +
            "    throw new Error('expected, a todo');\n" +
            "});\n"
        );

        assert.equal(text, "");
    });
});
