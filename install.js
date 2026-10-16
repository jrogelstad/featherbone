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
/*jslint node, eval, unordered*/
(function () {
    "use strict";

    require("./common/string.js");

    const {Client} = require("pg");
    const f = require("./common/core");
    const {Config} = require("./server/config");
    const {Database} = require("./server/database");
    const {Installer} = require("./server/services/installer");
    const {Manager} = require("./server/services/manager");
    const datasource = require("./server/datasource");
    const format = require("pg-format");
    const path = require("path");

    const db = new Database();
    const installer = new Installer();
    const manager = new Manager();
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
        Which kind of database to install into (tenant plan section 9):
        "manager" installs the one database that holds the registry, the
        identities and the sessions, and "instance" installs an
        application database. With neither flag the manager is installed,
        since that is what every installation needs first.
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
    /*
        The organization an instance is installed into (ADR-001). Sign-in
        is by identity, and an identity belongs to an organization, so an
        instance has to be attached to one before anyone can enter it.
        The organization is created if it does not exist, and the service
        account becomes its first administrator with the password in
        config.json (tenant plan B.8).
    */
    let orgName = "Default";
    let orgGiven = false;
    const FLAGS = [
        "--mode", "--manager", "--instance", "--target", "--dir", "-D",
        "-U", "--username", "-W", "--password", "--organization"
    ];

    argv.forEach(function (arg, i) {
        /*
            An unknown flag used to be ignored, and with no --instance
            the manager is what gets installed: `--my_database` quietly
            reinstalled the manager (John, Oct 2026). Refuse it.
        */
        if (
            i > 1 &&
            arg.startsWith("-") &&
            FLAGS.indexOf(arg) === -1
        ) {
            console.error(
                "Unknown option \"" + arg + "\". Options: " +
                FLAGS.join(", ")
            );
            process.exit(1);
        }

        switch (arg) {
        case "--organization":
            orgName = argv[argv.indexOf("--organization") + 1];
            orgGiven = true;
            break;
        case "--mode":
            mode = argv[argv.indexOf("--mode") + 1];
            break;
        case "--manager":
            target = "manager";
            break;
        case "--instance":
            instanceName = argv[argv.indexOf("--instance") + 1];
            target = "instance";
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

        target = target || "manager";
        mode = mode || conf.mode || "prod";

        if (!config.modes().includes(mode)) {
            throw new Error(
                "Mode must be one of " + config.modes().join(", ") +
                ", not \"" + mode + "\""
            );
        }

        if (target !== "manager" && target !== "instance") {
            throw new Error(
                "Install target must be manager or instance, not \"" +
                target + "\""
            );
        }

        // The manager is named by configuration; an instance names itself
        targetDb = (
            target === "manager"
            ? config.managerDatabase(conf)
            : instanceName
        );

        if (!targetDb) {
            throw new Error(
                "No database to install into. Name one with " +
                "`--instance <name>`, or install the manager with " +
                "`--manager`."
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

            /*
                The service account is the only Postgres role
                Featherbone uses: users are identities in the manager,
                not login roles, so it needs no CREATEROLE (ADR-001).
            */
            function createUser() {
                sql = format(
                    "CREATE USER %I WITH LOGIN NOSUPERUSER INHERIT " +
                    "NOREPLICATION CONNECTION LIMIT -1 PASSWORD %L;",
                    conf.pgUser,
                    conf.pgPassword
                );
                client.query(sql).then(resolve).catch(() => resolve());
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

        let managerDb = config.managerDatabase(conf);
        let serviceName = "Default service";
        let cpClient = new Client({
            database: managerDb,
            host: conf.pgHost,
            password: superpwd || conf.pgPassword,
            port: conf.pgPort,
            user: superuser || conf.pgUser
        });
        let servicePk;
        let resp;

        try {
            await cpClient.connect();
        } catch (ignore) {
            throw new Error(
                "Cannot reach the manager \"" + managerDb +
                "\" to register \"" + instanceName + "\". Install it " +
                "first with `node install --manager`."
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
                resp.rows[0].kind !== "manager"
            ) {
                throw new Error(
                    "\"" + managerDb + "\" is an application database, " +
                    "not a manager. Point managerDatabase at the " +
                    "management database."
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
                managerDb + "\""
            );
        } finally {
            await cpClient.end();
        }
    }

    /*
        Attach the instance to its organization and make sure somebody
        can sign in to it: the service account becomes an identity in
        the organization with a grant on this instance, and the
        organization's administrator if it has none yet. Idempotent --
        an existing identity keeps its password and flags.

        The installer made the matching local super user account, so
        this one identity is a tenant super user, organization
        administrator and, on a first installation, the platform's
        first administrator too (there is no one else to appoint one).
    */
    async function provisionIdentity() {
        if (!instanceName) {
            return;
        }

        let managerDb = config.managerDatabase(conf);
        let cpClient = new Client({
            database: managerDb,
            host: conf.pgHost,
            password: superpwd || conf.pgPassword,
            port: conf.pgPort,
            user: superuser || conf.pgUser
        });
        let by = conf.pgUser;

        await cpClient.connect();

        try {
            let resp = await cpClient.query(
                (
                    "SELECT t._pk, t._organization_organization_pk AS org, " +
                    "  o.name AS org_name " +
                    "FROM tenant t " +
                    "LEFT JOIN organization o " +
                    "  ON o._pk = t._organization_organization_pk " +
                    "WHERE t.pg_database = $1 AND NOT t.is_deleted"
                ),
                [instanceName]
            );
            let tenantPk = resp.rows[0]._pk;
            let orgPk = resp.rows[0].org;

            if (orgPk !== null) {
                // Already attached: that organization, whatever was asked
                if (orgGiven && resp.rows[0].org_name !== orgName) {
                    console.log(
                        "Instance \"" + instanceName + "\" already " +
                        "belongs to organization \"" +
                        resp.rows[0].org_name + "\"; --organization " +
                        "ignored"
                    );
                }
                orgName = resp.rows[0].org_name;
            } else {
                resp = await cpClient.query(
                    (
                        "SELECT _pk FROM organization " +
                        "WHERE name = $1 AND NOT is_deleted"
                    ),
                    [orgName]
                );

                if (resp.rows.length) {
                    orgPk = resp.rows[0]._pk;
                } else {
                    resp = await cpClient.query(
                        (
                            "INSERT INTO organization (_pk, id, created, " +
                            "created_by, updated, updated_by, " +
                            "is_deleted, owner, etag, name, is_active, " +
                            "authentication, is_two_factor_required) " +
                            "VALUES (nextval('object__pk_seq'), $1, " +
                            "now(), $2, now(), $2, false, $2, $1, $3, " +
                            "true, 'password', false) RETURNING _pk"
                        ),
                        [f.createId(), by, orgName]
                    );
                    orgPk = resp.rows[0]._pk;
                    await manager.audit(cpClient, {
                        action: "organization.created",
                        by,
                        detail: "Install: " + orgName,
                        organizationPk: orgPk
                    });
                    console.log("Created organization \"" + orgName + "\"");
                }

                await manager.attachInstance(cpClient, tenantPk, orgPk, by);
                console.log(
                    "Attached instance \"" + instanceName +
                    "\" to organization \"" + orgName + "\""
                );
            }

            let anyone = await cpClient.query(
                "SELECT 1 FROM identity WHERE NOT is_deleted LIMIT 1"
            );
            let added = await manager.addIdentity(cpClient, {
                by,
                organizationPk: orgPk,
                password: conf.pgPassword,
                username: conf.pgUser
            });

            await manager.setGrant(cpClient, {
                by,
                identityPk: added.identityPk,
                isActive: true,
                tenantPk
            });

            if (added.created) {
                await manager.audit(cpClient, {
                    action: "identity.created",
                    by,
                    detail: "Install: instance " + instanceName,
                    organizationPk: orgPk,
                    targetIdentityPk: added.identityPk
                });
                console.log(
                    "Created identity \"" + conf.pgUser + "\" in \"" +
                    orgName + "\" with the password in config.json"
                );
            }

            resp = await cpClient.query(
                "SELECT is_org_admin, is_platform_admin FROM identity " +
                "WHERE _pk = $1",
                [added.identityPk]
            );

            if (!resp.rows[0].is_org_admin) {
                await manager.setOrgAdmin(
                    cpClient,
                    added.identityPk,
                    true,
                    by
                );
                await manager.audit(cpClient, {
                    action: "identity.org_admin_granted",
                    by,
                    detail: "Install: first administrator of " + orgName,
                    organizationPk: orgPk,
                    targetIdentityPk: added.identityPk
                });
            }

            if (!anyone.rows.length && !resp.rows[0].is_platform_admin) {
                await cpClient.query(
                    (
                        "UPDATE identity SET is_platform_admin = true, " +
                        "updated = now(), updated_by = $2 WHERE _pk = $1"
                    ),
                    [added.identityPk, by]
                );
                await manager.audit(cpClient, {
                    action: "identity.platform_admin_granted",
                    by,
                    detail: "Install: first identity on this platform",
                    organizationPk: orgPk,
                    targetIdentityPk: added.identityPk
                });
                console.log(
                    "\"" + conf.pgUser + "\" is the platform administrator"
                );
            }

            console.log(
                "Sign in to /" + instanceName + "/ as \"" + conf.pgUser +
                "\"; the password is pgPassword in config.json"
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
        provisionIdentity
    ).then(
        done
    ).catch(
        error
    );
}());
