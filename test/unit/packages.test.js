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
const AdmZip = require("adm-zip");
const child = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
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

/*
    Zip is Featherbone's own package format: `packager.js` writes one,
    and every package shipped before packages moved to disk is a zip.
*/
describe("installing from an archive", function () {
    let work;

    function into() {
        return fs.mkdtempSync(path.join(os.tmpdir(), "fb-into-"));
    }

    /*
        A zip written byte by byte. AdmZip cleans an entry name as it
        writes, so an archive carrying a name that climbs out of its own
        directory cannot be built with it -- and that is exactly the
        archive this has to be shown refusing. Stored, not deflated,
        which keeps it to a header per entry.
    */
    function rawZip(name, entries) {
        let file = path.join(work, name);
        let locals = [];
        let central = [];
        let at = 0;

        entries.forEach(function (entry) {
            let raw = Buffer.from(entry.name, "utf8");
            let crc = zlib.crc32(entry.data);
            let local = Buffer.alloc(30);

            local.writeUInt32LE(0x04034b50, 0);
            local.writeUInt16LE(20, 4);
            local.writeUInt32LE(crc, 14);
            local.writeUInt32LE(entry.data.length, 18);
            local.writeUInt32LE(entry.data.length, 22);
            local.writeUInt16LE(raw.length, 26);

            let head = Buffer.alloc(46);

            head.writeUInt32LE(0x02014b50, 0);
            head.writeUInt16LE(20, 4);
            head.writeUInt16LE(20, 6);
            head.writeUInt32LE(crc, 16);
            head.writeUInt32LE(entry.data.length, 20);
            head.writeUInt32LE(entry.data.length, 24);
            head.writeUInt16LE(raw.length, 28);
            head.writeUInt32LE(at, 42);

            locals.push(local, raw, entry.data);
            central.push(head, raw);
            at += local.length + raw.length + entry.data.length;
        });

        let body = Buffer.concat(locals);
        let dir = Buffer.concat(central);
        let end = Buffer.alloc(22);

        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(entries.length, 8);
        end.writeUInt16LE(entries.length, 10);
        end.writeUInt32LE(dir.length, 12);
        end.writeUInt32LE(body.length, 16);

        fs.writeFileSync(file, Buffer.concat([body, dir, end]));
        return file;
    }

    function zipOf(name, entries) {
        let zip = new AdmZip();
        let file = path.join(work, name);

        Object.keys(entries).forEach(function (key) {
            zip.addFile(key, Buffer.from(entries[key]));
        });
        zip.writeZip(file);
        return file;
    }

    before(function () {
        work = fs.mkdtempSync(path.join(os.tmpdir(), "fb-archive-"));
        packages = new Packages();
    });

    after(function () {
        fs.rmSync(work, {recursive: true, force: true});
    });

    it("installs a zip holding its files at the root", function () {
        let dest = into();
        let src = zipOf("flat.zip", {
            "manifest.json": JSON.stringify({
                module: "Zipped",
                version: "1.2.0"
            }),
            "module.js": "// client",
            "workbooks.json": "[]"
        });
        let done = packages.install(src, {dir: dest, skipLibraries: true});

        assert.equal(done.name, "Zipped");
        assert.equal(done.version, "1.2.0");
        assert.ok(fs.existsSync(
            path.join(dest, "Zipped", "1.2.0", "workbooks.json")
        ));
        fs.rmSync(dest, {recursive: true, force: true});
    });

    it("installs a zip of a folder, which is what most people hand you",
        function () {
            let dest = into();
            let src = zipOf("wrapped.zip", {
                "job-shop/manifest.json": JSON.stringify({
                    module: "Wrapped",
                    version: "2.0.0"
                }),
                "job-shop/forms.json": "[]"
            });
            let done = packages.install(
                src,
                {dir: dest, skipLibraries: true}
            );

            assert.equal(done.name, "Wrapped");
            assert.ok(fs.existsSync(
                path.join(dest, "Wrapped", "2.0.0", "forms.json")
            ));
            fs.rmSync(dest, {recursive: true, force: true});
        });

    it("keeps a bundled dependency where the manifest expects it",
        function () {
            let dest = into();
            let src = zipOf("deps.zip", {
                "manifest.json": JSON.stringify({
                    dependencies: ["Other"],
                    files: [{path: "other/manifest.json", type: "install"}],
                    module: "Host",
                    version: "1.0.0"
                }),
                "other/manifest.json": JSON.stringify({
                    module: "Other",
                    version: "1.0.0"
                })
            });

            packages.install(src, {dir: dest, skipLibraries: true});

            // The nested manifest is a relative path the installer
            // follows at Deploy, so it has to survive Install intact.
            assert.ok(fs.existsSync(path.join(
                dest,
                "Host",
                "1.0.0",
                "other",
                "manifest.json"
            )));
            fs.rmSync(dest, {recursive: true, force: true});
        });

    it("reads a zip whatever it is called", function () {
        let dest = into();
        let src = zipOf("no-suffix", {
            "manifest.json": JSON.stringify({
                module: "Renamed",
                version: "1.0.0"
            })
        });

        assert.equal(
            packages.install(src, {dir: dest, skipLibraries: true}).name,
            "Renamed"
        );
        fs.rmSync(dest, {recursive: true, force: true});
    });

    it("refuses an entry that would be written outside the package",
        function () {
            let dest = into();
            let src = rawZip("slip.zip", [
                {
                    data: Buffer.from(JSON.stringify({
                        module: "Slip",
                        version: "1.0.0"
                    })),
                    name: "manifest.json"
                },
                {
                    data: Buffer.from("// not yours to write"),
                    name: "../../escaped.js"
                }
            ]);

            /*
                The refusal is the evidence: the name is checked before
                the entry is written, so an archive that is refused has
                written nothing outside itself. Asserting on the path it
                would have reached would mean naming a path outside the
                test's own directory, which a test should not touch.
            */
            assert.throws(
                () => packages.install(src, {dir: dest}),
                /written outside it/
            );
            fs.rmSync(dest, {recursive: true, force: true});
        });

    it("refuses a zip holding more than one package", function () {
        let dest = into();
        let src = zipOf("two.zip", {
            "one/manifest.json": JSON.stringify({
                module: "One",
                version: "1.0.0"
            }),
            "two/manifest.json": JSON.stringify({
                module: "Two",
                version: "1.0.0"
            })
        });

        assert.throws(
            () => packages.install(src, {dir: dest}),
            /more than one package/
        );
        fs.rmSync(dest, {recursive: true, force: true});
    });

    it("says so when the file is not an archive at all", function () {
        let dest = into();
        let src = path.join(work, "notes.txt");

        fs.writeFileSync(src, "this is not a package");

        assert.throws(
            () => packages.install(src, {dir: dest}),
            /neither a directory nor an archive/
        );
        fs.rmSync(dest, {recursive: true, force: true});
    });

    it("still reads an npm pack tarball", function () {
        let dest = into();
        let from = path.join(work, "tarme", "package");
        let src = path.join(work, "tarme-1.0.0.tgz");

        write(from, "manifest.json", JSON.stringify({
            module: "Tarred",
            version: "1.0.0"
        }));
        child.execFileSync(
            "tar",
            ["-czf", src, "-C", path.join(work, "tarme"), "package"]
        );

        assert.equal(
            packages.install(src, {dir: dest, skipLibraries: true}).name,
            "Tarred"
        );
        fs.rmSync(dest, {recursive: true, force: true});
    });
});
