/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint node unordered*/
/*
    Installed packages on the server's file system (ADR-002).

    A package is an npm-format module directory holding the same layout a
    module zip holds today -- a manifest naming feathers, services, routes
    and data -- placed at:

        <modulesDir>/<name>/<version>/

    One directory per version, because two databases served by the same
    process may run different versions of one module. The directory
    listing is the record of what is installed on the server; which of
    them a database carries is that database's own record (its `module`
    rows), written by Deploy.

    Code found here is preferred over code deployed into a database: a
    service in a table is text anyone with write access can change and
    the server will execute, while a file on disk changes only by
    deployment access. A module without a directory here falls back to
    the database copy, so a deployment that has not been repackaged yet
    keeps working.
*/
(function (exports) {
    "use strict";

    const AdmZip = require("adm-zip");
    const child = require("child_process");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    /**
        Server-installed package registry.

        @class Packages
        @constructor
        @namespace Services
    */
    exports.Packages = function () {
        let that = {};
        let root = "./modules";
        let index = {};
        /*
            The framework itself, Core, is a package too: the checkout
            this server runs from. It is not under the modules directory
            and cannot be installed, removed or listed as one, but its
            services and client script are read from its files like any
            other package's, because nothing is ever stored as rows.
        */
        let builtin = {};
        /*
            Modules carried inside another package. An umbrella such as
            SupplyChain holds no code of its own but lists, as `install`
            files, the manifests of the modules it is made of, each in a
            subdirectory with its own services, client script and
            routes. Deploying the umbrella deploys them all, and the
            database then records each under its own name and version,
            so each has to be found by that name. They are kept apart
            from `index` because they are not installed on their own:
            listing, removing and "newest" speak of what was installed.
        */
        let nested = {};
        const CHECKOUT = path.resolve(__dirname, "..", "..");

        // Installed under the modules directory, which Core is not
        function held(name, version) {
            return (
                (index[name] && index[name][version]) ||
                (nested[name] && nested[name][version])
            ) || undefined;
        }

        // Where a package's libraries are declared and installed
        function libDirOf(pkg) {
            return pkg.libDir || pkg.dir;
        }

        /*
            Find the modules an installed package carries, by following
            its `install` files to the manifests they name. A path that
            leaves the package, a manifest that cannot be read and a
            module already seen are skipped: the umbrella's own files
            are somebody else's data.
        */
        function indexNested(top, pkg, libDir, depth) {
            if (depth > 4) {
                return;
            }

            let base = path.resolve(pkg.dir) + path.sep;
            let files = pkg.manifest.files || [];

            files.forEach(function (file) {
                if (file.type !== "install" || !file.path) {
                    return;
                }

                let mfile = path.resolve(pkg.dir, file.path);

                if (!mfile.startsWith(base)) {
                    return;
                }

                let dir = path.dirname(mfile);
                let manifest = (
                    path.basename(mfile) === "manifest.json"
                    ? manifestOf(dir)
                    : undefined
                );

                if (
                    !manifest || !manifest.module || !manifest.version ||
                    (
                        index[manifest.module] &&
                        index[manifest.module][manifest.version]
                    )
                ) {
                    return;
                }

                if (!nested[manifest.module]) {
                    nested[manifest.module] = {};
                }

                let own = path.join(dir, "package.json");
                let inner = {
                    dir,
                    libDir: (
                        fs.existsSync(own)
                        ? dir
                        : libDir
                    ),
                    manifest,
                    parent: {name: top.name, version: top.version}
                };

                nested[manifest.module][manifest.version] = inner;
                indexNested(top, inner, inner.libDir, depth + 1);
            });
        }

        function manifestOf(dir) {
            let file = path.join(dir, "manifest.json");

            if (!fs.existsSync(file)) {
                return undefined;
            }

            try {
                return JSON.parse(fs.readFileSync(file, "utf8"));
            } catch (err) {
                console.error(
                    "Package manifest " + file + " is unreadable: " +
                    err.message
                );
                return undefined;
            }
        }

        /**
            Point the registry at a directory and scan it. Safe to call
            again; the index is rebuilt.

            @method scan
            @param {String} dir Modules directory
            @return {Object} The index, {name: {version: {dir, manifest}}}
        */
        that.scan = function (dir) {
            let core = manifestOf(CHECKOUT);

            root = dir || root;
            index = {};
            nested = {};
            builtin = {};

            if (core && core.module && core.version) {
                builtin[core.module] = {};
                builtin[core.module][core.version] = {
                    dir: CHECKOUT,
                    manifest: core
                };
            }

            if (!fs.existsSync(root)) {
                return index;
            }

            fs.readdirSync(root, {withFileTypes: true}).forEach(
                function (entry) {
                    if (!entry.isDirectory()) {
                        return;
                    }

                    let name = entry.name;
                    let versions = path.join(root, name);

                    fs.readdirSync(
                        versions,
                        {withFileTypes: true}
                    ).forEach(function (ventry) {
                        if (!ventry.isDirectory()) {
                            return;
                        }

                        let vdir = path.join(versions, ventry.name);
                        let manifest = manifestOf(vdir);

                        if (!manifest) {
                            return;
                        }

                        if (!index[name]) {
                            index[name] = {};
                        }

                        index[name][ventry.name] = {
                            dir: vdir,
                            manifest
                        };
                    });
                }
            );

            /*
                Nested modules after every top-level package, so one
                installed on its own is never shadowed by a copy that
                an umbrella happens to carry.
            */
            Object.keys(index).forEach(function (name) {
                Object.keys(index[name]).forEach(function (version) {
                    indexNested(
                        {name, version},
                        index[name][version],
                        index[name][version].dir,
                        0
                    );
                });
            });

            return index;
        };

        /**
            The installed package for a module at a version, or
            undefined when the server does not have it.

            The framework answers for whatever version a database
            records, which the modules under the modules directory do
            not. A module is served the version its database carries
            because two databases may run different versions of it;
            the framework is the one this process is, and a database
            recording an older Core is behind rather than owed that
            code -- its upgrade is what moves it. Matching Core
            strictly would leave such a database served nothing at
            all, now that no copy of the framework's code is kept in
            its tables.

            @method resolve
            @param {String} name Module name
            @param {String} version Version
            @return {Object|undefined} {dir, manifest}
        */
        that.resolve = function (name, version) {
            let own = builtin[name];
            let versions = (
                own
                ? Object.keys(own)
                : []
            );

            return (
                held(name, version) ||
                (
                    versions.length
                    ? own[versions[0]]
                    : undefined
                )
            );
        };

        /**
            The service sources of an installed package, read from its
            files in manifest order.

            @method serviceSources
            @param {String} name Module name
            @param {String} version Version
            @return {Array} [{name, module, script}]
        */
        that.serviceSources = function (name, version) {
            let pkg = that.resolve(name, version);
            let ret = [];

            if (!pkg) {
                return ret;
            }

            (pkg.manifest.files || []).forEach(function (file) {
                if (file.type !== "service") {
                    return;
                }

                ret.push({
                    name: file.name || path.basename(file.path, ".js"),
                    module: pkg.manifest.module || name,
                    script: fs.readFileSync(
                        path.join(pkg.dir, file.path),
                        "utf8"
                    )
                });
            });

            return ret;
        };

        /**
            The client script of an installed package: the module code
            the browser compiles. One file per package, named by the
            manifest's "module" entry (ADR-002 section 2 -- the other
            half of `Module.script`).

            @method clientSource
            @param {String} name Module name
            @param {String} version Version
            @return {Object|undefined} {module, script, version}
        */
        that.clientSource = function (name, version) {
            let pkg = that.resolve(name, version);
            let found;

            if (!pkg) {
                return undefined;
            }

            (pkg.manifest.files || []).forEach(function (file) {
                if (file.type !== "module" || found) {
                    return;
                }

                found = {
                    module: file.module || pkg.manifest.module || name,
                    script: fs.readFileSync(
                        path.join(pkg.dir, file.path),
                        "utf8"
                    ),
                    version: (
                        file.version ||
                        pkg.manifest.version ||
                        version
                    )
                };
            });

            return found;
        };

        /**
            The routes an installed package declares: the `routes.json`
            at the root of its directory, the same file a package export
            writes. Each entry names a `path` and the `function` it
            calls, either bare or wrapped as a batch record
            (`{data: {path, function}}`). Routes come from the version a
            database deployed, never from a table, so two databases on
            different versions of one module each get their own.

            @method routesOf
            @param {String} name Module name
            @param {String} version Version
            @return {Array|undefined} [{module, path, function}], or
            undefined when the package carries no routes.json at all,
            which is a package not yet repackaged rather than one with
            no routes
        */
        that.routesOf = function (name, version) {
            let pkg = that.resolve(name, version);
            let file;
            let list;

            if (!pkg) {
                return undefined;
            }

            file = path.join(pkg.dir, "routes.json");
            if (!fs.existsSync(file)) {
                return undefined;
            }

            try {
                list = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch (err) {
                console.error(
                    "Package routes " + file + " are unreadable: " +
                    err.message
                );
                return [];
            }

            if (!Array.isArray(list)) {
                return [];
            }

            return list.map(
                (item) => (
                    (item && item.data)
                    ? item.data
                    : item
                )
            ).filter(
                (item) => item && item.path && item.function
            ).map(function (item) {
                return {
                    function: item.function,
                    module: pkg.manifest.module || name,
                    path: item.path
                };
            });
        };

        /*
            Where a package goes: one directory per module and version,
            named by the manifest's module, because that name is what a
            database's `module` row carries and dispatch matches on.
        */
        function placeOf(dir, manifest) {
            return path.join(dir, manifest.module, manifest.version);
        }

        /*
            The property a library appears under on `f` when the
            package does not say: the name, in camel case, with the
            punctuation npm allows and JavaScript identifiers do not
            taken out -- "big.js" is `bigJs`, "node-fetch" is
            `nodeFetch`, "@acme/widgets" is `acmeWidgets`.
        */
        function propertyFor(name) {
            let words = String(name).split(/[^A-Za-z0-9]+/).filter(
                (word) => word.length
            );

            return words.map(function (word, i) {
                if (i === 0) {
                    return word.charAt(0).toLowerCase() + word.slice(1);
                }
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join("");
        }

        /**
            The libraries an installed package declares, as the
            properties they are to appear under on `f` (ADR-002
            question 1, which retires `ModuleNpm`).

            A package says so in its own `package.json`:

                "featherbone": {
                    "libraries": {
                        "bigJs": {"package": "big.js"},
                        "someClass": {"package": "lib", "export": "Some"}
                    }
                }

            With no such block every dependency is offered under its
            own name, camel-cased, which is what the `ModuleNpm` rows
            did by default.

            @method libraries
            @param {String} name Module name
            @param {String} version Version
            @return {Array} [{property, package, export}]
        */
        /*
            The property a manifest `npm` entry has always been given,
            exactly as the `ModuleNpm` loader names it, so code written
            against `f.Fs` or `f.NodeFetch` keeps finding it.
        */
        function legacyProperty(entry) {
            let str = String(
                entry.property || entry.export || entry.package
            ).replace(/[_,\-]+(.)?/g, function (ignore, chr) {
                return (
                    chr
                    ? chr.toUpperCase()
                    : ""
                );
            });

            return str.slice(0, 1).toUpperCase() + str.slice(1);
        }

        function fromPackageJson(pkg, ret) {
            let file = path.join(libDirOf(pkg), "package.json");
            let json;
            let declared;

            if (!fs.existsSync(file)) {
                return;
            }

            try {
                json = JSON.parse(fs.readFileSync(file, "utf8"));
            } catch (err) {
                console.error(
                    "Package " + file + " is unreadable: " + err.message
                );
                return;
            }

            declared = (json.featherbone || {}).libraries;

            if (declared) {
                Object.keys(declared).forEach(function (property) {
                    let one = declared[property] || {};

                    ret.push({
                        export: one.export || undefined,
                        package: one.package || property,
                        property
                    });
                });
                return;
            }

            Object.keys(json.dependencies || {}).forEach(function (dep) {
                ret.push({
                    export: undefined,
                    package: dep,
                    property: propertyFor(dep)
                });
            });
        }

        that.libraries = function (name, version) {
            // Core's dependencies are the server's own, not libraries
            let pkg = held(name, version);
            let ret = [];

            if (!pkg) {
                return ret;
            }

            fromPackageJson(pkg, ret);

            /*
                The manifest's own `npm` list, read from the file on
                disk. Installing a package stops its `ModuleNpm` rows
                being read, and a module inside an umbrella shares the
                umbrella's package.json, which names only what the
                umbrella thought to: without this, every library a
                module had declared for itself was lost the moment the
                module was found on disk. A package.json wins where
                both name the same property.
            */
            let npm = pkg.manifest.npm || [];

            npm.forEach(function (entry) {
                let property;

                if (!entry || !entry.package) {
                    return;
                }

                property = legacyProperty(entry);

                if (ret.some((one) => one.property === property)) {
                    return;
                }

                ret.push({
                    export: entry.export || undefined,
                    package: entry.package,
                    property
                });
            });

            return ret;
        };

        /**
            Load an installed package's libraries onto the Featherbone
            global, from the package's own `node_modules` -- which is
            what lets two versions of a module need different releases
            of the same library.

            A library that is not installed is reported and skipped,
            the way the `ModuleNpm` loader did: a module whose
            libraries are missing should fail where it uses them, with
            a line in the log saying why, rather than stopping the
            server from starting.

            @method loadLibraries
            @param {String} name Module name
            @param {String} version Version
            @param {Object} global The `f` global
            @return {Array} The properties loaded
        */
        that.loadLibraries = function (name, version, global) {
            let pkg = held(name, version);
            let loaded = [];

            if (!pkg) {
                return loaded;
            }

            that.libraries(name, version).forEach(function (lib) {
                let where = path.resolve(
                    path.join(libDirOf(pkg), "node_modules", lib.package)
                );
                let mod;

                try {
                    mod = require(
                        fs.existsSync(where)
                        ? where
                        : lib.package
                    );
                } catch (err) {
                    console.error(
                        "Unable to load library " + lib.package +
                        " for " + name + " " + version + ": " +
                        err.message
                    );
                    return;
                }

                global[lib.property] = (
                    lib.export
                    ? mod[lib.export]
                    : mod
                );
                loaded.push(lib.property);
            });

            return loaded;
        };

    /*
        Zip is Featherbone's own package format -- `packager.js` writes
        one with AdmZip, and every package shipped before packages moved
        to disk is a zip. An `npm pack` tarball is read as well, since
        that is what a module built as an npm package produces.

        Sniffed rather than taken from the extension: a package that has
        been renamed, or saved by a browser that chose its own suffix,
        is still the archive it is.
    */
    function archiveKind(source) {
        let head = Buffer.alloc(4);
        let fd = fs.openSync(source, "r");
        let read;

        try {
            read = fs.readSync(fd, head, 0, 4, 0);
        } finally {
            fs.closeSync(fd);
        }

        if (read >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
            return "tgz";
        }
        if (
            read >= 4 && head[0] === 0x50 && head[1] === 0x4b &&
            (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)
        ) {
            return "zip";
        }
        return "unknown";
    }

    /*
        An archive is somebody else's file, so its entry names are not
        trusted: a name containing ".." or an absolute path would write
        outside the directory being unpacked into. Each one is resolved
        against the target and refused if it lands anywhere else.
    */
    function unzip(source, into) {
        let zip = new AdmZip(source);
        let base = path.resolve(into) + path.sep;

        zip.getEntries().forEach(function (entry) {
            let to = path.resolve(into, entry.entryName);

            if (!(to + path.sep).startsWith(base)) {
                throw new Error(
                    "The package holds an entry that would be written " +
                    "outside it: " + entry.entryName
                );
            }
            if (entry.isDirectory) {
                fs.mkdirSync(to, {recursive: true});
                return;
            }
            fs.mkdirSync(path.dirname(to), {recursive: true});
            fs.writeFileSync(to, entry.getData());
        });
    }

    /*
        Where the package actually is once it is unpacked. A Featherbone
        zip holds its files at the root; an npm tarball wraps them in
        "package/"; and a zip made by compressing a folder wraps them in
        a folder named after it, which is what most people hand you.
    */
    function rootOf(dir, source) {
        if (fs.existsSync(path.join(dir, "manifest.json"))) {
            return dir;
        }

        let dirs = fs.readdirSync(dir, {withFileTypes: true}).filter(
            (one) => one.isDirectory() && !one.name.startsWith("__MACOSX")
        ).filter(
            (one) => fs.existsSync(
                path.join(dir, one.name, "manifest.json")
            )
        );

        if (dirs.length === 1) {
            return path.join(dir, dirs[0].name);
        }
        if (dirs.length > 1) {
            throw new Error(
                source + " holds more than one package (" +
                dirs.map((one) => one.name).join(", ") +
                "). Install them one at a time."
            );
        }
        throw new Error("No readable manifest.json in " + source);
    }

        /**
            Install a package on this server (ADR-002 section 6).
            Nothing about any database changes: the files are unpacked
            where the server looks for them, and Deploy is a separate
            act.

            The source is a directory, a zip, or an `npm pack` tarball.
            Where it carries a `package.json`, that and `manifest.json`
            must agree about the version -- the manifest's module name
            is the directory, and a package that disagrees with itself
            would be dispatched under a name it does not answer to.

            @method install
            @param {String} source Directory, .zip or .tgz
            @param {Object} [options]
            @param {String} [options.dir] Modules directory
            @param {Boolean} [options.force] Replace the version
            @param {Boolean} [options.skipLibraries] Do not npm install
            @return {Object} {name, version, dir, libraries}
        */
        that.install = function (source, opts) {
            opts = opts || {};

            let into = opts.dir || root;
            let work;
            let from = source;
            let manifest;
            let pkgJson;
            let place;
            let libraries = false;

            if (!fs.existsSync(source)) {
                throw new Error("No package at " + source);
            }

            if (!fs.statSync(source).isDirectory()) {
                let kind = archiveKind(source);

                if (kind === "unknown") {
                    throw new Error(
                        source + " is neither a directory nor an " +
                        "archive this reads. A package is a zip, an " +
                        "`npm pack` tarball, or an unpacked directory."
                    );
                }

                work = fs.mkdtempSync(
                    path.join(os.tmpdir(), "fb-package-")
                );

                if (kind === "zip") {
                    unzip(source, work);
                } else {
                    /*
                        tar is used rather than a dependency: npm itself
                        needs it, and Windows has shipped it since 10.
                    */
                    child.execFileSync("tar", ["-xzf", source, "-C", work]);
                }
                from = rootOf(work, source);
            }

            try {
                manifest = manifestOf(from);
                if (!manifest) {
                    throw new Error(
                        "No readable manifest.json in " + source
                    );
                }
                if (!manifest.module || !manifest.version) {
                    throw new Error(
                        "manifest.json must name a module and a version"
                    );
                }

                let pfile = path.join(from, "package.json");

                if (fs.existsSync(pfile)) {
                    pkgJson = JSON.parse(fs.readFileSync(pfile, "utf8"));
                    if (
                        pkgJson.version &&
                        pkgJson.version !== manifest.version
                    ) {
                        throw new Error(
                            "package.json says version " +
                            pkgJson.version + " and manifest.json says " +
                            manifest.version
                        );
                    }
                }

                place = placeOf(into, manifest);
                if (fs.existsSync(place)) {
                    if (!opts.force) {
                        throw new Error(
                            manifest.module + " " + manifest.version +
                            " is already installed at " + place +
                            ". Pass force to replace it."
                        );
                    }
                    fs.rmSync(place, {recursive: true});
                }

                fs.mkdirSync(place, {recursive: true});
                // A working copy's history is not part of the package
                fs.cpSync(from, place, {
                    filter: (src) => path.basename(src) !== ".git",
                    recursive: true
                });

                /*
                    The module's own libraries, installed inside its own
                    version directory: npm's one-version-per-name rule
                    is right at this scale, and it is what lets two
                    versions of a module need different releases of the
                    same library (ADR-002 question 1, which retires
                    `ModuleNpm`).
                */
                if (
                    !opts.skipLibraries &&
                    pkgJson &&
                    pkgJson.dependencies &&
                    Object.keys(pkgJson.dependencies).length
                ) {
                    child.execFileSync(
                        "npm",
                        ["install", "--omit=dev", "--no-audit", "--no-fund"],
                        {cwd: place, stdio: "inherit"}
                    );
                    libraries = true;
                }
            } finally {
                if (work) {
                    fs.rmSync(work, {recursive: true, force: true});
                }
            }

            that.scan(into);

            return {
                dir: place,
                libraries,
                name: manifest.module,
                version: manifest.version
            };
        };

        /*
            Enough version comparison to answer "which is newest" and
            "is this one behind": dotted numbers, and a prerelease
            (1.2.0-rc.1) sorts before the release it leads to. Written
            here rather than taken as a dependency, because that is the
            whole of what the fleet view needs; ranges would be the
            reason to reach for the semver package (ADR-002 question 1).
        */
        function parts(version) {
            let main = String(version).split("-");

            return {
                numbers: main[0].split(".").map(function (one) {
                    let n = parseInt(one, 10);

                    return (
                        Number.isNaN(n)
                        ? 0
                        : n
                    );
                }),
                pre: main.slice(1).join("-")
            };
        }

        function isNumeric(field) {
            return typeof field === "string" && (/^\d+$/).test(field);
        }

        /*
            Two prereleases, the way semver orders them: field by
            field, and a pair of numeric fields as numbers rather than
            as text. Comparing the whole prerelease as one string put
            alpha.9 after alpha.12, so a database left on an earlier
            alpha counted as ahead of the server this checkout is and
            was never offered the upgrade that would bring it current
            (John asked why one had not upgraded itself, Oct 2026).

            A numeric field sorts before a named one, and where one
            prerelease runs out of fields first it is the older
            (alpha before alpha.1).
        */
        function comparePre(a, b) {
            let one = a.split(".");
            let two = b.split(".");
            let len = Math.max(one.length, two.length);
            let i = 0;
            let ret = 0;

            while (i < len && ret === 0) {
                let x = one[i];
                let y = two[i];

                if (x === undefined || y === undefined) {
                    ret = (
                        x === undefined
                        ? -1
                        : 1
                    );
                } else if (isNumeric(x) && isNumeric(y)) {
                    if (Number(x) !== Number(y)) {
                        ret = (
                            Number(x) > Number(y)
                            ? 1
                            : -1
                        );
                    }
                } else if (isNumeric(x) !== isNumeric(y)) {
                    ret = (
                        isNumeric(x)
                        ? -1
                        : 1
                    );
                } else if (x !== y) {
                    ret = (
                        x > y
                        ? 1
                        : -1
                    );
                }

                i += 1;
            }

            return ret;
        }

        /**
            Compare two versions: -1, 0 or 1.

            @method compareVersions
            @param {String} a
            @param {String} b
            @return {Number}
        */
        /**
            Take a version off this server. The files go; no database
            is touched, which is the same division Install keeps --
            whether any database still wants this version is the
            caller's to settle before asking (ADR-002 section 6).

            @method remove
            @param {String} name
            @param {String} version
            @param {Object} [options]
            @param {String} [options.dir] Modules directory
            @return {Object} {name, version, dir}
        */
        that.remove = function (name, version, opts) {
            opts = opts || {};

            let into = opts.dir || root;
            let place = path.join(into, name, version);

            if (!fs.existsSync(path.join(place, "manifest.json"))) {
                throw new Error(
                    name + " " + version + " is not installed on this " +
                    "server"
                );
            }

            fs.rmSync(place, {recursive: true, force: true});

            /*
                The module's directory goes too once its last version
                has, so the modules directory lists what is there
                rather than the shape of what used to be.
            */
            let holder = path.join(into, name);

            if (
                fs.existsSync(holder) &&
                !fs.readdirSync(holder).length
            ) {
                fs.rmdirSync(holder);
            }

            that.scan(into);

            return {dir: place, name, version};
        };

        that.compareVersions = function (a, b) {
            let one = parts(a);
            let two = parts(b);
            let len = Math.max(one.numbers.length, two.numbers.length);
            let i = 0;
            let ret = 0;

            while (i < len && ret === 0) {
                let x = one.numbers[i] || 0;
                let y = two.numbers[i] || 0;

                if (x !== y) {
                    ret = (
                        x > y
                        ? 1
                        : -1
                    );
                }
                i += 1;
            }

            if (ret !== 0) {
                return ret;
            }

            if (one.pre === two.pre) {
                return 0;
            }
            if (!one.pre) {
                return 1;
            }
            if (!two.pre) {
                return -1;
            }
            return comparePre(one.pre, two.pre);
        };

        /**
            The newest installed version of a module, or undefined when
            the server holds none.

            @method newest
            @param {String} name Module name
            @return {String|undefined}
        */
        that.newest = function (name) {
            let found = Object.keys(index[name] || {});

            if (!found.length) {
                return undefined;
            }

            return found.sort(that.compareVersions)[found.length - 1];
        };

        /**
            Every installed package, for reporting.

            @method installed
            @return {Array} [{name, version}]
        */
        that.installed = function () {
            let ret = [];

            Object.keys(index).forEach(function (name) {
                Object.keys(index[name]).forEach(function (version) {
                    ret.push({name, version});
                });
            });

            return ret;
        };

        return that;
    };

}(exports));
