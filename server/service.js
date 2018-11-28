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
        Tools
    } = require("./services/tools");
    const {
        Settings
    } = require("./services/settings");
    const {
        CRUD
    } = require("./services/crud");

    var that,
        f = require("../common/core"),
        jsonpatch = require("fast-json-patch"),
        format = require("pg-format"),
        events = new Events(),
        tools = new Tools(),
        settings = new Settings(),
        crud = new CRUD(),
        buildAuthSql = tools.buildAuthSql,
        processSort = tools.processSort,
        sanitize = tools.sanitize,
        PKCOL = tools.PKCOL,
        types = {
            object: {
                type: "json",
                default: null
            },
            array: {
                type: "json",
                default: []
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
        },
        formats = {
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
            tel: {
                type: "text",
                default: ""
            },
            email: {
                type: "text",
                default: ""
            },
            password: {
                type: "text",
                default: ""
            },
            url: {
                type: "text",
                default: ""
            },
            enum: {
                type: "text",
                default: ""
            },
            textArea: {
                type: "text",
                default: ""
            },
            color: {
                type: "text",
                default: "#000000"
            },
            money: {
                type: "mono",
                default: null
            },
            lock: {
                type: "lock",
                default: null
            }
        };

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

        afterGetFeather = function (err, resp) {
            if (err) {
                obj.callback(err);
                return;
            }

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
            callback: afterGetFeather,
            data: {
                name: obj.name
            }
        });
    }

    function curry(...args1) {
        var fn = args1[0],
            args = args1[1],
            ary = [];

        return function () {
            return fn.apply(this, args.concat(ary.slice.call(args1)));
        };
    }

    function getParentKey(obj) {
        var cParent, afterGetChildFeather, afterGetParentFeather, done;

        afterGetChildFeather = function (err, resp) {
            var cKeys, cProps;

            if (err) {
                obj.callback(err);
                return;
            }

            cProps = resp.properties;
            cKeys = Object.keys(cProps);
            cKeys.every(function (cKey) {
                if (typeof cProps[cKey].type === "object" &&
                        cProps[cKey].type.childOf) {
                    cParent = cProps[cKey].type.relation;

                    that.getFeather({
                        client: obj.client,
                        callback: afterGetParentFeather,
                        data: {
                            name: obj.parent
                        }
                    });

                    return false;
                }

                return true;
            });
        };

        afterGetParentFeather = function (err, resp) {
            if (err) {
                obj.callback(err);
                return;
            }

            if (resp.isChildFeather) {
                getParentKey({
                    child: cParent,
                    parent: obj.parent,
                    client: obj.client,
                    callback: obj.callback
                });
                return;
            }

            tools.getKey({
                name: cParent.toSnakeCase(),
                client: obj.client
            }).then(done).catch(obj.callback);
        };

        done = function (err, resp) {
            if (err) {
                obj.callback(err);
                return;
            }

            obj.callback(null, resp);
        };

        that.getFeather({
            client: obj.client,
            callback: afterGetChildFeather,
            data: {
                name: obj.child
            }
        });
    }

    function isChildFeather(feather) {
        var props = feather.properties;

        return Object.keys(props).some(function (key) {
            return !!props[key].type.childOf;
        });
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

    function relationColumn(key, relation) {
        return "_" + key.toSnakeCase() + "_" + relation.toSnakeCase() + "_pk";
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
            @param {Object | Array} [payload.data.name] Name(s) of feather(s) to delete
            @param {Object} [payload.client] Database client
            @param {Function} [payload.callback] Callback
            @return {Boolean}
        */
        deleteFeather: function (obj) {
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
                    obj.callback(err);
                    return;
                }

                // Drop table(s)
                sql = "DROP VIEW %I; DROP TABLE %I;" + sql;
                sql = sql.format(["_" + table, table]);
                obj.client.query(sql, function (err) {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    sql = "DELETE FROM \"$auth\" WHERE object_pk=" +
                            "(SELECT _pk FROM \"$feather\" WHERE id=$1);";
                    obj.client.query(sql, [table], function (err) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        sql = "DELETE FROM \"$feather\" WHERE id=$1;";
                        obj.client.query(sql, [table], function (err) {
                            if (err) {
                                obj.callback(err);
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
                        obj.callback("Feather not found");
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
                    }).then(createViews).catch(obj.callback);
                    return;
                }

                // All done
                obj.callback(null, true);
            };

            settings.getSettings({
                client: obj.client,
                data: {
                    name: "catalog"
                }
            }).then(afterGetCatalog).catch(obj.callback);

            return this;
        },

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
        Perform soft delete on object records.

        @param {Object} Request payload
        @param {Object} [payload.id] Id of record to delete
        @param {Object} [payload.client] Database client
        @param {Function} [payload.callback] callback
        @param {Function} [payload.isHard] Hard delete flag. Default false.
        @param {Boolean} Request as child. Default false.
        @param {Boolean} Request as super user. Default false.
        @return receiver
        */
        doDelete: function (obj, isChild, isSuperUser) {
            var oldRec, keys, props, noChildProps, afterGetFeather,
                    afterAuthorization, afterDoSelect, afterDelete, afterLog,
                    sql = "UPDATE object SET is_deleted = true WHERE id=$1;",
                    clen = 1,
                    c = 0;

            if (obj.isHard === true) {
                sql = "DELETE FROM object WHERE id=$1;";
            }

            noChildProps = function (key) {
                if (typeof props[key].type !== "object" ||
                        !props[key].type.childOf) {
                    return true;
                }
            };

            afterGetFeather = function (err, feather) {
                try {
                    if (err) {
                        throw err;
                    }

                    props = feather.properties;

                    if (!isChild && feather.isChild) {
                        throw "Can not directly delete a child class";
                    }

                    if (isSuperUser === false) {
                        that.isAuthorized({
                            client: obj.client,
                            callback: afterAuthorization,
                            data: {
                                id: obj.id,
                                action: "canDelete"
                            }
                        });
                        return;
                    }

                    afterAuthorization(null, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorization = function (err, authorized) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!authorized) {
                        throw "Not authorized to delete \"" + obj.id + "\"";
                    }

                    // Get old record, bail if it doesn't exist
                    // Exclude childOf relations when we select
                    that.doSelect({
                        name: obj.name,
                        id: obj.id,
                        showDeleted: true,
                        properties: Object.keys(props).filter(noChildProps),
                        client: obj.client,
                        callback: afterDoSelect
                    }, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterDoSelect = function (err, resp) {
                var sessionId = "_sessionid"; // JSLint doesn't like underscore

                try {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    oldRec = resp;

                    if (!oldRec) {
                        throw "Record " + obj.id + " not found.";
                    }

                    if (oldRec.isDeleted) {
                        throw "Record " + obj.id + " already deleted.";
                    }

                    if (oldRec && oldRec.lock &&
                            oldRec.lock[sessionId] !== obj.sessionid) {
                        throw "Record is locked by " + oldRec.lock.username + " and cannot be updated.";
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    keys = Object.keys(props).filter(function (key) {
                        if (typeof props[key].type === "object" &&
                                props[key].type.parentOf) {
                            clen += oldRec[key].length;
                            return true;
                        }
                    });

                    // Delete children recursively
                    keys.forEach(function (key) {
                        var rel = props[key].type.relation;
                        oldRec[key].forEach(function (row) {
                            that.doDelete({
                                name: rel,
                                id: row.id,
                                client: obj.client,
                                callback: afterDelete,
                                isHard: obj.isHard
                            }, true);
                        });
                    });

                    // Finally, delete parent object
                    obj.client.query(sql, [obj.id], afterDelete);
                } catch (e) {
                    obj.callback(e);
                }
            };

            // Handle change log
            afterDelete = function (err) {
                try {
                    var now = f.now();

                    if (err) {
                        throw err;
                    }

                    // Move on only after all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    if (isChild || obj.isHard) {
                        afterLog();
                        return;
                    }

                    // Log the completed deletion
                    that.doInsert({
                        name: "Log",
                        data: {
                            objectId: obj.id,
                            action: "DELETE",
                            created: now,
                            createdBy: now,
                            updated: now,
                            updatedBy: now
                        },
                        client: obj.client,
                        callback: afterLog
                    }, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterLog = function (err) {
                obj.callback(err, true);
            };

            // Kick off query by getting feather, the rest falls through callbacks
            that.getFeather({
                client: obj.client,
                callback: afterGetFeather,
                data: {
                    name: obj.name
                }
            });
        },

        /**
          Insert records for a passed object.

          @param {Object} Request payload
          @param {Object} [payload.name] Object type name
          @param {Object} [payload.data] Data to insert
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @param {Boolean} Request as child. Default false.
          @param {Boolean} Request as super user. Default false.
          @return receiver
        */
        doInsert: function (obj, isChild, isSuperUser) {
            var sql, col, key, child, pk, n, dkeys, fkeys, len, msg, props, prop,
                    value, result, afterGetFeather, afterIdCheck, afterNextVal,
                    afterAuthorized, buildInsert, afterGetPk, afterHandleRelations,
                    insertChildren, afterInsert, afterDoSelect, afterLog,
                    afterUniqueCheck, feather, payload,
                    data = f.copy(obj.data),
                    name = obj.name || "",
                    args = [name.toSnakeCase()],
                    tokens = [],
                    params = [],
                    values = [],
                    unique = false,
                    clen = 1,
                    c = 0,
                    p = 2;

            payload = {
                data: {
                    name: obj.name
                },
                client: obj.client
            };

            afterGetFeather = function (err, resp) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!resp) {
                        throw "Class \"" + name + "\" not found";
                    }

                    feather = resp;
                    props = feather.properties;
                    fkeys = Object.keys(props);
                    dkeys = Object.keys(data);

                    /* Validate properties are valid */
                    len = dkeys.length;
                    for (n = 0; n < len; n += 1) {
                        if (fkeys.indexOf(dkeys[n]) === -1) {
                            throw "Feather \"" + name +
                                    "\" does not contain property \"" + dkeys[n] + "\"";
                        }
                    }

                    /* Check id for existence and uniqueness and regenerate if needed */
                    if (!data.id) {
                        afterIdCheck(null, -1);
                        return;
                    }

                    tools.getKey({
                        id: data.id,
                        client: obj.client
                    }, true).then(afterIdCheck).catch(obj.callback);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterIdCheck = function (id) {
                try {
                    if (id !== undefined) {
                        data.id = f.createId();
                    }

                    Object.keys(feather.properties).some(function (key) {
                        if (feather.properties[key].isUnique && !feather.properties[key].autonumber) {
                            unique = {
                                feather: feather.properties[key].inheritedFrom || feather.name,
                                prop: key,
                                value: obj.data[key],
                                label: feather.properties[key].alias || key
                            };

                            return true;
                        }

                        return false;
                    });

                    if (unique) {
                        tools.getKeys({
                            client: obj.client,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(obj.callback);
                        return;
                    }

                    afterUniqueCheck();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterUniqueCheck = function (resp) {
                try {
                    if (resp && resp.length) {
                        throw "Value '" + unique.value + "' assigned to " +
                                unique.label.toName() + " on " +
                                feather.name.toName() + " is not unique to data type " +
                                unique.feather.toName() + ".";
                    }

                    if (!isChild && isSuperUser === false) {
                        that.isAuthorized({
                            client: obj.client,
                            callback: afterAuthorized,
                            data: {
                                feather: name,
                                action: "canCreate"
                            }
                        });
                        return;
                    }

                    afterAuthorized(null, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorized = function (err, authorized) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!authorized) {
                        msg = "Not authorized to create \"" + obj.name + "\"";
                        throw {
                            statusCode: 401,
                            message: msg
                        };
                    }

                    // Set some system controlled values
                    data.updated = f.now();
                    data.created = data.updated;
                    data.createdBy = obj.client.currentUser;
                    data.updatedBy = obj.client.currentUser;
                    data.isDeleted = false;
                    data.lock = null;

                    // Get primary key
                    sql = "select nextval('object__pk_seq')";
                    obj.client.query(sql, afterNextVal);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterNextVal = function (err, resp) {
                try {
                    if (err) {
                        throw err;
                    }

                    pk = resp.rows[0].nextval;
                    values.push(pk);

                    /* Build values */
                    len = fkeys.length;
                    n = 0;
                    buildInsert();
                } catch (e) {
                    obj.callback(e);
                }
            };

            buildInsert = function () {
                var callback;

                if (n < len) {
                    key = fkeys[n];
                    child = false;
                    prop = props[key];
                    n += 1;

                    /* Handle relations */
                    if (typeof prop.type === "object") {
                        if (prop.type.parentOf) {
                            /* To many */
                            child = true;

                            /* To one */
                        } else {
                            col = relationColumn(key, prop.type.relation);
                            if (data[key] === null || data[key] === undefined) {
                                if (prop.default !== undefined && prop.default !== null) {
                                    data[key] = prop.default;
                                } else if (prop.isRequired !== true) {
                                    value = -1;
                                } else {
                                    throw "Property " + key + " is required on " + feather.name + ".";
                                }
                            }
                            if (value !== -1) {
                                if (prop.type.isChild) {
                                    /* Insert child relation on the fly */
                                    that.doInsert({
                                        name: prop.type.relation,
                                        data: data[key],
                                        client: obj.client,
                                        callback: function (err) {
                                            if (err) {
                                                obj.callback(err);
                                                return;
                                            }

                                            tools.getKey({
                                                id: data[key].id,
                                                client: obj.client
                                            }).then(afterGetPk).catch(obj.callback);
                                        }
                                    }, true, true);
                                    return;
                                }

                                /* Relation must already exist */
                                tools.getKey({
                                    id: data[key].id,
                                    client: obj.client
                                }).then(afterGetPk).catch(obj.callback);
                                return;
                            }
                        }

                        /* Handle discriminator */
                    } else if (key === "objectType") {
                        child = true;

                        /* Handle regular types */
                    } else {
                        value = data[key];
                        col = key.toSnakeCase();

                        // Handle objects whose values are actually strings
                        if (prop.type === "object" && typeof value === "string" &&
                                value.slice(0, 1) !== "[") {
                            value = '"' + value + '"';
                        }

                        // Handle autonumber
                        if (prop.autonumber && (value === undefined || prop.isReadOnly)) {
                            callback = function (err, resp) {
                                var lpad = function (str, length) {
                                    str += "";
                                    length = length || 0;
                                    while (str.length < length) {
                                        str = "0" + str;
                                    }
                                    return str;
                                };
                                if (err) {
                                    obj.callback(err);
                                    return;
                                }

                                value = prop.autonumber.prefix || "";
                                value += lpad(resp.rows[0].seq, prop.autonumber.length);
                                value += prop.autonumber.suffix || "";
                                afterHandleRelations();
                            };

                            obj.client.query("SELECT nextval($1) AS seq", [prop.autonumber.sequence], callback);
                            return;
                        }

                        // Handle other types of defaults
                        if (value === undefined) {
                            if (prop.default !== undefined && prop.default !== null) {
                                value = prop.default;
                            } else if (prop.format &&
                                    formats[prop.format] &&
                                    formats[prop.format].default !== undefined) {
                                value = formats[prop.format].default;
                            } else {
                                value = types[prop.type].default;
                            }

                            // If we have a class specific default that calls a function
                            if (value && typeof value === "string" && value.match(/\(\)$/)) {
                                value = f[value.replace(/\(\)$/, "")]();
                            }
                        }
                    }

                    /* Handle non-relational composites */
                    if (prop.type === "object" &&
                            prop.format) {

                        if (prop.isRequired && value === null) {
                            throw "\"" + key + "\" is required on " + feather.name + ".";
                        }
                        Object.keys(value || {}).forEach(function (attr) {
                            args.push(col);
                            args.push(attr);
                            tokens.push("%I.%I");
                            values.push(value[attr]);
                            params.push("$" + p);
                            p += 1;
                        });
                        buildInsert();
                        return;
                    }

                    afterHandleRelations();
                    return;
                }

                sql = ("INSERT INTO %I (_pk, " + tokens.toString(",") +
                        ") VALUES ($1," + params.toString(",") + ");");
                sql = sql.format(args);

                // Perform the insert
                obj.client.query(sql, values, insertChildren);
            };

            afterGetPk = function (id) {
                try {
                    value = id;

                    if (value === undefined) {
                        throw 'Relation not found in "' + prop.type.relation +
                                '" for "' + key + '" with id "' + data[key].id + '"';
                    }

                    if (!isChild && prop.type.childOf) {
                        throw "Child records may only be created from the parent.";
                    }

                    afterHandleRelations();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterHandleRelations = function () {
                if (!child) {
                    if (prop.isRequired && value === null) {
                        throw "\"" + key + "\" is required on " + feather.name + ".";
                    }
                    args.push(col);
                    tokens.push("%I");
                    values.push(value);
                    params.push("$" + p);
                    p += 1;
                }

                buildInsert();
            };

            insertChildren = function (err) {
                var ckeys;
                try {
                    if (err) {
                        throw err;
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    ckeys = Object.keys(props).filter(function (key) {
                        if (typeof props[key].type === "object" &&
                                props[key].type.parentOf &&
                                data[key] !== undefined) {
                            clen += data[key].length;
                            return true;
                        }
                    });

                    // Insert children recursively
                    ckeys.forEach(function (key) {
                        var rel = props[key].type.relation;
                        data[key].forEach(function (row) {
                            row[props[key].type.parentOf] = {
                                id: data.id
                            };
                            that.doInsert({
                                name: rel,
                                data: row,
                                client: obj.client,
                                callback: afterInsert
                            }, true);
                        });
                    });

                    afterInsert();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterInsert = function (err) {
                try {
                    if (err) {
                        throw err;
                    }

                    // Done only when all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    // We're done here if child
                    if (isChild) {
                        obj.callback(null, result);
                        return;
                    }

                    // Otherwise we'll move on to log the change
                    that.doSelect({
                        name: obj.name,
                        id: data.id,
                        client: obj.client,
                        callback: afterDoSelect
                    });
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterDoSelect = function (err, resp) {
                try {
                    if (err) {
                        throw err;
                    }

                    result = resp;

                    /* Handle change log */
                    that.doInsert({
                        name: "Log",
                        data: {
                            objectId: data.id,
                            action: "POST",
                            created: data.created,
                            createdBy: data.createdBy,
                            updated: data.updated,
                            updatedBy: data.updatedBy,
                            change: f.copy(result)
                        },
                        client: obj.client,
                        callback: afterLog
                    }, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterLog = function (err) {
                try {
                    if (err) {
                        throw err;
                    }

                    // We're going to return the changes
                    result = jsonpatch.compare(obj.cache, result);

                    // Report back result
                    obj.callback(null, result);
                } catch (e) {
                    obj.callback(e);
                }
            };

            // Kick off query by getting feather, the rest falls through callbacks
            payload.callback = afterGetFeather;
            that.getFeather(payload);
        },

        /**
          Select records for an object or array of objects.

          @param {Object} Request payload
          @param {Object} [payload.id] Id of record to select
          @param {Object} [payload.name] Name of feather
          @param {Object} [payload.filter] Filter criteria of records to select
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @param {Boolean} [payload.showDeleted] include deleted records
          @param {Object} [payload.subscription] subscribe to events on returned rows
          @param {Boolean} [payload.sanitize] sanitize result. Default true
          @param {Boolean} Request as child. Default false.
          @param {Boolean} Request as super user. Default false.
          @return receiver
        */
        doSelect: function (obj, isChild, isSuperUser) {
            var sql, table, keys, payload,
                    afterGetFeather, afterGetKey, afterGetKeys, mapKeys,
                    tokens = [],
                    cols = [];

            payload = {
                name: obj.name,
                client: obj.client,
                showDeleted: obj.showDeleted
            };

            afterGetFeather = function (err, feather) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!feather.name) {
                        throw "Feather \"" + obj.name + "\" not found.";
                    }

                    table = "_" + feather.name.toSnakeCase();
                    keys = obj.properties || Object.keys(feather.properties);

                    /* Validate */
                    if (!isChild && feather.isChild && !isSuperUser) {
                        throw "Can not query directly on a child class";
                    }

                    keys.forEach(function (key) {
                        tokens.push("%I");
                        cols.push(key.toSnakeCase());
                    });

                    cols.push(table);
                    sql = ("SELECT to_json((" + tokens.toString(",") +
                            ")) AS result FROM %I");
                    sql = sql.format(cols);

                    /* Get one result by key */
                    if (obj.id) {
                        payload.id = obj.id;
                        tools.getKey(payload, isSuperUser)
                            .then(afterGetKey).catch(obj.callback);

                        /* Get a filtered result */
                    } else {
                        payload.filter = obj.filter;
                        tools.getKeys(payload, isSuperUser)
                            .then(afterGetKeys).catch(obj.callback);
                    }
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterGetKey = function (key) {
                try {
                    if (key === undefined) {
                        obj.callback(null, undefined);
                        return;
                    }

                    sql += " WHERE _pk = $1";

                    obj.client.query(sql, [key], function (err, resp) {
                        var result;

                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        result = mapKeys(resp.rows[0]);
                        if (obj.sanitize !== false) {
                            result = sanitize(result);
                        }

                        obj.callback(null, result);
                    });
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterGetKeys = function (keys) {
                try {
                    var result, feathername,
                            sort = obj.filter
                        ? obj.filter.sort || []
                        : [],
                            subscription = obj.subscription || {},
                            i = 0;

                    if (keys.length) {
                        tokens = [];

                        while (keys[i]) {
                            i += 1;
                            tokens.push("$" + i);
                        }

                        sql += " WHERE _pk IN (" + tokens.toString(",") + ")";

                        tokens = [];
                        sql += processSort(sort, tokens);
                        sql = sql.format(tokens);

                        obj.client.query(sql, keys, function (err, resp) {
                            if (err) {
                                obj.callback(err);
                                return;
                            }

                            result = sanitize(resp.rows.map(mapKeys));

                            function ids(item) {
                                return item.id;
                            }

                            if (!obj.filter || (!obj.filter.criteria && !obj.filter.limit)) {
                                feathername = obj.name;
                            }

                            // Handle subscription
                            events.subscribe(obj.client, obj.subscription, result.map(ids),
                                    feathername)
                                .then(function () {
                                    obj.callback(null, result);
                                })
                                .catch(obj.callback);
                        });
                    } else {
                        // Handle subscription
                        events.unsubscribe(obj.client, subscription.id)
                            .then(function () {
                                obj.callback(null, []);
                            })
                            .catch(obj.callback);
                    }
                } catch (e) {
                    obj.callback(e);
                }
            };

            mapKeys = function (row) {
                var rkeys,
                    result = row.result,
                    ret = {},
                    i = 0;

                if (typeof result === "object") {
                    rkeys = Object.keys(result);
                    rkeys.forEach(function (key) {
                        ret[keys[i]] = result[key];
                        i += 1;
                    });

                    // If only one attribute returned
                } else {
                    ret[keys[0]] = result;
                }

                return ret;
            };

            // Kick off query by getting feather, the rest falls through callbacks
            that.getFeather({
                client: obj.client,
                callback: afterGetFeather,
                data: {
                    name: obj.name
                }
            });

            return this;
        },

        /**
          Update records based on patch definition.

          @param {Object} Request payload
          @param {Object} [payload.id] Id of record to update
          @param {Object} [payload.data] Patch to apply
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @param {Boolean} Request as super user. Default false.
          @return receiver
        */
        doUpdate: function (obj, isChild, isSuperUser) {
            var result, updRec, props, value, sql, pk, relation, key, keys,
                    oldRec, newRec, cpatches, feather, tokens, find, noChildProps,
                    afterGetFeather, afterGetKey, afterAuthorization, afterDoSelect,
                    afterUpdate, afterSelectUpdated, done, nextProp, afterProperties,
                    afterUniqueCheck, unique, doUnlock,
                    afterGetRelKey, cacheRec,
                    patches = obj.data || [],
                    id = obj.id,
                    doList = [],
                    params = [],
                    ary = [],
                    clen = 0,
                    c = 0,
                    p = 1,
                    n = 0;

            if (!patches.length) {
                obj.callback(null, []);
                return;
            }

            find = function (ary, id) {
                return ary.filter(function (item) {
                    return item && item.id === id;
                })[0] || false;
            };

            noChildProps = function (key) {
                if (typeof feather.properties[key].type !== "object" ||
                        !feather.properties[key].type.childOf) {
                    return true;
                }
            };

            afterGetFeather = function (err, resp) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!resp) {
                        throw "Feather \"" + obj.name + "\" not found.";
                    }

                    feather = resp;
                    tokens = [feather.name.toSnakeCase()];
                    props = feather.properties;

                    /* Validate */
                    if (!isChild && feather.isChild) {
                        throw "Can not directly update a child class";
                    }

                    if (isSuperUser === false) {
                        that.isAuthorized({
                            client: obj.client,
                            callback: afterAuthorization,
                            data: {
                                id: id,
                                action: "canUpdate"
                            }
                        });
                        return;
                    }

                    afterAuthorization(null, true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorization = function (err, authorized) {
                try {
                    if (err) {
                        throw err;
                    }

                    if (!authorized) {
                        throw "Not authorized to update \"" + id + "\"";
                    }

                    tools.getKey({
                        id: id,
                        client: obj.client
                    }).then(afterGetKey).catch(obj.callback);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterGetKey = function (resp) {
                try {
                    pk = resp;
                    keys = Object.keys(props);

                    // Get existing record
                    that.doSelect({
                        name: obj.name,
                        id: obj.id,
                        properties: keys.filter(noChildProps),
                        client: obj.client,
                        callback: afterDoSelect,
                        sanitize: false
                    }, isChild);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterDoSelect = function (err, resp) {
                var sessionId = "_sessionid"; // JSLint doesn't like underscore

                function requiredIsNull(fkey) {
                    if (props[fkey].isRequired && updRec[fkey] === null) {
                        key = fkey;
                        return true;
                    }
                }

                function uniqueChanged(fkey) {
                    if (props[fkey].isUnique &&
                            updRec[fkey] !== oldRec[fkey]) {

                        unique = {
                            feather: props[fkey].inheritedFrom || feather.name,
                            prop: fkey,
                            value: updRec[fkey],
                            label: props[fkey].alias || fkey
                        };

                        return true;
                    }
                }

                try {
                    if (err) {
                        throw err;
                    }

                    if (oldRec && oldRec.lock &&
                            oldRec.lock[sessionId] !== obj.sessionid) {
                        throw "Record is locked by " + oldRec.lock.username + " and cannot be updated.";
                    }

                    oldRec = sanitize(resp);

                    if (!Object.keys(oldRec).length || oldRec.isDeleted) {
                        obj.callback(null, false);
                        return;
                    }

                    newRec = f.copy(oldRec);
                    jsonpatch.apply(newRec, patches);

                    // Capture changes from original request
                    if (obj.cache) {
                        cacheRec = f.copy(oldRec);
                        jsonpatch.apply(cacheRec, obj.cache);
                    }

                    if (!patches.length) {
                        afterUpdate();
                        return;
                    }

                    updRec = f.copy(newRec);

                    // Revert data that may not be updated directly
                    updRec.created = oldRec.created;
                    updRec.createdBy = oldRec.createdBy;
                    updRec.updated = new Date().toJSON();
                    updRec.updatedBy = obj.client.currentUser;
                    updRec.isDeleted = false;
                    updRec.lock = oldRec.lock;

                    if (props.etag) {
                        updRec.etag = f.createId();
                    }

                    // Check required properties
                    if (keys.some(requiredIsNull)) {
                        throw "\"" + key + "\" is required.";
                    }

                    // Check unique properties
                    if (keys.some(uniqueChanged)) {
                        tools.getKeys({
                            client: obj.client,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(obj.callback);
                        return;
                    }

                    // Process properties
                    nextProp();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterUniqueCheck = function (resp) {
                try {
                    if (resp && resp.length) {
                        throw "Value '" + unique.value + "' assigned to " +
                                unique.label.toName() + " on " +
                                feather.name.toName() + " is not unique to data type " +
                                unique.feather.toName() + ".";
                    }

                    nextProp();
                } catch (e) {
                    obj.callback(e);
                }
            };

            nextProp = function () {
                var updProp, oldProp;

                try {
                    key = keys[n];
                    n += 1;

                    if (n <= keys.length) {
                        /* Handle composite types */
                        if (typeof props[key].type === "object") {
                            updProp = updRec[key] || {};
                            oldProp = oldRec[key] || {};

                            /* Handle child records */
                            if (Array.isArray(updRec[key])) {
                                relation = props[key].type.relation;

                                /* Process deletes */
                                oldRec[key].forEach(function (row) {
                                    var cid = row.id;

                                    if (!find(updRec[key], cid)) {
                                        clen += 1;
                                        doList.push({
                                            func: that.doDelete,
                                            payload: {
                                                name: relation,
                                                id: cid,
                                                client: obj.client,
                                                callback: afterUpdate
                                            }
                                        });
                                    }
                                });

                                /* Process inserts and updates */
                                updRec[key].forEach(function (cNewRec) {
                                    if (!cNewRec) {
                                        return;
                                    }

                                    var cid = cNewRec.id || null,
                                        cOldRec = find(oldRec[key], cid);

                                    if (cOldRec) {
                                        cpatches = jsonpatch.compare(cOldRec, cNewRec);

                                        if (cpatches.length) {
                                            clen += 1;
                                            doList.push({
                                                func: that.doUpdate,
                                                payload: {
                                                    name: relation,
                                                    id: cid,
                                                    data: cpatches,
                                                    client: obj.client,
                                                    callback: afterUpdate
                                                }
                                            });
                                        }
                                    } else {
                                        cNewRec[props[key].type.parentOf] = {
                                            id: updRec.id
                                        };
                                        clen += 1;
                                        doList.push({
                                            func: that.doInsert,
                                            payload: {
                                                name: relation,
                                                data: cNewRec,
                                                client: obj.client,
                                                callback: afterUpdate
                                            }
                                        });
                                    }
                                });

                            /* Handle child relation updates */
                            } else if (props[key].type.isChild) {
                                /* Do delete */
                                if (oldRec[key] && !updRec[key]) {
                                    that.doDelete({
                                        name: props[key].type.relation,
                                        id: oldRec[key].id,
                                        client: obj.client,
                                        isHard: true,
                                        callback: function (err) {
                                            if (err) {
                                                obj.callback(err);
                                                return;
                                            }

                                            afterGetRelKey(null, -1);
                                        }
                                    }, true, true);

                                    return;
                                }

                                /* Do insert */
                                if (updRec[key] && !oldRec[key]) {
                                    that.doInsert({
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: updRec[key],
                                        client: obj.client,
                                        callback: function (err) {
                                            if (err) {
                                                obj.callback(err);
                                                return;
                                            }

                                            tools.getKey({
                                                id: updRec[key].id,
                                                client: obj.client
                                            }).then(afterGetRelKey).catch(obj.callback);
                                        }
                                    }, true, true);

                                    return;
                                }

                                if (updRec[key] && oldRec[key] && updRec[key].id !== oldRec[key].id) {
                                    throw "Id cannot be changed on child relation '" + key + "'";
                                }

                                /* Do update */
                                cpatches = jsonpatch.compare(oldRec[key] || {}, updRec[key] || {});

                                if (cpatches.length) {
                                    that.doUpdate({
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: cpatches,
                                        client: obj.client,
                                        callback: function (err) {
                                            if (err) {
                                                obj.callback(err);
                                                return;
                                            }

                                            tools.getKey({
                                                id: updRec[key].id,
                                                client: obj.client
                                            }).then(afterGetRelKey).catch(obj.callback);
                                        }
                                    }, true, true);
                                    return;
                                }

                                nextProp();
                                return;
                            }

                            /* Handle regular to one relations */
                            if (!props[key].type.childOf &&
                                    updProp.id !== oldProp.id) {

                                if (updProp.id) {
                                    tools.getKey({
                                        id: updRec[key].id,
                                        client: obj.client
                                    }).then(afterGetRelKey).catch(obj.callback);
                                } else {
                                    afterGetRelKey(null, -1);
                                }
                                return;
                            }

                            /* Handle non-relational composites */
                        } else if (updRec[key] !== oldRec[key] &&
                                props[key].type === "object" &&
                                props[key].format) {

                            Object.keys(updRec[key]).forEach(function (attr) {
                                tokens.push(key.toSnakeCase());
                                tokens.push(attr.toSnakeCase());
                                ary.push("%I.%I = $" + p);
                                params.push(updRec[key][attr]);
                                p += 1;
                            });

                            /* Handle regular data types */
                        } else if (updRec[key] !== oldRec[key] && key !== "objectType") {

                            // Handle objects whose values are actually strings
                            if (props[key].type === "object" &&
                                    typeof updRec[key] === "string" &&
                                    updRec[key].slice(0, 1) !== "[") {
                                updRec[key] = '"' + value + '"';
                            }

                            tokens.push(key.toSnakeCase());
                            ary.push("%I = $" + p);
                            params.push(updRec[key]);
                            p += 1;
                        }

                        nextProp();
                        return;
                    }

                    // Done, move on
                    afterProperties();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterGetRelKey = function (resp) {
                try {
                    value = resp;
                    relation = props[key].type.relation;

                    if (value === undefined) {
                        throw "Relation not found in \"" + relation +
                                "\" for \"" + key + "\" with id \"" + updRec[key].id + "\"";
                    }

                    tokens.push(relationColumn(key, relation));
                    ary.push("%I = $" + p);
                    params.push(value);
                    p += 1;

                    nextProp();
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterProperties = function () {
                try {
                    // Execute top level object change
                    sql = ("UPDATE %I SET " + ary.join(",") + " WHERE _pk = $" + p);
                    sql = sql.format(tokens);
                    params.push(pk);
                    clen += 1;

                    obj.client.query(sql, params, afterUpdate);

                    // Execute child changes
                    doList.forEach(function (item) {
                        item.func(item.payload, true);
                    });
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterUpdate = function (err) {
                try {
                    if (err) {
                        throw err;
                    }

                    // Don't proceed until all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    // If child, we're done here
                    if (isChild) {
                        obj.callback();
                        return;
                    }

                    // If a top level record, return patch of what changed
                    that.doSelect({
                        name: feather.name,
                        id: id,
                        client: obj.client,
                        callback: afterSelectUpdated
                    });
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterSelectUpdated = function (err, resp) {
                try {
                    if (err) {
                        throw err;
                    }

                    result = resp;

                    // Handle change log
                    if (updRec) {
                        that.doInsert({
                            name: "Log",
                            data: {
                                objectId: id,
                                action: "PATCH",
                                created: updRec.updated,
                                createdBy: updRec.updatedBy,
                                updated: updRec.updated,
                                updatedBy: updRec.updatedBy,
                                change: JSON.stringify(jsonpatch.compare(oldRec, result))
                            },
                            client: obj.client,
                            callback: doUnlock
                        }, true);
                        return;
                    }
                    doUnlock();
                } catch (e) {
                    obj.callback(e);
                }
            };

            doUnlock = function () {
                crud.unlock(obj.client, {
                    id: obj.id
                })
                    .then(done)
                    .catch(obj.callback);
            };

            done = function () {
                try {
                    // Remove the lock information
                    result.lock = null;

                    // Send back the differences between what user asked for and result
                    obj.callback(null, jsonpatch.compare(cacheRec, result));
                } catch (e) {
                    obj.callback(e);
                }
            };

            // Kick off query by getting feather, the rest falls through callbacks
            that.getFeather({
                client: obj.client,
                callback: afterGetFeather,
                data: {
                    name: obj.name
                }
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
          Return a class definition, including inherited properties.

          @param {Object} Request payload
          @param {Object} [payload.name] Feather name
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @param {Boolean} [payload.includeInherited] Include inherited or not. Default = true.
          @return receiver
        */
        getFeather: function (obj) {
            var callback, name = obj.data.name;

            callback = function (catalog) {
                var resultProps, featherProps, keys, appendParent,
                        result = {
                    name: name,
                    inherits: "Object"
                };

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
                    obj.callback(null, false);
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

                obj.callback(null, result);
            };

            /* First, get catalog */
            settings.getSettings({
                client: obj.client,
                data: {
                    name: "catalog"
                }
            }).then(callback).catch(obj.callback);
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
          @param {String} [payload.callback] Callback
            action
        */
        isAuthorized: function (obj) {
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
                        obj.callback(err);
                        return;
                    }

                    result = resp.rows.length > 0;
                    obj.callback(null, result);
                });

                /* Otherwise check object authorization */
            } else if (id) {
                /* Find object */
                sql = "SELECT _pk, tableoid::regclass::text AS \"t\" " +
                        "FROM object WHERE id = $1;";
                obj.client.query(sql, [id], function (err, resp) {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    /* If object found, check authorization */
                    if (resp.rows.length > 0) {
                        table = resp.rows[0].t;
                        pk = resp.rows[0][PKCOL];

                        tokens.push(table);
                        authSql = buildAuthSql(action, table, tokens);
                        sql = "SELECT _pk FROM %I WHERE _pk = $2 " + authSql;
                        sql = sql.format(tokens);

                        obj.client.query(sql, [user, pk], function (err, resp) {
                            if (err) {
                                obj.callback(err);
                                return;
                            }

                            result = resp.rows.length > 0;

                            obj.callback(null, result);
                        });
                    }
                });
            }
        },

        /**
          Returns whether user is super user.

          @param {Object} Payload
          @param {String} [payload.user] User. Defaults to current user
          @param {String} [payload.client] Datobase client
          @param {String} [payload.callback] Callback
          @return receiver
        */
        isSuperUser: function (obj) {
            var sql = "SELECT is_super FROM \"$user\" WHERE username=$1;",
                user = obj.user === undefined
                    ? obj.client.currentUser
                    : obj.user;

            obj.client.query(sql, [user], function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                obj.callback(null, resp.rows.length
                    ? resp.rows[0].is_super
                    : false);
            });

            return this;
        },

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
        */
        saveAuthorization: function (obj) {
            var result, sql, pk, feather, params, objPk, rolePk,
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
                    obj.callback("Object \"" + id + "\" not found");
                    return;
                }

                tools.getKey({
                    id: obj.data.role,
                    client: obj.client
                }).then(afterGetRoleKey).catch(obj.callback);
            };

            afterGetRoleKey = function (resp) {
                rolePk = resp;

                // Validation
                if (!rolePk) {
                    obj.callback("Role \"" + id + "\" not found");
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
                    obj.callback(err);
                    return;
                }

                feather = resp.rows[0].feather.toCamelCase(true);

                that.getFeather({
                    client: obj.client,
                    callback: afterGetFeather,
                    data: {
                        name: feather
                    }
                });
            };

            afterGetFeather = function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                feather = resp;

                if (isChildFeather(feather)) {
                    err = "Can not set authorization on child feathers.";
                } else if (!feather.properties.owner) {
                    err = "Feather must have owner property to set authorization";
                }

                if (err) {
                    obj.callback(err);
                    return;
                }

                checkSuperUser();
            };

            checkSuperUser = function () {
                that.isSuperUser({
                    client: obj.client,
                    callback: function (err, isSuper) {
                        if (err) {
                            obj.callback(err);
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
                                obj.callback(err);
                                return;
                            }

                            if (resp.rows[0].owner !== obj.client.currentUser) {
                                err = "Must be super user or owner of \"" + id + "\" to set " +
                                        "authorization.";
                                obj.callback(err);
                                return;
                            }

                            afterCheckSuperUser();
                        });
                        return;
                    }
                });
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
                    obj.callback(err);
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
                    obj.callback(err);
                    return;
                }

                obj.callback(null, true);
            };

            // Kick off query by getting object key, the rest falls through callbacks
            tools.getKey({
                id: id,
                client: obj.client
            }).then(afterGetObjKey).catch(obj.callback);
        },

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
         * @param {Function} [payload.callback] callback.
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
         * @return receiver
        */
        saveFeather: function (obj) {
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

                afterGetFeather = function (err, resp) {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    feather = resp;

                    settings.getSettings({
                        client: obj.client,
                        data: {
                            name: "catalog"
                        }
                    }).then(afterGetCatalog).catch(obj.callback);
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
                                        relationColumn(key, type.relation)
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
                            ? types[prop.type]
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
                                        token = relationColumn(key, type.relation);

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
                                        if (formats[prop.format]) {
                                            sql += formats[prop.format].type;
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
                        obj.callback(err);
                        return;
                    }

                    /* Update schema */
                    sql = sql.format(tokens);
                    obj.client.query(sql, createSequence);
                };

                createSequence = function (err) {
                    if (err) {
                        obj.callback(err);
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
                            obj.callback(err);
                            return;
                        }

                        if (!resp.rows.length) {
                            sql = "CREATE SEQUENCE %I;";
                            sql = sql.format([sequence]);
                            obj.client.query(sql, function (err) {
                                if (err) {
                                    obj.callback(err);
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
                        obj.callback(err);
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
                            obj.callback(err);
                            return;
                        }

                        recs = resp.rows;

                        if (recs.length) {
                            values = [recs[0][PKCOL]];
                            i = 0;
                            n += 1;

                            while (i < fns.length) {
                                values.push(f[fns[i].default]());
                                i += 1;
                            }

                            obj.client.query(sqlUpd, values, function (err) {
                                if (err) {
                                    obj.callback(err);
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
                                        ((pformat && formats[pformat])
                                    ? formats[pformat].default
                                    : false) ||
                                        types[type].default;
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
                                    args.push(relationColumn(add, type.relation));
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
                                .catch(obj.callback);

                            return;
                        }

                        afterPopulateDefaults();
                        return;
                    }

                    createIndex();
                };

                createIndex = function (err) {
                    if (err) {
                        obj.callback(err);
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
                        obj.callback(err);
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
                    spec.isChild = spec.isChild || isChildFeather(spec);

                    settings.saveSettings({
                        client: obj.client,
                        data: {
                            name: "catalog",
                            data: catalog
                        }
                    }).then(afterUpdateCatalog).catch(obj.callback);
                };

                afterUpdateCatalog = function () {
                    var callback;

                    callback = function (err, resp) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        isChild = isChildFeather(resp);
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
                        });
                        return;
                    }

                    afterInsertFeather();
                };

                afterNextVal = function (err, resp) {
                    var callback;

                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    pk = resp.rows[0].pk;

                    callback = function (err, resp) {
                        var key;

                        if (err) {
                            obj.callback(err);
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
                            client: obj.client,
                            callback: callback
                        });
                        return;
                    }

                    callback(null, pk);
                };

                afterInsertFeather = function (err) {
                    if (err) {
                        obj.callback(err);
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
                        obj.callback(err);
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
                            client: obj.client,
                            callback: afterSaveAuthorization
                        };
                    }

                    /* Set authorization */
                    if (authorization) {
                        that.saveAuthorization(authorization);
                        return;
                    }

                    afterSaveAuthorization();
                };

                afterSaveAuthorization = function (err) {
                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    if (c < len) {
                        nextSpec();
                        return;
                    }

                    obj.callback(null, true);
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
                    obj.callback("No name defined");
                    return;
                }

                that.getFeather({
                    client: obj.client,
                    callback: afterGetFeather,
                    data: {
                        name: spec.name,
                        includeInherited: false
                    }
                });
            };

            // Real work starts here
            nextSpec();

            return this;
        },

        /**
          Create or upate settings.

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
                            authorization.callback = nextWorkbook;

                            // Set authorization
                            if (authorization) {
                                that.saveAuthorization(authorization);
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

        /**
          Sets a user as super user or not.

          @param {Object} Payload
          @param {String} [payload.user] User
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] Callback
        */
        setSuperUser: function (obj, isSuper) {
            isSuper = obj.isSuper === undefined
                ? true
                : obj.isSuper;

            var sql, afterCheckSuperUser, afterGetPgUser, afterGetUser, afterUpsert,
                    user = obj.user;

            afterCheckSuperUser = function (err, ok) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                if (!ok) {
                    obj.callback("Only a super user can set another super user");
                }

                sql = "SELECT * FROM pg_user WHERE usename=$1;";
                obj.client.query(sql, [user], afterGetUser);
            };

            afterGetPgUser = function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                if (!resp.rows.length) {
                    obj.callback("User does not exist");
                }

                sql = "SELECT * FROM \"$user\" WHERE username=$1;";
                obj.client.query(sql, [user], afterGetPgUser);
            };

            afterGetUser = function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                if (resp.rows.length) {
                    sql = "UPDATE \"$user\" SET is_super=$2 WHERE username=$1";
                } else {
                    sql = "INSERT INTO \"$user\" VALUES ($1, $2)";
                }

                obj.client.query(sql, [user, isSuper], afterUpsert);
            };

            afterUpsert = function (err) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Success. Return to callback.
                obj.callback(null, true);
            };

            that.isSuperUser({
                name: obj.client.currentUser,
                client: obj.client,
                callback: afterCheckSuperUser
            });

            return this;
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