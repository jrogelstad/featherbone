/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
/*jslint node devel*/
/**
    @module Workbooks
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const {Feathers} = require("./feathers");
    const {Tools} = require("./tools");
    const f = require("../../common/core");

    const db = new Database();
    const feathers = new Feathers();
    const tools = new Tools();

    /**
        @class Workbooks
        @constructor
        @namespace Services
    */
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

            @method deleteWorkbook
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
                let theClient = obj.client;

                tools.isSuperUser({
                    client: theClient,
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

                    theClient.query(sql, [obj.data.name], function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        resolve(true);
                    });
                }).catch(reject);
            });
        };

        /**
            @method getWorkbook
            @param {Object} payload
            @param {String} payload.user
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Workbook name
            @return {Promise}
        */
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
            Resolve to workbook definition(s). If name is passed in payload
            only that workbook will be returned.

            @method getWorkbooks
            @param {Object} Request payload
            @param {Object} [payload.data] Workbook data
            @param {Object} [payload.data.name] Workbook name
            @param {Object} [payload.client] Database client
            @return {Promise}
        */
        that.getWorkbooks = function (obj) {
            return new Promise(function (resolve, reject) {
                let theUser = obj.user;
                let theClient = obj.client;

                function callback(isSuper) {
                    let params = [];
                    let sql;

                    sql = (
                        "SELECT name, description, module, " +
                        "launch_config AS \"launchConfig\", " +
                        "icon, sequence, actions, label, " +
                        "default_config AS \"defaultConfig\", " +
                        "local_config AS \"localConfig\", " +
                        "is_template AS \"isTemplate\", " +
                        "to_json(ARRAY( SELECT ROW(role, can_read, " +
                        "can_update) " +
                        "  FROM \"$auth\" as auth " +
                        "  WHERE auth.object_pk = workbook._pk " +
                        "  ORDER BY auth.pk)) AS authorizations " +
                        "FROM \"$workbook\" AS workbook " +
                        "WHERE true "
                    );

                    if (!isSuper) {
                        params = [theClient.currentUser()];
                        sql += (
                            "AND EXISTS (" +
                            "  SELECT can_read FROM ( " +
                            "    SELECT can_read " +
                            "    FROM \"$auth\", pg_authid " +
                            "    WHERE pg_has_role(" +
                            "        $1, pg_authid.oid, 'member')" +
                            "      AND \"$auth\".object_pk=workbook._pk" +
                            "      AND \"$auth\".role=pg_authid.rolname" +
                            "    ORDER BY can_read DESC" +
                            "    LIMIT 1" +
                            "  ) AS data " +
                            "  WHERE can_read)"
                        );
                    }

                    if (obj.data.name) {
                        sql += " AND name=$";
                        if (!isSuper) {
                            sql += "2";
                        } else {
                            sql += "1";
                        }
                        params.push(obj.data.name);
                    }

                    sql += " ORDER BY _pk";

                    theClient.query(sql, params, function (err, resp) {
                        function auths(a) {
                            return {
                                role: a.f1,
                                canRead: a.f2,
                                canUpdate: a.f3
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
                    client: theClient,
                    user: theUser
                }).then(callback).catch(reject);
            });
        };

        /**
            Check whether a user is authorized to perform an action on a
            particular feather (class) or object.

            Allowable actions: `canCreate`, `canRead`, `canUpdate", `canDelete`

            `canCreate` will only check feather names.

            @method workbookIsAuthorized
            @param {Object} Payload
            @param {Object} payload.data Payload data
            @param {String} payload.data.action
            @param {String} payload.data.name Workbook name
            @param {String} payload.data.user User.
            @param {String} payload.client Database client
            @return {Promise}
        */
        that.workbookIsAuthorized = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql;
                let user = obj.data.user;
                let action = obj.data.action || "";
                let name = obj.data.name;
                let theClient = obj.client;

                action = action.toSnakeCase();

                function callback(isSuper) {
                    if (isSuper) {
                        resolve(true);
                        return;
                    }

                    sql = (
                        "SELECT _pk " +
                        "FROM \"$workbook\" AS workbook, " +
                        "  \"$auth\" AS auth, " +
                        "  pg_authid " +
                        "WHERE name = $1 " +
                        "  AND workbook._pk=auth.object_pk" +
                        "  AND auth.role=pg_authid.rolname " +
                        "  AND pg_has_role($2, pg_authid.oid, 'member')" +
                        "  AND " + action + " " +
                        "LIMIT 1;"
                    );

                    theClient.query(sql, [name, user]).then(function (resp) {
                        resolve(resp.rows.length > 0);
                    }).catch(reject);
                }

                if (action !== "can_read" && action !== "can_update") {
                    throw new Error(
                        "Only actions `canRead` and `canUpdate` supported " +
                        "for workbook."
                    );
                }

                if (!name) {
                    throw new Error("Authorization check requires name");
                }

                tools.isSuperUser({
                    client: theClient,
                    user: obj.data.user
                }).then(callback).catch(reject);
            });
        };

        /**
            Create or upate workbooks.

            @method saveWorkbook
            @param {Object} Payload
            @param {String} payload.user User name.
            @param {Object} payload.data Workbook data.
            @param {Object | Array} payload.data.specs Workbook
            specification(s).
            @param {Object} payload.client Database client
            @return {Promise}
        */
        that.saveWorkbook = function (obj) {
            return new Promise(function (resolve, reject) {
                let row;
                let nextWorkbook;
                let wb;
                let sql;
                let params;
                let authorizations;
                let theId;
                let theUser = obj.user;
                let findSql = "SELECT * FROM \"$workbook\" WHERE name = $1;";
                let workbooks = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );
                let len = workbooks.length;
                let n = 0;
                let oldAuth;
                let theClient = obj.client;

                findSql = (
                    "SELECT * FROM \"$workbook\" AS workbook, " +
                    "to_json(ARRAY( SELECT ROW(role) " +
                    "  FROM \"$auth\" as auth " +
                    "  WHERE auth.object_pk = workbook._pk " +
                    "  ORDER BY auth.pk)) AS authorizations " +
                    "WHERE name = $1;"
                );

                function execute() {
                    theClient.query(sql, params, function (err) {
                        let auths = [];
                        let requests = [];

                        if (err) {
                            reject(err);
                            return;
                        }

                        if (oldAuth) {
                            // Clear old auths in case of deletions
                            oldAuth.forEach(function (auth) {
                                auths.push({
                                    client: theClient,
                                    data: {
                                        id: theId,
                                        role: auth.f1,
                                        isInternal: true,
                                        actions: {
                                            canCreate: false,
                                            canRead: false,
                                            canUpdate: false,
                                            canDelete: false
                                        }
                                    }
                                });
                            });
                        }

                        // Set new authorizations
                        if (authorizations) {
                            authorizations.forEach(function (auth) {
                                let found;
                                let actions;

                                if (auth === null) {
                                    return; // Was deleted
                                }

                                found = auths.find(
                                    (a) => a.data.role === auth.role
                                );

                                if (found) {
                                    actions = found.data.actions;
                                    actions.canCreate = null;
                                    actions.canUpdate = auth.canUpdate;
                                    actions.canRead = auth.canRead;
                                    actions.canDelete = null;
                                } else {
                                    auths.push({
                                        client: theClient,
                                        data: {
                                            id: theId,
                                            role: auth.role,
                                            isInternal: true,
                                            actions: {
                                                canCreate: null,
                                                canRead: auth.canRead,
                                                canUpdate: auth.canUpdate,
                                                canDelete: null
                                            }
                                        }
                                    });
                                }
                            });
                        }

                        auths.forEach(function (auth) {
                            requests.push(
                                feathers.saveAuthorization(auth)
                            );
                        });
                        Promise.all(requests).then(nextWorkbook).catch(reject);
                    });
                }

                nextWorkbook = function () {
                    if (n < len) {
                        wb = workbooks[n];
                        authorizations = wb.authorizations;
                        n += 1;
                        oldAuth = false;

                        // Upsert workbook
                        theClient.query(
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
                                    if (authorizations !== false) {
                                        oldAuth = row.authorizations;
                                    }

                                    // Update workbook
                                    sql = (
                                        "UPDATE \"$workbook\" SET " +
                                        "updated_by=$2, updated=now(), " +
                                        "description=$3, launch_config=$4," +
                                        "default_config=$5," +
                                        "local_config=$6, module=$7, " +
                                        "icon=$8, sequence=$9, actions=$10, " +
                                        "label=$11, is_template=$12 " +
                                        "WHERE name=$1;"
                                    );
                                    theId = row.id;
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
                                        theClient.currentUser(),
                                        wb.description || row.description,
                                        JSON.stringify(launchConfig),
                                        JSON.stringify(defaultConfig),
                                        JSON.stringify(localConfig),
                                        wb.module,
                                        icon,
                                        wb.sequence || row.sequence || 0,
                                        {}, // TODO
                                        wb.label || row.label,
                                        wb.isTemplate || row.isTemplate
                                    ];
                                    execute();
                                } else {
                                    tools.isSuperUser({
                                        client: theClient,
                                        user: theUser
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
                                            "sequence, actions, label, " +
                                            "created, updated, is_deleted, " +
                                            "is_template) " +
                                            "VALUES (" +
                                            "nextval('object__pk_seq')," +
                                            "$1, $2, $3, $4, $5, $6, $7, $8," +
                                            "$9, $9, $10, $11, $12, " +
                                            "now(), now(), false, $13) " +
                                            "RETURNING _pk;"
                                        );
                                        theId = f.createId();
                                        launchConfig = wb.launchConfig || {};
                                        localConfig = wb.localConfig || [];
                                        defaultConfig = wb.defaultConfig || [];
                                        icon = wb.icon || "folder";
                                        params = [
                                            theId,
                                            wb.name,
                                            wb.description || "",
                                            wb.module,
                                            launchConfig,
                                            JSON.stringify(defaultConfig),
                                            JSON.stringify(localConfig),
                                            icon,
                                            theClient.currentUser(),
                                            wb.sequence || 0,
                                            {}, // TODO
                                            wb.label,
                                            wb.isTemplate
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

