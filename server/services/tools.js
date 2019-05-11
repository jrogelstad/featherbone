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
/*jslint node, this*/
(function (exports) {
    "use strict";

    const f = require("../../common/core");
    const ops = Object.keys(f.operators);
    const format = require("pg-format");

    const tools = {};

    function curry(...args1) {
        let fn = args1[0];
        let args = args1[1];
        let ary = [];

        return function () {
            return fn.apply(this, args.concat(ary.slice.call(args1)));
        };
    }

    /**
      * Escape strings to prevent sql injection
        http://www.postgresql.org/docs/9.1/interactive/functions-string.html
      *
      * @param {String} A string with tokens to replace.
      * @param {Array} Array of replacement strings.
      * @return {String} Escaped string.
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

    exports.Tools = function () {

        // ..........................................................
        // PUBLIC
        //
        tools.PKCOL = "_pk";

        tools.buildAuthSql = function (action, table, tokens) {
            let actions;
            let i = 6;
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

            while (i) {
                i -= 1;
                tokens.push(table);
            }

            action = action.toSnakeCase();

            sql = (
                " AND _pk IN (" +
                "SELECT %I._pk " +
                "FROM %I " +
                "  JOIN \"$feather\" " +
                "  ON \"$feather\".id::regclass::oid=%I.tableoid " +
                "WHERE EXISTS (" +
                "  SELECT " + action + " FROM ( " +
                "    SELECT " + action +
                "    FROM \"$auth\"" +
                "      JOIN role ON" +
                "           \"$auth\".role_pk=role._pk" +
                "      JOIN pg_authid" +
                "        ON role.name=" +
                "           pg_authid.rolname" +
                "    WHERE pg_has_role($1, pg_authid.oid, 'member')" +
                "      AND object_pk=\"$feather\".parent_pk" +
                "    ORDER BY " + action + " DESC" +
                "    LIMIT 1" +
                "  ) AS data" +
                "  WHERE " + action +
                ") " +
                "EXCEPT " +
                "SELECT %I._pk " +
                "FROM %I " +
                "WHERE EXISTS ( " +
                "  SELECT " + action + " FROM (" +
                "    SELECT " + action +
                "    FROM \"$auth\"" +
                "    JOIN role ON" +
                "         \"$auth\".role_pk=role._pk" +
                "      JOIN pg_authid" +
                "        ON role.name=" +
                "           pg_authid.rolname" +
                "    WHERE pg_has_role($1, pg_authid.oid, 'member')" +
                "      AND object_pk=%I._pk" +
                "    ORDER BY " + action + " DESC" +
                "    LIMIT 1 " +
                "  ) AS data " +
                "WHERE NOT " + action + "))"
            );

            return sql;
        };

        tools.formats = {
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
                default: "money()"
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

        /**
          Get the primary key for a given id.
          @param {Object} Request payload
          @param {Object} [payload.id] Id to resolve
          @param {Object} [payload.client] Database client
          @param {Boolean} Request as super user. Default false.
          @return Promise
        */
        tools.getKey = function (obj, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let payload;

                payload = {
                    name: obj.name || "Object",
                    filter: {criteria: [{property: "id", value: obj.id}]},
                    client: obj.client,
                    showDeleted: obj.showDeleted
                };

                function callback(keys) {
                    resolve(keys[0]);
                }

                tools.getKeys(payload, isSuperUser).then(
                    callback
                ).catch(
                    reject
                );
            });
        };
        /**
          Get an array of primary keys for a given feather and filter criteria.
          @param {Object} Request payload
          @param {Object} [payload.name] Feather name
          @param {Object} [payload.filter] Filter
          @param {Boolean} [payload.showDeleted] Show deleted records
          @param {Object} [payload.client] Database client
          @param {Boolean} Request as super user. Default false.
          @return Promise
        */
        tools.getKeys = function (obj, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let part;
                let op;
                let err;
                let or;
                let name = obj.name;
                let filter = obj.filter;
                let table = name.toSnakeCase();
                let clause = "NOT is_deleted";
                let sql = "SELECT _pk FROM %I WHERE " + clause;
                let tokens = ["_" + table];
                let criteria = false;
                let sort = [];
                let params = [];
                let parts = [];
                let p = 1;

                function callback(resp) {
                    let keys = resp.rows.map(function (rec) {
                        return rec[tools.PKCOL];
                    });

                    resolve(keys);
                }

                try {
                    if (obj.showDeleted) {
                        clause = "true";
                    }

                    if (filter) {
                        criteria = filter.criteria || [];
                        sort = filter.sort || [];
                    }

                    // Add authorization criteria
                    if (isSuperUser === false) {
                        sql += tools.buildAuthSql("canRead", table, tokens);

                        params.push(obj.client.currentUser);
                        p += 1;
                    }

                    // Process filter
                    if (filter) {
                        // Process criteria
                        criteria.forEach(function (where) {
                            op = where.operator || "=";

                            if (ops.indexOf(op) === -1) {
                                err = "Unknown operator \"" + op + "\"";
                                throw err;
                            }

                            // Value "IN" array ("Andy" IN ["Ann","Andy"])
                            // Whether "Andy"="Ann" OR "Andy"="Andy"
                            if (op === "IN") {
                                part = [];
                                where.value.forEach(function (val) {
                                    params.push(val);
                                    part.push("$" + p);
                                    p += 1;
                                });
                                part = tools.resolvePath(
                                    where.property,
                                    tokens
                                ) + " IN (" + part.join(",") + ")";

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

                    obj.client.query(sql, params).then(callback).catch(reject);
                } catch (e) {
                    reject(e);
                }
            });
        };

        tools.isChildFeather = function (feather) {
            let props = feather.properties;

            return Object.keys(props).some(function (key) {
                return Boolean(props[key].type.childOf);
            });
        };

        /**
          Returns whether user is super user.

          @param {Object} Payload
          @param {String} [payload.user] User. Defaults to current user
          @param {String} [payload.client] Datobase client
          @return Promise
        */
        tools.isSuperUser = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "SELECT is_super FROM \"role\" WHERE name=$1;";
                let user = (
                    obj.user === undefined
                    ? obj.client.currentUser
                    : obj.user
                );

                obj.client.query(sql, [user], function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(
                        resp.rows.length
                        ? resp.rows[0].is_super
                        : false
                    );
                });
            });
        };

        /**
          Clear out primmary keys and normalize data
          @param {Object} Data to sanitize
          @returns {Object} Sanitized object
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

                    keys = Object.keys(oldObj);
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

          @param {Object} Payload
          @param {String} [payload.user] User
          @param {Object} [payload.client] Database client
          @returns {Object} Promise
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

                afterCheckSuperUser = function (err, ok) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!ok) {
                        reject("Only a super user can set another super user");
                    }

                    sql = "SELECT * FROM pg_user WHERE usename=$1;";
                    obj.client.query(sql, [user], afterGetUser);
                };

                afterGetPgUser = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!resp.rows.length) {
                        obj.callback("User does not exist");
                    }

                    sql = "SELECT * FROM \"role\" WHERE name=$1;";
                    obj.client.query(sql, [user], afterGetPgUser);
                };

                afterGetUser = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (resp.rows.length) {
                        sql = "UPDATE \"role\" SET is_super=$2 ";
                        sql += "WHERE name=$1";
                    } else {
                        sql = "INSERT INTO \"role\" VALUES ($1, $2)";
                    }

                    obj.client.query(sql, [user, isSuper], afterUpsert);
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
                    name: obj.client.currentUser,
                    client: obj.client
                }).then(afterCheckSuperUser).catch(reject);
            });
        };

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

        tools.relationColumn = function (key, relation) {
            let ret;

            ret = "_" + key.toSnakeCase() + "_" + relation.toSnakeCase();
            ret += "_pk";

            return ret;
        };

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

