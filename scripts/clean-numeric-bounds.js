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
    Clean the stray minimum and maximum the feather editor leaves on
    number and integer properties.

    Changing a property's type in the feather editor writes min 0 and
    max 0 onto it (client/models/feather.js). The model reads a maximum
    of 0 as "no maximum" (`prop.max && val > prop.max`), so a stray
    max 0 does nothing, but a stray min 0 is a real rule: it rejects
    negative values. A freshly installed feather has neither.

    This script reports, and with --apply removes:

    - max: 0 on a number or integer property. No change in behavior.
    - with --clear-min as well, min: 0 on a property whose max is also
      0 (the pair the editor writes). This DOES change behavior: those
      properties then accept negative values again. Review the list the
      dry run prints first, and keep a minimum on any property that
      should reject negatives by setting it again in the feather editor.

    Decide before you apply: once max 0 has been removed on its own, a
    leftover min 0 can no longer be told from one somebody set on
    purpose, so --clear-min only works in the same run as the max
    removal.

    Properties of Core feathers are never touched (UserAccount's
    signInAttempts really does declare min 0 and max 0).

    A dry run is the default and writes nothing. Only the feather
    catalog of the one named database is changed. Restart the server
    afterwards: it caches the catalog.

    Usage:
        node scripts/clean-numeric-bounds.js --database demo
        node scripts/clean-numeric-bounds.js --database demo --apply
        node scripts/clean-numeric-bounds.js --database demo \
            --clear-min --apply
*/
(function () {
    "use strict";

    const {Client} = require("pg");
    const {Config} = require("../server/config");

    const config = new Config();
    const argv = process.argv;
    const apply = argv.indexOf("--apply") !== -1;
    const clearMin = argv.indexOf("--clear-min") !== -1;
    let database;

    if (argv.indexOf("--database") !== -1) {
        database = argv[argv.indexOf("--database") + 1];
    }

    function isNumeric(prop) {
        return prop.type === "number" || prop.type === "integer";
    }

    function newId() {
        return Math.random().toString(36).slice(2, 14);
    }

    async function run() {
        if (!database) {
            throw new Error("Name the database with --database <name>");
        }

        let conf = await config.read();
        let client = new Client({
            database,
            host: conf.pgHost,
            password: conf.pgPassword,
            port: conf.pgPort,
            user: conf.pgUser
        });

        await client.connect();

        try {
            let marker = await client.query("SELECT kind FROM \"$db\"");
            if (marker.rows.length && marker.rows[0].kind !== "instance") {
                throw new Error(
                    "\"" + database + "\" is not an application database"
                );
            }

            let resp = await client.query(
                "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
            );
            if (!resp.rows.length) {
                throw new Error("\"" + database + "\" has no catalog");
            }

            let catalog = resp.rows[0].data;
            let maxList = [];
            let pairList = [];

            Object.keys(catalog).forEach(function (name) {
                let feather = catalog[name];

                if (
                    !feather ||
                    !feather.properties ||
                    feather.module === "Core"
                ) {
                    return;
                }

                Object.keys(feather.properties).forEach(function (key) {
                    let prop = feather.properties[key];
                    let label = name + "." + key;

                    if (!prop || !isNumeric(prop)) {
                        return;
                    }

                    if (prop.max === 0) {
                        maxList.push(label);
                        if (prop.min === 0) {
                            pairList.push(label);
                        }
                        if (apply) {
                            if (clearMin && prop.min === 0) {
                                delete prop.min;
                            }
                            delete prop.max;
                        }
                    }
                });
            });

            let prefix = (
                apply
                ? ""
                : "[dry run] "
            );
            console.log(
                prefix + "max 0, which has no effect: " +
                maxList.length + " properties"
            );
            console.log(
                prefix + "min 0 together with max 0, which rejects " +
                "negative values: " + pairList.length + " properties" +
                (
                    clearMin
                    ? " (min removed too)"
                    : " (kept; add --clear-min to remove)"
                )
            );
            pairList.forEach((label) => console.log("  " + label));

            if (!apply) {
                console.log("Nothing written. Pass --apply to write.");
                return;
            }

            await client.query(
                "UPDATE \"$settings\" SET data = $1, etag = $2, " +
                "updated = now() WHERE name = 'catalog'",
                [JSON.stringify(catalog), newId()]
            );
            console.log(
                "Catalog updated. Restart the server so it reloads it."
            );
        } finally {
            await client.end();
        }
    }

    run().catch(function (err) {
        console.error(err.message || err);
        process.exit(1);
    });
}());
