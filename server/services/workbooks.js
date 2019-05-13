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
        Feathers
    } = require("./feathers");

    const f = require("../../common/core");
    const feathers = new Feathers();

    exports.Workbooks = function () {
        // ..........................................................
        // PRIVATE
        //

        let that = {};

        // ..........................................................
        // PUBLIC
        //

        /**
          Remove a workbook from the database.

            @param {Object} Request payload
            @param {Object} [payload.data] Payload data
            @param {Object | Array} [payload.data.name] Workbook to delete
            @param {Object} [payload.client] Database client
            @return {Object} Promise
        */
        that.deleteWorkbook = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "DELETE FROM \"$workbook\" WHERE name=$1;";

                obj.client.query(sql, [obj.data.name], function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(true);
                });
            });
        };

        that.getWorkbook = function (obj) {
            return new Promise(function (resolve, reject) {
                let err;

                function callback(resp) {
                    if (!resp.length) {
                        err = new Error("Workbook not found");
                        err.statusCode = 404;
                        throw err;
                    }

                    resolve(resp[0]);
                }

                that.getWorkbooks({
                    data: obj.data,
                    client: obj.client
                }).then(callback).catch(reject);
            });
        };

        /**
          Return a workbook definition(s). If name is passed in payload
          only that workbook will be returned.

          @param {Object} Request payload
          @param {Object} [payload.data] Workbook data
          @param {Object} [payload.data.name] Workbook name
          @param {Object} [payload.client] Database client
          @return {Object} Promise
        */
        that.getWorkbooks = function (obj) {
            return new Promise(function (resolve, reject) {
                let params = [obj.client.currentUser];
                let sql;

                sql = (
                    "SELECT name, description, module, " +
                    "launch_config AS \"launchConfig\", " +
                    "icon, " +
                    "default_config AS \"defaultConfig\", " +
                    "local_config AS \"localConfig\" " +
                    "FROM \"$workbook\"" +
                    "WHERE EXISTS (" +
                    "  SELECT can_read FROM ( " +
                    "    SELECT can_read " +
                    "    FROM \"$auth\", pg_authid " +
                    "    WHERE pg_has_role($1, pg_authid.oid, 'member')" +
                    "      AND \"$auth\".object_pk=\"$workbook\"._pk" +
                    "      AND \"$auth\".role=pg_authid.rolname" +
                    "    ORDER BY can_read DESC" +
                    "    LIMIT 1" +
                    "  ) AS data " +
                    "  WHERE can_read)"
                );

                if (obj.data.name) {
                    sql += " AND name=$2";
                    params.push(obj.data.name);
                }

                sql += " ORDER BY _pk";

                obj.client.query(sql, params, function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(resp.rows);
                });
            });
        };

        /**
          Create or upate workbooks.

          @param {Object} Payload
          @param {Object | Array} [payload.data] Workbook data.
          @param {Object | Array} [payload.data.specs] Workbook specification.
          @param {Object} [payload.client] Database client
          @return {Object} Promise
        */
        that.saveWorkbook = function (obj) {
            return new Promise(function (resolve, reject) {
                let row;
                let nextWorkbook;
                let wb;
                let sql;
                let params;
                let authorization;
                let id;
                let findSql = "SELECT * FROM \"$workbook\" WHERE name = $1;";
                let workbooks = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );
                let len = workbooks.length;
                let n = 0;

                nextWorkbook = function () {
                    if (n < len) {
                        wb = workbooks[n];
                        authorization = wb.authorization;
                        n += 1;

                        // Upsert workbook
                        obj.client.query(
                            findSql,
                            [wb.name],
                            function (err, resp) {
                                let icon;
                                let launchConfig;
                                let localConfig;
                                let defaultConfig;

                                if (err) {
                                    reject(err);
                                    return;
                                }

                                row = resp.rows[0];
                                if (row) {
                                    // Update workbook
                                    sql = (
                                        "UPDATE \"$workbook\" SET " +
                                        "updated_by=$2, updated=now(), " +
                                        "description=$3, launch_config=$4," +
                                        "default_config=$5," +
                                        "local_config=$6, module=$7, " +
                                        "icon=$8 " +
                                        "WHERE name=$1;"
                                    );
                                    id = row.id;
                                    launchConfig = (
                                        wb.launchConfig || row.launch_config
                                    );
                                    icon = (
                                        wb.icon || row.icon
                                    );
                                    defaultConfig = (
                                        wb.defaultConfig || row.default_config
                                    );
                                    localConfig = (
                                        wb.localConfig || row.local_config
                                    );
                                    params = [
                                        wb.name,
                                        obj.client.currentUser,
                                        wb.description || row.description,
                                        JSON.stringify(launchConfig),
                                        JSON.stringify(defaultConfig),
                                        JSON.stringify(localConfig),
                                        wb.module,
                                        icon
                                    ];
                                } else {
                                    // Insert new workbook
                                    sql = "INSERT INTO \"$workbook\"";
                                    sql += "(_pk, id, name, description, ";
                                    sql += "module, ";
                                    sql += "launch_config, default_config, ";
                                    sql += "local_config, icon, ";
                                    sql += "created_by, updated_by, created, ";
                                    sql += "updated, is_deleted) ";
                                    sql += "VALUES (";
                                    sql += "nextval('object__pk_seq'),";
                                    sql += "$1, $2, $3, $4, $5, $6, $7, $8,";
                                    sql += "$8, $9, ";
                                    sql += "now(), now(), false) ";
                                    sql += "RETURNING _pk;";
                                    id = f.createId();
                                    launchConfig = wb.launchConfig || {};
                                    localConfig = wb.localConfig || [];
                                    defaultConfig = wb.defaultConfig || [];
                                    icon = wb.icon || "folder";
                                    params = [
                                        id,
                                        wb.name,
                                        wb.description || "",
                                        wb.module,
                                        launchConfig,
                                        JSON.stringify(defaultConfig),
                                        JSON.stringify(localConfig),
                                        icon,
                                        obj.client.currentUser
                                    ];
                                }

                                // Execute
                                obj.client.query(sql, params, function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    // If no specific authorization, make one
                                    if (authorization === undefined) {
                                        authorization = {
                                            data: {
                                                role: "everyone",
                                                isInternal: true,
                                                actions: {
                                                    canCreate: true,
                                                    canRead: true,
                                                    canUpdate: true,
                                                    canDelete: true
                                                }
                                            },
                                            client: obj.client
                                        };
                                    }
                                    authorization.data.id = id;
                                    authorization.client = obj.client;

                                    // Set authorization
                                    if (authorization) {
                                        feathers.saveAuthorization(
                                            authorization
                                        ).then(nextWorkbook).catch(reject);
                                        return;
                                    }

                                    // Only come here if authorization was false
                                    nextWorkbook();
                                });
                            }
                        );
                        return;
                    }

                    resolve(true);
                };

                nextWorkbook();
            });
        };

        return that;
    };

}(exports));

