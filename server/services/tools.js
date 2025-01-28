/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint node, this, unordered*/
/**
    @module Tools
*/
(function (exports) {
    "use strict";

    const f = require("../../common/core");
    const ops = Object.keys(f.operators);
    const format = require("pg-format");

    const tools = {};
    const formats = {
        integer: {
            type: "integer",
            default: 0
        },
        long: {
            type: "bigint",
            default: 0
        },
        float: {
            type: "real",
            default: 0
        },
        double: {
            type: "double precision",
            default: 0
        },
        string: {
            type: "text",
            default: "''"
        },
        boolean: {
            type: "boolean",
            default: "false"
        },
        date: {
            type: "date",
            default: "today()"
        },
        dateTime: {
            type: "timestamp with time zone",
            default: "now()"
        },
        enum: {
            type: "text",
            default: ""
        },
        color: {
            type: "text",
            default: "#000000"
        },
        money: {
            type: "mono",
            // Hack because promises tough to deal with
            default: null,
            isMoney: true
        },
        lock: {
            type: "lock",
            default: null
        },
        object: {
            type: "json",
            default: null
        }
    };

    function curry(...args1) {
        let fn = args1[0];
        let args = args1[1];
        let ary = [];

        return function () {
            return fn.apply(this, args.concat(ary.slice.call(args1)));
        };
    }

    /**
        Escape strings to prevent sql injection
        http://www.postgresql.org/docs/9.1/interactive/functions-string.html
        @method format
        @for String
        @param {Array} Array of replacement strings.
        @return {String} Escaped string.
    */
    String.prototype.format = function (ary) {
        let params = [];
        let i = 0;

        ary = ary || [];
        ary.unshift(this);

        while (ary[i]) {
            i += 1;
            params.push("$" + i);
        }

        return curry(format, ary)();
    };

    /**
        @class Tools
        @constructor
        @namespace Services
    */
    exports.Tools = function () {

        // ..........................................................
        // PUBLIC
        //
        /**
            @property PKCOL
            @type String
            @default "_pk"
            @static
        */
        tools.PKCOL = "_pk";
        /**
            Return a SQL clause that adds checks for use authorization to a
            `WHERE` clause.
            @method buildAuthSql
            @param {String} action `canCreate`, `canRead`, `canUpdate` or
            `canDelete`
            @param {String} table
            @param {Array} tokens
            @param {Boolean} [rowAuth] check row authorization
            @param {Integer} [p] parameter number. Default 1
            @return {String} SQL clause
        */
        tools.buildAuthSql = function (
            action,
            table,
            tokens,
            rowAuth,
            p,
            prefix
        ) {
            p = p || 1;
            let actions;
            let i = (
                rowAuth
                ? 7
                : 4
            );
            let msg;
            let sql;

            actions = [
                "canRead",
                "canUpdate",
                "canDelete"
            ];

            if (actions.indexOf(action) === -1) {
                msg = "Invalid authorization action for object \"";
                msg += action + "\"";
                throw msg;
            }

            if (prefix) {
                tokens.push(prefix + table);
            } else {
                tokens.push(table);
            }
            while (i) {
                i -= 1;
                tokens.push(table);
            }

            action = action.toSnakeCase();

            sql = (
                " AND %I._pk IN (" +
                "SELECT %I._pk " +
                "FROM %I " +
                "  JOIN \"$feather\" " +
                "  ON \"$feather\".id::regclass::oid=%I.tableoid " +
                "WHERE EXISTS (" +
                "  SELECT " + action + " FROM ( " +
                "    SELECT " + action +
                "    FROM \"$auth\", pg_authid" +
                "    WHERE pg_has_role($" + p + ", pg_authid.oid, 'member')" +
                "      AND \"$auth\".object_pk " +
                "        IN (\"$feather\".parent_pk, %I._pk)" +
                "      AND \"$auth\".role=pg_authid.rolname" +
                "      AND " + action + " IS NOT NULL " +
                "    ORDER BY " + action + " DESC" +
                "    LIMIT 1" +
                "  ) AS data" +
                "  WHERE " + action +
                ") "
            );

            if (rowAuth) {
                sql += (
                    "EXCEPT " +
                    "SELECT %I._pk " +
                    "FROM %I " +
                    "WHERE EXISTS ( " +
                    "  SELECT " + action + " FROM (" +
                    "    SELECT " + action +
                    "    FROM \"$auth\", pg_authid" +
                    "    WHERE pg_has_role($" + p +
                    ", pg_authid.oid, 'member')" +
                    "      AND \"$auth\".object_pk=%I._pk" +
                    "      AND \"$auth\".role=pg_authid.rolname" +
                    "      AND " + action + " IS NOT NULL " +
                    "    ORDER BY " + action + " DESC" +
                    "    LIMIT 1 " +
                    "  ) AS data " +
                    "WHERE NOT " + action + ")"
                );
            }

            sql += ")";

            return sql;
        };

        /**
            Return a sql `WHERE` clause based on filter criteria in payload.
            @method buildWhere
            @param {Object} payload Request payload
            @param {Object} payload.name Feather name
            @param {Filter} [payload.filter] Filter
            @param {Boolean} [payload.showDeleted] Show deleted records
            @param {Object} payload.client Database client
            @param {Array} [params] Parameters used for the sql query
            @param {Boolean} [flag] Request as super user. Default false.
            @param {Boolean} [flag] Enforce row authorization. Default false.
            @return {Promise}
        */
        tools.buildWhere = function (obj, params, isSuperUser, rowAuth) {
            let part;
            let op;
            let err;
            let or;
            let name = obj.name;
            let filter = obj.filter;
            let table = name.toSnakeCase();
            let clause = "NOT is_deleted";
            let sql = " WHERE ";
            let tokens = [];
            let criteria = false;
            let sort = [];
            let parts = [];
            let p = 1;

            if (obj.showDeleted) {
                clause = "true";
            }

            sql += clause;

            if (filter) {
                criteria = filter.criteria || [];
                sort = filter.sort || [];
            }

            // Add authorization criteria
            if (isSuperUser === false) {
                sql += tools.buildAuthSql(
                    "canRead",
                    table,
                    tokens,
                    rowAuth,
                    1,
                    "_"
                );

                params.push(obj.client.currentUser());
                p += 1;
            }

            // Process filter
            if (filter) {
                // Process criteria
                criteria.forEach(function (where) {
                    op = where.operator || "=";
                    let yr;
                    let mo;
                    let da;
                    let dw;
                    let today;
                    let d1;
                    let d2;

                    if (ops.indexOf(op) === -1) {
                        err = "Unknown operator \"" + op + "\"";
                        throw err;
                    }

                    // Escape backslash on regex operations
                    if (op.indexOf("~") > -1) {
                        where.value = where.value.replace(/\\/g, "\\\\");
                    }

                    // Handle date options
                    if (op === "IS") {
                        today = f.today();
                        yr = today.slice(0, 4) - 0;
                        mo = today.slice(5, 7) - 1;
                        da = today.slice(8, 10) - 0;
                        // ISO week starts Monday
                        dw = f.parseDate(today).getDay() - 1;
                        if (dw < 0) {
                            dw = 7;
                        }
                        part = tools.resolvePath(
                            where.property,
                            tokens
                        );

                        switch (where.value) {
                        case "TODAY":
                            part += "='" + today + "'";
                            break;
                        case "BEFORE_TODAY":
                            part += "<'" + today + "'";
                            break;
                        case "ON_OR_BEFORE_TODAY":
                            part += "<='" + today + "'";
                            break;
                        case "ON_OR_AFTER_TODAY":
                            part += ">='" + today + "'";
                            break;
                        case "THIS_WEEK":
                            d1 = new Date(yr, mo, da - dw);
                            d2 = new Date(yr, mo, da + 6 - dw);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "ON_OR_BEFORE_THIS_WEEK":
                            d1 = new Date(yr, mo, da + 6 - dw);
                            part += (
                                " <= '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "ON_OR_AFTER_THIS_WEEK":
                            d1 = new Date(yr, mo, da - dw);
                            part += (
                                " >= '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "THIS_MONTH":
                            d1 = new Date(yr, mo, 1);
                            d2 = new Date(yr, mo + 1, 0);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "ON_OR_BEFORE_THIS_MONTH":
                            d1 = new Date(yr, mo + 1, 0);
                            part += (
                                " <= '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "ON_OR_AFTER_THIS_MONTH":
                            d1 = new Date(yr, mo, 1);
                            part += (
                                " >= '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "THIS_YEAR":
                            part += (
                                " BETWEEN '" + yr + "-01-01' AND '" +
                                yr + "-12-31'"
                            );
                            break;
                        case "ON_OR_BEFORE_THIS_YEAR":
                            part += (
                                " <= '" + yr + "-12-31'"
                            );
                            break;
                        case "ON_OR_AFTER_THIS_YEAR":
                            part += (
                                " >= '" + yr + "-01-01'"
                            );
                            break;
                        case "YESTERDAY":
                            d1 = new Date(yr, mo, da - 1);
                            part += (
                                " = '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "LAST_WEEK":
                            d1 = new Date(yr, mo, da - dw - 7);
                            d2 = new Date(yr, mo, da - dw - 1);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "LAST_MONTH":
                            d1 = new Date(yr, mo - 1, 1);
                            d2 = new Date(yr, mo, 0);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "LAST_YEAR":
                            yr = yr - 1;
                            part += (
                                " BETWEEN '" + yr + "-01-01' AND '" +
                                yr + "-12-31'"
                            );
                            break;
                        case "TOMORROW":
                            d1 = new Date(yr, mo, da + 1);
                            part += (
                                " = '" + d1.toLocalDate() + "'"
                            );
                            break;
                        case "NEXT_WEEK":
                            d1 = new Date(yr, mo, da - dw + 7);
                            d2 = new Date(yr, mo, da - dw + 12);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "NEXT_MONTH":
                            d1 = new Date(yr, mo + 1, 1);
                            d2 = new Date(yr, mo + 2, 0);
                            part += (
                                " BETWEEN '" + d1.toLocalDate() +
                                "' AND '" + d2.toLocalDate() + "'"
                            );
                            break;
                        case "NEXT_YEAR":
                            yr = yr + 1;
                            part += (
                                " BETWEEN '" + yr + "-01-01' AND '" +
                                yr + "-12-31'"
                            );
                            break;
                        default:
                            throw new Error(
                                "Value " + where.value +
                                " for date operator 'IS' unknown"
                            );
                        }

                    // Value "IN" array ("Andy" IN ["Ann","Andy"])
                    // Whether "Andy"="Ann" OR "Andy"="Andy"
                    } else if (op === "IN") {
                        part = [];
                        if (where.value.length) {
                            where.value.forEach(function (val) {
                                params.push(val);
                                part.push("$" + p);
                                p += 1;
                            });
                            part = tools.resolvePath(
                                where.property,
                                tokens
                            ) + " IN (" + part.join(",") + ")";
                        // If no values in array, then no result
                        } else {
                            params.push(false);
                            part.push("$" + p);
                            p += 1;
                        }

                    // Property "OR" array compared to value
                    // (["name","email"]="Andy")
                    // Whether "name"="Andy" OR "email"="Andy"
                    } else if (Array.isArray(where.property)) {
                        or = [];
                        where.property.forEach(function (prop) {
                            params.push(where.value);
                            or.push(tools.resolvePath(
                                prop,
                                tokens
                            ) + " " + op + " $" + p);
                            p += 1;
                        });
                        part = "(" + or.join(" OR ") + ")";

                    // Regular comparison ("name"="Andy")
                    } else if (
                        typeof where.value === "object" &&
                        !where.value.id
                    ) {
                        part = tools.resolvePath(
                            where.property,
                            tokens
                        ) + " IS NULL";
                    } else {
                        if (typeof where.value === "object") {
                            where.property = where.property + ".id";
                            where.value = where.value.id;
                        }
                        params.push(where.value);
                        part = tools.resolvePath(
                            where.property,
                            tokens
                        ) + " " + op + " $" + p;
                        p += 1;
                    }
                    parts.push(part);
                });

                if (parts.length) {
                    sql += " AND " + parts.join(" AND ");
                }
            }


            // Process sort
            sql += tools.processSort(sort, tokens);

            if (filter) {
                // Process offset and limit
                if (filter.offset) {
                    sql += " OFFSET $" + p;
                    p += 1;
                    params.push(filter.offset);
                }

                if (filter.limit) {
                    sql += " LIMIT $" + p;
                    params.push(filter.limit);
                }
            }

            sql = sql.format(tokens);

            return sql;
        };

        /**
            Object with properties mapping to each type of data type format
            requiring special support on the server side. Each format has a
            database type and default value.
            @property formats
            @type Object
        */
        tools.formats = formats;

        /**
            Get the primary key for a given id.
            @method getKey
            @param {Object} Request payload
            @param {Object} payload.id Id to resolve
            @param {Object} payload.client Database client
            @param {Boolean} [payload.rowAuth] Enable row authorization
            @param {Boolean} [flag] Request as super user. Default false.
            @return {Promise}
        */
        tools.getKey = async function (obj, isSuperUser) {
            let keys = await tools.getKeys({
                name: obj.name || "Object",
                filter: {criteria: [{property: "id", value: obj.id}]},
                client: obj.client,
                showDeleted: obj.showDeleted
            }, isSuperUser);
            return keys[0];
        };
        /**
            Get an array of primary keys for a given feather and filter
            criteria.
            @method getKeys
            @param {Object} payload Request payload
            @param {Object} payload.name Feather name
            @param {Filter} [payload.filter] Filter
            @param {Boolean} [payload.showDeleted] Show deleted records
            @param {Boolean} [payload.rowAuth] Enable row authorization.
            @param {Object} payload.client Database client
            @param {Boolean} [flag] Request as super user. Default true.
            @return {Promise}
        */
        tools.getKeys = async function (obj, isSuperUser) {
            isSuperUser = isSuperUser !== false;
            let sql = "SELECT _pk FROM %I";
            let params = [];
            let resp;

            sql = sql.format(["_" + obj.name.toSnakeCase()]);
            sql += tools.buildWhere(obj, params, isSuperUser, obj.rowAuth);

            resp = await obj.client.query(sql, params);
            return resp.rows.map((rec) => rec[tools.PKCOL]);
        };

        /**
            @method isChildFeather
            @param {Object} feather Feather
            @return {Boolean}
        */
        tools.isChildFeather = function (feather) {
            let props = feather.properties;

            return Object.keys(props).some(function (key) {
                return Boolean(props[key].type.childOf);
            });
        };

        /**
            Returns whether user is super user.

            @method isSuperUser
            @param {Object} payload Request payload
            @param {String} [payload.user] User. Defaults to current user
            @param {Client} payload.client Database client
            @return {Promise}
        */
        tools.isSuperUser = async function (obj) {
            let sql = "SELECT is_super FROM user_account WHERE name=$1;";
            let user = (
                obj.user === undefined
                ? obj.client.currentUser()
                : obj.user
            );
            let client = obj.client;

            let resp = await client.query(sql, [user]);
            return (
                resp.rows.length
                ? resp.rows[0].is_super
                : false
            );
        };

        /**
            Returns authorizations for an object.
            @method getAuthorizations
            @param {Object} payload Request payload
            @param {Client} payload.client
            @param {String} payload.id Object ID
            @return Promise
        */
        tools.getAuthorizations = function (obj) {
            let client = obj.client;
            let sql = (
                "SELECT auth.role, auth.can_read, auth.can_update," +
                "auth.can_delete, " +
                "'object_authorization' AS object_type " +
                "FROM object, \"$auth\" AS auth " +
                "WHERE id=$1 AND object._pk=auth.object_pk;"
            );

            let resp = client.query(sql, [obj.data.id]);
            return tools.sanitize(resp.rows);
        };

        /**
            Clear out primmary keys and convert snake case to camel case.
            @method sanitize
            @param {Object} Data to sanitize
            @return {Object} Sanitized object
        */
        tools.sanitize = function (obj) {
            let oldObj;
            let newObj;
            let oKey;
            let ary;
            let len;
            let nKey;
            let keys;
            let klen;
            let n;
            let isArray = Array.isArray(obj);
            let i = 0;

            if (isArray) {
                ary = obj;
            } else {
                ary = [obj];
            }
            len = ary.length;

            while (i < len) {
                if (typeof ary[i] === "string") {
                    i += 1;
                } else {
                    /* Copy to convert dates back to string for accurate
                       comparisons */
                    oldObj = JSON.parse(JSON.stringify(ary[i]));
                    newObj = {};

                    keys = Object.keys(oldObj || {});
                    klen = keys.length;
                    n = 0;

                    while (n < klen) {
                        oKey = keys[n];
                        n += 1;

                        /* Remove internal properties */
                        if (oKey.match("^_")) {
                            delete oldObj[oKey];
                        } else {
                            /* Make properties camel case */
                            nKey = oKey.toCamelCase();
                            newObj[nKey] = oldObj[oKey];

                            /* Recursively sanitize objects */
                            if (
                                typeof newObj[nKey] === "object" &&
                                newObj[nKey] !== null
                            ) {
                                newObj[nKey] = tools.sanitize(newObj[nKey]);
                            }
                        }
                    }

                    ary[i] = newObj;
                    i += 1;
                }
            }

            return (
                isArray
                ? ary
                : ary[0]
            );
        };

        /**
            Sets a user as super user or not.
            @method setSuperUser
            @param {Object} Payload
            @param {String} payload.user User
            @param {Client} payload.client Database client
            @param {Boolean} [payload.isSuper] Default true
            @return {Promise}
        */
        tools.setSuperUser = function (obj, isSuper) {
            return new Promise(function (resolve, reject) {
                isSuper = (
                    obj.isSuper === undefined
                    ? true
                    : obj.isSuper
                );

                let sql;
                let afterCheckSuperUser;
                let afterGetPgUser;
                let afterGetUser;
                let afterUpsert;
                let user = obj.user;
                let theClient = obj.client;

                afterCheckSuperUser = function (err, ok) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!ok) {
                        reject("Only a super user can set another super user");
                    }

                    sql = "SELECT * FROM pg_user WHERE usename=$1;";
                    theClient.query(sql, [user], afterGetUser);
                };

                afterGetPgUser = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!resp.rows.length) {
                        obj.callback("User does not exist");
                    }

                    sql = "SELECT * FROM user_account WHERE name=$1;";
                    theClient.query(sql, [user], afterGetPgUser);
                };

                afterGetUser = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (resp.rows.length) {
                        sql = "UPDATE user_account SET is_super=$2 ";
                        sql += "WHERE name=$1";
                    } else {
                        throw new Error("User " + user + " not found.");
                    }

                    theClient.query(sql, [user, isSuper], afterUpsert);
                };

                afterUpsert = function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Success. Return to callback.
                    resolve(true);
                };

                tools.isSuperUser({
                    name: theClient.currentUser(),
                    client: theClient
                }).then(afterCheckSuperUser).catch(reject);
            });
        };

        /**
            Returns an `ORDER BY` SQL clause based sort criteria.
            @method processSort
            @param {Array} sort
            @param {Array} tokens
            @return {String} SQL clause
        */
        tools.processSort = function (sort, tokens) {
            let order;
            let part;
            let clause = "";
            let i = 0;
            let parts = [];

            // Always sort on primary key as final tie breaker
            sort.push({property: tools.PKCOL});

            while (sort[i]) {
                order = (sort[i].order || "ASC");
                order = order.toUpperCase();
                if (order !== "ASC" && order !== "DESC") {
                    throw "Unknown operator \"" + order + "\"";
                }
                part = tools.resolvePath(sort[i].property, tokens);
                parts.push(part + " " + order);
                i += 1;
            }

            if (parts.length) {
                clause = " ORDER BY " + parts.join(",");
            }

            return clause;
        };

        /**
            Infer name of relation primary key column.
            @method relationColumn
            @param {String} key Column name
            @param {String} relation Feather name of relation
            @return {String}
        */
        tools.relationColumn = function (key, relation) {
            let ret;

            ret = "_" + key.toSnakeCase() + "_" + relation.toSnakeCase();
            ret += "_pk";

            return ret;
        };

        /**
            Adds a token for a given column name to `tokens` and returns
            "%I" as the place holder value for a SQL clause.
            @method resolvePath
            @param {String} column
            @param {Array} tokens
            @return {String}
        */
        tools.resolvePath = function (col, tokens) {
            let prefix;
            let suffix;
            let ret;
            let idx = col.lastIndexOf(".");

            if (idx > -1) {
                prefix = col.slice(0, idx);
                suffix = col.slice(idx + 1, col.length).toSnakeCase();
                ret = "(" + tools.resolvePath(prefix, tokens) + ").%I";
                tokens.push(suffix);
                return ret;
            }

            tokens.push(col.toSnakeCase());
            return "%I";
        };

        /**
            Object with properties mapping to each type of data type
            to database equivilents. Each format has a database `type` and
            `default` property.
            @property types
            @type Object
        */
        tools.types = {
            object: {
                type: "json",
                default: null
            },
            array: {
                type: "json",
                default: null
            },
            string: {
                type: "text",
                default: ""
            },
            integer: {
                type: "integer",
                default: 0
            },
            number: {
                type: "numeric",
                default: 0
            },
            boolean: {
                type: "boolean",
                default: "false"
            }
        };

        return tools;
    };

}(exports));

