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
/**
    What an instance runs: the framework, the modules it deployed and
    the software underneath. Answers the About dialog.

    @module About
*/
(function (exports) {
    "use strict";

    const fs = require("fs/promises");
    const os = require("os");
    const path = require("path");
    const {Config} = require("../config");
    const {Packages} = require("./packages");
    const {deployed} = require("./openapi");

    const ROOT = path.resolve(__dirname, "../..");
    const config = new Config();

    async function readJson(file) {
        return JSON.parse(await fs.readFile(file, "utf8"));
    }

    async function versionOf(lib) {
        try {
            let pkg = await readJson(
                path.join(ROOT, "node_modules", lib, "package.json")
            );

            return pkg.version;
        } catch (ignore) {
            return "Unknown";
        }
    }

    /**
        @class About
        @constructor
        @namespace Services
    */
    exports.About = function () {
        let that = {};

        /**
            @method getAbout
            @param {Object} payload
            @param {Client} payload.client Database client
            @return {Promise} {name, description, version, modules,
            infrastructure}
        */
        that.getAbout = async function (obj) {
            let client = obj.client;
            let conf = await config.read();
            let packages = new Packages();
            let manifest = await readJson(path.join(ROOT, "manifest.json"));
            let core = await client.query(
                "SELECT version FROM module " +
                "WHERE name = 'Core' AND NOT is_deleted"
            );
            let pg = await client.query("SHOW server_version");
            let mods;

            packages.scan(conf.modulesDir);
            mods = await deployed(client, packages);

            return {
                name: "Featherbone",
                description: (
                    "A framework for building object relational " +
                    "database applications. Data classes (feathers) " +
                    "defined in JSON generate the database schema, " +
                    "a REST API and a browser client of workbooks and " +
                    "forms; modules add feathers, services and routes " +
                    "on top."
                ),
                version: manifest.version,
                deployedVersion: (
                    core.rows.length
                    ? core.rows[0].version
                    : undefined
                ),
                modules: mods.map((mod) => ({
                    name: mod.name,
                    parent: mod.parent,
                    version: mod.version
                })),
                infrastructure: [
                    {name: "Node.js", version: process.version.slice(1)},
                    {
                        name: "PostgreSQL",
                        version: pg.rows[0].server_version
                    },
                    {name: "Express", version: await versionOf("express")},
                    {name: "node-postgres", version: await versionOf("pg")},
                    {name: "Mithril", version: await versionOf("mithril")},
                    {
                        name: "Operating system",
                        version: os.type() + " " + os.release()
                    }
                ]
            };
        };

        return that;
    };

}(exports));
