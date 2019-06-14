/*
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
          Return user data.

          @param {String} User account or role name
          @return {Object} User account info
        */
        that.deserializeUser = function (username) {
            return new Promise(function (resolve, reject) {
                const sql = (
                    "SELECT name, is_super, contact.email AS email, " +
                    "  contact.phone AS phone " +
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
                        delete row.is_super;
                        // Send back result
                        resolve(row);
                        obj.done();
                    }).catch(reject);
                });
            });
        };

        that.getClient = (ref) => clients[ref.clientId];

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

