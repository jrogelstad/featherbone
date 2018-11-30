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
/*jslint node, es6*/
(function (exports) {
    "strict";

    const {
        Tools
    } = require("./tools");
    const {
        Settings
    } = require("./settings");
    const f = require("../../common/core");

    const settings = new Settings();
    const tools = new Tools();

    exports.Feathers = function () {
        // ..........................................................
        // PRIVATE
        //

        var that = {};

        function createView(obj) {
            var parent, alias, type, view, sub, col, feather, props, keys,
                    afterGetFeather,
                    name = obj.name,
                    execute = obj.execute !== false,
                    dropFirst = obj.dropFirst,
                    table = name.toSnakeCase(),
                    args = ["_" + table, "_pk"],
                    cols = ["%I"],
                    sql = "";

            afterGetFeather = function (resp) {
                feather = resp;
                props = feather.properties;
                keys = Object.keys(props);

                keys.forEach(function (key) {
                    alias = key.toSnakeCase();

                    /* Handle discriminator */
                    if (key === "objectType") {
                        cols.push("%s");
                        args.push("to_camel_case(tableoid::regclass::text) AS " +
                                alias);

                        /* Handle relations */
                    } else if (typeof props[key].type === "object") {
                        type = props[key].type;
                        parent = props[key].inheritedFrom
                            ? props[key].inheritedFrom.toSnakeCase()
                            : table;

                        /* Handle to many */
                        if (type.parentOf) {
                            sub = "ARRAY(SELECT %I FROM %I WHERE %I.%I = %I._pk " +
                                    "AND NOT %I.is_deleted ORDER BY %I._pk) AS %I";
                            view = "_" + props[key].type.relation.toSnakeCase();
                            col = "_" + type.parentOf.toSnakeCase() + "_" + parent + "_pk";
                            args = args.concat([view, view, view, col, table, view, view,
                                    alias]);

                            /* Handle to one */
                        } else if (!type.childOf) {
                            col = "_" + key.toSnakeCase() + "_" +
                                    props[key].type.relation.toSnakeCase() + "_pk";
                            sub = "(SELECT %I FROM %I WHERE %I._pk = %I) AS %I";

                            if (props[key].type.properties) {
                                view = "_" + parent + "$" + key.toSnakeCase();
                            } else {
                                view = "_" + props[key].type.relation.toSnakeCase();
                            }

                            args = args.concat([view, view, view, col, alias]);
                        } else {
                            sub = "_" + key.toSnakeCase() + "_" + type.relation.toSnakeCase() +
                                    "_pk";
                        }

                        cols.push(sub);

                        /* Handle regular types */
                    } else {
                        cols.push("%I");
                        args.push(alias);
                    }
                });

                args.push(table);

                if (dropFirst) {
                    sql = "DROP VIEW IF EXISTS %I CASCADE;";
                    sql = sql.format(["_" + table]);
                }

                sql += "CREATE OR REPLACE VIEW %I AS SELECT " + cols.join(",") + " FROM %I;";
                sql = sql.format(args);

                // If execute, run the sql now
                if (execute) {
                    obj.client.query(sql, function (err) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        obj.callback(null, true);
                        return;
                    });
                }

                // Otherwise send the sql back
                obj.callback(null, sql);
            };

            that.getFeather({
                client: obj.client,
                data: {
                    name: obj.name
                }
            }).then(afterGetFeather).catch(obj.callback);
        }

        function propagateViews(obj) {
            var cprops, catalog,
                    afterGetCatalog, afterCreateView,
                    name = obj.name,
                    statements = obj.statements || [],
                    level = obj.level || 0,
                    sql = "";

            afterGetCatalog = function (resp) {
                catalog = resp;
                createView({
                    name: name,
                    client: obj.client,
                    callback: afterCreateView,
                    dropFirst: true,
                    execute: false
                });
            };

            afterCreateView = function (err, resp) {
                var keys, next, propagateUp,
                        functions = [],
                        i = 0;

                if (err) {
                    obj.callback(err);
                    return;
                }

                statements.push({
                    level: level,
                    sql: resp
                });

                // Callback to process functions sequentially
                next = function (err, resp) {
                    var o;

                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    // Responses that are result of createView get appended
                    if (typeof resp === "string") {
                        statements.push({
                            level: level,
                            sql: resp
                        });
                    }

                    // Iterate to next function to build statement
                    o = functions[i];
                    i += 1;

                    if (o) {
                        o.func(o.payload);
                        return;
                    }

                    // Only top level will actually execute statements
                    if (level > 0) {
                        obj.callback(null, true);
                        return;
                    }

                    // If here then ready to execute
                    // Sort by level
                    statements.sort(function (a, b) {
                        if (a.level === b.level || a.level < b.level) {
                            return 0;
                        }
                        return 1;
                    });

                    statements.forEach(function (statement) {
                        sql += statement.sql;
                    });

                    obj.client.query(sql, function (err) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        obj.callback(null, true);
                    });
                };

                // Build object to propagate relations */
                keys = Object.keys(catalog);
                keys.forEach(function (key) {
                    var ckeys;

                    cprops = catalog[key].properties;
                    ckeys = Object.keys(cprops);

                    ckeys.forEach(function (ckey) {
                        if (cprops.hasOwnProperty(ckey) &&
                                typeof cprops[ckey].type === "object" &&
                                cprops[ckey].type.relation === name &&
                                !cprops[ckey].type.childOf &&
                                !cprops[ckey].type.parentOf) {
                            functions.push({
                                func: propagateViews,
                                payload: {
                                    name: key,
                                    client: obj.client,
                                    callback: next,
                                    statements: statements,
                                    level: level + 1
                                }
                            });
                        }
                    });
                });

                /* Propagate down */
                keys = Object.keys(catalog);
                keys.forEach(function (key) {
                    if (catalog[key].inherits === name) {
                        functions.push({
                            func: propagateViews,
                            payload: {
                                name: key,
                                client: obj.client,
                                callback: next,
                                statements: statements,
                                level: level + 1
                            }
                        });
                    }
                });

                /* Propagate up */
                propagateUp = function (name, plevel) {
                    var pkeys, props;
                    plevel = plevel - 1;
                    props = catalog[name].properties;
                    pkeys = Object.keys(props);
                    pkeys.forEach(function (key) {
                        var type = props[key].type;
                        if (typeof type === "object" && type.childOf) {
                            functions.push({
                                func: createView,
                                payload: {
                                    name: type.relation,
                                    client: obj.client,
                                    callback: next,
                                    execute: false
                                }
                            });
                            propagateUp(type.relation, plevel);
                        }
                    });
                };

                propagateUp(name, level);

                next();
            };

            settings.getSettings({
                client: obj.client,
                data: {
                    name: "catalog"
                }
            }).then(afterGetCatalog).catch(obj.callback);
        }

        function getParentKey(obj) {
            return new Promise(function (resolve, reject) {
                var cParent, afterGetChildFeather, afterGetParentFeather, done;

                afterGetChildFeather = function (resp) {
                    var cKeys, cProps;

                    cProps = resp.properties;
                    cKeys = Object.keys(cProps);
                    cKeys.every(function (cKey) {
                        if (typeof cProps[cKey].type === "object" &&
                                cProps[cKey].type.childOf) {
                            cParent = cProps[cKey].type.relation;

                            that.getFeather({
                                client: obj.client,
                                data: {
                                    name: obj.parent
                                }
                            }).then(afterGetParentFeather).catch(reject);

                            return false;
                        }

                        return true;
                    });
                };

                afterGetParentFeather = function (resp) {
                    if (resp.isChildFeather) {
                        getParentKey({
                            child: cParent,
                            parent: obj.parent,
                            client: obj.client
                        }).then(resolve).catch(reject);
                        return;
                    }

                    tools.getKey({
                        name: cParent.toSnakeCase(),
                        client: obj.client
                    }).then(done).catch(reject);
                };

                done = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(resp);
                };

                that.getFeather({
                    client: obj.client,
                    data: {
                        name: obj.child
                    }
                }).then(afterGetChildFeather).catch(reject);
            });
        }

        // ..........................................................
        // PUBLIC
        //

        /**
          Remove a class from the database.

            @param {Object} Request payload
            @param {Object} [payload.data] Payload data
            @param {Object | Array} [payload.data.name] Name(s) of feather(s) to delete
            @param {Object} [payload.client] Database client
            @return {Object} Promise
        */
        that.deleteFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                var name, table, catalog, sql, rels, props, view, type, keys,
                        afterGetCatalog, next, createViews, dropTables,
                        names = Array.isArray(obj.data.name)
                    ? obj.data.name
                    : [obj.data.name],
                        o = 0,
                        c = 0;

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
                    sql = "DROP VIEW %I; DROP TABLE %I;" + sql;
                    sql = sql.format(["_" + table, table]);
                    obj.client.query(sql, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        sql = "DELETE FROM \"$auth\" WHERE object_pk=" +
                                "(SELECT _pk FROM \"$feather\" WHERE id=$1);";
                        obj.client.query(sql, [table], function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            sql = "DELETE FROM \"$feather\" WHERE id=$1;";
                            obj.client.query(sql, [table], function (err) {
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
                    var rel;

                    if (c < rels.length) {
                        rel = rels[c];
                        c += 1;

                        // Update views
                        createView({
                            name: rel,
                            dropFirst: true,
                            client: obj.client,
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
                            if (typeof props[key].type === "object") {
                                type = props[key].type;

                                if (type.properties) {
                                    view = "_" + name.toSnakeCase() + "$" + key.toSnakeCase();
                                    sql += "DROP VIEW %I;";
                                    sql = sql.format([view]);
                                }

                                if (type.childOf && catalog[type.relation]) {
                                    delete catalog[type.relation].properties[type.childOf];
                                    rels.push(type.relation);
                                }
                            }
                        });

                        /* Update catalog settings */
                        delete catalog[name];
                        settings.saveSettings({
                            client: obj.client,
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
                    client: obj.client,
                    data: {
                        name: "catalog"
                    }
                }).then(afterGetCatalog).catch(reject);
            });
        };

        /**
          Return a class definition, including inherited properties.
          @param {Object} Request payload
          @param {Object} [payload.name] Feather name
          @param {Object} [payload.client] Database client
          @param {Boolean} [payload.includeInherited] Include inherited or not. Default = true.
          @return {Object} Promise
        */
        that.getFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                var callback, name = obj.data.name;

                callback = function (catalog) {
                    var resultProps, featherProps, keys, appendParent,
                            result = {name: name, inherits: "Object"};

                    appendParent = function (child, parent) {
                        var feather = catalog[parent],
                            parentProps = feather.properties,
                            childProps = child.properties,
                            ckeys = Object.keys(parentProps);

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
                    };

                    /* Validation */
                    if (!catalog[name]) {
                        resolve(false);
                        return;
                    }

                    /* Add other attributes after name */
                    keys = Object.keys(catalog[name]);
                    keys.forEach(function (key) {
                        result[key] = catalog[name][key];
                    });

                    /* Want inherited properites before class properties */
                    if (obj.data.includeInherited !== false && name !== "Object") {
                        result.properties = {};
                        result = appendParent(result, result.inherits);
                    } else {
                        delete result.inherits;
                    }

                    /* Now add local properties back in */
                    featherProps = catalog[name].properties;
                    resultProps = result.properties;
                    keys = Object.keys(featherProps);
                    keys.forEach(function (key) {
                        resultProps[key] = featherProps[key];
                    });

                    resolve(result);
                };

                /* First, get catalog */
                settings.getSettings({
                    client: obj.client,
                    data: {name: "catalog"}
                }).then(callback).catch(reject);
            });
        };

        /**
          Check whether a user is authorized to perform an action on a
          particular feather (class) or object.

          Allowable actions: "canCreate", "canRead", "canUpdate", "canDelete"

          "canCreate" will only check feather names.

          @param {Object} Payload
          @param {Object} [payload.data] Payload data
          @param {String} [payload.data.action] Required
          @param {String} [payload.data.feather] Class
          @param {String} [payload.data.id] Object id
          @param {String} [payload.data.user] User. Defaults to current user
          @param {String} [payload.client] Datobase client
          @return {Object} Promise
        */
        that.isAuthorized = function (obj) {
            return new Promise(function (resolve, reject) {
                var table, pk, authSql, sql, params,
                        user = obj.data.user || obj.client.currentUser,
                        feather = obj.data.feather,
                        action = obj.data.action,
                        id = obj.data.id,
                        tokens = [],
                        result = false;

                /* If feather, check class authorization */
                if (feather) {
                    params = [feather.toSnakeCase(), user];
                    sql =
                            "SELECT pk FROM \"$auth\" AS auth " +
                            "  JOIN \"$feather\" AS feather ON feather._pk=auth.object_pk " +
                            "  JOIN role ON role._pk=auth.role_pk " +
                            "  JOIN role_member ON role_member._parent_role_pk=role._pk " +
                            "WHERE feather.id=$1" +
                            "  AND role_member.member=$2" +
                            "  AND %I";
                    sql = sql.format([action.toSnakeCase()]);
                    obj.client.query(sql, params, function (err, resp) {
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
                    sql = "SELECT _pk, tableoid::regclass::text AS \"t\" " +
                            "FROM object WHERE id = $1;";
                    obj.client.query(sql, [id], function (err, resp) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        /* If object found, check authorization */
                        if (resp.rows.length > 0) {
                            table = resp.rows[0].t;
                            pk = resp.rows[0][tools.PKCOL];

                            tokens.push(table);
                            authSql = tools.buildAuthSql(action, table, tokens);
                            sql = "SELECT _pk FROM %I WHERE _pk = $2 " + authSql;
                            sql = sql.format(tokens);

                            obj.client.query(sql, [user, pk], function (err, resp) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                result = resp.rows.length > 0;

                                resolve(result);
                            });
                        }
                    });
                }
            });
        };

        /**
          Set authorazition for a particular authorization role.

          Example:
            {
              id: "ExWIx6'",
              role: "IWi.QWvo",
              isMember: true,
              actions:
                {
                  canCreate: false,
                  canRead: true,
                  canUpdate: false,
                  canDelete: false
                }
            }

          @param {Object} Payload
          @param {Object} [payload.data] Payload data
          @param {String} [payload.data.id] Object id
          @param {String} [payload.daat.role] Role
          @param {Object} [payload.data.actions] Required
          @param {Boolean} [payload.data.actions.canCreate]
          @param {Boolean} [payload.data.actions.canRead]
          @param {Boolean} [payload.data.actions.canUpdate]
          @param {Boolean} [payload.daat.actions.canDelete]
          @return {Object} Promise
        */
        that.saveAuthorization = function (obj) {
            return new Promise(function (resolve, reject) {
                var result, sql, pk, feather, params, objPk, rolePk, err,
                        afterGetObjKey, afterGetRoleKey, afterGetFeatherName,
                        afterGetFeather, checkSuperUser, afterCheckSuperUser,
                        afterQueryAuth, done,
                        id = obj.data.feather
                    ? obj.data.feather.toSnakeCase()
                    : obj.data.id,
                        actions = obj.data.actions || {},
                        isMember = false,
                        hasAuth = false;

                afterGetObjKey = function (resp) {
                    objPk = resp;

                    // Validation
                    if (!objPk) {
                        reject("Object \"" + id + "\" not found");
                        return;
                    }

                    tools.getKey({
                        id: obj.data.role,
                        client: obj.client
                    }).then(afterGetRoleKey).catch(reject);
                };

                afterGetRoleKey = function (resp) {
                    rolePk = resp;

                    // Validation
                    if (!rolePk) {
                        reject("Role \"" + id + "\" not found");
                        return;
                    }

                    if (obj.data.id && obj.data.isMember) {
                        sql = "SELECT tableoid::regclass::text AS feather " +
                                "FROM object WHERE id=$1";
                        obj.client.query(sql, [id], afterGetFeatherName);
                        return;
                    }

                    checkSuperUser();
                };

                afterGetFeatherName = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    feather = resp.rows[0].feather.toCamelCase(true);

                    that.getFeather({
                        client: obj.client,
                        data: {
                            name: feather
                        }
                    }).then(afterGetFeather).catch(reject);
                };

                afterGetFeather = function (resp) {
                    feather = resp;

                    if (tools.isChildFeather(feather)) {
                        err = "Can not set authorization on child feathers.";
                    } else if (!feather.properties.owner) {
                        err = "Feather must have owner property to set authorization";
                    }

                    if (err) {
                        reject(err);
                        return;
                    }

                    checkSuperUser();
                };

                checkSuperUser = function () {
                    tools.isSuperUser({
                        client: obj.client
                    }).then(function (isSuper) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (isSuper) {
                            afterCheckSuperUser();
                            return;
                        }

                        sql = "SELECT owner FROM %I WHERE _pk=$1";
                        sql = sql.format(feather.name.toSnakeCase());

                        obj.client.query(sql, [objPk], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (resp.rows[0].owner !== obj.client.currentUser) {
                                err = "Must be super user or owner of \"" + id + "\" to set " +
                                        "authorization.";
                                reject(err);
                                return;
                            }

                            afterCheckSuperUser();
                        });
                        return;
                    }).catch(reject);
                };

                afterCheckSuperUser = function () {
                    // Determine whether any authorization has been granted
                    hasAuth = actions.canCreate ||
                            actions.canRead ||
                            actions.canUpdate ||
                            actions.canDelete;

                    // Find an existing authorization record
                    sql = "SELECT auth.* FROM \"$auth\" AS auth " +
                            "JOIN object ON object._pk=object_pk " +
                            "JOIN role ON role._pk=role_pk " +
                            "WHERE object.id=$1 AND role.id=$2 AND is_member_auth=$3 ";
                    obj.client.query(sql, [id, obj.data.role, isMember], afterQueryAuth);
                };

                afterQueryAuth = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    result = resp.rows[0] || false;

                    if (result) {
                        pk = result.pk;

                        if (!hasAuth && isMember) {

                            sql = "DELETE FROM \"$auth\" WHERE pk=$1";
                            params = [pk];
                        } else {

                            sql = "UPDATE \"$auth\" SET can_create=$1, can_read=$2," +
                                    "can_update=$3, can_delete=$4 WHERE pk=$5";
                            params = [
                                actions.canCreate === undefined
                                    ? result.can_create
                                    : actions.canCreate,
                                actions.canRead === undefined
                                    ? result.can_read
                                    : actions.canRead,
                                actions.canUpdate === undefined
                                    ? result.can_update
                                    : actions.canUpdate,
                                actions.canDelete === undefined
                                    ? result.can_delete
                                    : actions.canDelete,
                                pk
                            ];
                        }
                    } else if (hasAuth || !isMember) {

                        sql = "INSERT INTO \"$auth\" VALUES (" +
                                "nextval('$auth_pk_seq'), $1, $2," +
                                "$3, $4, $5, $6, $7)";
                        params = [
                            objPk,
                            rolePk,
                            actions.canCreate === undefined
                                ? false
                                : actions.canCreate,
                            actions.canRead === undefined
                                ? false
                                : actions.canRead,
                            actions.canUpdate === undefined
                                ? false
                                : actions.canUpdate,
                            actions.canDelete === undefined
                                ? false
                                : actions.canDelete,
                            isMember
                        ];
                    } else {

                        done(null, false);
                        return;
                    }

                    obj.client.query(sql, params, done);
                };

                done = function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(true);
                };

                // Kick off query by getting object key, the rest falls through callbacks
                tools.getKey({
                    id: id,
                    client: obj.client
                }).then(afterGetObjKey).catch(reject);
            });
        };

        /**
          Create or update a persistence class. This function is idempotent.
          Subsequent saves will automatically drop properties no longer present.

          Example payload:
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
                "type": "date"
              },
              "isMarried": {
                "description": "Marriage status",
                "type": "boolean"
              },
              "dependents": {
                "description": "Number of dependents",
                "type": "number"
              }
            }
          }

         * @param {Object} Payload
         * @param {Object} [payload.client] Database client.
         * @param {Object | Array} [payload.spec] Feather specification(s).
         * @param {String} [payload.spec.name] Name
         * @param {String} [payload.spec.description] Description
         * @param {Object | Boolean} [payload.spec.authorization]
         *  Authorization spec. Defaults to grant all to everyone if undefined. Pass
         *  false to grant no auth.
         * @param {String} [payload.spec.properties] Feather properties
         * @param {String} [payload.spec.properties.description]
         * Description
         * @param {String} [spec.properties.default] Default value
         *  or function name.
         * @param {String | Object} [payload.spec.properties.type]
         *  Type. Standard types are string, boolean, number, date. Object is used
         *  for relation specs.
         * @param {String} [payload.spec.properties.relation] Feather name of
         *  relation.
         * @param {String} [payload.spec.properties.childOf] Property name
         *  on parent relation if one to many relation.
         * @return {Object} Promise
        */
        that.saveFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                var spec, nextSpec, parent,
                        specs = Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs],
                        c = 0,
                        len = specs.length;

                nextSpec = function () {
                    var sqlUpd, token, values, defaultValue, props, keys, recs, type,
                            name, isChild, pk, precision, scale, feather, catalog, autonumber,
                            afterGetFeather, afterGetCatalog, afterUpdateSchema, updateCatalog,
                            afterUpdateCatalog, afterPropagateViews, afterNextVal, createIndex,
                            afterInsertFeather, afterSaveAuthorization, createSequence,
                            table, inherits, authorization, dropSql, createDropSql,
                            changed = false,
                            sql = "",
                            tokens = [],
                            adds = [],
                            args = [],
                            fns = [],
                            cols = [],
                            unique = [],
                            indices = [],
                            i = 0,
                            n = 0,
                            p = 1;

                    createDropSql = function (name) {
                        var statements, buildDeps,
                                feathers = [];
                        buildDeps = function (name) {
                            var dkeys = Object.keys(catalog);

                            feathers.push(name);
                            dkeys.forEach(function (key) {
                                if (key !== name && catalog[key].inherits === name) {
                                    buildDeps(key);
                                }
                            });
                        };

                        buildDeps(name);

                        statements = feathers.map(function (feather) {
                            var stmt = "DROP VIEW IF EXISTS %I CASCADE";
                            return stmt.format(["_" + feather.toSnakeCase()]);
                        });

                        return statements.join(";") + ";";
                    };

                    afterGetFeather = function (resp) {
                        feather = resp;

                        settings.getSettings({
                            client: obj.client,
                            data: {
                                name: "catalog"
                            }
                        }).then(afterGetCatalog).catch(reject);
                    };

                    afterGetCatalog = function (resp) {
                        var err;
                        catalog = resp;

                        dropSql = createDropSql(spec.name);

                        /* Create table if applicable */
                        if (!feather) {
                            sql = "CREATE TABLE %I( " +
                                    "CONSTRAINT %I PRIMARY KEY (_pk), " +
                                    "CONSTRAINT %I UNIQUE (id)) " +
                                    "INHERITS (%I);" +
                                    "CREATE TRIGGER %I AFTER INSERT ON %I " +
                                    "FOR EACH ROW EXECUTE PROCEDURE insert_trigger();" +
                                    "CREATE TRIGGER %I AFTER UPDATE ON %I " +
                                    "FOR EACH ROW EXECUTE PROCEDURE update_trigger();";
                            tokens = tokens.concat([
                                table,
                                table + "_pkey",
                                table + "_id_key",
                                inherits,
                                table + "_insert_trigger",
                                table,
                                table + "_update_trigger",
                                table
                            ]);

                        } else {
                            /* Drop non-inherited columns not included in properties */
                            props = feather.properties;
                            keys = Object.keys(props);
                            keys.forEach(function (key) {
                                if (spec.properties && !spec.properties[key] &&
                                        !(typeof feather.properties[key].type === "object" &&
                                        typeof feather.properties[key].type.parentOf)) {
                                    /* Drop views */
                                    if (!changed) {
                                        sql += dropSql;
                                        changed = true;
                                    }

                                    /* Handle relations */
                                    type = props[key].type;

                                    if (typeof type === "object" && type.properties) {
                                        /* Drop associated view if applicable */
                                        sql += "DROP VIEW %I;";
                                        tokens = tokens.concat([
                                            "_" + table + "_" + key.toSnakeCase(),
                                            table,
                                            tools.relationColumn(key, type.relation)
                                        ]);
                                    } else {
                                        tokens = tokens.concat([table, key.toSnakeCase()]);
                                    }

                                    sql += "ALTER TABLE %I DROP COLUMN %I;";

                                    // Unrelate parent if applicable
                                    if (type.childOf) {
                                        parent = catalog[type.relation];
                                        delete parent.properties[type.childOf];
                                    }

                                    // Parent properties need to be added back into spec so not lost
                                } else if (spec.properties && !spec.properties[key] &&
                                        (typeof feather.properties[key].type === "object" &&
                                        typeof feather.properties[key].type.parentOf)) {
                                    spec.properties[key] = feather.properties[key];
                                }
                            });
                        }

                        // Add table description
                        if (spec.description) {
                            sql += "COMMENT ON TABLE %I IS %L;";
                            tokens = tokens.concat([table, spec.description || ""]);
                        }

                        /* Add columns */
                        spec.properties = spec.properties || {};
                        props = spec.properties;
                        keys = Object.keys(props).filter(function (item) {
                            var prop = props[item];
                            if (prop.autonumber) {
                                autonumber = prop.autonumber;
                                autonumber.key = item;
                            }

                            return !prop.inheritedFrom;
                        });
                        keys.every(function (key) {
                            var vSql,
                                prop = props[key];

                            type = typeof prop.type === "string"
                                ? tools.types[prop.type]
                                : prop.type;

                            if (type && key !== spec.discriminator) {
                                if (!feather || !feather.properties[key]) {

                                    /* Drop views */
                                    if (feather && !changed) {
                                        sql += dropSql;
                                    }

                                    changed = true;
                                    sql += "ALTER TABLE %I ADD COLUMN %I ";

                                    /* Handle composite types */
                                    if (typeof prop.type === "object") {
                                        if (type.relation) {
                                            sql += "integer;";
                                            token = tools.relationColumn(key, type.relation);

                                            /* Update parent class for to-many children */
                                            if (type.childOf) {
                                                parent = catalog[type.relation];
                                                if (!parent.properties[type.childOf]) {
                                                    parent.properties[type.childOf] = {
                                                        description: 'Parent of "' + key + '" on "' +
                                                                spec.name + '"',
                                                        type: {
                                                            relation: spec.name,
                                                            parentOf: key
                                                        }
                                                    };

                                                } else {
                                                    err = 'Property "' + type.childOf +
                                                            '" already exists on "' + type.relation + '"';
                                                }
                                            } else if (type.parentOf) {
                                                err = 'Can not set parent directly for "' + key + '"';
                                            } else if (!type.properties || !type.properties.length) {
                                                err = 'Properties must be defined for relation "' + key + '"';
                                            /* Must be to-one relation.
                                               If relation feather is flagged as child, flag property as child on this feather. */
                                            } else {
                                                parent = catalog[type.relation];
                                                if (parent.isChild) {
                                                    prop.type.isChild = true;
                                                }
                                            }
                                        } else {
                                            err = 'Relation not defined for composite type "' + key + '"';
                                        }

                                        if (err) {
                                            return false;
                                        }

                                        if (type.properties) {
                                            cols = ["%I"];
                                            name = "_" + table + "$" + key.toSnakeCase();
                                            args = [name, "_pk"];

                                            /* Always include "id" whether specified or not */
                                            if (type.properties.indexOf("id") === -1) {
                                                type.properties.unshift("id");
                                            }

                                            i = 0;
                                            while (i < type.properties.length) {
                                                cols.push("%I");
                                                args.push(type.properties[i].toSnakeCase());
                                                i += 1;
                                            }

                                            args.push("_" + type.relation.toSnakeCase());
                                            vSql = "CREATE VIEW %I AS SELECT " + cols.join(",") +
                                                    " FROM %I WHERE NOT is_deleted;";
                                            sql += vSql.format(args);
                                        }

                                        /* Handle standard types */
                                    } else {
                                        if (prop.format) {
                                            if (tools.formats[prop.format]) {
                                                sql += tools.formats[prop.format].type;
                                            } else {
                                                err = 'Invalid format "' + prop.format + '" for property "' +
                                                        key + '" on class "' + spec.name + '"';
                                                return false;
                                            }
                                        } else {
                                            sql += type.type;
                                            if (type.type === "numeric") {
                                                precision = typeof prop.precision === "number"
                                                    ? prop.precision
                                                    : f.PRECISION_DEFAULT;
                                                scale = typeof prop.scale === "number"
                                                    ? prop.scale
                                                    : f.SCALE_DEFAULT;
                                                sql += "(" + precision + "," + scale + ")";
                                            }
                                        }
                                        sql += ";";
                                        token = key.toSnakeCase();
                                    }

                                    adds.push(key);
                                    tokens = tokens.concat([table, token]);

                                    if (prop.isUnique) {
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
                                }
                            } else {
                                err = 'Invalid type "' + prop.type + '" for property "' +
                                        key + '" on class "' + spec.name + '"';
                                return false;
                            }

                            return true;
                        });

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Update schema */
                        sql = sql.format(tokens);
                        obj.client.query(sql, createSequence);
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
                        var sequence = autonumber.sequence;
                        sql = "SELECT relname FROM pg_class " +
                                "JOIN pg_namespace ON relnamespace=pg_namespace.oid " +
                                "WHERE relkind = 'S' AND relname = $1 AND nspname = 'public'";

                        obj.client.query(sql, [sequence], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (!resp.rows.length) {
                                sql = "CREATE SEQUENCE %I;";
                                sql = sql.format([sequence]);
                                obj.client.query(sql, function (err) {
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
                        var afterPopulateDefaults, iterateDefaults;

                        function disableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I DISABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                obj.client.query(sql)
                                    .then(resolve)
                                    .catch(reject);
                            });
                        }

                        function updateTable() {
                            return new Promise(function (resolve, reject) {
                                sql = "UPDATE %I SET " + tokens.join(",") + ";";
                                sql = sql.format(args);
                                obj.client.query(sql, values)
                                    .then(resolve)
                                    .catch(reject);
                            });
                        }

                        function enableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I ENABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                obj.client.query(sql)
                                    .then(resolve)
                                    .catch(reject);
                            });
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        afterPopulateDefaults = function () {
                            // Update function based defaults (one by one)
                            if (fns.length || autonumber) {
                                tokens = [];
                                args = [table];
                                i = 0;

                                fns.forEach(function (fn) {
                                    tokens.push("%I=$" + (i + 2));
                                    args.push(fn.col);
                                    i += 1;
                                });

                                if (autonumber) {
                                    tokens.push("%I='" + (autonumber.prefix || "") +
                                            "' || lpad(nextval('" + autonumber.sequence + "')::text, " +
                                            (autonumber.length || 0) + ", '0') || '" +
                                            (autonumber.suffix || "") + "'");
                                    args.push(autonumber.key);
                                }

                                sql = "SELECT _pk FROM %I ORDER BY _pk OFFSET $1 LIMIT 1;";
                                sql = sql.format([table]);
                                sqlUpd = "UPDATE %I SET " + tokens.join(",") + " WHERE _pk = $1";
                                sqlUpd = sqlUpd.format(args);
                                obj.client.query(sql, [n], iterateDefaults);
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

                                obj.client.query(sqlUpd, values, function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    // Look for next record
                                    obj.client.query(sql, [n], iterateDefaults);
                                });
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
                                var pformat = props[add].format;
                                type = props[add].type;
                                if (typeof type === "object") {
                                    defaultValue = -1;
                                } else {
                                    defaultValue = props[add].default ||
                                            ((pformat && tools.formats[pformat])
                                        ? tools.formats[pformat].default
                                        : false) ||
                                            tools.types[type].default;
                                }
                                if (typeof defaultValue === "string" &&
                                        defaultValue.match(/\(\)$/)) {
                                    fns.push({
                                        col: add.toSnakeCase(),
                                        default: defaultValue.replace(/\(\)$/, "")
                                    });
                                } else {
                                    values.push(defaultValue);
                                    tokens.push("%I=$" + p);
                                    if (typeof type === "object") {
                                        args.push(tools.relationColumn(add, type.relation));
                                    } else {
                                        args.push(add.toSnakeCase());
                                    }
                                    p += 1;
                                }
                            });

                            if (values.length) {
                                Promise.resolve()
                                    .then(disableTriggers)
                                    .then(updateTable)
                                    .then(enableTriggers)
                                    .then(afterPopulateDefaults)
                                    .catch(reject);

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

                            obj.client.query(sql.format(tokens), updateCatalog);
                            return;
                        }
                        updateCatalog();
                    };

                    updateCatalog = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Make sure certain values added automatically persist */
                        if (feather) {
                            Object.keys(spec.properties).forEach(function (p) {
                                var fprops = feather.properties;
                                if (fprops[p]) {
                                    Object.keys(fprops[p]).forEach(function (attr) {
                                        if (attr === "type") {
                                            if (typeof spec.properties[p].type === "object" &&
                                                    spec.properties[p].type.relation === feather.properties[p].type.relation &&
                                                    feather.properties[p].type.isChild) {
                                                spec.properties[p].type.isChild = true;
                                            }
                                        }
                                    });
                                }
                            });
                        }

                        /* Update catalog settings */
                        name = spec.name;
                        catalog[name] = spec;
                        delete spec.name;
                        delete spec.authorization;
                        spec.isChild = spec.isChild || tools.isChildFeather(spec);

                        settings.saveSettings({
                            client: obj.client,
                            data: {
                                name: "catalog",
                                data: catalog
                            }
                        }).then(afterUpdateCatalog).catch(reject);
                    };

                    afterUpdateCatalog = function () {
                        var callback;

                        callback = function (resp) {
                            isChild = tools.isChildFeather(resp);
                            sql = "SELECT nextval('object__pk_seq') AS pk;";
                            obj.client.query(sql, afterNextVal);
                        };

                        if (!feather) {
                            that.getFeather({
                                client: obj.client,
                                callback: callback,
                                data: {
                                    name: name
                                }
                            }).then(callback).catch(reject);
                            return;
                        }

                        afterInsertFeather();
                    };

                    afterNextVal = function (err, resp) {
                        var callback;

                        if (err) {
                            reject(err);
                            return;
                        }

                        pk = resp.rows[0].pk;

                        callback = function (err, resp) {
                            var key;

                            if (err) {
                                reject(err);
                                return;
                            }

                            key = resp;

                            sql = "INSERT INTO \"$feather\" " +
                                    "(_pk, id, created, created_by, updated, updated_by, " +
                                    "is_deleted, is_child, parent_pk) VALUES " +
                                    "($1, $2, now(), $3, now(), $4, false, $5, $6);";
                            values = [pk, table, obj.client.currentUser,
                                    obj.client.currentUser, isChild,
                                    key];
                            obj.client.query(sql, values, afterInsertFeather);
                        };

                        if (isChild) {
                            getParentKey({
                                parent: parent,
                                child: name,
                                client: obj.client
                            }).then(callback).catch(reject);
                            return;
                        }

                        callback(null, pk);
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
                                name: name,
                                client: obj.client,
                                callback: afterPropagateViews
                            });
                            return;
                        }

                        afterPropagateViews();
                    };

                    afterPropagateViews = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        // If no specific authorization, make one
                        if (authorization === undefined) {
                            authorization = {
                                data: {
                                    feather: name,
                                    role: "everyone",
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

                        /* Set authorization */
                        if (authorization) {
                            that.saveAuthorization(authorization)
                                .then(afterSaveAuthorization)
                                .catch(reject);
                            return;
                        }

                        afterSaveAuthorization();
                    };

                    afterSaveAuthorization = function () {
                        if (c < len) {
                            nextSpec();
                            return;
                        }

                        resolve(true);
                    };

                    // Real work starts here
                    spec = specs[c];
                    c += 1;
                    table = spec.name
                        ? spec.name.toSnakeCase()
                        : false;
                    inherits = (spec.inherits || "Object");
                    inherits = inherits.toSnakeCase();
                    authorization = spec.authorization;

                    if (!table) {
                        reject("No name defined");
                        return;
                    }

                    that.getFeather({
                        client: obj.client,
                        data: {
                            name: spec.name,
                            includeInherited: false
                        }
                    }).then(afterGetFeather).catch(reject);
                };

                // Real work starts here
                nextSpec();
            });
        };


        return that;
    };

}(exports));