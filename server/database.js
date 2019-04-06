/**
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
**/
/*jslint node*/
(function (exports) {
    "use strict";

    const {
        Pool
    } = require("pg");
    const {
        Config
    } = require("./config");

    const config = new Config();

    exports.Database = function () {
        let conn;
        let pool;
        let that = {};

        // Reslove connection string
        function setConnectionString(config) {
            return new Promise(function (resolve) {
                conn = "postgres://";
                conn += config.postgres.user + ":";
                conn += config.postgres.password + "@";
                conn += config.postgres.host + "/";
                conn += config.postgres.database;

                resolve();
            });
        }

        function setNodeId(config) {
            return new Promise(function (resolve) {
                that.nodeId = config.nodeId.toSnakeCase();
                resolve(config);
            });
        }

        // ..........................................................
        // PUBLIC
        //

        that.connect = function () {
            return new Promise(function (resolve, reject) {
                // Do connection
                function doConnect() {
                    return new Promise(function (resolve, reject) {
                        if (!pool) {
                            pool = new Pool({
                                connectionString: conn
                            });
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

                            resolve({
                                client: c,
                                done: d
                            });
                        });
                    });
                }

                if (conn) {
                    doConnect().then(resolve).catch(reject);
                    return;
                }

                // If no connection string, go get it
                Promise.resolve().then(
                    config.read
                ).then(
                    setNodeId
                ).then(
                    setConnectionString
                ).then(
                    doConnect
                ).then(
                    resolve
                ).catch(
                    reject
                );
            });
        };

        return that;
    };

}(exports));

