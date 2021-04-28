/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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

    const {Pool} = require("pg");
    const {Config} = require("./config");
    const f = require("../common/core");

    const config = new Config();
    const clients = {};

    function prop(store) {
        return function (...args) {
            if (args.length) {
                store = args[0];
            }
            return store;
        };
    }

    /**
        Class for managing database connectivity functions.
        @class Database
        @constructor
    */
    exports.Database = function () {
        let cache;
        let pool;
        let that = {};

        // Reslove connection string
        function setConfig(resp) {
            return new Promise(function (resolve) {
                cache = resp;
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
            @param username
            @param password
            @return {Promise}
        */
        that.authenticate = function (username, password) {
            return new Promise(function (resolve, reject) {
                // Do connection
                function doConnect(resp) {
                    return new Promise(function (resolve, reject) {
                        let login;

                        login = new Pool({
                            host: resp.postgres.host,
                            database: resp.postgres.database,
                            user: username,
                            password: password,
                            port: resp.postgres.port
                        });

                        login.connect(function (err, ignore, done) {
                            // handle an error from the connection
                            done();

                            if (err) {
                                reject(err);
                                return;
                            }

                            that.deserializeUser(username).then(
                                resolve
                            ).catch(reject);
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
            A Featherbone object which references a client connection created
            by the <a href='https://node-postgres.com'>node-postgres</a> library
            for handling postgres connectivity.
            It also contains several properties for keeping track of
            transaction state and the user account making requests.

            Use {{#crossLink "Database/getClient:method"}}{{/crossLink}} to
            resolve to an actual
            <a href='https://node-postgres.com/api/client'>postgres client</a>
            and execute SQL.
            @class Client
            @static
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
            @param {Boolean} referenceOnly
            @return {Promise}
        */
        that.connect = function (referenceOnly) {
            return new Promise(function (resolve, reject) {
                let id = f.createId();

                // Do connection
                function doConnect() {
                    return new Promise(function (resolve, reject) {
                        if (!pool) {
                            pool = new Pool(cache.postgres);
                        }

                        pool.connect(function (err, c, d) {
                            // handle an error from the connection
                            if (err) {
                                console.error(
                                    "Could not connect to server",
                                    err
                                );
                                reject(err);
                                return;
                            }

                            c.clientId = id;
                            c.currentUser = prop();
                            c.isTriggering = prop(false);
                            c.wrapped = prop(false);
                            clients[id] = c;

                            if (referenceOnly) {
                                resolve({
                                    client: Object.freeze({
                                        clientId: c.clientId,
                                        currentUser: c.currentUser,
                                        isTriggering: c.isTriggering,
                                        wrapped: c.wrapped
                                    }),
                                    done: function () {
                                        delete clients[id];
                                        d();
                                    }
                                });
                                return;
                            }

                            resolve({
                                client: c,
                                done: function () {
                                    delete clients[id];
                                    d();
                                }
                            });
                        });
                    });
                }

                if (cache) {
                    doConnect().then(resolve).catch(reject);
                    return;
                }

                // If no config cache, go get it
                Promise.resolve().then(
                    config.read
                ).then(
                    setNodeId
                ).then(
                    setConfig
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
            @return {User} User account info
        */
        that.deserializeUser = function (username) {
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

                that.connect().then(function (obj) {
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
            Resolve a reference {{#crossLink "Client"}}{{/crossLink}}
            to an actual
            <a href='https://node-postgres.com/api/client'>postgres client</a>
            to execute SQL.
            @method getClient
            @param {Client} client
            @return {Object}
        */
        that.getClient = (ref) => clients[ref.clientId];

        /**
            Resolve to a
            <a href='https://node-postgres.com/api/pool'>connection pool</a>
            from which to request a connection.
            @method getPool
            @return {Promise}
        */
        that.getPool = function () {
            return new Promise(function (resolve, reject) {
                if (pool) {
                    resolve(pool);
                    return;
                }

                // Create pool
                function doPool() {
                    pool = new Pool(cache.postgres);
                    resolve(pool);
                }

                if (cache) {
                    doPool().then(resolve).catch(reject);
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

        return that;
    };

}(exports));

