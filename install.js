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
/*jslint node, eval, unordered*/
(function () {
    "use strict";

    require("./common/string.js");

    const {Client} = require("pg");
    const f = require("./common/core");
    const {Config} = require("./server/config");
    const {Database} = require("./server/database");
    const {Installer} = require("./server/services/installer");
    const datasource = require("./server/datasource");
    const format = require("pg-format");
    const path = require("path");

    const db = new Database();
    const installer = new Installer();
    const config = new Config();

    let conf;
    let client;
    let user;
    let argv = process.argv;
    let thedir;
    let dir;
    let superuser;
    let superpwd;
    /*
        Which kind of database to install into (tenant plan A.1):
        "controlPlane" installs the tenant management database named by
        the `controlPlane` configuration block, "tenant" installs an
        application database, and "both" -- the default, and what a
        single database install has always been -- installs one database
        that serves as each.
    */
    let target;
    let targetDb;
    /*
        An application database to install and register in the control
        plane, so the server can serve it (tenant plan A.1). Without
        this the control plane knows of no instance but itself, and
        there is no way to make one short of the administration UI,
        which does not exist yet.
    */
    let instanceName;
    // Which banner the database shows: dev, test or prod. Recorded in
    // the database rather than on each server (John, Oct 2026).
    let mode;

    argv.forEach(function (arg) {
        switch (arg) {
        case "--mode":
            mode = argv[argv.indexOf("--mode") + 1];
            break;
        case "--control-plane":
            target = "controlPlane";
            break;
        case "--tenant":
            target = "tenant";
            break;
        case "--instance":
            instanceName = argv[argv.indexOf("--instance") + 1];
            target = "tenant";
            break;
        case "--target":
            target = argv[argv.indexOf("--target") + 1];
            break;
        case "--dir":
            thedir = argv[argv.indexOf("--dir") + 1];
            break;
        case "-D":
            thedir = argv[argv.indexOf("-D") + 1];
            break;
        case "-U":
            superuser = argv[argv.indexOf("-U") + 1];
            break;
        case "--username":
            superuser = argv[argv.indexOf("--username") + 1];
            break;
        case "-W":
            superpwd = argv[argv.indexOf("-W") + 1];
            break;
        case "--password":
            superpwd = argv[argv.indexOf("--password") + 1];
            break;
        }
    });

    dir = path.resolve(__dirname, thedir || ".");

    if (superuser && superpwd === undefined) {
        throw new Error("Password must be provided for user");
    }

    function error(err) {
        console.error(err);
        process.exit();
    }

    function connect() {
        return new Promise(function (resolve, reject) {
            function callback(data) {
                user = data.pgUser;
                /*
                    Name the database rather than taking the default
                    connection: the default is the control plane, which
                    is not where a tenant install goes.
                */
                db.connect({
                    pgDatabase: targetDb,
                    pgService: {
                        pgHost: data.pgHost,
                        pgPort: data.pgPort,
                        pgUser: data.pgUser,
                        pgPassword: data.pgPassword
                    }
                }).then(function (resp) {
                    client = resp.client;
                    client.currentUser = () => user;
                    resolve();
                }).catch(reject);
            }

            config.read().then(callback).catch(reject);
        });
    }

    // Connect to postgres so we can inquire on db status
    async function start(confresp) {
        conf = confresp;

        target = target || config.serverRole(conf);
        mode = mode || conf.mode || "prod";

        if (!config.modes().includes(mode)) {
            throw new Error(
                "Mode must be one of " + config.modes().join(", ") +
                ", not \"" + mode + "\""
            );
        }

        if (!config.roles().includes(target)) {
            throw new Error(
                "Install target must be one of " +
                config.roles().join(", ") + ", not \"" + target + "\""
            );
        }

        // The control plane has a database of its own to install into,
        // and a named instance is its own database too
        targetDb = (
            target === "controlPlane"
            ? config.controlPlane(conf).pgDatabase
            : instanceName || conf.pgDatabase
        );

        if (!targetDb) {
            throw new Error(
                "No database to install into. Set controlPlane.pgDatabase " +
                "in server/config.json to install a control plane."
            );
        }

        console.log(
            "Installing " + target + " database \"" + targetDb +
            "\" in " + mode + " mode"
        );

        let missing = config.missingSecrets(conf);
        if (missing.length) {
            throw new Error(
                "Set " + missing.join(", ") + " in server/config.json " +
                "before installing. The crypto key is baked into the " +
                "database and cannot be changed later without " +
                "re-encrypting its data."
            );
        }

        let placeholders = config.placeholderSecrets(conf);
        if (placeholders.length) {
            console.warn(
                "WARNING: " + placeholders.join(", ") + " still hold the " +
                "template placeholder text. Use real values for any new " +
                "installation."
            );
        }

        let conn = (
            "postgres://" +
            (superuser || conf.pgUser) + ":" +
            (superpwd || conf.pgPassword) + "@" +
            conf.pgHost + ":" +
            conf.pgPort + "/"
        );
        let sql;

        client = new Client({connectionString: conn + "postgres"});
        await client.connect();
        sql = (
            "SELECT datname FROM pg_database " +
            "WHERE datistemplate = false AND datname = $1"
        );

        let resp = await client.query(
            sql,
            [targetDb]
        );

        // Deal with database inquiry
        let msg;

        // If database exists, initialize datasource
        if (resp.rows.length === 1) {
            await client.end();
            // Check if this database has been initialized
            client = new Client({
                connectionString: conn + targetDb
            });
            await client.connect();
            sql = (
                "SELECT * FROM pg_tables " +
                "WHERE tablename = '$settings';"
            );
            resp = await client.query(sql);
            if (resp.rows.length) {
                await datasource.getCatalog();
            }

        // Otherwise create database first
        } else {
            msg = "Creating database \"";
            msg += targetDb + "\"";
            console.log(msg);

            sql = "CREATE DATABASE %I;";
            sql = format(
                sql,
                targetDb,
                conf.pgUser
            );

            await client.query(sql);
            await client.end();
            client = new Client({
                connectionString: conn + targetDb
            });
            await client.connect();
            sql = "CREATE EXTENSION IF NOT EXISTS pgcrypto;";
            await client.query(sql);
        }
    }

    function handleUser() {
        return new Promise(function (resolve, reject) {
            let sql;
            let conn;

            function grantUser() {
                sql = (
                    "GRANT SELECT ON pg_authid TO " +
                    conf.pgUser + ";"
                );
                client.query(sql).then(resolve).catch(reject);
            }

            function createUser() {
                sql = (
                    "CREATE USER " + conf.pgUser + " WITH " +
                    "LOGIN " +
                    "NOSUPERUSER " +
                    "CREATEROLE " +
                    "INHERIT " +
                    "NOREPLICATION " +
                    "CONNECTION LIMIT -1 " +
                    "PASSWORD '" + conf.pgPassword + "';"
                );
                client.query(sql).then(grantUser).catch(grantUser);
            }

            if (!superuser) {
                resolve();
                return;
            }

            conn = (
                "postgres://" +
                superuser + ":" +
                superpwd + "@" +
                conf.pgHost + ":" +
                conf.pgPort + "/" + targetDb
            );

            client = new Client({connectionString: conn});
            client.connect().then(createUser).catch(reject);
        });
    }

    function install() {
        return installer.install(
            datasource,
            client,
            dir,
            user,
            {isSuper: true, target, mode}
        );
    }

    /*
        Put the instance in the control plane's registry so a server can
        route "/<name>/" to it (tenant plan A.1). Without this an
        instance database exists but nothing knows about it, and the
        only way to register one is the administration UI, which is
        still to come.

        Idempotent: an instance already registered is left alone, and
        one service row is shared by every instance on this Postgres
        server.

        Written as SQL rather than through the datasource on purpose.
        The catalog this process is holding belongs to the instance just
        installed, and an instance does not carry the Tenant feather at
        all, so there is nothing to make the record with. The password
        is encrypted the same way `crud.js` encrypts it, with the key
        travelling as a parameter rather than in the SQL text.
    */
    async function registerInstance() {
        if (!instanceName) {
            return;
        }

        let cp = config.controlPlane(conf);
        let serviceName = "Default service";
        let cpClient = new Client({
            database: cp.pgDatabase,
            host: cp.pgHost,
            password: superpwd || cp.pgPassword,
            port: cp.pgPort,
            user: superuser || cp.pgUser
        });
        let servicePk;
        let resp;

        try {
            await cpClient.connect();
        } catch (ignore) {
            throw new Error(
                "Cannot reach the control plane \"" + cp.pgDatabase +
                "\" to register \"" + instanceName + "\". Install it " +
                "first with `node install --control-plane`."
            );
        }

        try {
            resp = await cpClient.query((
                "SELECT kind FROM \"$db\""
            )).catch(function () {
                return {rows: []};
            });

            if (
                resp.rows.length &&
                resp.rows[0].kind === "tenant"
            ) {
                throw new Error(
                    "\"" + cp.pgDatabase + "\" is an application " +
                    "database, not a control plane. Point " +
                    "controlPlane.pgDatabase at the tenant management " +
                    "database."
                );
            }

            resp = await cpClient.query((
                "SELECT _pk FROM tenant_service " +
                "WHERE name = $1 AND NOT is_deleted"
            ), [serviceName]);

            if (resp.rows.length) {
                servicePk = resp.rows[0]._pk;
            } else {
                resp = await cpClient.query((
                    "INSERT INTO tenant_service (_pk, id, created, " +
                    "created_by, updated, updated_by, is_deleted, " +
                    "owner, etag, name, pg_host, pg_port, pg_user, " +
                    "pg_password) VALUES (nextval('object__pk_seq'), " +
                    "$1, now(), $2, now(), $2, false, $2, $3, $4, $5, " +
                    "$6, $7, pgp_sym_encrypt($8, $9)::text) RETURNING _pk"
                ), [
                    f.createId(), conf.pgUser, f.createId(), serviceName,
                    conf.pgHost, String(conf.pgPort), conf.pgUser,
                    conf.pgPassword, conf.pgCryptoKey
                ]);
                servicePk = resp.rows[0]._pk;
                console.log("Added tenant service \"" + serviceName + "\"");
            }

            resp = await cpClient.query((
                "SELECT name FROM tenant " +
                "WHERE pg_database = $1 AND NOT is_deleted"
            ), [instanceName]);

            if (resp.rows.length) {
                console.log(
                    "Instance \"" + instanceName + "\" is already " +
                    "registered as \"" + resp.rows[0].name + "\""
                );
                return;
            }

            await cpClient.query((
                "INSERT INTO tenant (_pk, id, created, created_by, " +
                "updated, updated_by, is_deleted, owner, etag, name, " +
                "is_active, _pg_service_tenant_service_pk, pg_database) " +
                "VALUES (nextval('object__pk_seq'), $1, now(), $2, " +
                "now(), $2, false, $2, $3, $4, true, $5, $6)"
            ), [
                f.createId(), conf.pgUser, f.createId(), instanceName,
                servicePk, instanceName
            ]);

            console.log(
                "Registered instance \"" + instanceName + "\" in \"" +
                cp.pgDatabase + "\""
            );
        } finally {
            await cpClient.end();
        }
    }

    function done() {
        client.end();
        process.exit();
    }

    // Real work starts here
    config.read().then(
        start
    ).then(
        handleUser
    ).then(
        connect // This time to database with service user
    ).then(
        install
    ).then(
        registerInstance
    ).then(
        done
    ).catch(
        error
    );
}());
