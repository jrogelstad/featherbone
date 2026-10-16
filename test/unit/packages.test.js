/*
    The installed-package registry (ADR-002): what the server holds on
    disk, how versions compare, and where a module's libraries come
    from now that `ModuleNpm` is retired (question 1).

    No database: this is the file system and a package.json.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {Packages} = require("../../server/services/packages");

let root;
let packages;

function write(dir, file, content) {
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, file), content);
}

function place(name, version, manifest, pkgJson) {
    let dir = path.join(root, name, version);

    write(dir, "manifest.json", JSON.stringify(manifest));
    if (pkgJson) {
        write(dir, "package.json", JSON.stringify(pkgJson));
    }
    return dir;
}

describe("installed packages", function () {
    before(function () {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "fb-packages-"));
        packages = new Packages();
    });

    after(function () {
        fs.rmSync(root, {recursive: true, force: true});
    });

    it("finds one directory per module and version", function () {
        place("alpha", "1.0.0", {module: "alpha", version: "1.0.0"});
        place("alpha", "1.1.0", {module: "alpha", version: "1.1.0"});
        place("beta", "0.9.0", {module: "beta", version: "0.9.0"});

        packages.scan(root);

        assert.deepEqual(packages.installed(), [
            {name: "alpha", version: "1.0.0"},
            {name: "alpha", version: "1.1.0"},
            {name: "beta", version: "0.9.0"}
        ]);
        assert.ok(packages.resolve("alpha", "1.1.0"));
        assert.equal(packages.resolve("alpha", "2.0.0"), undefined);
    });

    it("ignores a directory with no readable manifest", function () {
        fs.mkdirSync(path.join(root, "gamma", "1.0.0"), {recursive: true});
        write(path.join(root, "delta", "1.0.0"), "manifest.json", "{oops");

        packages.scan(root);

        assert.equal(packages.resolve("gamma", "1.0.0"), undefined);
        assert.equal(packages.resolve("delta", "1.0.0"), undefined);
    });

    it("compares versions, prerelease before release", function () {
        assert.equal(packages.compareVersions("1.0.0", "1.0.0"), 0);
        assert.equal(packages.compareVersions("1.0.0", "1.1.0"), -1);
        assert.equal(packages.compareVersions("2.0.0", "1.9.9"), 1);
        assert.equal(packages.compareVersions("1.10.0", "1.9.0"), 1);
        assert.equal(packages.compareVersions("1.2", "1.2.0"), 0);
        assert.equal(packages.compareVersions("1.2.0-rc.1", "1.2.0"), -1);
        assert.equal(packages.compareVersions("1.2.0", "1.2.0-rc.1"), 1);
        assert.equal(
            packages.compareVersions("1.2.0-rc.1", "1.2.0-rc.2"),
            -1
        );
    });

    it("knows the newest version it holds", function () {
        packages.scan(root);

        assert.equal(packages.newest("alpha"), "1.1.0");
        assert.equal(packages.newest("beta"), "0.9.0");
        assert.equal(packages.newest("nothing"), undefined);
    });

    it("offers every dependency under its own name by default",
            function () {
        place(
            "libs",
            "1.0.0",
            {module: "libs", version: "1.0.0"},
            {
                dependencies: {"big.js": "^6.0.0", "node-fetch": "^2.0.0"},
                name: "libs",
                version: "1.0.0"
            }
        );
        packages.scan(root);

        assert.deepEqual(packages.libraries("libs", "1.0.0"), [
            {export: undefined, package: "big.js", property: "bigJs"},
            {
                export: undefined,
                package: "node-fetch",
                property: "nodeFetch"
            }
        ]);
    });

    it("takes the properties a package names for itself", function () {
        place(
            "named",
            "1.0.0",
            {module: "named", version: "1.0.0"},
            {
                dependencies: {"big.js": "^6.0.0"},
                featherbone: {
                    libraries: {
                        money: {package: "big.js"},
                        promise: {export: "Promise", package: "big.js"}
                    }
                },
                name: "named",
                version: "1.0.0"
            }
        );
        packages.scan(root);

        assert.deepEqual(packages.libraries("named", "1.0.0"), [
            {export: undefined, package: "big.js", property: "money"},
            {export: "Promise", package: "big.js", property: "promise"}
        ]);
    });

    it("loads them onto the global it is given", function () {
        let global = {};
        let loaded = packages.loadLibraries("named", "1.0.0", global);

        assert.deepEqual(loaded, ["money", "promise"]);
        assert.equal(typeof global.money, "function");
    });

    it("reports a library it cannot load and carries on", function () {
        let global = {};

        place(
            "broken",
            "1.0.0",
            {module: "broken", version: "1.0.0"},
            {
                dependencies: {"no-such-library-anywhere": "^1.0.0"},
                name: "broken",
                version: "1.0.0"
            }
        );
        packages.scan(root);

        let loaded = packages.loadLibraries("broken", "1.0.0", global);

        assert.deepEqual(loaded, [], "nothing was loaded");
        assert.deepEqual(
            Object.keys(global),
            [],
            "and the global is untouched rather than half set"
        );
    });

    it("has nothing to say about a module it does not hold", function () {
        assert.deepEqual(packages.libraries("absent", "1.0.0"), []);
        assert.deepEqual(
            packages.loadLibraries("absent", "1.0.0", {}),
            []
        );
        assert.equal(packages.clientSource("absent", "1.0.0"), undefined);
    });

    it("installs a package, and refuses to overwrite one", function () {
        let into = fs.mkdtempSync(path.join(os.tmpdir(), "fb-into-"));
        let src = path.join(root, "alpha", "1.1.0");
        let done = packages.install(src, {dir: into});

        assert.equal(done.name, "alpha");
        assert.equal(done.version, "1.1.0");
        assert.ok(fs.existsSync(path.join(into, "alpha", "1.1.0")));

        assert.throws(
            () => packages.install(src, {dir: into}),
            /already installed/
        );
        assert.ok(packages.install(src, {dir: into, force: true}));
        fs.rmSync(into, {recursive: true, force: true});
    });

    it("refuses a package that disagrees with itself", function () {
        let into = fs.mkdtempSync(path.join(os.tmpdir(), "fb-into-"));

        place(
            "mismatch",
            "1.0.0",
            {module: "mismatch", version: "1.0.0"},
            {name: "mismatch", version: "2.0.0"}
        );

        assert.throws(
            () => packages.install(
                path.join(root, "mismatch", "1.0.0"),
                {dir: into}
            ),
            /package.json says version 2\.0\.0/
        );
        fs.rmSync(into, {recursive: true, force: true});
    });

    it("refuses a manifest with no module or version", function () {
        let into = fs.mkdtempSync(path.join(os.tmpdir(), "fb-into-"));
        let dir = path.join(root, "nameless", "1.0.0");

        write(dir, "manifest.json", JSON.stringify({version: "1.0.0"}));

        assert.throws(
            () => packages.install(dir, {dir: into}),
            /must name a module and a version/
        );
        fs.rmSync(into, {recursive: true, force: true});
    });
});
