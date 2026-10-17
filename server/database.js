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
    PostgreSQL database connection handlers.
    @module Database
*/
(function (exports) {
    "use strict";

    const crypto = require("crypto");
    const fs = require("fs");
    const {Pool} = require("pg");
    const {Config} = require("./config");
    const {Identities} = require("./services/identities");
    const f = require("../common/core");

    const config = new Config();
    let pgCryptoKey;

    function prop(store) {
        return function (...args) {
            if (args.length) {
                store = args[0];
            }
            return store;
        };
    }

    function sslConfig(props) {
        let sslCfg;
        let rfs = "readFileSync"; // Lint tyranny

        if (props.ssl) {
            let caCfg;
            let certCfg;
            let keyCfg;
            if (props.pgSslCA) {
                caCfg = fs[rfs](
                    props.pgSslCA
                ).toString();
            }
            if (props.pgSslCert) {
                certCfg = fs[rfs](
                    props.pgSslCert
                ).toString();
            }
            if (props.pgSslKey) {
                keyCfg = fs[rfs](props.pgSslKey).toString();
            }
            sslCfg = {
                ca: caCfg,
                cert: certCfg,
                key: keyCfg,
                rejectUnauthorized: (props.pgRejectUnauthorized || false)
            };
        }
        return sslCfg;
    }

    const identities = new Identities();

    function resolveTenant(tenant) {
        return tenant || {
            pgDatabase: undefined,
            pgService: {
                id: undefined,
                pgHost: undefined,
                pgPassword: undefined,
                pgPort: undefined
            }
        };
    }


    /*
        One connection pool per database, for the whole process.

        A dozen services each do `new Database()` (crud, settings,
        workbooks, admin, manager, installer and the rest), and the
        pools used to live inside that call -- so one database could
        have a dozen pools, each up to `pgTenantPoolSize`, and the
        connection budget in the README was wrong by the number of
        services.

        Worse, it made "give up this database" impossible: releasing a
        tenant before a template copy or a drop (tenant plan D.3) ended
        only the pool belonging to whichever service asked, and
        everyone else's idle connections kept the database busy until
        their idle timeout. A template build after a deployment would
        then refuse, because the deployment had read the instance
        through a different service's pool.

        Keyed by database name, which is what `getPool` already used,
        so sharing them changes nothing about how one is found.
    */
    const pools = {};

    /**
        Class for managing database connectivity functions.
        @class Database
        @constructor
    */
    exports.Database = function () {
        let cache;
        let that = {};

        /*
            Resolve connection string.

            The connection used when no instance is named is the
            manager: the registry, the sessions and everything else a
            `tenant: false` request reaches (tenant plan section 9).
        */
        function setConfig(resp) {
            return new Promise(function (resolve) {
                let managerDb = config.managerDatabase(resp);

                cache = {
                    pgDatabase: managerDb,
                    postgres: {
                        database: managerDb,
                        host: resp.pgHost,
                        max: resp.pgMaxConnections || 10,
                        password: resp.pgPassword,
                        port: resp.pgPort,
                        // The manager is on this server's own cluster,
                        // so the server's TLS settings are the right
                        // ones here.
                        ssl: sslConfig(resp),
                        user: resp.pgUser
                    },
                    /*
                        What each instance's pool may grow to, and how
                        long an idle client lives (tenant plan E.4).
                        pgMaxConnections governs the manager pool
                        above, as it always has.
                    */
                    tenantIdleTimeout: resp.pgTenantIdleTimeout || 60000,
                    tenantPoolSize: resp.pgTenantPoolSize || 10
                };
                resolve(resp);
            });
        }

        function setNodeId(resp) {
            return new Promise(function (resolve) {
                // Unique per process, so two nodes started from one config
                // file never share locks, subscriptions or a LISTEN channel.
                that.nodeId = (
                    "node_" + process.pid + "_" +
                    crypto.randomBytes(3).toString("hex")
                );
                resolve(resp);
            });
        }

        /*
            Sign in against the manager's identity table (ADR-001
            B.1/B.2): database -> tenant -> organization -> identity ->
            verify in Node -> access grant -> local profile. No Postgres
            connection is ever opened as the user, so a failed sign-in
            strands nothing (the leak item 1.6 described cannot happen
            on this path).

            Lock policy matches the role path: the fourth consecutive
            failure locks the identity, and locking writes an audit row.
        */
        const AUDIT_DOC = (
            "nextval('object__pk_seq'),$1,now(),'system',now()," +
            "'system',false,'system',$1"
        );

        /*
            The credential half of sign-in, shared by the instance
            sign-in below and the picker's sign-in against the manager
            alone (tenant plan G.1). Resolves the identity inside one
            organization, verifies the password in Node, counts
            failures and locks on the fourth, and replaces an imported
            verifier with the application's own hash. Returns the
            identity row; what access that buys is the caller's to
            decide.
        */
        async function verifyCredential(client, orgPk, username, pswd) {
            let resp = await client.query(
                (
                    "SELECT _pk, password_hash, status, " +
                    "  failed_attempts, locked_until, " +
                    "  is_platform_admin, is_org_admin, " +
                    "  full_name, email, username " +
                    "FROM identity " +
                    "WHERE _organization_organization_pk = $1 " +
                    "  AND lower(username) = lower($2) " +
                    "  AND NOT is_deleted"
                ),
                [orgPk, username]
            );
            let row;

            if (!resp.rows.length) {
                throw new Error(
                    "No active user account " + username + " found"
                );
            }
            row = resp.rows[0];

            if (
                row.status === "locked" || (
                    row.locked_until &&
                    new Date(row.locked_until) > new Date()
                )
            ) {
                throw new Error("User account is locked");
            }
            if (row.status !== "active") {
                throw new Error(
                    "No active user account " + username + " found"
                );
            }

            let check = identities.verifyPassword(
                pswd,
                row.password_hash,
                username
            );

            if (!check.ok) {
                let attempts = row.failed_attempts + 1;

                await client.query(
                    (
                        "UPDATE identity SET failed_attempts = $2, " +
                        "updated = now(), updated_by = 'system' " +
                        "WHERE _pk = $1"
                    ),
                    [row._pk, attempts]
                );

                if (attempts > 3) {
                    await client.query(
                        (
                            "UPDATE identity SET status = 'locked', " +
                            "updated = now(), updated_by = 'system' " +
                            "WHERE _pk = $1"
                        ),
                        [row._pk]
                    );
                    // The lock is a privileged state change, so it
                    // leaves an audit trail (ADR-001 A.4)
                    await client.query(
                        (
                            "INSERT INTO admin_audit (_pk,id,created," +
                            "created_by,updated,updated_by,is_deleted," +
                            "owner,etag,action,occurred," +
                            "_target_identity_identity_pk,detail) " +
                            "VALUES (" + AUDIT_DOC + ",$2,now(),$3,$4)"
                        ),
                        [
                            f.createId(),
                            "identity.locked",
                            row._pk,
                            "Locked after too many failed sign-in " +
                            "attempts"
                        ]
                    );
                    throw new Error(
                        "Too many sign in attempts. Account is locked."
                    );
                }
                if (attempts === 3) {
                    throw new Error(
                        "Invalid sign in credentials. " +
                        "One more attempt before account is locked."
                    );
                }
                throw new Error("Invalid sign in credentials.");
            }

            /*
                A verifier imported from pg_authid is checked once
                and replaced with the application's own hash, so the
                password-equivalent export does not stay at rest
            */
            if (check.needsRehash) {
                await client.query(
                    (
                        "UPDATE identity SET password_hash = $2, " +
                        "updated = now(), updated_by = 'system' " +
                        "WHERE _pk = $1"
                    ),
                    [row._pk, identities.hashPassword(pswd)]
                );
            }

            return row;
        }

        // A sign-in happened: the failure count goes back to zero and
        // the clock records it
        function stampSignIn(client, identityPk) {
            return client.query(
                (
                    "UPDATE identity SET failed_attempts = 0, " +
                    "last_signed_in = now(), " +
                    "updated = now(), updated_by = 'system' " +
                    "WHERE _pk = $1"
                ),
                [identityPk]
            );
        }

        /*
            Sign in against the manager's identity table (ADR-001
            B.1/B.2): database -> tenant -> organization -> identity ->
            verify in Node -> access grant -> local profile. No Postgres
            connection is ever opened as the user, so a failed sign-in
            strands nothing (the leak item 1.6 described cannot happen
            on this path).

            Lock policy matches the role path: the fourth consecutive
            failure locks the identity, and locking writes an audit row.
        */
        async function authenticateIdentity(req, username, pswd) {
            let obj;
            let orgTwoFactor;

            if (!req || !req.tenant || req.tenant.id === "-1") {
                throw new Error("Sign in requires an instance");
            }

            obj = await that.connect();
            try {
                let client = obj.client;
                let resp = await client.query(
                    (
                        "SELECT t._pk, t.is_active, " +
                        "  t._organization_organization_pk AS org, " +
                        "  o.is_two_factor_required " +
                        "FROM tenant t " +
                        "LEFT JOIN organization o " +
                        "  ON o._pk = t._organization_organization_pk " +
                        "WHERE t.id = $1 AND NOT t.is_deleted"
                    ),
                    [req.tenant.id]
                );
                let tenantPk;
                let row;

                if (!resp.rows.length) {
                    throw new Error(
                        "Instance " + req.tenant.name +
                        " is not registered"
                    );
                }
                tenantPk = resp.rows[0]._pk;
                if (resp.rows[0].org === null) {
                    throw new Error(
                        "Instance " + req.tenant.name +
                        " is not assigned to an organization"
                    );
                }
                /*
                    The registry's own switch (tenant plan D.4) and the
                    provisioning gate (D.1): a closed instance, or one
                    still being built, refuses new sign-ins. Nothing
                    here checked it before, so "close" only changed the
                    row.
                */
                if (resp.rows[0].is_active !== true) {
                    throw new Error(
                        "Instance " + req.tenant.name +
                        " is closed to sign-in"
                    );
                }

                /*
                    Whether this organization requires a second factor
                    (tenant plan C.2): rides to doSignIn on the resolved
                    user, so the policy is the organization's rather
                    than one global switch.
                */
                orgTwoFactor = resp.rows[0].is_two_factor_required;

                row = await verifyCredential(
                    client,
                    resp.rows[0].org,
                    username,
                    pswd
                );

                // The access boundary: may this identity enter this
                // instance?
                resp = await client.query(
                    (
                        "SELECT 1 FROM access_grant " +
                        "WHERE _identity_identity_pk = $1 " +
                        "  AND _tenant_tenant_pk = $2 " +
                        "  AND is_active AND NOT is_deleted"
                    ),
                    [row._pk, tenantPk]
                );
                if (!resp.rows.length) {
                    throw new Error(
                        "No access to instance " + req.tenant.name
                    );
                }

                /*
                    A deployment is running, so the schema underneath
                    is moving (ADR-002 question 7). Everyone is kept
                    out except a platform administrator, who has to be
                    able to get in: on an installation with one
                    instance the screen that clears maintenance is
                    served from that instance.
                */
                if (
                    req.tenant.isMaintenance === true &&
                    row.is_platform_admin !== true
                ) {
                    throw new Error(
                        "Down for maintenance. Instance " +
                        req.tenant.name +
                        " is being deployed to and will be back."
                    );
                }

                await stampSignIn(client, row._pk);
            } finally {
                obj.done();
            }

            // The local profile: preferences, contact and the stable
            // key history points at. Still required (B.5).
            let user = await that.deserializeUser(req, username);

            user.isTwoFactorRequired = orgTwoFactor === true;
            return user;
        }

        /*
            Sign in against the manager and nothing else, for the
            instance picker at a URL with no database (tenant plan
            G.1). There is no instance yet, so no grant is read and no
            local profile is made: what comes back is the identity, and
            the caller decides which instances it may reach.

            A username is unique within its organization, not across
            the installation, so an ambiguous one has to say which
            organization it means. The organization is never listed to
            a caller who has not signed in -- that would say where a
            username exists -- and the password is not tried against
            each candidate either, since a wrong one would count a
            failure against every organization and lock them all.
        */
        async function authenticateIdentityOnly(username, pswd, orgName) {
            let obj = await that.connect();

            try {
                let client = obj.client;
                let resp = await client.query(
                    (
                        "SELECT o._pk, o.id, o.name, " +
                        "  o.is_two_factor_required " +
                        "FROM identity i " +
                        "JOIN organization o " +
                        "  ON o._pk = i._organization_organization_pk " +
                        "WHERE lower(i.username) = lower($1) " +
                        "  AND i.status = 'active' " +
                        "  AND NOT i.is_deleted " +
                        "  AND o.is_active AND NOT o.is_deleted " +
                        "ORDER BY o.name"
                    ),
                    [username]
                );
                let org;
                let row;

                if (!resp.rows.length) {
                    throw new Error("Invalid sign in credentials.");
                }

                if (orgName) {
                    org = resp.rows.find(
                        (r) => (
                            r.name.toLowerCase() ===
                            String(orgName).trim().toLowerCase()
                        )
                    );
                    if (!org) {
                        throw new Error("Invalid sign in credentials.");
                    }
                } else if (resp.rows.length > 1) {
                    let err = new Error(
                        "More than one organization has this user name. " +
                        "Which one is yours?"
                    );

                    err.code = "organization-required";
                    throw err;
                } else {
                    org = resp.rows[0];
                }

                row = await verifyCredential(
                    client,
                    org._pk,
                    username,
                    pswd
                );
                await stampSignIn(client, row._pk);

                return {
                    email: row.email || "",
                    fullName: row.full_name || row.username,
                    isOrgAdmin: row.is_org_admin === true,
                    isPlatformAdmin: row.is_platform_admin === true,
                    isTwoFactorRequired: org.is_two_factor_required === true,
                    organization: {id: org.id, name: org.name},
                    username: row.username
                };
            } finally {
                obj.done();
            }
        }

        // ..........................................................
        // PUBLIC
        //
        /**
            Authenticates a user against their identity in the manager
            database (ADR-001) and, when the identity holds a live grant
            on the requested instance, resolves to
            {{#crossLink "User"}}{{/crossLink}}.
            Note this function does not create a persistant client connection.
            All actual client connections are handled by the service account.
            @method authenticate
            @param {String} username
            @param {String} password
            @return {Promise}
        */
        that.authenticate = function (req, username, pswd) {
            return authenticateIdentity(req, username, pswd);
        };
        /**
            Authenticates a user against their identity in the manager
            database with no instance in play, for the picker at a URL
            that names no database (tenant plan G.1). Resolves to the
            identity rather than to a
            {{#crossLink "User"}}{{/crossLink}}: there is no instance
            yet, so there is no local profile to resolve.

            Rejects with an error whose `code` is
            "organization-required" when the user name exists in more
            than one organization and none was named.

            @method authenticateIdentityOnly
            @param {String} username
            @param {String} password
            @param {String} [organization] Organization name
            @return {Promise}
        */
        that.authenticateIdentityOnly = function (username, pswd, org) {
            return authenticateIdentityOnly(username, pswd, org);
        };
        /**
            Database connection object. This object is requested from a
            connection pool and passed forward through all actions of a
            transaction until it is completed. Featherbone automatically
            handles connections and transactions, however it is important to
            know that any service that makes a
            {{#crossLink "Datasource/request:method"}}{{/crossLink}}
            on another service needs to reference the
            {{#crossLink "Client"}}{{/crossLink}} forwarded to it.
            @class Connection
            @static
        */
        /**
            @property client
            @type Client
            @final
        */
        /**
            Called when transaction is completed and returns client to the pool.
            @method done
        */
        /**
            Unique id to reference which node-postgres client to use in a
            transaction.
            @property clientId
            @type string
            @final
        */
        /**
            Returns the user name of the user who made a request. Necessary for
            Featherbone authorization management.
            @method currentUser
            @return {String}
        */
        /**
            Prevents recursive triggers from committing until all are done.
            @method isTriggering
            @param {Boolean} flag
            @return {Boolean}
        */
        /**
            Indicates whether client is currently wrapped in a transaction.
            @method wrapped
            @param {Boolean} flag
            @return {Boolean}
        */
        /**
            Resolves to a
            {{#crossLink "Connection"}}{{/crossLink}} using
            the configured postgres user account. If `referenceOnly`
            is passed as `true` then the connection's client value is a
            reference {{#crossLink "client"}}{{/crossLink}}, otherwise the
            client is an actual
            <a href='https://node-postgres.com/api/client'>postgres client</a>
            connection.
            The reference client is necessary to prevent SQL injection
            within a
            {{#crossLink "datasource"}}{{/crossLink}}
            {{#crossLink "datasource/request:method"}}{{/crossLink}} called by
            services written in the web client and stored in the database,
            where otherwise a "real" postgres client is used to execute SQL
            statements for hard coded services such as
            {{#crossLink "Services.CRUD"}}{{/crossLink}},
            {{#crossLink "Services.Events"}}{{/crossLink}} and
            {{#crossLink "Services.Installer"}}{{/crossLink}}.
            @method connect
            @for Database
            @param {Object} [tenant] Tenant login credentials
            @return {Promise}
        */
        that.connect = async function (tenant) {
            tenant = resolveTenant(tenant);

            let id = f.createId();
            let db;
            let pool;
            let resp;

            // Do connection
            async function doConnect() {
                db = tenant.pgDatabase || cache.pgDatabase;
                pool = pools[db];
                if (!pool) {
                    if (tenant.pgDatabase) {
                        pool = new Pool({
                            database: tenant.pgDatabase,
                            host: tenant.pgService.pgHost,
                            /*
                                Idle clients go away on their own, so an
                                instance nobody is using holds only its
                                LISTEN connection. With the cap this
                                bounds a node at
                                (instances x (1 + cap)) + manager
                                connections; see the README's sizing
                                note (tenant plan E.4).
                            */
                            idleTimeoutMillis: (
                                cache.tenantIdleTimeout
                            ),
                            max: cache.tenantPoolSize,
                            password: tenant.pgService.pgPassword,
                            port: tenant.pgService.pgPort,
                            /*
                                The server's own TLS settings stand in
                                for the service's: every TenantService
                                row today points at the cluster this
                                server already trusts, and the service
                                carries no TLS material of its own yet.
                            */
                            ssl: sslConfig(cache),
                            user: tenant.pgService.pgUser
                        });
                    } else {
                        pool = new Pool(cache.postgres);
                    }
                    pool.on("error", function (err) {
                        console.error(err.message);
                    });
                    pool.setMaxListeners(cache.postgres.max || 10);
                    pools[db] = pool;
                }

                let callbacks = [];
                let rollbacks = [];
                let c;
                let events = "_events";

                function doOnCommit(callback) {
                    callbacks.push(callback);
                }

                function doOnRollback(callback) {
                    rollbacks.push(callback);
                }

                try {
                    c = await pool.connect();
                    c.clientId = id;
                    c.currentUser = prop();
                    c.tenant = prop(
                        tenant.pgDatabase
                        ? tenant
                        : undefined
                    );
                    c.isTriggering = prop(false);
                    c.wrapped = prop(false);
                    c.onCommit = doOnCommit;
                    c.onRollback = doOnRollback;
                    c.callbacks = callbacks;
                    c.rollbacks = rollbacks;
                    if (!c[events] || !c[events].error) {
                        c.on("error", function (err) {
                            console.error(err.message);
                        });
                    }

                    return {
                        client: c,
                        done: c.release
                    };
                } catch (err) {
                    console.error(
                        "Could not connect to server",
                        err
                    );
                    return Promise.reject(err);
                }
            }

            if (cache) {
                return doConnect();
            }

            // If no config cache, go get it
            resp = await config.read();
            await setNodeId(resp);
            await setConfig(resp);
            return doConnect();
        };
        /**
            Get or set the postgres encryption key.

            @method pgCryptoKey
            @param {Object} payload Request payload
            @param {Object} payload.client Database client
            @return {Promise}
        */
        that.cryptoKey = function (...args) {
            if (args.length) {
                pgCryptoKey = args[0];
            }

            return pgCryptoKey;
        };
        /**
            Object defining a user on the server side for passport management.
            @class User
            @static
        */
        /**
            @property name
            @type String
        */
        /**
            @property isSuper
            @type Boolean
        */
        /**
            @property firstName
            @type String
        */
        /**
            @property lastName
            @type String
        */
        /**
            @property email
            @type String
        */
        /**
            @property phone
            @type String
        */
        /*
            Give an identity the local profile the instance needs
            (tenant plan B.7).

            `user_account` is the profile (B.5) and every instance
            needs its own row: without one, deserializeUser below
            refuses with "User account <name> not found", which is
            what somebody granted an instance from the Users screen,
            by the backfill, or by registering a database their people
            already use, runs into the moment they open it.

            The grant is the authorization decision, so a live grant
            is the only reason needed to write the row. Checked here
            and not taken on trust: the identity must be active, in
            this instance's organization, with an active grant to this
            instance. The row joins "everyone" and nothing else -- a
            profile created this way carries no authority the
            organization did not give it.

            Only on the identity path. On the role path a Postgres
            login role is cluster-wide, so the missing profile is the
            boundary that keeps one database's users out of another's,
            and creating one on demand would reopen item 1.1.
        */
        async function provisionProfile(req, username) {
            let mgr = await that.connect();
            let allowed;

            try {
                let resp = await mgr.client.query(
                    (
                        "SELECT i._pk, i.full_name, i.email " +
                        "FROM identity i " +
                        "JOIN access_grant g ON " +
                        "  g._identity_identity_pk = i._pk " +
                        "JOIN tenant t ON g._tenant_tenant_pk = t._pk " +
                        "WHERE t.id = $1 " +
                        "  AND lower(i.username) = lower($2) " +
                        "  AND i._organization_organization_pk = " +
                        "      t._organization_organization_pk " +
                        "  AND i.status = 'active' AND NOT i.is_deleted " +
                        "  AND g.is_active AND NOT g.is_deleted " +
                        "  AND NOT t.is_deleted"
                    ),
                    [req.tenant.id, username]
                );

                allowed = resp.rows[0];

                if (!allowed) {
                    return false;
                }
            } finally {
                mgr.done();
            }

            let obj = await that.connect(req.tenant);

            try {
                /*
                    Two requests can arrive together on a first sign-in,
                    and name is a unique natural key since improvement
                    item 2.6, so the second insert is a no-op rather
                    than an error.
                */
                let made = await obj.client.query(
                    (
                        "INSERT INTO user_account (" +
                        "  _pk, id, created, created_by, updated, " +
                        "  updated_by, is_deleted, owner, etag, name, " +
                        "  is_login, is_super, is_active, " +
                        "  change_password, sign_in_attempts, is_locked" +
                        ") VALUES (" +
                        "  nextval('object__pk_seq'), $1, now(), " +
                        "  'system', now(), 'system', false, $2, $1, $2, " +
                        "  true, false, true, false, 0, false" +
                        ") ON CONFLICT DO NOTHING RETURNING _pk"
                    ),
                    [f.createId(), username]
                );

                if (made.rows.length) {
                    await obj.client.query(
                        (
                            "INSERT INTO role_membership (" +
                            "  _pk, id, created, created_by, updated, " +
                            "  updated_by, is_deleted, _parent_role_pk, " +
                            "  role) VALUES (" +
                            "  nextval('object__pk_seq'), $1, now(), " +
                            "  'system', now(), 'system', false, $2, " +
                            "  'everyone')"
                        ),
                        [f.createId(), made.rows[0]._pk]
                    );
                }
            } finally {
                obj.done();
            }

            // Recorded where the other privileged writes are
            let audit = await that.connect();

            try {
                await audit.client.query(
                    (
                        "INSERT INTO admin_audit (" +
                        "  _pk, id, created, created_by, updated, " +
                        "  updated_by, is_deleted, owner, etag, action, " +
                        "  occurred, _actor_identity_pk, " +
                        "  _target_identity_identity_pk, detail" +
                        ") VALUES (" +
                        "  nextval('object__pk_seq'), $1, now(), " +
                        "  'system', now(), 'system', false, 'system', " +
                        "  $1, 'user_account.provisioned', now(), null, " +
                        "  $2, $3)"
                    ),
                    [
                        f.createId(),
                        allowed._pk,
                        username + " in " + req.tenant.name
                    ]
                );
            } catch (err) {
                console.error(
                    "Could not record the profile created for " +
                    username + ": " + (err.message || err)
                );
            } finally {
                audit.done();
            }

            return true;
        }

        /**
            Return user data.
            @method deserializeUser
            @for Database
            @param {String} username User account or role name
            @param {Object} tenant Tenant
            @return {User} User account info
        */
        that.deserializeUser = async function (req, username) {
            const sql = (
                "SELECT name, is_super, change_password, " +
                "contact.first_name as first_name, " +
                "contact.last_name as last_name, " +
                "contact.email AS email, " +
                "contact.phone AS phone," +
                "user_account.id,  " +
                "CASE WHEN rm.role IS NULL " +
                "  THEN false " +
                "  ELSE true END AS is_admin " +
                "FROM user_account " +
                "LEFT OUTER JOIN contact ON " +
                "  (_contact_contact_pk = contact._pk) " +
                "LEFT OUTER JOIN role_membership rm ON" +
                "  (rm._parent_role_pk = user_account._pk " +
                " AND rm.role='administrator' " +
                " AND NOT rm.is_deleted) " +
                "WHERE name = $1;"
            );
            let obj;
            if (!req.tenant) {
                return Promise.reject(
                    "Deserialize user function requires a tenant"
                );
            }

            try {
                obj = await that.connect(req.tenant);
                let resp = await obj.client.query(sql, [username]);
                let row;

                if (!resp.rows.length) {
                    /*
                        No profile here yet. A live grant is reason
                        enough to make one (B.7); without a grant the
                        answer stands.
                    */
                    let made = false;

                    try {
                        made = await provisionProfile(req, username);
                    } catch (err) {
                        /*
                            Say so: without this the person is told
                            their account does not exist, which is
                            true but not the reason.
                        */
                        console.error(
                            "Could not make the local profile for " +
                            username + " in " + req.tenant.name +
                            ": " + (err.message || err)
                        );
                    }

                    if (made) {
                        resp = await obj.client.query(sql, [username]);
                    }

                    if (!resp.rows.length) {
                        return Promise.reject(new Error(
                            "User account " + username + " not found."
                        ));
                    }
                }

                row = resp.rows[0];
                row.isAdmin = row.is_admin;
                row.isSuper = row.is_super;
                row.firstName = row.first_name || "";
                row.lastName = row.last_name || "";
                row.email = row.email || "";
                row.phone = row.phone || "";
                row.changePassword = row.change_password;
                delete row.is_super;
                delete row.first_name;
                delete row.last_name;
                delete row.change_password;
                delete row.is_admin;
                // Send back result
                return row;
            } catch (e) {
                return Promise.reject(e);
            } finally {
                obj.done();
            }
        };

        /**
            Resolve to a
            <a href='https://node-postgres.com/api/pool'>connection pool</a>
            from which to request a connection.
            @method getPool
            @return {Promise}
        */
        that.getPool = function (tenant) {
            tenant = resolveTenant(tenant);

            return new Promise(function (resolve, reject) {
                let db = tenant.pgDatabase || cache.pgDatabase;
                let pool = pools[db];

                if (pool) {
                    resolve(pool);
                    return;
                }

                // Create pool
                function doPool() {
                    if (tenant.pgDatabase) {
                        pool = new Pool({
                            database: tenant.pgDatabase,
                            host: tenant.pgService.pgHost,
                            password: tenant.pgService.pgPassword,
                            port: tenant.pgService.pgPort,
                            ssl: sslConfig(cache), // This doesn't look right
                            user: tenant.pgService.pgUser
                        });
                    } else {
                        pool = new Pool(cache.postgres);
                    }
                    pool.on("error", function (err) {
                        console.error(err.message);
                    });
                    pool.setMaxListeners(cache.postgres.max);
                    pools[db] = pool;
                    resolve(pool);
                }

                if (cache) {
                    doPool();
                    return;
                }

                // If no connection string, go get it
                Promise.resolve().then(
                    config.read
                ).then(
                    setNodeId
                ).then(
                    setConfig
                ).then(
                    doPool
                ).catch(
                    reject
                );
            });
        };

        /**
            Terminate pool and all connections.

            @method endPool
            @return {Promise}
        */
        that.endPool = async function (tenant) {
            /*
                Look the pool up instead of asking getPool for one:
                getPool creates a pool when none exists, so ending the
                pool of a database this process never connected to used
                to build one just to tear it down (tenant plan D.3).
            */
            let db = (
                (tenant && tenant.pgDatabase)
                ? tenant.pgDatabase
                : (cache && cache.pgDatabase)
            );
            let pool = (
                db
                ? pools[db]
                : undefined
            );

            if (pool) {
                await pool.end();
                delete pools[db];
            }
        };

        /**
            True if this process holds a connection pool for the
            database. Lets a caller tell "no pool" from "pool ended".

            @method hasPool
            @param {Object} [tenant]
            @return {Boolean}
        */
        that.hasPool = function (tenant) {
            let db = (
                (tenant && tenant.pgDatabase)
                ? tenant.pgDatabase
                : (cache && cache.pgDatabase)
            );

            return Boolean(db && pools[db]);
        };

        return that;
    };

}(exports));

