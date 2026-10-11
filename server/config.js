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
            What this process serves. The control plane is the one
            database that knows about organizations, identities, grants
            and the tenant registry; a tenant server serves customer
            databases. One process may do both, which is what a single
            database install has always done and still the default.
        */
        const ROLES = ["controlPlane", "tenant", "both"];

        /*
            What a database warns about: a development or test database
            shows a banner, production shows none. It lives in the
            database's own "$db" row, so one server can serve a test and
            a production database and each says the right thing. The
            `mode` setting seeds it at install time and is the fallback
            for a database installed before it moved.
        */
        const MODES = ["dev", "test", "prod"];

        // Connection settings the `controlPlane` block may override.
        // Anything it leaves out falls back to the top-level value, so
        // a control plane on the same server as the tenants needs only
        // `pgDatabase`.
        const CONNECTION_KEYS = [
            "pgDatabase",
            "pgHost",
            "pgPort",
            "pgUser",
            "pgPassword"
        ];

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

                    // Present even when the file leaves them out, so
                    // the environment can set them on its own: the
                    // override loop below only visits keys it can see
                    data.controlPlane = data.controlPlane || {};
                    data.serverRole = data.serverRole || "both";

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

                    // The control plane block takes one variable per
                    // setting, named for the block and the setting
                    // together -- `controlPlanePgDatabase` sets
                    // `controlPlane.pgDatabase` -- and they work whether
                    // or not the file carries the block. Spelled out
                    // rather than using `toProperCase`, so configuration
                    // can be read before common/string.js is loaded.
                    CONNECTION_KEYS.forEach(function (key) {
                        let name = "controlPlane" +
                                key.charAt(0).toUpperCase() + key.slice(1);

                        if (process.env[name] !== undefined) {
                            data.controlPlane[key] = typed(process.env[name]);
                        }
                    });

                    resolve(data);
                });
            });
        };

        /**
            What this process serves: `"controlPlane"`, `"tenant"` or
            `"both"`. Defaults to `"both"`, which is how a single
            database install has always behaved.

            @method serverRole
            @param {Object} data Configuration as returned by `read`
            @return {String}
        */
        config.serverRole = function (data) {
            return data.serverRole || "both";
        };

        /**
            Whether `serverRole` holds something this version knows.

            @method isValidRole
            @param {Object} data Configuration as returned by `read`
            @return {Boolean}
        */
        config.isValidRole = function (data) {
            return ROLES.includes(config.serverRole(data));
        };

        /**
            Names a role may take, for error messages.

            @method roles
            @return {Array}
        */
        config.roles = function () {
            return ROLES.slice();
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
            Connection settings for the tenant management database --
            the control plane. The `controlPlane` block names it; every
            setting it leaves out falls back to the top-level value, and
            with no block at all the control plane is `pgDatabase` on the
            ordinary connection, which is what it has always been.

            @method controlPlane
            @param {Object} data Configuration as returned by `read`
            @return {Object}
        */
        config.controlPlane = function (data) {
            let block = data.controlPlane || {};
            let ret = {};

            CONNECTION_KEYS.forEach(function (key) {
                let value = block[key];

                ret[key] = (
                    value === undefined || value === null || value === ""
                    ? data[key]
                    : value
                );
            });

            return ret;
        };

        /**
            Whether the control plane is a database of its own rather
            than the one this server also serves as a tenant.

            @method hasOwnControlPlane
            @param {Object} data Configuration as returned by `read`
            @return {Boolean}
        */
        config.hasOwnControlPlane = function (data) {
            let cp = config.controlPlane(data);

            return (
                cp.pgDatabase !== data.pgDatabase ||
                cp.pgHost !== data.pgHost ||
                Number(cp.pgPort) !== Number(data.pgPort)
            );
        };

        return config;
    };

}(exports));

