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
/*jslint node*/
/**
    Help that travels with the module it documents (ADR-003).

    A module with help carries a `help` folder beside its manifest: a
    `help.json` and the Markdown pages it names. Nothing about help is
    stored on a worksheet or a form, which is what used to go wrong -- a
    configured worksheet kept a copy of the whole help record, so a
    change to the record never reached a worksheet saved before it, and
    one field served both the vendor and the customer.

    What answers for a page is looked up when help opens, in this order:

      1. the `forms` entry of the module the form belongs to,
      2. the `feathers` entry of the module the feather belongs to,
      3. the default page of either module, in that same order,
      4. the framework's own generic page.

    The form comes first because the form is where a record's actions are
    and one feather can have several forms. A module that says nothing
    about this particular form still answers better about itself than the
    framework's generic page does, which is what step 3 is for.

    Pages are read from the version of the module the database has
    deployed, so two databases on different versions each get help that
    matches the software they are running.

    @module Help
*/
(function (exports) {
    "use strict";

    const fs = require("fs/promises");
    const path = require("path");
    const {Packages} = require("./packages");

    const packages = new Packages();

    /*
        What a page may be: text to read, and the pictures in it.
        help.json is not here -- it is the index the server reads, not
        anything to hand a browser.
    */
    const TYPES = {
        ".gif": "image/gif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".md": "text/markdown; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webp": "image/webp"
    };

    let scanned = false;

    function isFile(file) {
        return fs.stat(file).then((stat) => stat.isFile(), () => false);
    }

    /**
        @class Help
        @constructor
        @namespace Services
    */
    exports.Help = function () {
        let that = {};

        // The package index is read once per process, as elsewhere
        function scan() {
            if (!scanned) {
                packages.scan();
                scanned = true;
            }
        }

        // The modules a database has deployed, name -> version
        async function deployed(client) {
            let resp = await client.query(
                "SELECT name, version FROM module WHERE NOT is_deleted"
            );
            let ret = {};

            resp.rows.forEach(function (row) {
                ret[row.name] = row.version;
            });

            return ret;
        }

        /*
            The help of a deployed module: its folder and what its
            help.json says. Undefined when the server does not hold that
            version, or it carries no help.
        */
        async function helpOf(name, version) {
            let dir;
            let pkg;

            if (!version) {
                return undefined;
            }
            pkg = packages.resolve(name, version);

            if (!pkg) {
                return undefined;
            }
            dir = path.join(pkg.dir, "help");

            try {
                let read = await fs.readFile(
                    path.join(dir, "help.json"),
                    "utf8"
                );

                return {dir, manifest: JSON.parse(read)};
            } catch (ignore) {
                return undefined;
            }
        }

        // A page the module really carries, never one it merely names
        async function pageOf(dir, file) {
            if (!file) {
                return undefined;
            }
            let held = await isFile(path.join(dir, file));

            if (held) {
                return file;
            }
            return undefined;
        }

        /**
            Everything this database has help for: each module that
            carries any, with its contents list.

            Help has to be readable without being on the page it is
            about (John, Oct 2026) -- how workbooks, filters and
            settings work is not about any one worksheet -- so the
            window offers this as its contents, and the framework's own
            pages are first because they are the generic ones.

            @method getContents
            @param {Object} payload
            @param {Client} payload.client Database client
            @return {Promise} [{module, title, pages}]
        */
        that.getContents = async function (obj) {
            let versions = await deployed(obj.client);
            let names = Object.keys(versions).sort();
            let found = [];
            let n = 0;

            scan();

            while (n < names.length) {
                let name = names[n];
                let help = await helpOf(name, versions[name]);
                let pages = [];

                n += 1;

                if (help) {
                    pages = help.manifest.pages || [];
                }
                if (pages.length) {
                    found.push({
                        module: name,
                        pages,
                        title: help.manifest.title || name
                    });
                }
            }

            // The framework's generic pages lead
            return found.filter(
                (one) => one.module === "Core"
            ).concat(found.filter((one) => one.module !== "Core"));
        };

        /**
            The customer's own help for a form: a help link record that
            belongs to no module. A deploy writes only records that
            belong to one, so a deploy cannot touch it, and it is read
            when help opens rather than copied into a configuration.

            @method getSupplement
            @param {Object} payload
            @param {Client} payload.client Database client
            @param {Object} [payload.data]
            @param {String} [payload.data.form] Form name
            @return {Promise} {label, resource, icon} or null
        */
        that.getSupplement = async function (obj) {
            let data = obj.data || {};
            let resp;

            if (!data.form) {
                return null;
            }

            resp = await obj.client.query(
                "SELECT label, resource, icon FROM help_link " +
                "WHERE form = $1 AND coalesce(module, '') = '' " +
                "  AND NOT is_deleted ORDER BY label",
                [data.form]
            );

            return resp.rows[0] || null;
        };

        /**
            Which module's help holds the page for a form or a feather,
            and the module's contents list to read it beside.

            The form's own module answers first, then the feather's, then
            the framework. A caller that knows neither gets the
            framework's generic page, which is what the Help button on a
            worksheet with nothing configured should open.

            @method getTopic
            @param {Object} payload
            @param {Client} payload.client Database client
            @param {Object} [payload.data]
            @param {String} [payload.data.form] Form name
            @param {String} [payload.data.feather] Feather name
            @return {Promise} {module, path, title, pages, supplement}
        */
        that.getTopic = async function (obj) {
            let data = obj.data || {};
            let client = obj.client;
            let feather = data.feather;
            let form;
            let found;
            let order = [];
            let versions;
            let n = 0;

            scan();
            versions = await deployed(client);

            if (data.form) {
                let resp = await client.query(
                    "SELECT name, module, feather FROM form " +
                    "WHERE name = $1 AND NOT is_deleted",
                    [data.form]
                );

                form = resp.rows[0];

                // A form names its feather, so a caller need not
                if (form && !feather) {
                    feather = form.feather;
                }
            }

            if (form && form.module) {
                order.push({key: "forms", name: form.module, of: form.name});
            }

            if (feather) {
                let cat = await client.query(
                    "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
                );
                let row = cat.rows[0];
                let catalog = {};
                let owner;

                if (row && row.data) {
                    catalog = row.data;
                }
                if (catalog[feather]) {
                    owner = catalog[feather].module;
                }
                if (owner) {
                    order.push({key: "feathers", name: owner, of: feather});
                }
            }

            /*
                The framework always answers, even for a form of a module
                that carries no help of its own.
            */
            order.push({key: "feathers", name: "Core", of: feather});

            /*
                Twice over the same order: an entry that names the page
                first, and only then a module's own default. A module
                that says nothing about this form still answers better
                about itself than the framework's generic page does, but
                not before the feather's module has been asked by name.
            */
            while (n < order.length * 2 && !found) {
                let step = order[n % order.length];
                let byName = n < order.length;
                let help = await helpOf(step.name, versions[step.name]);

                n += 1;

                if (help) {
                    let map = help.manifest[step.key] || {};
                    let file = await pageOf(help.dir, (
                        byName
                        ? map[step.of]
                        : help.manifest.default
                    ));

                    if (file) {
                        found = {
                            module: step.name,
                            pages: help.manifest.pages || [],
                            path: file,
                            title: help.manifest.title || step.name
                        };
                    }
                }
            }

            if (!found) {
                found = {module: "Core", pages: [], path: "", title: ""};
            }
            found.supplement = await that.getSupplement(obj);

            return found;
        };

        /**
            A help file of a deployed module, as a path on this server
            for the route to send.

            A path that leaves the module's help folder is refused: the
            path comes from a browser.

            @method getFile
            @param {Object} payload
            @param {Client} payload.client Database client
            @param {Object} payload.data
            @param {String} payload.data.module Module name
            @param {String} payload.data.path Path within `help`
            @return {Promise} {file, type}
        */
        that.getFile = async function (obj) {
            let data = obj.data || {};
            let err;
            let file;
            let help;
            let inside;
            let versions;
            let type = TYPES[path.extname(data.path || "").toLowerCase()];

            scan();
            versions = await deployed(obj.client);
            help = await helpOf(data.module, versions[data.module]);

            if (!help || !type) {
                err = new Error("No help for \"" + data.module + "\"");
                err.statusCode = 404;
                throw err;
            }

            file = path.resolve(help.dir, data.path);
            inside = file.startsWith(path.resolve(help.dir) + path.sep);

            if (!inside || !await isFile(file)) {
                err = new Error("No help page \"" + data.path + "\"");
                err.statusCode = 404;
                throw err;
            }

            return {file, type};
        };

        return that;
    };

}(exports));
