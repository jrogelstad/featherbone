/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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

    const fs = require("fs");
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
