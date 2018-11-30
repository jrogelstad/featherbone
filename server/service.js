/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*global Promise*/
/*jslint node, this, es6, for*/
(function (exports) {
    "strict";

    const {
        Events
    } = require("./services/events");
    const {
        Settings
    } = require("./services/settings");
    const {
        Feather
    } = require("./services/feather");

    const events = new Events();
    const settings = new Settings();
    const plumo = new Feather();

    var that,
        f = require("../common/core"),
        format = require("pg-format");

    // ..........................................................
    // PRIVATE
    //

    function promiseWrapper(name) {
        return function (...args) {
            return new Promise(function (resolve, reject) {
                args[0].callback = function (err, resp) {
                    if (err) {
                        if (typeof err === "string") {
                            err = {
                                message: err,
                                statusCode: 500
                            };
                        } else if (err instanceof Error) {
                            err.statusCode = 500;
                        }

                        reject(err);
                        return;
                    }

                    resolve(resp);
                };

                that[name].apply(null, args);
            });
        };
    }

    function curry(...args1) {
        var fn = args1[0],
            args = args1[1],
            ary = [];

        return function () {
            return fn.apply(this, args.concat(ary.slice.call(args1)));
        };
    }

    // ..........................................................
    // PUBLIC
    //

    /**
      * Escape strings to prevent sql injection
        http://www.postgresql.org/docs/9.1/interactive/functions-string.html
      *
      * @param {String} A string with tokens to replace.
      * @param {Array} Array of replacement strings.
      * @return {String} Escaped string.
    */
    String.prototype.format = function (ary) {
        var params = [],
            i = 0;

        ary = ary || [];
        ary.unshift(this);

        while (ary[i]) {
            i += 1;
            params.push("$" + i);
        }

        return curry(format, ary)();
    };

    that = {

        /**
          Remove a class from the database.

            @param {Object} Request payload
            @param {Object} [payload.data] Payload data
            @param {Object | Array} [payload.data.name] Name of workbook to delete
            @param {Object} [payload.client] Database client
            @param {Function} [payload.callback] Callback
            @return {Boolean}
        */
        deleteWorkbook: function (obj) {
            var sql = "DELETE FROM \"$workbook\" WHERE name=$1;";

            obj.client.query(sql, [obj.data.name], function (err) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                obj.callback(null, true);
            });

            return this;
        },

        /**
          Return services.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getServices: function (obj) {
            var sql = "SELECT * FROM \"$service\" ";

            // Query modules
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        /**
          Return modules.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getModules: function (obj) {
            var sql = "SELECT * FROM \"$module\" ";

            // Query modules
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        /**
          Return routes.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getRoutes: function (obj) {
            var sql = "SELECT * FROM \"$route\";";

            // Query routes
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        getWorkbook: function (obj) {
            var callback = function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                obj.callback(null, resp[0]);
            };

            that.getWorkbooks({
                data: obj.data,
                client: obj.client,
                callback: callback
            });
        },

        /**
          Return a workbook definition(s). If name is passed in payload
          only that workbook will be returned.

          @param {Object} Request payload
          @param {Object} [payload.data] Workbook data
          @param {Object} [payload.data.name] Workbook name
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return receiver
        */
        getWorkbooks: function (obj) {
            var params = [obj.client.currentUser],
                sql = "SELECT name, description, module, launch_config AS \"launchConfig\", " +
                        "default_config AS \"defaultConfig\", local_config AS \"localConfig\" " +
                        "FROM \"$workbook\"" +
                        "WHERE EXISTS (" +
                        "  SELECT can_read FROM ( " +
                        "    SELECT can_read " +
                        "    FROM \"$auth\"" +
                        "      JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
                        "      JOIN \"role_member\"" +
                        "        ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
                        "    WHERE member=$1" +
                        "      AND object_pk=\"$workbook\"._pk" +
                        "    ORDER BY can_read DESC" +
                        "    LIMIT 1" +
                        "  ) AS data " +
                        "  WHERE can_read)";

            if (obj.data.name) {
                sql += " AND name=$2";
                params.push(obj.data.name);
            }

            sql += " ORDER BY _pk";

            obj.client.query(sql, params, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                obj.callback(null, resp.rows);
            });
        },

        /**
          Create or upate workbooks.

          @param {Object} Payload
          @param {Object | Array} [payload.data] Workbook data.
          @param {Object | Array} [payload.data.specs] Workbook specification(s).
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] Callback
          @return {String}
        */
        saveWorkbook: function (obj) {
            var row, nextWorkbook, wb, sql, params, authorization, id,
                    findSql = "SELECT * FROM \"$workbook\" WHERE name = $1;",
                    workbooks = Array.isArray(obj.data.specs)
                ? obj.data.specs
                : [obj.data.specs],
                    len = workbooks.length,
                    n = 0;

            nextWorkbook = function () {
                if (n < len) {
                    wb = workbooks[n];
                    authorization = wb.authorization;
                    n += 1;

                    // Upsert workbook
                    obj.client.query(findSql, [wb.name], function (err, resp) {
                        var launchConfig, localConfig, defaultConfig;
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        row = resp.rows[0];
                        if (row) {

                            // Update workbook
                            sql = "UPDATE \"$workbook\" SET " +
                                    "updated_by=$2, updated=now(), " +
                                    "description=$3, launch_config=$4, default_config=$5," +
                                    "local_config=$6, module=$7 WHERE name=$1;";
                            id = wb.id;
                            launchConfig = wb.launchConfig || row.launch_config;
                            defaultConfig = wb.defaultConfig || row.default_config;
                            localConfig = wb.localConfig || row.local_config;
                            params = [
                                wb.name,
                                obj.client.currentUser,
                                wb.description || row.description,
                                JSON.stringify(launchConfig),
                                JSON.stringify(defaultConfig),
                                JSON.stringify(localConfig),
                                wb.module
                            ];
                        } else {
                            // Insert new workbook
                            sql = "INSERT INTO \"$workbook\" (_pk, id, name, description, module, " +
                                    "launch_config, default_config, local_config, " +
                                    "created_by, updated_by, created, updated, is_deleted) " +
                                    "VALUES (" +
                                    "nextval('object__pk_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $8, " +
                                    "now(), now(), false) " +
                                    "RETURNING _pk;";
                            id = f.createId();
                            launchConfig = wb.launchConfig || {};
                            localConfig = wb.localConfig || [];
                            defaultConfig = wb.defaultConfig || [];
                            params = [
                                id,
                                wb.name,
                                wb.description || "",
                                wb.module,
                                launchConfig,
                                JSON.stringify(defaultConfig),
                                JSON.stringify(localConfig),
                                obj.client.currentUser
                            ];
                        }

                        // Execute
                        obj.client.query(sql, params, function (err) {
                            if (err) {
                                obj.callback(err);
                                return;
                            }

                            // If no specific authorization, make one
                            if (authorization === undefined) {
                                authorization = {
                                    data: {
                                        role: "everyone",
                                        actions: {
                                            canCreate: true,
                                            canRead: true,
                                            canUpdate: true,
                                            canDelete: true
                                        }
                                    },
                                    client: obj.client,
                                    callback: nextWorkbook
                                };
                            }
                            authorization.data.id = id;
                            authorization.client = obj.client;

                            // Set authorization
                            if (authorization) {
                                plumo.saveAuthorization(authorization)
                                    .then(nextWorkbook)
                                    .catch(obj.callback);
                                return;
                            }

                            // Only come here if authorization was false
                            nextWorkbook();
                        });
                    });
                    return;
                }

                obj.callback(null, true);
            };

            nextWorkbook();
        },

        subscribe: function (obj) {
            events.subscribe(obj.client, obj.subscription, [obj.id])
                .then(function () {
                    obj.callback(null, true);
                })
                .catch(obj.callback);
        },

        unsubscribe: function (obj) {
            events.unsubscribe(obj.client, obj.subscription.id)
                .then(function () {
                    obj.callback(null, true);
                })
                .catch(obj.callback);
        }
    };

    /**
      Returns settings object used internally by service.

      @returns {Object} Settings
    */
    exports.settings = function () {
        return settings;
    };

    // Set properties on exports
    Object.keys(that).forEach(function (key) {
        exports[key] = promiseWrapper(key);
    });

}(exports));