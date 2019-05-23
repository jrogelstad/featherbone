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

    const {Feathers} = require("./feathers");
    const {Tools} = require("./tools");
    const f = require("../../common/core");
    const feathers = new Feathers();
    const tools = new Tools();

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
            @param {String} [payload.user] User name
            @param {Object} [payload.data] Payload data
            @param {String} [payload.data.name] Workbook to delete
            @param {Object} [payload.client] Database client
            @return {Object} Promise
        */
        that.deleteWorkbook = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "DELETE FROM \"$workbook\" WHERE name=$1;";

                tools.isSuperUser({
                    client: obj.client,
                    user: obj.user
                }).then(function (isSuper) {
                    let err;

                    if (!isSuper) {
                        err = new Error(
                            "Only super users may delete workbooks."
                        );
                        err.statusCode = 401;
                        throw err;
                    }

                    obj.client.query(sql, [obj.data.name], function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve(true);
                    });
                }).catch(reject);
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
                    user: obj.user,
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
                let user = obj.user;

                function callback(isSuper) {
                    let params = [];
                    let sql;

                    sql = (
                        "SELECT name, description, module, " +
                        "launch_config AS \"launchConfig\", " +
                        "icon, " +
                        "default_config AS \"defaultConfig\", " +
                        "local_config AS \"localConfig\", " +
                        "to_json(ARRAY( SELECT ROW(role, can_read, " +
                        "can_update) " +
                        "  FROM \"$auth\" as auth " +
                        "  WHERE auth.object_pk = workbook._pk " +
                        "  ORDER BY auth.pk)) AS authorizations " +
                        "FROM \"$workbook\" AS workbook "
                    );

                    if (!isSuper) {
                        params = [obj.client.currentUser];
                        sql += (
                            "WHERE EXISTS (" +
                            "  SELECT can_read FROM ( " +
                            "    SELECT can_read " +
                            "    FROM \"$auth\", pg_authid " +
                            "    WHERE pg_has_role(" +
                            "        $1, pg_authid.oid, 'member')" +
                            "      AND \"$auth\".object_pk=\"$workbook\"._pk" +
                            "      AND \"$auth\".role=pg_authid.rolname" +
                            "    ORDER BY can_read DESC" +
                            "    LIMIT 1" +
                            "  ) AS data " +
                            "  WHERE can_read)"
                        );
                    }

                    if (obj.data.name) {
                        sql += " AND name=$2";
                        params.push(obj.data.name);
                    }

                    sql += " ORDER BY _pk";

                    obj.client.query(sql, params, function (err, resp) {
                        function auths(a) {
                            return {
                                role: a.f1,
                                canUpdate: a.f2,
                                canDelete: a.f3
                            };
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        resp.rows.forEach(function (row) {
                            row.authorizations = row.authorizations.map(auths);
                        });

                        resolve(resp.rows);
                    });
                }

                tools.isSuperUser({
                    client: obj.client,
                    user: user
                }).then(callback).catch(reject);
            });
        };

        /**
          Create or upate workbooks.

          @param {Object} Payload
          @param {String} [payload.user] User name.
          @param {Object} [payload.data] Workbook data.
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
                let user = obj.user;
                let findSql = "SELECT * FROM \"$workbook\" WHERE name = $1;";
                let workbooks = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );
                let len = workbooks.length;
                let n = 0;

                function execute() {
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
                                    execute();
                                } else {
                                    tools.isSuperUser({
                                        client: obj.client,
                                        user: user
                                    }).then(function (isSuper) {
                                        let e;

                                        if (!isSuper) {
                                            e = new Error(
                                                "Only super users may create" +
                                                " workbooks."
                                            );
                                            e.statusCode = 401;
                                            throw e;
                                        }

                                        // Insert new workbook
                                        sql = (
                                            "INSERT INTO \"$workbook\"" +
                                            "(_pk, id, name, description, " +
                                            "module, " +
                                            "launch_config, default_config, " +
                                            "local_config, icon, " +
                                            "created_by, updated_by, " +
                                            "created, updated, is_deleted) " +
                                            "VALUES (" +
                                            "nextval('object__pk_seq')," +
                                            "$1, $2, $3, $4, $5, $6, $7, $8," +
                                            "$8, $9, " +
                                            "now(), now(), false) " +
                                            "RETURNING _pk;"
                                        );
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

                                        execute();
                                    }).catch(reject);
                                }
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

