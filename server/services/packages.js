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
            root = dir || root;
            index = {};

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

            return index;
        };

        /**
            The installed package for a module at a version, or
            undefined when the server does not have it.

            @method resolve
            @param {String} name Module name
            @param {String} version Version
            @return {Object|undefined} {dir, manifest}
        */
        that.resolve = function (name, version) {
            return (
                index[name]
                ? index[name][version]
                : undefined
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

        /*
            Where a package goes: one directory per module and version,
            named by the manifest's module, because that name is what a
            database's `module` row carries and dispatch matches on.
        */
        function placeOf(dir, manifest) {
            return path.join(dir, manifest.module, manifest.version);
        }

        /**
            Install a package on this server (ADR-002 section 6).
            Nothing about any database changes: the files are unpacked
            where the server looks for them, and Deploy is a separate
            act.

            The source is a directory, or an `npm pack` tarball, whose
            `package.json` and `manifest.json` must agree about the
            name and the version -- the manifest's module name is the
            directory, and a package that disagrees with itself would
            be dispatched under a name it does not answer to.

            @method install
            @param {String} source Directory or .tgz
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
                /*
                    An npm tarball holds everything under "package/".
                    tar is used rather than a dependency: npm itself
                    needs it, and Windows has shipped it since 10.
                */
                work = fs.mkdtempSync(
                    path.join(os.tmpdir(), "fb-package-")
                );
                child.execFileSync("tar", ["-xzf", source, "-C", work]);
                from = (
                    fs.existsSync(path.join(work, "package"))
                    ? path.join(work, "package")
                    : work
                );
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
                fs.cpSync(from, place, {recursive: true});

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

        /**
            Compare two versions: -1, 0 or 1.

            @method compareVersions
            @param {String} a
            @param {String} b
            @return {Number}
        */
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
            return (
                one.pre > two.pre
                ? 1
                : -1
            );
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
