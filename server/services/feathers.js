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
    @module Feathers
*/
(function (exports) {
    "use strict";

    const {Tools} = require("./tools");
    const {Settings} = require("./settings");
    const f = require("../../common/core");

    const settings = new Settings();
    const tools = new Tools();
    const formats = tools.formats;

    const reserved = [
        "ALL",
        "ANALYSE",
        "ANALYZE",
        "AND",
        "ANY",
        "ARRAY",
        "AS",
        "ASC",
        "ASYMMETRIC",
        "AUTHORIZATION",
        "BINARY",
        "BOTH",
        "CASE",
        "CAST",
        "CHECK",
        "COLLATE",
        "COLLATION",
        "COLUMN",
        "CONCURRENTLY",
        "CONSTRAINT",
        "CREATE",
        "CROSS",
        "CURRENT_CATALOG",
        "CURRENT_DATE",
        "CURRENT_ROLE",
        "CURRENT_SCHEMA",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP",
        "CURRENT_USER",
        "DEFAULT",
        "DEFERRABLE",
        "DESC",
        "DISTINCT",
        "DO",
        "ELSE",
        "END",
        "EXCEPT",
        "FALSE",
        "FETCH",
        "FOR",
        "FOREIGN",
        "FREEZE",
        "FROM",
        "FULL",
        "GRANT",
        "GROUP",
        "HAVING",
        "ILIKE",
        "IN",
        "INITIALLY",
        "INNER",
        "INTERSECT",
        "INTO",
        "IS",
        "ISNULL",
        "JOIN",
        "LATERAL",
        "LEADING",
        "LEFT",
        "LIKE",
        "LIMIT",
        "LOCALTIME",
        "LOCALTIMESTAMP",
        "MONEY",
        "NATURAL",
        "NOT",
        "NOTNULL",
        "NULL",
        "OFFSET",
        "ON",
        "ONLY",
        "OR",
        "ORDER",
        "OUTER",
        "OVERLAPS",
        "PLACING",
        "PRIMARY",
        "REFERENCES",
        "RETURNING",
        "RIGHT",
        "SELECT",
        "SESSION_USER",
        "SIMILAR",
        "SOME",
        "SYMMETRIC",
        "TABLE",
        "TABLESAMPLE",
        "THEN",
        "TO",
        "TRAILING",
        "TRUE",
        "UNION",
        "UNIQUE",
        "USER",
        "USING",
        "VARIADIC",
        "VERBOSE",
        "WHEN",
        "WHERE",
        "WINDOW",
        "WITH"
    ];

    let disablePropagateViews = false;

    /**
        Feather management service.

        @class Feathers
        @constructor
        @namespace Services
    */
    exports.Feathers = function () {
        // ..........................................................
        // PRIVATE
        //

        let that = {};

        function createView(obj) {
            let alias;
            let type;
            let view;
            let sub;
            let col;
            let feather;
            let localFeathers = {};
            let props;
            let keys;
            let name = obj.name;
            let table = name.toSnakeCase();
            let args = ["_" + table, "_pk"];
            let cols = ["%I"];
            let sql = "";
            let parentProp;
            let childTable;
            let childSql = "";
            let i;
            let args2;
            let cols2;
            let sql2;
            let parent;

            function createChildView(pName) {
                let tProps;
                let tArgs;
                let tCols;
                let tRel;
                let theSql = "";
                let cFeather = localFeathers[props[pName].type.relation];
                let nKey = Object.keys(
                    cFeather.properties
                ).find((k) => cFeather.properties[k].isNaturalKey);
                let idx;
                let ret;

                tProps = props[pName].type.properties.slice();
                tCols = [];
                tArgs = [view];

                /* Always include natural key,
                "objectType" and "id"
                whether specified or not. */

                //Natural key first
                if (nKey) {
                    idx = tProps.indexOf(nKey);
                    if (idx !== -1) {
                        tProps.splice(idx, 1);
                    }
                    tProps.unshift(nKey);
                }
                if (tProps.indexOf("objectType") === -1) {
                    tProps.push("objectType");
                }
                if (tProps.indexOf("id") === -1) {
                    tProps.push("id");
                }

                i = 0;
                while (i < tProps.length) {
                    tCols.push("%I");
                    tArgs.push(tProps[i].toSnakeCase());
                    i += 1;
                }

                // Add primary key
                tCols.push("%I");
                tArgs.push("_pk");

                tRel = (
                    "_" + props[pName].type.relation.toSnakeCase()
                );
                tArgs.push(tRel);
                theSql = "CREATE OR REPLACE VIEW %I AS SELECT ";
                theSql += tCols.join(",");
                theSql += " FROM %I ";
                theSql += "WHERE NOT is_deleted;";
                ret = theSql.format(tArgs);
                return ret;
            }

            function afterGetFeathers() {
                feather = localFeathers[obj.name];
                props = feather.properties;
                keys = Object.keys(props);

                // Find any property that makes this table a child
                parentProp = keys.find(function (key) {
                    return (
                        typeof props[key].type === "object" &&
                        props[key].type.childOf
                    );
                });

                keys.forEach(function (key) {
                    let clause;

                    alias = key.toSnakeCase();

                    /* Handle discriminator */
                    if (key === "objectType") {
                        cols.push("%s");
                        clause = "to_camel_case(tableoid::regclass::text) AS ";
                        clause += alias;
                        args.push(clause);

                        /* Handle relations */
                    } else if (typeof props[key].type === "object") {
                        type = props[key].type;
                        parent = (
                            props[key].inheritedFrom
                            ? props[key].inheritedFrom.toSnakeCase()
                            : table
                        );

                        /* Handle to many */
                        if (type.parentOf) {
                            sub = "ARRAY(SELECT %I FROM %I ";
                            sub += "WHERE %I.%I = %I._pk ";
                            sub += "AND NOT %I.is_deleted ORDER BY %I._pk) ";
                            sub += "AS %I";
                            view = "_" + parent + "$$";
                            view += props[key].type.relation.toSnakeCase();
                            col = "_" + type.parentOf.toSnakeCase();
                            col += "_" + parent + "_pk";
                            args = args.concat([
                                view,
                                view,
                                view,
                                col,
                                table,
                                view,
                                view,
                                alias
                            ]);

                            /* Handle to one */
                        } else if (!type.childOf) {
                            col = "_" + key.toSnakeCase() + "_";
                            col += props[key].type.relation.toSnakeCase();
                            col += "_pk";
                            sub = "(SELECT %I FROM %I WHERE %I._pk = %I) ";
                            sub += "AS %I";

                            if (props[key].type.properties) {
                                view = "_" + parent + "$" + key.toSnakeCase();
                                childSql += createChildView(key);
                            } else {
                                view = "_";
                                view += props[key].type.relation.toSnakeCase();
                            }

                            args = args.concat([view, view, view, col, alias]);
                        } else {
                            sub = "_" + key.toSnakeCase() + "_";
                            sub += type.relation.toSnakeCase() + "_pk";
                        }

                        cols.push(sub);

                        /* Handle regular types */
                    } else {
                        cols.push("%I");
                        args.push(alias);
                    }
                });

                sql = "DROP VIEW IF EXISTS %I CASCADE;";
                sql = sql.format(["_" + table]);

                if (parentProp) {
                    childTable = (
                        "_" + props[parentProp].type.relation.toSnakeCase() +
                        "$$" + table
                    );
                    sql += "DROP VIEW IF EXISTS %I CASCADE;";
                    sql = sql.format([childTable]);
                }

                args2 = args.slice(); // copy while pristine
                cols2 = cols.slice();

                args.push(table);
                sql += childSql;
                sql += "CREATE VIEW %I AS SELECT " + cols.join(",");
                sql += " FROM %I;";
                sql = sql.format(args);

                if (parentProp) {
                    if (
                        props[parentProp].type.properties &&
                        props[parentProp].type.properties.length
                        // Update regular view later to include parent reference
                    ) {
                        col = (
                            "_" + parentProp.toSnakeCase() + "_" +
                            props[parentProp].type.relation.toSnakeCase() +
                            "_pk"
                        );
                        sub = (
                            "(SELECT %I FROM %I WHERE %I._pk = %I) " +
                            "AS %I"
                        );
                        parent = (
                            props[parentProp].inheritedFrom
                            ? props[parentProp].inheritedFrom.toSnakeCase()
                            : table
                        );
                        view = "_" + table + "$" + parentProp.toSnakeCase();
                        sql2 = createChildView(parentProp);
                        args2 = args2.concat([
                            view,
                            view,
                            view,
                            col,
                            parentProp.toSnakeCase(),
                            table
                        ]);
                        cols2.push(sub);

                        sql2 += (
                            "CREATE OR REPLACE VIEW %I AS SELECT " +
                            cols2.join(",") +
                            " FROM %I;"
                        );
                        sql2 = sql2.format(args2);
                        obj.childSql.push(sql2); // Will run at end
                    }

                    // Create another version that will be child array only
                    args.shift();
                    args[0] = childTable;
                    sql += "CREATE VIEW %I AS SELECT " + cols.join(",");
                    sql += " FROM %I;";
                    sql = sql.format(args);
                }

                obj.client.query(sql, function (err) {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    obj.callback(null, true);
                });
            }

            that.getFeathers(
                obj.client,
                obj.name,
                localFeathers
            ).then(afterGetFeathers).catch(obj.callback);
        }

        function propagateViews(obj) {
            return new Promise(function (resolve, reject) {
                let sql = (
                    "SELECT viewname FROM pg_views " +
                    "WHERE schemaname = 'public' AND viewname LIKE '_%';"
                );
                let keys = [];

                function createDropSql(row) {
                    let stmt = "DROP VIEW IF EXISTS %I CASCADE";

                    return stmt.format([row.viewname]);
                }

                function getViews() {
                    return new Promise(function (resolve, reject) {
                        obj.client.query(sql).then(resolve).catch(reject);
                    });
                }

                function deleteViews(resp) {
                    return new Promise(function (resolve, reject) {
                        let stmts = resp.rows.map(createDropSql);

                        // Run drops one by one
                        function next() {
                            let stmt;

                            if (!stmts.length) {
                                resolve();
                                return;
                            }

                            stmt = stmts.shift();
                            obj.client.query(stmt).then(next).catch(reject);
                        }

                        next();
                    });
                }

                function getCatalog() {
                    return new Promise(function (resolve, reject) {
                        settings.getSettings({
                            client: obj.client,
                            data: {
                                name: "catalog"
                            }
                        }).then(resolve).catch(reject);
                    });
                }

                function createViews(resp) {
                    return new Promise(function (resolve, reject) {
                        let feathers = f.copy(resp);
                        let deps = Object.keys(feathers).filter(
                            (d) => !feathers[d].isView
                        );
                        let found;
                        let deferred = [];
                        let err;

                        function nextChild() {
                            if (deferred.length) {
                                obj.client.query(
                                    deferred.pop()
                                ).then(
                                    nextChild
                                ).catch(reject);

                                return;
                            }

                            resolve();
                        }

                        function nextView(err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (keys.length) {
                                createView({
                                    client: obj.client,
                                    name: keys.shift(),
                                    callback: nextView,
                                    childSql: deferred
                                });

                                return;
                            }

                            nextChild();
                        }

                        // Establish dependencies
                        deps.forEach(function (dep) {
                            let fthr = feathers[dep];
                            let pkeys = Object.keys(fthr.properties);

                            if (dep === "Object") {
                                fthr.dependencies = [];
                                return;
                            }

                            fthr.dependencies = [
                                fthr.inherits || "Object"
                            ];

                            pkeys.forEach(function (pkey) {
                                let prop = fthr.properties[pkey];

                                if (
                                    typeof prop.type === "object" &&
                                    !prop.type.childOf
                                ) {
                                    fthr.dependencies.push(prop.type.relation);
                                }
                            });
                        });

                        // Now build key array based on dependency order
                        function keyExists(item) {
                            return keys.indexOf(item) !== -1;
                        }

                        function candidate(name) {
                            return feathers[name].dependencies.every(
                                keyExists
                            );
                        }

                        while (deps.length) {
                            found = deps.find(candidate);
                            if (found === undefined) {
                                err = (
                                    "Relationships cause circular" +
                                    " dependencies"
                                );
                                deps.length = 0;
                            } else {
                                keys.push(found);
                                deps.splice(deps.indexOf(found), 1);
                            }
                        }

                        if (err) {
                            reject(err);
                        } else {

                        // Now create views
                            nextView();
                        }
                    });
                }

                // Bail out if this turned off
                if (disablePropagateViews) {
                    resolve();
                    return;
                }

                Promise.resolve().then(
                    getViews
                ).then(
                    deleteViews
                ).then(
                    getCatalog
                ).then(
                    createViews
                ).then(
                    resolve
                ).catch(reject);
            });
        }

        // ..........................................................
        // PUBLIC
        //

        /**
            Remove a feather definition from the database.

            @method deleteFeather
            @param {Object} payload Request payload
            @param {Object} payload.data Payload data
            @param {String | Array} payload.data.name Name(s) of
                feather(s) to delete
            @param {Client} payload.client Database client
            @return {Promise} Resolves to `true` if successful.
        */
        that.deleteFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                let name;
                let table;
                let catalog;
                let sql;
                let sql1;
                let sql2;
                let sql3;
                let rels;
                let props;
                let view;
                let type;
                let keys;
                let afterGetCatalog;
                let next;
                let createViews;
                let dropTables;
                let names = (
                    Array.isArray(obj.data.name)
                    ? obj.data.name
                    : [obj.data.name]
                );
                let o = 0;
                let c = 0;
                let theClient = obj.client;

                afterGetCatalog = function (resp) {
                    catalog = resp;
                    next();
                };

                dropTables = function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Drop table(s)
                    sql1 = (
                        "DROP VIEW IF EXISTS %I; " +
                        "DROP TABLE IF EXISTS %I;" + sql
                    );
                    sql1 = sql1.format(["_" + table, table]);
                    theClient.query(sql1, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        sql2 = "DELETE FROM \"$auth\" WHERE object_pk=";
                        sql2 += "(SELECT _pk FROM \"$feather\" WHERE id=$1);";
                        theClient.query(sql2, [table], function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            sql3 = "DELETE FROM \"$feather\" WHERE id=$1;";
                            theClient.query(sql3, [table], function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                next();
                            });
                        });
                    });
                };

                createViews = function () {
                    let rel;

                    if (c < rels.length) {
                        rel = rels[c];
                        c += 1;

                        // Update views
                        createView({
                            name: rel,
                            client: theClient,
                            callback: createViews
                        });
                        return;
                    }

                    dropTables();
                };

                next = function () {
                    sql = "";
                    if (o < names.length) {
                        name = names[o];
                        o += 1;
                        table = name.toSnakeCase();
                        rels = [];

                        if (!table || !catalog[name]) {
                            reject("Feather not found");
                            return;
                        }

                        /* Drop views for composite types */
                        props = catalog[name].properties;
                        keys = Object.keys(props);
                        keys.forEach(function (key) {
                            let cfp;

                            if (typeof props[key].type === "object") {
                                type = props[key].type;

                                if (type.properties) {
                                    view = "_" + name.toSnakeCase() + "$";
                                    view += key.toSnakeCase();
                                    sql += "DROP VIEW IF EXISTS %I;";
                                    sql = sql.format([view]);
                                }

                                if (type.childOf && catalog[type.relation]) {
                                    cfp = catalog[type.relation].properties;
                                    delete cfp[type.childOf];
                                    rels.push(type.relation);
                                }
                            }
                        });

                        /* Update catalog settings */
                        delete catalog[name];
                        settings.saveSettings({
                            client: theClient,
                            data: {
                                name: "catalog",
                                data: catalog
                            }
                        }).then(createViews).catch(reject);
                        return;
                    }

                    // All done
                    resolve(true);
                };

                settings.getSettings({
                    client: theClient,
                    data: {
                        name: "catalog"
                    }
                }).then(afterGetCatalog).catch(reject);
            });
        };

        /**
            Disable propagation of views during feather creation. This
            prevents running into shared memory violitions when doing mass
            updates via installation.

            @method disablePropagation
            @param {Boolean}
        */
        that.disablePropagation = function (flag) {
            disablePropagateViews = Boolean(flag);
        };

        let descendants = {};
        /**
           Take a feather name and return an array of the feather
           and its descendant names

            @method getDescendants
            @param {Object} client
            @param {String} name
            @return {Array}
         */
        that.getDescendants = async function (theClient, name) {
            if (!name) {
                return;
            }

            if (descendants[name]) {
                return descendants[name];
            }

            let result = [name];
            let catalog;

            function appendFeathers(str) {
                let kids = Object.keys(catalog).filter(function children(fthr) {
                    return catalog[fthr].inherits === str;
                });
                result = result.concat(kids);
                kids.forEach(appendFeathers);
            }

            try {
                catalog = await settings.getSettings({
                    client: theClient,
                    data: {name: "catalog"}
                });

                appendFeathers(name);

                descendants[name] = result;

                return result;
            } catch (e) {
                return Promise.reject(e);
            }
        };

        /**
            Return a feather definition, including inherited properties.

            @method getFeather
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {Object} payload.data Data
            @param {Object} payload.data.name Feather name
            @param {Boolean} [payload.data.includeInherited] Include inherited
                or not. Default = true.
            @return {Promise} Resoloves to feather definition object.
        */
        that.getFeather = async function (obj) {
            let theName = obj.data.name;
            let theClient = obj.client;
            let catalog;
            let overloads;

            function appendParent(child, parent) {
                let feather = catalog[parent];
                let parentProps = feather.properties;
                let childProps = child.properties;
                let ckeys = Object.keys(parentProps);

                if (parent !== "Object") {
                    appendParent(child, feather.inherits || "Object");
                }

                ckeys.forEach(function (key) {
                    if (childProps[key] === undefined) {
                        childProps[key] = parentProps[key];
                        childProps[key].inheritedFrom = parent;
                    }
                });

                return child;
            }

            try {
                /* First, get catalog */
                catalog = await settings.getSettings({
                    client: theClient,
                    data: {name: "catalog"}
                });
                let theFeather = catalog[theName];
                let resultProps;
                let featherProps;
                let result = {name: theName, inherits: "Object"};

                /* Validation */
                if (!theFeather) {
                    return false;
                }

                /* Add other attributes after name */
                Object.keys(theFeather).forEach(function (key) {
                    result[key] = theFeather[key];
                });

                /* Want inherited properties before class properties */
                if (
                    obj.data.includeInherited !== false &&
                    theName !== "Object"
                ) {
                    result.properties = {};
                    result = appendParent(result, result.inherits);
                } else {
                    delete result.inherits;
                }

                /* Now add local properties back in */
                featherProps = theFeather.properties;
                resultProps = result.properties;
                Object.keys(featherProps).forEach(function (key) {
                    resultProps[key] = featherProps[key];
                });
                // Apply overload default values
                overloads = theFeather.overloads;
                if (overloads) {
                    Object.keys(overloads).forEach(function (key) {
                        if (
                            resultProps[key] &&
                            overloads[key].default !== undefined
                        ) {
                            resultProps[key].default =
                            overloads[key].default;
                        }
                    });
                }

                return result;
            } catch (e) {
                return Promise.reject(e);
            }
        };

        /**
            Append feather definitions to an object that includes theClient
            child feathers for the feather requested.

            @method getFeathers
            @param {Object} Database client
            @param {String} Feather name
            @param {Object} Object to append feathers to
            @return {Promise}
        */
        that.getFeathers = function (client, featherName, localFeathers, idx) {
            return new Promise(function (resolve, reject) {
                idx = idx || [];

                // avoid infinite loops
                if (idx.indexOf(featherName) !== -1) {
                    resolve();
                    return;
                }
                idx.push(featherName);

                function getChildFeathers(resp) {
                    let frequests = [];
                    let props = resp.properties;

                    try {
                        localFeathers[featherName] = resp;

                        // Recursively get feathers for all children
                        Object.keys(props).forEach(function (key) {
                            let type = props[key].type;

                            if (
                                typeof type === "object"
                            ) {
                                frequests.push(
                                    that.getFeathers(
                                        client,
                                        type.relation,
                                        localFeathers,
                                        idx
                                    )
                                );
                            }
                        });
                    } catch (e) {
                        reject(e);
                        return;
                    }

                    Promise.all(
                        frequests
                    ).then(resolve).catch(reject);
                }

                that.getFeather({
                    client,
                    data: {
                        name: featherName
                    }
                }).then(getChildFeathers).catch(reject);
            });
        };

        /**
            Check whether a user is authorized to perform an action on a
            particular feather (class) or object.

            Allowable actions: `canCreate`, `canRead`, `canUpdate`, `canDelete`

            `canCreate` will only check feather names.

            @method isAuthorized
            @param {Object} payload
            @param {Object} payload.data Payload data
            @param {String} payload.data.action
            @param {String} [payload.data.feather] Feather name
            @param {String} [payload.data.id] Object id
            @param {String} [payload.data.user] Defaults to current user
            @param {Client} payload.client Database client
            @return {Promise} Resolves to Boolean.
        */
        that.isAuthorized = function (obj) {
            return new Promise(function (resolve, reject) {
                let table;
                let pk;
                let authSql;
                let sql;
                let params;
                let user = obj.data.user || obj.client.currentUser();
                let feather = obj.data.feather;
                let action = obj.data.action;
                let id = obj.data.id;
                let tokens = [];
                let result = false;
                let theClient = obj.client;

                function callback(isSuper) {
                    if (isSuper) {
                        resolve(true);
                        return;
                    }

                    /* If feather, check class authorization */
                    if (feather) {
                        params = [feather.toSnakeCase(), user];
                        sql = (
                            "SELECT pk FROM \"$auth\" " +
                            "  JOIN \"$feather\" " +
                            "    ON \"$feather\"._pk=\"$auth\".object_pk " +
                            "  JOIN pg_authid " +
                            "   ON \"$auth\".role=pg_authid.rolname " +
                            "WHERE \"$feather\".id=$1" +
                            "  AND pg_has_role($2, pg_authid.oid, 'member')" +
                            "  AND \"$auth\".object_pk=\"$feather\".parent_pk" +
                            "  AND %I;"
                        );
                        sql = sql.format([action.toSnakeCase()]);

                        theClient.query(sql, params, function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            result = resp.rows.length > 0;
                            resolve(result);
                        });

                        /* Otherwise check object authorization */
                    } else if (id) {
                        /* Find object */
                        sql = "SELECT _pk, tableoid::regclass::text AS \"t\" ";
                        sql += "FROM object WHERE id = $1;";

                        theClient.query(sql, [id], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            /* If object found, check authorization */
                            if (resp.rows.length > 0) {
                                table = resp.rows[0].t;
                                pk = resp.rows[0][tools.PKCOL];

                                tokens.push(table);
                                authSql = tools.buildAuthSql(
                                    action,
                                    table,
                                    tokens
                                );
                                sql = (
                                    "SELECT _pk FROM %I WHERE _pk = $2 " +
                                    authSql
                                );
                                sql = sql.format(tokens);

                                theClient.query(
                                    sql,
                                    [user, pk],
                                    function (err, resp) {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }

                                        result = resp.rows.length > 0;

                                        resolve(result);
                                    }
                                );
                            }
                        });
                    }
                }

                if (!obj.data.feather && !obj.data.id) {
                    throw new Error(
                        "Authorization check requires feather or id"
                    );
                }

                tools.isSuperUser({
                    client: theClient,
                    user: obj.data.user
                }).then(callback).catch(reject);
            });
        };

        /**
            Delete and repropagate all views.

            @method propagateViews
            @param {Object} client
            @return {Promise}
        */
        that.propagateViews = function (c) {
            return propagateViews({
                client: c
            });
        };

        /**
            Set authorazition for a particular authorization role. Must pass
            data `id` or `feather`.

            @example
                // Example payload
                {
                    id: "ExWIx6'",
                    role: "jdoe",
                    actions:
                    {
                        canCreate: false,
                        canRead: true,
                        canUpdate: false,
                        canDelete: false
                    }
                }

            @method saveAuthorization
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Payload data
            @param {String} [payload.data.id] Object id (if record level)
            @param {String} [payload.data.feather] Feather
            @param {String} payload.data.role Role
            @param {Boolean} [payload.data.isInternal] Not a feather
            @param {Boolean} [payload.data.isSilentError] Silence errors
            @param {Object} payload.data.actions
            @param {Boolean} [payload.data.actions.canCreate]
            @param {Boolean} [payload.data.actions.canRead]
            @param {Boolean} [payload.data.actions.canUpdate]
            @param {Boolean} [payload.data.actions.canDelete]
            @return {Promise}
        */
        that.saveAuthorization = function (obj) {
            return new Promise(function (resolve, reject) {
                let result;
                let sql;
                let pk;
                let feather;
                let params;
                let objPk;
                let err;
                let afterGetObjKey;
                let afterGetRoleKey;
                let afterGetFeatherName;
                let afterGetFeather;
                let checkSuperUser;
                let afterCheckSuperUser;
                let afterQueryAuth;
                let done;
                let theId = (
                    obj.data.feather
                    ? obj.data.feather.toSnakeCase()
                    : obj.data.id
                );
                let actions = obj.data.actions || {};
                let hasAuth = false;
                let theClient = obj.client;

                afterGetObjKey = function (resp) {
                    objPk = resp;

                    // Validation
                    if (!objPk) {
                        reject("Object \"" + theId + "\" not found");
                        return;
                    }

                    theClient.query(
                        "SELECT _pk FROM \"role\" WHERE name = $1",
                        [obj.data.role]
                    ).then(afterGetRoleKey).catch(reject);
                };

                afterGetRoleKey = function (resp) {
                    // Validation
                    if (!resp.rows.length) {
                        reject("Role \"" + obj.data.role + "\" not found");
                        return;
                    }

                    if (obj.data.isInternal) {
                        afterCheckSuperUser();
                        return;
                    }

                    if (obj.data.id) {
                        sql = (
                            "SELECT tableoid::regclass::text AS feather " +
                            "FROM object WHERE id=$1"
                        );
                        theClient.query(sql, [theId], afterGetFeatherName);
                        return;
                    }

                    afterGetFeatherName(null, {
                        rows: [{
                            feather: obj.data.feather
                        }]
                    });
                };

                afterGetFeatherName = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    feather = resp.rows[0].feather.toCamelCase(true);

                    that.getFeather({
                        client: theClient,
                        data: {
                            name: feather,
                            includeInherited: true
                        }
                    }).then(afterGetFeather).catch(reject);
                };

                afterGetFeather = function (resp) {
                    feather = resp;

                    if (tools.isChildFeather(feather)) {
                        actions.canCreate = false;
                        actions.canUpdate = false;
                        actions.canDelete = false;
                    } else if (
                        obj.data.id &&
                        !feather.properties.owner
                    ) {
                        err = (
                            "Feather '" + resp.name +
                            "' must have owner property to set " +
                            "record level authorization."
                        );
                    }

                    if (err) {
                        if (obj.data.isSilentError) {
                            done(null, false);
                            return;
                        }
                        reject(err);
                        return;
                    }

                    checkSuperUser();
                };

                checkSuperUser = function () {
                    tools.isSuperUser({
                        client: theClient
                    }).then(function (isSuper) {
                        if (isSuper) {
                            afterCheckSuperUser();
                            return;
                        }

                        sql = (
                            "SELECT tableoid::regclass::text AS tbl " +
                            "FROM object WHERE _pk=$1;"
                        );
                        theClient.query(sql, [objPk], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }
                            sql = (
                                "SELECT owner " +
                                "FROM " + resp.rows[0].tbl +
                                " WHERE _pk=$1;"
                            );
                            theClient.query(sql, [objPk], function (err, resp) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                if (
                                    obj.data.id &&
                                    resp.rows[0].owner !==
                                    theClient.currentUser()
                                ) {
                                    if (obj.data.isSilentError) {
                                        done(null, false);
                                        return;
                                    }
                                    err = (
                                        "Must be super user or owner of \"" +
                                        theId +
                                        "\" to set authorization."
                                    );
                                    reject(err);
                                    return;
                                }

                                afterCheckSuperUser();
                            });
                        });
                    }).catch(reject);
                };

                afterCheckSuperUser = function () {
                    // Determine whether any authorization has been granted
                    hasAuth = !(
                        (
                            actions.canCreate === false &&
                            actions.canRead === false &&
                            actions.canUpdate === false &&
                            actions.canDelete === false
                        ) || (
                            actions.canCreate === null &&
                            actions.canRead === null &&
                            actions.canUpdate === null &&
                            actions.canDelete === null
                        )
                    );

                    // Find an existing authorization record
                    sql = (
                        "SELECT auth.* FROM \"$auth\" AS auth " +
                        "  JOIN object ON object._pk=object_pk " +
                        "WHERE object.id=$1 " +
                        "  AND auth.role=$2;"
                    );

                    theClient.query(
                        sql,
                        [theId, obj.data.role],
                        afterQueryAuth
                    );
                };

                afterQueryAuth = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    result = resp.rows[0] || false;

                    if (result) {
                        pk = result.pk;

                        if (!hasAuth) {
                            sql = "DELETE FROM \"$auth\" WHERE pk=$1";
                            params = [pk];
                        } else {
                            sql = (
                                "UPDATE \"$auth\" SET can_create=$1," +
                                "can_read=$2, can_update=$3, can_delete=$4 " +
                                "WHERE pk=$5"
                            );

                            params = [
                                (
                                    actions.canCreate === undefined
                                    ? result.can_create
                                    : actions.canCreate
                                ),
                                (
                                    actions.canRead === undefined
                                    ? result.can_read
                                    : actions.canRead
                                ),
                                (
                                    actions.canUpdate === undefined
                                    ? result.can_update
                                    : actions.canUpdate
                                ),
                                (
                                    actions.canDelete === undefined
                                    ? result.can_delete
                                    : actions.canDelete
                                ),
                                pk
                            ];
                        }
                    } else if (hasAuth) {
                        sql = (
                            "INSERT INTO \"$auth\" AS a VALUES " +
                            "(nextval('$auth_pk_seq'), " +
                            "$1, $2, $3, $4, $5, $6)"
                        );
                        params = [
                            objPk,
                            obj.data.role,
                            (
                                actions.canCreate === undefined
                                ? null
                                : actions.canCreate
                            ),
                            (
                                actions.canRead === undefined
                                ? null
                                : actions.canRead
                            ),
                            (
                                actions.canUpdate === undefined
                                ? null
                                : actions.canUpdate
                            ),
                            (
                                actions.canDelete === undefined
                                ? null
                                : actions.canDelete
                            )
                        ];
                    } else {
                        done(null, false);
                        return;
                    }

                    theClient.query(sql, params, done);
                };

                done = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(resp !== false);
                };

                // Kick off query by getting object key, the rest falls
                // through callbacks
                tools.getKey({
                    id: theId,
                    client: theClient
                }).then(afterGetObjKey).catch(reject);
            });
        };

        /**
            Create or update a persistence class. This function is idempotent.
            Subsequent saves will automatically drop properties no longer
            present.

            @example
            // example payload:
            {
                "name": "Contact",
                "description": "Contact data about a person",
                "inherits": "Object",
                "properties": {
                    "fullName": {
                        "description": "Full name",
                        "type": "string"
                    },
                    "birthDate": {
                        "description": "Birth date",
                        "type": "string"
                        "format": "date"
                    },
                    "isMarried": {
                        "description": "Marriage status",
                        "type": "boolean"
                    },
                    "dependents": {
                        "description": "Number of dependents",
                        "type": "integer"
                    }
                }
            }

            @method saveFeather
            @param {Object} payload
            @param {Client} payload.client Database client.
            @param {Object | Array} [payload.spec] Feather specification(s).
            @param {String} payload.spec.name Name
            @param {String} [payload.spec.description] Description
            @param {Object | Array | Boolean} [payload.spec.authorizations]
            Authorization spec. Defaults to grant all to everyone if
            undefined.
            @param {String} [payload.spec.properties] Feather properties
            @param {String} [payload.spec.properties.description]
            Description
            @param {String} [spec.properties.default] Default value
            or function name.
            @param {String | Object} payload.spec.properties.type
            Type. Standard types are string, boolean, number, date.
            Object is used for relation specs.
            @param {String} [payload.spec.properties.relation] Feather name of
            relation.
            @param {String} [payload.spec.properties.childOf] Property name
                on parent relation if one to many relation.
            @return {Promise}
        */
        that.saveFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                let spec;
                let theParent;
                let specs = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );
                let c = 0;
                let len = specs.length;
                let theClient = obj.client;

                function nextSpec() {
                    let sqlUpd;
                    let token;
                    let values;
                    let defaultValue;
                    let props;
                    let keys;
                    let recs;
                    let type;
                    let theName;
                    let isChild;
                    let pk;
                    let prec;
                    let scale;
                    let feather;
                    let catalog;
                    let autonumber;
                    let afterGetCatalog;
                    let afterUpdateSchema;
                    let updateCatalog;
                    let afterUpdateCatalog;
                    let afterPropagateViews;
                    let afterNextVal;
                    let createIndex;
                    let afterInsertFeather;
                    let afterSaveAuthorization;
                    let createSequence;
                    let table;
                    let inherits;
                    let dropSql;
                    let changed = false;
                    let sql = "";
                    let tokens = [];
                    let adds = [];
                    let args = [];
                    let fns = [];
                    let unique = [];
                    let indices = [];
                    let i = 0;
                    let n = 0;
                    let p = 1;
                    let err;

                    function createDropSql(name) {
                        let statements;
                        let buildDeps;
                        let feathers = [];

                        buildDeps = function (name) {
                            let dkeys = Object.keys(catalog);

                            feathers.push(name);
                            dkeys.forEach(function (key) {
                                if (
                                    key !== name &&
                                    catalog[key].inherits === name
                                ) {
                                    buildDeps(key);
                                }
                            });
                        };

                        buildDeps(name);

                        statements = feathers.map(function (feather) {
                            let stmt = "DROP VIEW IF EXISTS %I CASCADE";
                            return stmt.format(["_" + feather.toSnakeCase()]);
                        });

                        return statements.join(";") + ";";
                    }

                    function afterGetFeather(resp) {
                        feather = resp;

                        settings.getSettings({
                            client: theClient,
                            data: {
                                name: "catalog"
                            }
                        }).then(afterGetCatalog).catch(reject);
                    }

                    function handleProps(key) {
                        let prop = props[key];
                        let fProp;
                        let pProps;
                        let descr;

                        if (feather && feather.properties) {
                            fProp = feather.properties[key];
                        }

                        type = (
                            typeof prop.type === "string"
                            ? tools.types[prop.type]
                            : prop.type
                        );

                        if (type && key !== spec.discriminator) {
                            if (!feather || !fProp) {

                                /* Drop views */
                                if (feather && !changed) {
                                    sql += dropSql;
                                }

                                changed = true;
                                sql += "ALTER TABLE %I ADD COLUMN %I ";

                                /* Handle composite types */
                                if (typeof prop.type === "object") {
                                    if (type.relation) {
                                        sql += "bigint;";
                                        token = tools.relationColumn(
                                            key,
                                            type.relation
                                        );

                                        /* Update parent class for to-many
                                           children */
                                        if (type.childOf) {
                                            theParent = catalog[type.relation];
                                            if (theParent) {
                                                pProps = theParent.properties;
                                                if (!pProps[type.childOf]) {
                                                    descr = (
                                                        "Parent of \"" + key +
                                                        "\" on \"" +
                                                        spec.name + "\""
                                                    );

                                                    pProps[type.childOf] = {
                                                        description: descr,
                                                        type: {
                                                            relation: spec.name,
                                                            parentOf: key
                                                        }
                                                    };

                                                } else {
                                                    err = (
                                                        "Property \"" +
                                                        type.childOf +
                                                        "\" already exists on" +
                                                        "\"" + type.relation +
                                                        "\""
                                                    );
                                                }
                                            } else {
                                                err = (
                                                    "Relation feather " +
                                                    type.relation +
                                                    " required by " +
                                                    spec.name +
                                                    " not found, likely due " +
                                                    "to a missing dependency."
                                                );
                                            }
                                        } else if (type.parentOf) {
                                            err = "Can not set parent ";
                                            err += "directly for \"";
                                            err += key + "\"";
                                        } else if (
                                            !type.properties ||
                                            !type.properties.length
                                        ) {
                                            err = "Properties must be defined";
                                            err += "for relation \"" + key;
                                            err += "\"";
                                        /* Must be to-one relation.
                                           If relation feather is flagged
                                           as child, flag property as
                                           child on this feather. */
                                        } else {
                                            theParent = catalog[type.relation];
                                            if (!theParent) {
                                                err = (
                                                    "Relation feather " +
                                                    type.relation +
                                                    " required by " +
                                                    spec.name +
                                                    " not found, likely " +
                                                    "due to a " +
                                                    "missing dependency."
                                                );
                                            } else {
                                                prop.type.isChild = Boolean(
                                                    theParent.isChild
                                                );
                                            }
                                        }
                                    } else {
                                        err = "Relation not defined for ";
                                        err += "composite type \"" + key;
                                        err += "\"";
                                    }

                                    if (err) {
                                        return false;
                                    }

                                    /* Handle standard types */
                                } else {
                                    if (prop.format) {
                                        if (formats[prop.format]) {
                                            sql += formats[prop.format].type;
                                        } else if (formats[prop.type]) {
                                            sql += formats[prop.type].type;
                                        } else {
                                            err = "Invalid format \"";
                                            err += prop.format;
                                            err += "\" for property \"";
                                            err += key + "\" on class \"";
                                            err += spec.name + "\"";
                                            return false;
                                        }
                                    } else {
                                        sql += type.type;
                                        if (type.type === "numeric") {
                                            if (
                                                prop.precision !== undefined &&
                                                !Number.isNaN(prop.precision) &&
                                                prop.precision !== -1
                                            ) {
                                                prec = prop.precision;
                                            } else {
                                                prec = f.PRECISION_DEFAULT;
                                            }

                                            if (
                                                prop.scale !== undefined &&
                                                !Number.isNaN(prop.scale) &&
                                                prop.scale !== -1
                                            ) {
                                                scale = prop.scale;
                                            } else {
                                                scale = f.SCALE_DEFAULT;
                                            }

                                            sql += "(" + prec + "," + scale;
                                            sql += ")";
                                        }
                                    }
                                    sql += ";";
                                    token = key.toSnakeCase();
                                }

                                adds.push(key);
                                tokens = tokens.concat([table, token]);

                                if (prop.isNaturalKey) {
                                    unique.push(key);
                                }

                                if (prop.isIndexed) {
                                    indices.push(key);
                                }

                                if (prop.description) {
                                    sql += "COMMENT ON COLUMN %I.%I IS %L;";

                                    tokens = tokens.concat([
                                        table,
                                        token,
                                        prop.description || ""
                                    ]);
                                }
                                // Always regenerate relation views in case
                                // properties changed
                            }
                        } else {
                            err = "Invalid type \"" + prop.type;
                            err += "\" for property \"";
                            err += key + "\" on class \"" + spec.name + "\"";

                            return false;
                        }

                        return true;
                    }

                    afterGetCatalog = function (resp) {
                        let overloads;

                        catalog = resp;

                        dropSql = createDropSql(spec.name);

                        /* Create table if applicable */
                        if (!feather) {
                            sql = (
                                "CREATE TABLE %I( " +
                                "CONSTRAINT %I PRIMARY KEY (_pk), " +
                                "CONSTRAINT %I UNIQUE (id)) " +
                                "INHERITS (%I);" +
                                "CREATE TRIGGER %I AFTER INSERT ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "insert_trigger();" +
                                "CREATE TRIGGER %I AFTER UPDATE ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "update_trigger();" +
                                "CREATE TRIGGER %I AFTER DELETE ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "delete_trigger();"
                            );

                            tokens = tokens.concat([
                                table,
                                table + "_pkey",
                                table + "_id_key",
                                inherits,
                                table + "_insert_trigger",
                                table,
                                table + "_update_trigger",
                                table,
                                table + "_delete_trigger",
                                table
                            ]);

                        } else {
                            // Update triggers as necessary
                            sql += (
                                "DROP TRIGGER IF EXISTS %I ON %I;" +
                                "DROP TRIGGER IF EXISTS %I ON %I;" +
                                "DROP TRIGGER IF EXISTS %I ON %I;" +
                                "CREATE TRIGGER %I " +
                                "AFTER INSERT ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "insert_trigger();" +
                                "CREATE TRIGGER %I " +
                                "AFTER UPDATE ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "update_trigger();" +
                                "CREATE TRIGGER %I " +
                                "AFTER DELETE ON %I " +
                                "FOR EACH ROW EXECUTE PROCEDURE " +
                                "delete_trigger();"
                            );

                            tokens = tokens.concat([
                                table + "_insert_trigger",
                                table,
                                table + "_update_trigger",
                                table,
                                table + "_delete_trigger",
                                table,
                                table + "_insert_trigger",
                                table,
                                table + "_update_trigger",
                                table,
                                table + "_delete_trigger",
                                table
                            ]);

                            /* Drop non-inherited columns not included
                               in properties */
                            props = feather.properties;
                            keys = Object.keys(props);
                            keys.forEach(function (key) {
                                if (
                                    spec.properties && !spec.properties[key] &&
                                    !(
                                        typeof props[key].type === "object" &&
                                        Boolean(props[key].type.parentOf)
                                    )
                                ) {
                                    /* Drop views */
                                    if (!changed) {
                                        sql += dropSql;
                                        changed = true;
                                    }

                                    /* Handle relations */
                                    type = props[key].type;

                                    if (
                                        typeof type === "object" &&
                                        type.properties
                                    ) {
                                        tokens = tokens.concat([
                                            table,
                                            tools.relationColumn(
                                                key,
                                                type.relation
                                            )
                                        ]);
                                    } else {
                                        tokens = tokens.concat([
                                            table,
                                            key.toSnakeCase()
                                        ]);
                                    }

                                    sql += (
                                        "ALTER TABLE %I DROP COLUMN %I CASCADE;"
                                    );

                                    // Unrelate parent if applicable
                                    if (type.childOf) {
                                        theParent = catalog[type.relation];
                                        delete theParent.properties[
                                            type.childOf
                                        ];
                                    }
                                    // Always drop/recreate relation views in
                                    // case properties changed
                                } else if (
                                    typeof props[key].type === "object" &&
                                    !Boolean(props[key].type.parentOf) &&
                                    !Boolean(props[key].type.childOf)
                                ) {
                                    changed = true;

                                    // Parent properties need to be added back
                                    // into spec so not lost
                                } else if (
                                    spec.properties &&
                                    !spec.properties[key] && (
                                        typeof props[key].type === "object" &&
                                        props[key].type.parentOf
                                    )
                                ) {
                                    spec.properties[key] = props[key];
                                }
                            });
                        }

                        // Add table description
                        if (spec.description) {
                            sql += "COMMENT ON TABLE %I IS %L;";
                            tokens = tokens.concat([
                                table,
                                spec.description || ""
                            ]);
                        }

                        /* Handle autonumber overloads */
                        overloads = spec.overloads || {};
                        Object.keys(overloads).forEach(function (key) {
                            let o = overloads[key];

                            if (o.autonumber) {
                                autonumber = o.autonumber;
                                autonumber.key = key;
                            }
                        });

                        /* Add columns */
                        spec.properties = spec.properties || {};
                        props = spec.properties;
                        keys = Object.keys(props).filter(function (item) {
                            let prop = props[item];
                            if (prop.autonumber && !autonumber) {
                                autonumber = prop.autonumber;
                                autonumber.key = item;
                            }

                            return !prop.inheritedFrom;
                        });
                        keys.every(handleProps);

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Update schema */
                        sql = sql.format(tokens);
                        theClient.query(sql, createSequence);
                    };

                    createSequence = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (!autonumber) {
                            afterUpdateSchema();
                            return;
                        }
                        let sequence = autonumber.sequence;
                        sql = "SELECT relname FROM pg_class ";
                        sql += "JOIN pg_namespace ";
                        sql += "ON relnamespace=pg_namespace.oid ";
                        sql += "WHERE relkind = 'S' AND relname = $1 ";
                        sql += "AND nspname = 'public'";

                        theClient.query(sql, [sequence], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (!resp.rows.length) {
                                sql = "CREATE SEQUENCE %I;";
                                sql = sql.format([sequence]);
                                theClient.query(sql, function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    afterUpdateSchema();
                                });
                                return;
                            }

                            afterUpdateSchema();
                        });
                    };

                    afterUpdateSchema = function (err) {
                        let afterPopulateDefaults;
                        let iterateDefaults;

                        function disableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I DISABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                theClient.query(sql).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        function updateTable() {
                            return new Promise(function (resolve, reject) {
                                sql = "UPDATE %I SET " + tokens.join(",");
                                sql += ";";
                                sql = sql.format(args);
                                theClient.query(sql, values).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        function enableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I ENABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                theClient.query(sql).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        afterPopulateDefaults = function () {
                            // Update function based defaults (one by one)
                            if (fns.length) {
                                tokens = [];
                                args = [table];
                                i = 0;

                                fns.forEach(function (fn) {
                                    tokens.push("%I=$" + (i + 2));
                                    args.push(fn.col);
                                    i += 1;
                                });

                                sql = "SELECT _pk FROM %I ORDER BY _pk ";
                                sql += "OFFSET $1 LIMIT 1;";
                                sql = sql.format([table]);
                                sqlUpd = "UPDATE %I SET " + tokens.join(",");
                                sqlUpd += " WHERE _pk = $1";
                                sqlUpd = sqlUpd.format(args);
                                theClient.query(sql, [n], iterateDefaults);
                                return;
                            }

                            createIndex();
                        };

                        iterateDefaults = function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            recs = resp.rows;

                            if (recs.length) {
                                values = [recs[0][tools.PKCOL]];
                                i = 0;
                                n += 1;

                                while (i < fns.length) {
                                    values.push(f[fns[i].default]());
                                    i += 1;
                                }

                                theClient.query(
                                    sqlUpd,
                                    values,
                                    function (err) {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }

                                        // Look for next record
                                        theClient.query(
                                            sql,
                                            [n],
                                            iterateDefaults
                                        );
                                    }
                                );
                                return;
                            }

                            createIndex();
                        };

                        // Populate defaults
                        if (adds.length) {
                            values = [];
                            tokens = [];
                            args = [table];

                            adds.forEach(function (add) {
                                let pformat = props[add].format;

                                type = props[add].type;

                                if (typeof type === "object") {
                                    defaultValue = -1;
                                } else {
                                    defaultValue = props[add].default;
                                    if (defaultValue === undefined) {
                                        defaultValue = (
                                            (pformat && formats[pformat])
                                            ? formats[pformat].default
                                            : false
                                        ) || tools.types[type].default;
                                    }
                                }

                                if (
                                    (
                                        pformat === "date" ||
                                        pformat === "dateTime"
                                    ) && props[add].default === "null"
                                ) {
                                    defaultValue = null;
                                }

                                if (
                                    typeof defaultValue === "string" &&
                                    defaultValue.match(/\(\)$/)
                                ) {
                                    fns.push({
                                        col: add.toSnakeCase(),
                                        default: defaultValue.replace(
                                            /\(\)$/,
                                            ""
                                        )
                                    });
                                } else {
                                    values.push(defaultValue);
                                    tokens.push("%I=$" + p);
                                    if (typeof type === "object") {
                                        args.push(
                                            tools.relationColumn(
                                                add,
                                                type.relation
                                            )
                                        );
                                    } else {
                                        args.push(add.toSnakeCase());
                                    }
                                    p += 1;
                                }
                            });

                            if (values.length) {
                                Promise.resolve().then(
                                    disableTriggers
                                ).then(
                                    updateTable
                                ).then(
                                    enableTriggers
                                ).then(
                                    afterPopulateDefaults
                                ).catch(
                                    reject
                                );

                                return;
                            }

                            afterPopulateDefaults();
                            return;
                        }

                        createIndex();
                    };

                    createIndex = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (unique.length || indices.length) {
                            sql = "";
                            tokens = [];

                            unique.forEach(function (key) {
                                sql += "CREATE INDEX %I ON %I (%I);";
                                tokens = tokens.concat([
                                    table + "_index_" + key.toSnakeCase(),
                                    table,
                                    key.toSnakeCase()
                                ]);
                            });

                            indices.forEach(function (key) {
                                sql += "CREATE INDEX %I ON %I (%I);";
                                tokens = tokens.concat([
                                    table + "_index_" + key.toSnakeCase(),
                                    table,
                                    key.toSnakeCase()
                                ]);
                            });

                            theClient.query(
                                sql.format(tokens),
                                updateCatalog
                            );
                            return;
                        }
                        updateCatalog();
                    };

                    updateCatalog = function (err) {
                        let fprops;
                        let sprops;

                        function handleFP(attr) {
                            let pr = this;
                            let st = sprops[pr].type;
                            let ft = fprops[pr].type;

                            if (attr === "type") {
                                if (
                                    typeof sprops[pr].type === "object" &&
                                    st.relation === ft.relation &&
                                    ft.isChild
                                ) {
                                    st.isChild = true;
                                } else if (st && st.isChild) {
                                    st.isChild = false;
                                }
                            }
                        }

                        function handleSP(p) {
                            if (fprops[p]) {
                                Object.keys(
                                    fprops[p]
                                ).forEach(
                                    handleFP.bind(p)
                                );
                            }
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Make sure certain values added automatically
                           persist */
                        if (feather) {
                            fprops = feather.properties;
                            sprops = spec.properties;

                            Object.keys(sprops).forEach(handleSP);
                        }

                        /* Update catalog settings */
                        theName = spec.name;
                        catalog[theName] = spec;
                        delete spec.name;

                        if (
                            typeof spec.authorization === "object" &&
                            !Array.isArray(spec.authorization)
                        ) {
                            spec.authorization = [spec.authorization];
                        }

                        settings.saveSettings({
                            client: theClient,
                            data: {
                                name: "catalog",
                                data: catalog
                            }
                        }).then(afterUpdateCatalog).catch(reject);
                    };

                    afterUpdateCatalog = function () {
                        function callback(resp) {
                            isChild = tools.isChildFeather(resp);
                            sql = "SELECT nextval('object__pk_seq') AS pk;";
                            theClient.query(sql, afterNextVal);
                        }

                        if (!feather) {
                            that.getFeather({
                                client: theClient,
                                data: {
                                    name: theName
                                }
                            }).then(callback).catch(reject);
                            return;
                        }

                        isChild = tools.isChildFeather(feather);
                        afterInsertFeather();
                    };

                    afterNextVal = function (err, resp) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        pk = resp.rows[0].pk;

                        sql = "INSERT INTO \"$feather\" ";
                        sql += "(_pk, id, created, created_by, updated, ";
                        sql += "updated_by, is_deleted, is_child, ";
                        sql += "parent_pk) VALUES ";
                        sql += "($1, $2, now(), $3, now(), $4, false, ";
                        sql += "$5, $6);";
                        values = [
                            pk,
                            table,
                            theClient.currentUser(),
                            theClient.currentUser(),
                            isChild,
                            pk
                        ];
                        theClient.query(sql, values, afterInsertFeather);
                    };

                    afterInsertFeather = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Propagate views */
                        changed = changed || !feather;
                        if (changed) {
                            propagateViews({
                                client: theClient
                            }).then(afterPropagateViews).catch(reject);
                            return;
                        }

                        afterPropagateViews();
                    };

                    afterPropagateViews = function () {
                        let requests = [];

                        /* If no specific authoriztion this won't work */
                        if (
                            !isChild && !spec.isChild && (
                                spec.authorizations === undefined ||
                                spec.authorizations === null
                            )
                        ) {
                            throw new Error(
                                "Feather must specify authorization."
                            );
                        }

                        /* Set authorization */
                        if (
                            Array.isArray(spec.authorizations) &&
                            spec.authorizations.length
                        ) {
                            spec.authorizations.forEach(function (auth) {
                                auth.feather = theName;
                                auth.isSilentError = true;
                                requests.push(that.saveAuthorization({
                                    client: theClient,
                                    data: auth
                                }));
                            });

                            Promise.all(requests).then(
                                afterSaveAuthorization
                            ).catch(reject);
                            return;
                        }

                        afterSaveAuthorization();
                    };

                    afterSaveAuthorization = function () {
                        if (c < len) {
                            nextSpec();
                            return;
                        }

                        descendants = {}; // Reset cache
                        resolve(true);
                    };

                    // Real work starts here
                    spec = specs[c];
                    c += 1;
                    table = (
                        spec.name
                        ? spec.name.toSnakeCase()
                        : false
                    );
                    inherits = (spec.inherits || "Object");
                    inherits = inherits.toSnakeCase();

                    if (!table) {
                        reject("No name defined");
                        return;
                    }

                    if (reserved.indexOf(
                        table.toSnakeCase().toUpperCase()
                    ) !== -1) {
                        reject(
                            "Cannot create feather \"" + table +
                            "\" because it is a reserved word."
                        );
                        return;
                    }

                    that.getFeather({
                        client: theClient,
                        data: {
                            name: spec.name,
                            includeInherited: false
                        }
                    }).then(afterGetFeather).catch(reject);
                }

                // Real work starts here
                nextSpec();
            });
        };

        return that;
    };

}(exports));