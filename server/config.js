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
(function (exports) {
    "use strict";
    const fs = require("fs");
    const path = require("path");

    exports.Config = function () {
        let config = {};

        // Settings that must be set by the deployer. Empty values are
        // refused. The placeholder text once shipped in the template is only
        // reported: databases already encrypted with it can't change the key
        // without re-encrypting their data, so refusing would lock them out.
        const REQUIRED_SECRETS = {
            pgCryptoKey: ["Your db encryption key here"],
            secret: ["Your own session key here"]
        };

        /*
            Every installation is multi-instance (tenant plan section 9).
            One manager database holds the registry, the identities and
            the sessions; every application database is an instance
            registered in it. Even a single company wants production,
            test and demo, so there is no single-database shape worth a
            second code path.
        */
        const MANAGER_DEFAULT = "db_manager";

        /*
            What a database warns about: a development or test database
            shows a banner, production shows none. It lives in the
            database's own "$db" row, so one server can serve a test and
            a production database and each says the right thing. The
            `mode` setting seeds it at install time and is the fallback
            for a database installed before it moved.
        */
        const MODES = ["dev", "test", "prod"];

        /**
            Names of required secret settings that are missing or blank.

            @method missingSecrets
            @param {Object} data Configuration as returned by `read`
            @return {Array}
        */
        config.missingSecrets = function (data) {
            return Object.keys(REQUIRED_SECRETS).filter(function (key) {
                return typeof data[key] !== "string" || !data[key].trim();
            });
        };

        /**
            Names of required secret settings still holding the placeholder
            text from the old template.

            @method placeholderSecrets
            @param {Object} data Configuration as returned by `read`
            @return {Array}
        */
        config.placeholderSecrets = function (data) {
            return Object.keys(REQUIRED_SECRETS).filter(function (key) {
                return REQUIRED_SECRETS[key].includes(data[key]);
            });
        };

        config.read = function () {
            return new Promise(function (resolve, reject) {
                let filename = path.format(
                    {root: "./", base: "/server/config.json"}
                );

                fs.readFile(filename, "utf8", function (err, data) {
                    if (err) {
                        console.error(err);
                        return reject(err);
                    }
                    data = JSON.parse(data);

                    // Present even when the file leaves it out, so the
                    // environment can set it on its own: the override
                    // loop below only visits keys it can see
                    data.managerDatabase = (
                        data.managerDatabase || MANAGER_DEFAULT
                    );

                    function typed(value) {
                        if (value.toLowerCase() === "true") {
                            return true;
                        }
                        if (value.toLowerCase() === "false") {
                            return false;
                        }
                        if (!Number.isNaN(Number(value))) {
                            return Number(value);
                        }
                        return value;
                    }

                    // Environment values over-ride file if they exist
                    Object.keys(data).forEach(function (key) {
                        if (process.env[key] !== undefined) {
                            data[key] = typed(process.env[key]);
                        }
                    });

                    resolve(data);
                });
            });
        };

        /**
            Modes a database may be in, for error messages.

            @method modes
            @return {Array}
        */
        config.modes = function () {
            return MODES.slice();
        };

        /**
            The manager database: the registry of instances, and where
            identities and sessions live. One per Postgres server, named
            `db_manager` unless `managerDatabase` says otherwise. The
            setting exists so a developer can keep two installations on
            one cluster and so the test harness can build its own
            without colliding; ordinary deployments leave it alone.

            @method managerDatabase
            @param {Object} data Configuration as returned by `read`
            @return {String}
        */
        config.managerDatabase = function (data) {
            let name = (data || {}).managerDatabase;

            return (
                typeof name === "string" && name.trim()
                ? name.trim()
                : MANAGER_DEFAULT
            );
        };

        return config;
    };

}(exports));

