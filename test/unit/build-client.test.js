/*
    The production client (scripts/build-client.js): index_debug.html is
    the one list of what the client is, and the bundle and index.html
    follow it.
*/
/*jslint node unordered*/
"use strict";

const fs = require("fs");
const path = require("path");
const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const build = require("../../scripts/build-client");

const ROOT = path.resolve(__dirname, "..", "..");
const DEBUG = fs.readFileSync(path.join(ROOT, "index_debug.html"), "utf8");

/*
    Client files the bundle is not meant to hold: the bundle itself, the
    generated API documentation, the linter shim and its 500 KB linter,
    and the two pages that are not the app -- the instance picker and the
    help window, each of which the browser loads on its own.
*/
const NOT_BUNDLED = new Set([
    "client/clientmin.js",
    "client/api.js",
    "client/help-window.js",
    "client/javascript-lint.js",
    "client/jslint.mjs",
    "client/picker.js"
]);

const PAGE = [
    "<!doctype html>",
    "<html>",
    "    <body>",
    "        <script src=\"/node_modules/m/m.js\"></script>",
    "        <script src=\"/node_modules/g/g.min.js\"></script>",
    "        <script src=\"/node_modules/n/n.js\"></script>",
    "        <script src=\"/client/javascript-lint.js\" " +
            "type=\"module\"></script>",
    "        <script src=\"/client/a.js\" type=\"module\"></script>",
    "        <script src=\"/client/b.js\" type=\"module\"></script>",
    "    </body>",
    "</html>",
    ""
].join("\n");

function clientFiles(dir) {
    return fs.readdirSync(path.join(ROOT, dir)).filter(
        (name) => (/\.m?js$/).test(name)
    ).map((name) => dir + "/" + name);
}

describe("production page from the debug page", function () {
    it("lists the bundled scripts in load order, leaving the linter out",
            function () {
        assert.deepEqual(build.bundled(PAGE), ["/client/a.js", "/client/b.js"]);
    });

    it("swaps in one bundle and .min.js vendor files where they exist",
            function () {
        let page = build.productionHtml(
            PAGE,
            (src) => src === "/node_modules/m/m.min.js"
        );

        assert.ok(page.includes("<script src=\"/node_modules/m/m.min.js\">"));
        assert.ok(page.includes("<script src=\"/node_modules/n/n.js\">"));
        assert.ok(page.includes("<script src=\"/node_modules/g/g.min.js\">"));
        assert.ok(page.includes("/client/javascript-lint.js"));
        assert.equal(page.split("/client/clientmin.js").length, 2);
        assert.ok(!page.includes("/client/a.js"));
        assert.ok(!page.includes("/client/b.js"));
    });

    it("puts the bundle where the first bundled script was", function () {
        let page = build.productionHtml(PAGE, () => false);

        assert.ok(
            page.indexOf("javascript-lint.js") < page.indexOf("clientmin.js")
        );
        assert.ok(
            page.indexOf("clientmin.js") < page.indexOf("</body>")
        );
    });

    it("is what index.html is (run `npm run build:client`)", function () {
        assert.equal(
            fs.readFileSync(path.join(ROOT, "index.html"), "utf8"),
            build.productionHtml(DEBUG)
        );
    });
});

/*
    The bundle is built when the server starts rather than committed
    (server.js), so what `ensure` does when it cannot build, or cannot
    write, decides whether the server comes up at all.
*/
describe("ensuring the bundle", function () {
    const fsp = fs.promises;
    const scratch = path.join(ROOT, "test", ".artifacts", "bundle-test.js");

    function clean() {
        return fsp.rm(scratch, {force: true});
    }

    before(async function () {
        await fsp.mkdir(path.dirname(scratch), {recursive: true});
        await clean();
    });

    after(clean);

    it("writes one that is not there", async function () {
        let out = await build.ensure({file: scratch, quiet: true});
        let held = await fsp.readFile(scratch, "utf8");

        assert.equal(out.built, true);
        assert.ok(held.length > 100000, held.length + " bytes");
    });

    it("leaves one that is already current alone", async function () {
        let was = await fsp.stat(scratch);
        let out = await build.ensure({file: scratch, quiet: true});
        let now = await fsp.stat(scratch);

        assert.equal(out.built, false);
        assert.equal(out.reason, "current");
        assert.equal(now.mtimeMs, was.mtimeMs);
    });

    it("rewrites one that does not match the sources", async function () {
        await fsp.writeFile(scratch, "// stale");

        let out = await build.ensure({file: scratch, quiet: true});
        let held = await fsp.readFile(scratch, "utf8");

        assert.equal(out.built, true);
        assert.ok(held.length > 100000, held.length + " bytes");
    });

    /*
        A server with no bundle cannot serve a client, so it says so as
        it starts rather than coming up and failing at the first page.
        (Where one is already on disk it warns and serves that instead,
        which needs a checkout it cannot write to.)
    */
    it("refuses when there is none and it cannot write one",
            async function () {
        await assert.rejects(
            () => build.ensure({
                file: path.join(scratch, "no", "such", "place.js"),
                quiet: true
            }),
            /client bundle is missing/
        );
    });
});

describe("client bundle", function () {
    it("holds every client file the debug page reaches, imports none",
            async function () {
        let built = await build.bundle(DEBUG);
        let inputs = new Set(built.inputs);
        let missing = []
            .concat(clientFiles("client"))
            .concat(clientFiles("client/components"))
            .concat(clientFiles("client/models"))
            .filter((file) => !NOT_BUNDLED.has(file) && !inputs.has(file));

        assert.deepEqual(
            missing,
            [],
            "Add these to index_debug.html or they are left out of production"
        );
        assert.ok(inputs.has("common/number.mjs"));
        assert.deepEqual(built.external, []);
    });

    it("fails, naming the file, when the debug page loads one that is gone",
            async function () {
        await assert.rejects(
            build.bundle(PAGE),
            /\/client\/a\.js, which does not exist/
        );
    });
});
