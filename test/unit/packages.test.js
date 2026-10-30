/*
    The installed-package registry (ADR-002): what the server holds on
    disk, how versions compare, and where a module's libraries come
    from now that `ModuleNpm` is retired (question 1).

    No database: this is the file system and a package.json.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
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

    /*
        A numbered prerelease counts up, so the tenth of a series is
        newer than the ninth. Compared as text it was not, and a
        database left on an earlier alpha of a series counted as ahead
        of the server and so was never upgraded.
    */
    it("counts a numbered prerelease, not its spelling", function () {
        assert.equal(
            packages.compareVersions("3.0.0-alpha.9", "3.0.0-alpha.12"),
            -1
        );
        assert.equal(
            packages.compareVersions("3.0.0-alpha.12", "3.0.0-alpha.9"),
            1
        );
        assert.equal(
            packages.compareVersions("3.0.0-alpha.12", "3.0.0-alpha.12"),
            0
        );
        assert.equal(
            packages.compareVersions("1.0.0-alpha.2", "1.0.0-beta.1"),
            -1
        );
        // A numbered field before a named one, and the shorter first
        assert.equal(
            packages.compareVersions("1.0.0-1", "1.0.0-alpha"),
            -1
        );
        assert.equal(
            packages.compareVersions("1.0.0-alpha", "1.0.0-alpha.1"),
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

    it("leaves a working copy's .git behind, and keeps its tests",
            function () {
        let into = fs.mkdtempSync(path.join(os.tmpdir(), "fb-into-"));
        let src = place("gitted", "1.0.0", {
            module: "gitted",
            version: "1.0.0"
        });
        let dir;

        write(path.join(src, ".git"), "HEAD", "ref: refs/heads/master\n");
        write(path.join(src, "test"), "one.test.js", "\"use strict\";\n");
        dir = packages.install(src, {dir: into}).dir;
        assert.ok(!fs.existsSync(path.join(dir, ".git")));
        assert.ok(fs.existsSync(path.join(dir, "test", "one.test.js")));
        fs.rmSync(into, {force: true, recursive: true});
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

    it("reads routes.json, bare or as batch records", function () {
        let dir = place("gamma", "1.0.0", {module: "gamma", version: "1.0.0"});

        write(dir, "routes.json", JSON.stringify([
            {function: "gammaOne", path: "/one"},
            {data: {function: "gammaTwo", path: "/two"}, name: "Route"},
            {path: "/broken"}
        ]));
        packages.scan(root);

        assert.deepEqual(packages.routesOf("gamma", "1.0.0"), [
            {function: "gammaOne", module: "gamma", path: "/one"},
            {function: "gammaTwo", module: "gamma", path: "/two"}
        ]);
    });

    it("tells a package without routes.json from one with none",
            function () {
        place("delta", "1.0.0", {module: "delta", version: "1.0.0"});
        write(
            place("epsilon", "1.0.0", {module: "epsilon", version: "1.0.0"}),
            "routes.json",
            "[]"
        );
        packages.scan(root);

        assert.equal(packages.routesOf("delta", "1.0.0"), undefined);
        assert.deepEqual(packages.routesOf("epsilon", "1.0.0"), []);
    });

    it("answers each version with its own routes", function () {
        write(
            place("zeta", "1.0.0", {module: "zeta", version: "1.0.0"}),
            "routes.json",
            JSON.stringify([{function: "zetaA", path: "/a"}])
        );
        write(
            place("zeta", "2.0.0", {module: "zeta", version: "2.0.0"}),
            "routes.json",
            JSON.stringify([{function: "zetaA2", path: "/a"}])
        );
        packages.scan(root);

        assert.equal(packages.routesOf("zeta", "1.0.0")[0].function, "zetaA");
        assert.equal(packages.routesOf("zeta", "2.0.0")[0].function, "zetaA2");
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

describe("Core as a package", function () {
    let core = JSON.parse(fs.readFileSync(
        path.join(__dirname, "..", "..", "manifest.json"),
        "utf8"
    ));
    let pkgs = new Packages();

    before(function () {
        pkgs.scan(fs.mkdtempSync(path.join(os.tmpdir(), "fbcore-")));
    });

    it("is served from the checkout, so none of its code is stored",
            function () {
        let found = pkgs.resolve(core.module, core.version);

        assert.ok(found, "the checkout answers for Core");
        assert.equal(
            path.resolve(found.dir),
            path.resolve(__dirname, "..", "..")
        );
        assert.ok(
            pkgs.serviceSources(core.module, core.version).length > 0,
            "with its services read from files"
        );
        assert.ok(
            pkgs.clientSource(core.module, core.version).script.length > 0,
            "and its client script"
        );
    });

    it("answers for whatever version a database records of it",
            function () {
        /*
            A database behind this server is behind, not owed code
            nobody keeps any more: its tables hold none of the
            framework's, so the framework it is served is this one,
            and its upgrade is what moves it forward.
        */
        let old = pkgs.resolve(core.module, "2.2.0");

        assert.ok(old, "an older version still resolves");
        assert.equal(
            path.resolve(old.dir),
            path.resolve(__dirname, "..", "..")
        );
        assert.equal(
            pkgs.serviceSources(core.module, "2.2.0").length,
            pkgs.serviceSources(core.module, core.version).length
        );
        assert.equal(
            pkgs.resolve("NotAModuleHere", core.version),
            undefined,
            "and nothing else gets that treatment"
        );
    });

    it("is not an installed package, and brings no libraries",
            function () {
        assert.deepEqual(
            pkgs.installed().filter((pkg) => pkg.name === core.module),
            []
        );
        assert.equal(pkgs.newest(core.module), undefined);
        assert.deepEqual(pkgs.libraries(core.module, core.version), []);
    });
});

describe("modules carried inside a package", function () {
    let dir;
    let own;
    let outside;

    function nestedModule(sub, name, version, files, extra, npm) {
        let at = path.join(dir, sub);

        write(at, "manifest.json", JSON.stringify({
            files: files || [],
            module: name,
            npm,
            version
        }));
        Object.keys(extra || {}).forEach(
            (file) => write(at, file, extra[file])
        );
    }

    before(function () {
        let top;

        outside = fs.mkdtempSync(path.join(os.tmpdir(), "fb-umbrella-"));
        own = path.join(outside, "modules");
        top = path.join(own, "Umbrella", "2.0.0");
        dir = top;

        write(top, "manifest.json", JSON.stringify({
            files: [
                {path: "common/manifest.json", type: "install"},
                {path: "ship/manifest.json", type: "install"},
                {path: "../../../escape/manifest.json", type: "install"},
                {path: "gone/manifest.json", type: "install"},
                {path: "module.js", type: "module"}
            ],
            module: "Umbrella",
            version: "2.0.0"
        }));
        write(top, "module.js", "// umbrella client");
        write(top, "package.json", JSON.stringify({
            dependencies: {"big.js": "^6.0.0"},
            featherbone: {libraries: {Money: {package: "big.js"}}}
        }));
        nestedModule("common", "Common", "1.2.0", [
            {name: "doThing", path: "do-thing.js", type: "service"},
            {path: "module.js", type: "module"}
        ], {
            "do-thing.js": "// common service",
            "module.js": "// common client",
            "routes.json": JSON.stringify([
                {function: "doThing", path: "/do/thing"}
            ])
        }, [
            {export: "", package: "fs", property: "", version: ""},
            {export: "Client", package: "pg", property: "PgClient"},
            {package: "node-fetch"},
            {package: "big.js", property: "Money"}
        ]);
        nestedModule("ship", "Ship", "1.0.4", [
            {path: "module.js", type: "module"}
        ], {
            "module.js": "// ship client",
            "package.json": JSON.stringify({
                dependencies: {"node-fetch": "^2.0.0"}
            })
        });
        // A manifest outside the package must not be followed
        write(path.join(outside, "escape"), "manifest.json",
            JSON.stringify({module: "Escaped", version: "1.0.0"}));

        packages = new Packages();
        packages.scan(own);
    });

    after(function () {
        fs.rmSync(outside, {force: true, recursive: true});
    });

    it("finds a nested module by its own name and version", function () {
        let pkg = packages.resolve("Common", "1.2.0");

        assert.ok(pkg);
        assert.equal(pkg.dir, path.join(dir, "common"));
        assert.equal(packages.resolve("Common", "9.9.9"), undefined);
        assert.ok(packages.resolve("Ship", "1.0.4"));
    });

    it("serves a nested module's services, client and routes",
            function () {
        assert.deepEqual(packages.serviceSources("Common", "1.2.0"), [{
            module: "Common",
            name: "doThing",
            script: "// common service"
        }]);
        assert.equal(
            packages.clientSource("Common", "1.2.0").script,
            "// common client"
        );
        assert.equal(
            packages.clientSource("Ship", "1.0.4").script,
            "// ship client"
        );
        assert.deepEqual(packages.routesOf("Common", "1.2.0"), [
            {function: "doThing", module: "Common", path: "/do/thing"}
        ]);
        assert.equal(
            packages.clientSource("Umbrella", "2.0.0").script,
            "// umbrella client"
        );
    });

    it("takes libraries from the module's own package.json, else the " +
            "umbrella's", function () {
        assert.deepEqual(packages.libraries("Common", "1.2.0"), [
            {export: undefined, package: "big.js", property: "Money"},
            {export: undefined, package: "fs", property: "Fs"},
            {export: "Client", package: "pg", property: "PgClient"},
            {export: undefined, package: "node-fetch", property: "NodeFetch"}
        ], "the umbrella's package.json, then the module's own npm list " +
                "under the names ModuleNpm gave them");
        assert.deepEqual(packages.libraries("Ship", "1.0.4"), [
            {export: undefined, package: "node-fetch", property: "nodeFetch"}
        ]);
    });

    it("lists only what was installed", function () {
        assert.deepEqual(
            packages.installed(),
            [{name: "Umbrella", version: "2.0.0"}]
        );
        assert.equal(packages.newest("Common"), undefined);
    });

    it("does not follow a path out of the package", function () {
        assert.equal(packages.resolve("Escaped", "1.0.0"), undefined);
    });

    it("prefers a module installed on its own to the copy inside",
            function () {
        place2("Common", "1.2.0", "// standalone client");
        packages.scan(own);

        assert.equal(
            packages.clientSource("Common", "1.2.0").script,
            "// standalone client"
        );
        assert.deepEqual(packages.installed().map((one) => one.name), [
            "Common",
            "Umbrella"
        ]);
    });

    function place2(name, version, client) {
        let at = path.join(own, name, version);

        write(at, "manifest.json", JSON.stringify({
            files: [{path: "module.js", type: "module"}],
            module: name,
            version
        }));
        write(at, "module.js", client);
    }
});
