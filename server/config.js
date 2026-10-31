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

        /*
            What every setting is when neither the file nor the
            environment says. These mirror config.template.json, which
            stays as the documented starting point for a file, but the
            server never reads the template: a file copied from it is a
            real configuration, and the template is not. A deployment
            that sets everything in the environment needs no file at all.

            Left blank on purpose, so that nothing runs on a guess:
            - the secrets, which the server refuses to start without
              (REQUIRED_SECRETS)
            - pgPassword, because it is also the password the installer
              gives the platform administrator
            - the SMTP account, because a placeholder host would be tried
              as though it were real, and notify.js answers an empty one
              with "No mail server is set up".
        */
        function defaults() {
            return {
                cipher: "",
                clientPort: 80,
                debug: true,
                demoGraceDays: 30,
                fileUpload: false,
                fileUploadMaxMB: 25,
                googleEmailClientFile: "",
                googleEmailUserAccount: "",
                googleOauth2CallbackUrl: "",
                googleOauth2ClientId: "",
                googleOauth2ClientSecret: "",
                logLevel: "info",
                logMaxFiles: "7d",
                logMaxSize: "10m",
                logSilent: false,
                logZippedArchive: false,
                managerDatabase: MANAGER_DEFAULT,
                mode: "prod",
                modulesDir: "./modules",
                passwordLength: 0,
                pgCryptoKey: "",
                pgHost: "127.0.0.1",
                pgMaxConnections: 10,
                pgPassword: "",
                pgPort: 5432,
                pgSslCA: "./server/ssl/root.crt",
                pgSslCert: "./server/ssl/server.crt",
                pgSslKey: "./server/ssl/server.key",
                pgTenantIdleTimeout: 60000,
                pgTenantPoolSize: 10,
                pgUser: "admin",
                platformOnlySettings: [],
                secret: "",
                selfUpgradeInstances: false,
                selfUpgradeManager: false,
                sessionTimeout: 86400000,
                smtpAuthPass: "",
                smtpAuthUser: "",
                smtpHost: "",
                smtpPort: 465,
                smtpSecure: true,
                splashTitle: "Home",
                splashUrl: "",
                ssl: false,
                ssoCallbackUrl: "",
                twoFactorAuth: false,
                webhookHeader: "",
                webhookSecret: ""
            };
        }

        /**
            The built-in value of every setting, as `read` starts from
            them. A fresh copy each time.

            @method defaults
            @return {Object}
        */
        config.defaults = defaults;

        function typed(value) {
            if (value.toLowerCase() === "true") {
                return true;
            }
            if (value.toLowerCase() === "false") {
                return false;
            }
            if (value.trim() !== "" && !Number.isNaN(Number(value))) {
                return Number(value);
            }
            return value;
        }

        /**
            The configuration: built-in defaults, over-ridden by
            `server/config.json` when there is one, over-ridden in turn
            by environment variables of the same name. A missing file is
            not an error; one that cannot be parsed is.

            @method read
            @param {String} [filename] Another file to read, for tests
            @return {Promise} Resolves the settings object
        */
        config.read = function (filename) {
            return new Promise(function (resolve, reject) {
                let file = filename || path.format(
                    {root: "./", base: "/server/config.json"}
                );

                fs.readFile(file, "utf8", function (err, text) {
                    let data = defaults();

                    if (err && err.code !== "ENOENT") {
                        console.error(err);
                        return reject(err);
                    }
                    if (!err) {
                        try {
                            Object.assign(data, JSON.parse(text));
                        } catch (parseErr) {
                            parseErr.message = (
                                file + " is not valid JSON: " +
                                parseErr.message
                            );
                            console.error(parseErr.message);
                            return reject(parseErr);
                        }
                    }

                    // A file may blank these, but they always have a name
                    data.managerDatabase = (
                        data.managerDatabase || MANAGER_DEFAULT
                    );
                    data.modulesDir = data.modulesDir || "./modules";

                    // Environment values over-ride file if they exist.
                    // Every setting has a default now, so the
                    // environment can set any of them.
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

