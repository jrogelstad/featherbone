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
        Feather
    } = require("./services/feather");
    const {
        CRUD
    } = require("./services/crud");

    const events = new Events();
    const tools = new Tools();
    const settings = new Settings();
    const crud = new CRUD();
    const plumo = new Feather();

    var that,
        f = require("../common/core"),
        jsonpatch = require("fast-json-patch"),
        format = require("pg-format"),
        processSort = tools.processSort,
        sanitize = tools.sanitize;

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

            afterGetFeather = function (feather) {
                try {
                    props = feather.properties;

                    if (!isChild && feather.isChild) {
                        throw "Can not directly delete a child class";
                    }

                    if (isSuperUser === false) {
                        plumo.isAuthorized({
                            client: obj.client,
                            data: {
                                id: obj.id,
                                action: "canDelete"
                            }
                        }).then(afterAuthorization).catch(obj.callback);
                        return;
                    }

                    afterAuthorization(true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorization = function (authorized) {
                try {
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
            plumo.getFeather({
                client: obj.client,
                data: {
                    name: obj.name
                }
            }).then(afterGetFeather).catch(obj.callback);
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

            afterGetFeather = function (resp) {
                try {
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
                        plumo.isAuthorized({
                            client: obj.client,
                            data: {
                                feather: name,
                                action: "canCreate"
                            }
                        }).then(afterAuthorized).catch(obj.callback);
                        return;
                    }

                    afterAuthorized(true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorized = function (authorized) {
                try {
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
                            col = tools.relationColumn(key, prop.type.relation);
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
                                    tools.formats[prop.format] &&
                                    tools.formats[prop.format].default !== undefined) {
                                value = tools.formats[prop.format].default;
                            } else {
                                value = tools.types[prop.type].default;
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
            plumo.getFeather(payload).then(afterGetFeather).catch(obj.callback);
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

            afterGetFeather = function (feather) {
                try {
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
            plumo.getFeather({
                client: obj.client,
                data: {
                    name: obj.name
                }
            }).then(afterGetFeather).catch(obj.callback);

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

            afterGetFeather = function (resp) {
                try {
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
                        plumo.isAuthorized({
                            client: obj.client,
                            data: {
                                id: id,
                                action: "canUpdate"
                            }
                        }).then(afterAuthorization).catch(obj.callback);
                        return;
                    }

                    afterAuthorization(true);
                } catch (e) {
                    obj.callback(e);
                }
            };

            afterAuthorization = function (authorized) {
                try {
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

                    tokens.push(tools.relationColumn(key, relation));
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
            plumo.getFeather({
                client: obj.client,
                data: {
                    name: obj.name
                }
            }).then(afterGetFeather).catch(obj.callback);

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