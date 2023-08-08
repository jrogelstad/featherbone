/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

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

    const fs = require("fs");
    const {Pool} = require("pg");
    const {Config} = require("./config");
    const f = require("../common/core");

    const config = new Config();

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


    /**
        Class for managing database connectivity functions.
        @class Database
        @constructor
    */
    exports.Database = function () {
        let cache;
        let pools = {};
        let that = {};

        // Reslove connection string
        function setConfig(resp) {
            return new Promise(function (resolve) {
                cache = {
                    postgres: {
                        database: resp.pgDatabase,
                        host: resp.pgHost,
                        max: resp.pgMaxConnections || 10,
                        password: resp.pgPassword,
                        port: resp.pgPort,
                        ssl: sslConfig(resp), // This doesn't look right
                        user: resp.pgUser
                    }
                };
                resolve(resp);
            });
        }

        function setNodeId(resp) {
            return new Promise(function (resolve) {
                that.nodeId = resp.nodeId.toSnakeCase();
                resolve(resp);
            });
        }

        // ..........................................................
        // PUBLIC
        //
        /**
            Authenticates user against database credentials, and if successful
            resolves to
            {{#crossLink "User"}}{{/crossLink}}.
            Note this function does not create a persistant client connection.
            All actual client connections are handled by the service account.
            @method authenticate
            @param {String} username
            @param {String} password
            @return {Promise}
        */
        that.authenticate = function (username, pswd) {
            return new Promise(function (resolve, reject) {
                // Do connection
                function doConnect(resp) {
                    return new Promise(function (resolve, reject) {
                        let login = new Pool({
                            database: resp.pgDatabase,
                            host: resp.pgHost,
                            password: pswd,
                            port: resp.pgPort,
                            ssl: sslConfig(resp),
                            user: username
                        });

                        login.connect(function (err, ignore, done) {
                            // handle an error from the connection
                            done();

                            if (err) {
                                reject(err);
                                return;
                            }

                            that.deserializeUser(username).then(function (dat) {
                                login.end();
                                resolve(dat);
                            }).catch(reject);
                        });
                    });
                }

                // If no connection string, go get it
                Promise.resolve().then(
                    config.read
                ).then(
                    doConnect
                ).then(
                    resolve
                ).catch(
                    reject
                );
            });
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
                            password: tenant.pgService.pgPassword,
                            port: tenant.pgService.pgPort,
                            ssl: sslConfig(cache), // Doesn't look right
                            user: tenant.pgService.pgUser
                        });
                    } else {
                        pool = new Pool(cache.postgres);
                    }
                    pool.setMaxListeners(cache.postgres.max || 10);
                    pools[db] = pool;
                }

                let callbacks = [];
                let rollbacks = [];
                let c;

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
        /**
            Return user data.
            @method deserializeUser
            @for Database
            @param {String} username User account or role name
            @param {Object} tenant Tenant
            @return {User} User account info
        */
        that.deserializeUser = function (username, tenant) {
            return new Promise(function (resolve, reject) {
                const sql = (
                    "SELECT name, is_super, " +
                    "contact.first_name as first_name, " +
                    "contact.last_name as last_name, " +
                    "contact.email AS email, " +
                    "contact.phone AS phone " +
                    "FROM user_account " +
                    "LEFT OUTER JOIN contact ON " +
                    "  (_contact_contact_pk = contact._pk) " +
                    "WHERE name = $1;"
                );

                that.connect(tenant).then(function (obj) {
                    obj.client.query(sql, [username]).then(function (resp) {
                        let row;

                        if (!resp.rows.length) {
                            reject(new Error(
                                "User account " + username + " not found."
                            ));
                        }

                        row = resp.rows[0];
                        row.isSuper = row.is_super;
                        row.firstName = row.first_name || "";
                        row.lastName = row.last_name || "";
                        row.email = row.email || "";
                        row.phone = row.phone || "";
                        delete row.is_super;
                        delete row.first_name;
                        delete row.last_name;
                        // Send back result
                        resolve(row);
                        obj.done();
                    }).catch(reject);
                });
            });
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
            let pool = await that.getPool(tenant);
            let db = (
                tenant
                ? tenant.pgDatabase
                : cache.pgDatabase
            );

            if (pool) {
                await pool.end();
                delete pools[db];
            }
        };

        return that;
    };

}(exports));

