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
/*jslint node, es6, for*/
(function (exports) {
    "strict";

    const {
        Events
    } = require('./events');
    const {
        Feathers
    } = require('./feathers');
    const {
        Tools
    } = require('./tools');

    const events = new Events();
    const feathers = new Feathers();
    const tools = new Tools();
    const f = require("../../common/core");
    const jsonpatch = require("fast-json-patch");

    exports.CRUD = function () {
        // ..........................................................
        // PRIVATE
        //

        const crud = {};

        // ..........................................................
        // PUBLIC
        //

        /**
        Perform soft delete on object records.

        @param {Object} Request payload
        @param {Object} [payload.id] Id of record to delete
        @param {Object} [payload.client] Database client
        @param {Function} [payload.isHard] Hard delete flag. Default false.
        @param {Boolean} Request as child. Default false.
        @param {Boolean} Request as super user. Default false.
        @return {Object} Promise
        */
        crud.doDelete = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
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
                            feathers.isAuthorized({
                                client: obj.client,
                                data: {
                                    id: obj.id,
                                    action: "canDelete"
                                }
                            }).then(afterAuthorization).catch(reject);
                            return;
                        }

                        afterAuthorization(true);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterAuthorization = function (authorized) {
                    try {
                        if (!authorized) {
                            throw "Not authorized to delete \"" + obj.id + "\"";
                        }

                        // Get old record, bail if it doesn't exist
                        // Exclude childOf relations when we select
                        crud.doSelect({
                            name: obj.name,
                            id: obj.id,
                            showDeleted: true,
                            properties: Object.keys(props).filter(noChildProps),
                            client: obj.client,
                            callback: afterDoSelect
                        }, true).then(afterDoSelect).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterDoSelect = function (resp) {
                    var sessionId = "_sessionid"; // JSLint doesn't like underscore

                    try {
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
                                crud.doDelete({
                                    name: rel,
                                    id: row.id,
                                    client: obj.client,
                                    isHard: obj.isHard
                                }, true).then(afterDelete).catch(reject);
                            });
                        });

                        // Finally, delete parent object
                        obj.client.query(sql, [obj.id], afterDelete);
                    } catch (e) {
                        reject(e);
                    }
                };

                // Handle change log
                afterDelete = function () {
                    try {
                        var now = f.now();

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
                        crud.doInsert({
                            name: "Log",
                            data: {
                                objectId: obj.id,
                                action: "DELETE",
                                created: now,
                                createdBy: now,
                                updated: now,
                                updatedBy: now
                            },
                            client: obj.client
                        }, true).then(afterLog).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterLog = function () {
                    resolve(true);
                };

                // Kick off query by getting feather, the rest falls through callbacks
                feathers.getFeather({
                    client: obj.client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
          Insert records for a passed object.

          @param {Object} Request payload
          @param {Object} [payload.name] Object type name
          @param {Object} [payload.data] Data to insert
          @param {Object} [payload.client] Database client
          @param {Boolean} Request as child. Default false.
          @param {Boolean} Request as super user. Default false.
          @return {Object} Promise
        */
        crud.doInsert = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
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
                        }, true).then(afterIdCheck).catch(reject);
                    } catch (e) {
                        reject(e);
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
                            }).then(afterUniqueCheck).catch(reject);
                            return;
                        }

                        afterUniqueCheck();
                    } catch (e) {
                        reject(e);
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
                            feathers.isAuthorized({
                                client: obj.client,
                                data: {
                                    feather: name,
                                    action: "canCreate"
                                }
                            }).then(afterAuthorized).catch(reject);
                            return;
                        }

                        afterAuthorized(true);
                    } catch (e) {
                        reject(e);
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
                        reject(e);
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
                        reject(e);
                    }
                };

                buildInsert = function () {
                    var callback;

                    if (n < len) {
                        key = fkeys[n];
                        child = false;
                        prop = props[key];
                        n += 1;
                        value = undefined;

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
                                        crud.doInsert({
                                            name: prop.type.relation,
                                            data: data[key],
                                            client: obj.client
                                        }, true, true).then(function () {
                                            tools.getKey({
                                                id: data[key].id,
                                                client: obj.client
                                            }).then(afterGetPk).catch(reject);
                                        }).catch(reject);
                                        return;
                                    }

                                    /* Relation must already exist */
                                    if (prop.type.childOf && obj.pk) {
                                        afterGetPk(obj.pk);
                                    } else {
                                        tools.getKey({
                                            id: data[key].id,
                                            client: obj.client
                                        }).then(afterGetPk).catch(reject);
                                    }
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
                                        reject(err);
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
                                args.push(attr.toSnakeCase());
                                tokens.push("%I.%I");
                                values.push(value[attr.toSnakeCase()]);
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

                    // Insert children first, parent last so notification gets full object
                    insertChildren();
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
                        reject(e);
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
                                crud.doInsert({
                                    pk: pk,
                                    name: rel,
                                    data: row,
                                    client: obj.client
                                }, true).then(afterInsert).catch(reject);
                            });
                        });

                        afterInsert();
                    } catch (e) {
                        reject(e);
                    }
                };

                afterInsert = function () {
                    function afterParentInsert() {
                        // We're done here if child
                        if (isChild) {
                            resolve(result);
                            return;
                        }

                        // Otherwise move on to log the change
                        crud.doSelect({
                            name: obj.name,
                            id: data.id,
                            client: obj.client
                        }).then(afterDoSelect).catch(reject);
                    }

                    try {
                        // Done only when all callbacks report back
                        c += 1;
                        if (c < clen) {
                            return;
                        }

                        // Perform the parent insert
                        obj.client.query(sql, values)
                            .then(afterParentInsert)
                            .catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterDoSelect = function (resp) {
                    try {
                        result = resp;

                        /* Handle change log */
                        crud.doInsert({
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
                            client: obj.client
                        }, true).then(afterLog).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterLog = function () {
                    try {
                        // We're going to return the changes
                        result = jsonpatch.compare(obj.cache, result);

                        // Report back result
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    }
                };

                // Kick off query by getting feather, the rest falls through callbacks
                feathers.getFeather(payload).then(afterGetFeather).catch(reject);
            });
        };

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
        crud.doSelect = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
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
                                .then(afterGetKey).catch(reject);

                            /* Get a filtered result */
                        } else {
                            payload.filter = obj.filter;
                            tools.getKeys(payload, isSuperUser)
                                .then(afterGetKeys).catch(reject);
                        }
                    } catch (e) {
                        reject(e);
                    }
                };

                afterGetKey = function (key) {
                    try {
                        if (key === undefined) {
                            resolve(undefined);
                            return;
                        }

                        sql += " WHERE _pk = $1";

                        obj.client.query(sql, [key], function (err, resp) {
                            var result;

                            if (err) {
                                reject(err);
                                return;
                            }

                            result = mapKeys(resp.rows[0]);
                            if (obj.sanitize !== false) {
                                result = tools.sanitize(result);
                            }

                            resolve(result);
                        });
                    } catch (e) {
                        reject(e);
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
                            sql += tools.processSort(sort, tokens);
                            sql = sql.format(tokens);

                            obj.client.query(sql, keys, function (err, resp) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                result = tools.sanitize(resp.rows.map(mapKeys));

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
                                        resolve(result);
                                    })
                                    .catch(reject);
                            });
                        } else {
                            // Handle subscription
                            events.unsubscribe(obj.client, subscription.id)
                                .then(function () {
                                    resolve([]);
                                })
                                .catch(reject);
                        }
                    } catch (e) {
                        reject(e);
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
                feathers.getFeather({
                    client: obj.client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
          Update records based on patch definition.

          @param {Object} Request payload
          @param {Object} [payload.id] Id of record to update
          @param {Object} [payload.data] Patch to apply
          @param {Object} [payload.client] Database client
          @param {Boolean} Request as super user. Default false.
          @return receiver
        */
        crud.doUpdate = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
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
                        children = [],
                        p = 1,
                        n = 0;

                if (!patches.length) {
                    resolve([]);
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
                            feathers.isAuthorized({
                                client: obj.client,
                                data: {
                                    id: id,
                                    action: "canUpdate"
                                }
                            }).then(afterAuthorization).catch(reject);
                            return;
                        }

                        afterAuthorization(true);
                    } catch (e) {
                        reject(e);
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
                        }).then(afterGetKey).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterGetKey = function (resp) {
                    try {
                        pk = resp;
                        keys = Object.keys(props);

                        // Get existing record
                        crud.doSelect({
                            name: obj.name,
                            id: obj.id,
                            properties: keys.filter(noChildProps),
                            client: obj.client,
                            sanitize: false
                        }, isChild).then(afterDoSelect).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterDoSelect = function (resp) {
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
                        if (oldRec && oldRec.lock &&
                                oldRec.lock[sessionId] !== obj.sessionid) {
                            throw "Record is locked by " + oldRec.lock.username + " and cannot be updated.";
                        }

                        oldRec = tools.sanitize(resp);

                        if (!Object.keys(oldRec).length || oldRec.isDeleted) {
                            resolve(false);
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
                            }).then(afterUniqueCheck).catch(reject);
                            return;
                        }

                        // Process properties
                        nextProp();
                    } catch (e) {
                        reject(e);
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
                        reject(e);
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
                                                func: crud.doDelete,
                                                payload: {
                                                    name: relation,
                                                    id: cid,
                                                    client: obj.client
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
                                                    func: crud.doUpdate,
                                                    payload: {
                                                        name: relation,
                                                        id: cid,
                                                        data: cpatches,
                                                        client: obj.client
                                                    }
                                                });
                                            }
                                        } else {
                                            cNewRec[props[key].type.parentOf] = {
                                                id: updRec.id
                                            };
                                            clen += 1;
                                            doList.push({
                                                func: crud.doInsert,
                                                payload: {
                                                    name: relation,
                                                    data: cNewRec,
                                                    client: obj.client
                                                }
                                            });
                                        }
                                    });

                                /* Handle child relation updates */
                                } else if (props[key].type.isChild) {
                                    /* Do delete */
                                    if (oldRec[key] && !updRec[key]) {
                                        crud.doDelete({
                                            name: props[key].type.relation,
                                            id: oldRec[key].id,
                                            client: obj.client,
                                            isHard: true
                                        }, true, true).then(function () {
                                            afterGetRelKey(null, -1);
                                        }).catch(reject);

                                        return;
                                    }

                                    /* Do insert */
                                    if (updRec[key] && !oldRec[key]) {
                                        crud.doInsert({
                                            name: props[key].type.relation,
                                            id: updRec[key].id,
                                            data: updRec[key],
                                            client: obj.client
                                        }, true, true).then(function () {
                                            tools.getKey({
                                                id: updRec[key].id,
                                                client: obj.client
                                            }).then(afterGetRelKey).catch(reject);
                                        }).catch(reject);

                                        return;
                                    }

                                    if (updRec[key] && oldRec[key] && updRec[key].id !== oldRec[key].id) {
                                        throw "Id cannot be changed on child relation '" + key + "'";
                                    }

                                    /* Do update */
                                    cpatches = jsonpatch.compare(oldRec[key] || {}, updRec[key] || {});

                                    if (cpatches.length) {
                                        crud.doUpdate({
                                            name: props[key].type.relation,
                                            id: updRec[key].id,
                                            data: cpatches,
                                            client: obj.client
                                        }, true, true).then(function () {
                                            tools.getKey({
                                                id: updRec[key].id,
                                                client: obj.client
                                            }).then(afterGetRelKey).catch(reject);
                                        }).catch(reject);
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
                                        }).then(afterGetRelKey).catch(reject);
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
                        reject(e);
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
                        reject(e);
                    }
                };

                afterProperties = function () {
                    try {
                        // Execute child changes first so all captured in any notification
                        children = doList.map((item) => item.func(item.payload, true));

                        // Execute top level object change
                        sql = ("UPDATE %I SET " + ary.join(",") + " WHERE _pk = $" + p);
                        sql = sql.format(tokens);
                        params.push(pk);
                        clen += 1;

                        Promise.all(children)
                            .then(() => obj.client.query(sql, params))
                            .then(afterUpdate)
                            .catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterUpdate = function () {
                    try {
                        // If child, we're done here
                        if (isChild) {
                            resolve();
                            return;
                        }

                        // If a top level record, return patch of what changed
                        crud.doSelect({
                            name: feather.name,
                            id: id,
                            client: obj.client
                        }).then(afterSelectUpdated).catch(reject);
                    } catch (e) {
                        reject(e);
                    }
                };

                afterSelectUpdated = function (resp) {
                    try {
                        result = resp;

                        // Handle change log
                        if (updRec) {
                            crud.doInsert({
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
                                client: obj.client
                            }, true).then(doUnlock).catch(reject);
                            return;
                        }
                        doUnlock();
                    } catch (e) {
                        reject(e);
                    }
                };

                doUnlock = function () {
                    crud.unlock(obj.client, {
                        id: obj.id
                    })
                        .then(done)
                        .catch(reject);
                };

                done = function () {
                    try {
                        // Remove the lock information
                        result.lock = null;

                        // Send back the differences between what user asked for and result
                        resolve(jsonpatch.compare(cacheRec, result));
                    } catch (e) {
                        reject(e);
                    }
                };

                // Kick off query by getting feather, the rest falls through callbacks
                feathers.getFeather({
                    client: obj.client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
          Lock a record to prevent others from editing.

          @param {Object} Database client connection
          @param {String} Node id.
          @param {String} Object id.
          @param {String} User name.
          @param {String} Session id.
          @return {Object} Promise
        */
        crud.lock = function (client, nodeid, id, username, sessionid) {
            return new Promise(function (resolve, reject) {
                if (!nodeid) {
                    throw new Error('Lock requires a node id.');
                }

                if (!sessionid) {
                    throw new Error('Lock requires a sessionid.');
                }

                if (!id) {
                    throw new Error('Lock requires an object id.');
                }

                if (!username) {
                    throw new Error('Lock requires a username.');
                }

                function checkLock() {
                    return new Promise(function (resolve, reject) {
                        var sql = "SELECT lock FROM object WHERE id = $1";

                        function callback(resp) {
                            if (!resp.rows.length) {
                                throw new Error("Record " + id + " not found.");
                            }

                            if (resp.rows[0].lock) {
                                throw new Error("Record " + id + " is already locked.");
                            }

                            resolve();
                        }

                        client.query(sql, [id])
                            .then(callback)
                            .catch(reject);
                    });
                }

                function doLock() {
                    return new Promise(function (resolve, reject) {
                        var params,
                            sql = "UPDATE object SET lock = ROW($1, now(), $2, $3) WHERE id = $4";

                        function callback() {
                            resolve(true);
                        }

                        params = [
                            username,
                            nodeid,
                            sessionid,
                            id
                        ];

                        client.query(sql, params)
                            .then(callback)
                            .catch(reject);
                    });
                }

                Promise.resolve()
                    .then(checkLock)
                    .then(doLock)
                    .then(resolve)
                    .catch(reject);

            });
        };

        /**
          Unlock object(s) by type.

          @param {Object} Database client connection
          @param {Object} Criteria for what to unlock.
          @param {String} [criteria.id] Object id.
          @param {String} [criteria.username] User name.
          @param {String} [criteria.sessionId] Session id.
          @param {String} [criteria.nodeId] Node id.
          @return {Object} Promise
        */
        crud.unlock = function (client, criteria) {
            return new Promise(function (resolve, reject) {
                var sql,
                    params = [];

                function callback(resp) {
                    resolve(resp.rows);
                }

                sql = 'UPDATE object SET lock = NULL ' +
                        'WHERE true ';

                if (criteria.id) {
                    params.push(criteria.id);
                    sql += ' AND object.id = $1';
                }

                if (criteria.username) {
                    params.push(criteria.username);
                    sql += ' AND username(lock) = $' + params.length;
                }

                if (criteria.sessionId) {
                    params.push(criteria.sessionId);
                    sql += ' AND _sessionid(lock) = $' + params.length;
                }

                if (criteria.nodeId) {
                    params.push(criteria.nodeId);
                    sql += ' AND _nodeid(lock) = $' + params.length;
                }

                if (!params.length) {
                    throw new Error("No lock criteria defined.");
                }

                sql += " RETURNING id; ";

                client.query(sql, params)
                    .then(callback)
                    .catch(reject);
            });
        };

        return crud;
    };

}(exports));

