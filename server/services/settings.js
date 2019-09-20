/*
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
*/
/*jslint node*/
/**
    @module Settings
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const f = require("../../common/core");

    const db = new Database();
    const settings = {};

    // ..........................................................
    // PRIVATE
    //

    /**
        Check to see if an etag is current.
        @private
        @method checkEtag
        @param {Object} payload
        @param {String} payload.id Object id
        @param {String} payload.etag Object etag
        @param {Object} payload.client Database client
        @return {Promise}
    */
    function checkEtag(obj) {
        return new Promise(function (resolve, reject) {
            let sql = "SELECT etag FROM %I WHERE id = $1";

            function callback(resp) {
                let result = false;

                if (resp.rows.length) {
                    result = resp.rows[0].etag === obj.etag;
                }

                resolve(result);
            }

            sql = sql.format([obj.name.toSnakeCase()]);

            obj.client.query(sql, [obj.id]).then(callback).catch(reject);
        });
    }

    // ..........................................................
    // PUBLIC
    //

    settings.data = {};

    /**
        Return settings data.
        @method getSettings
        @for Services.Settings
        @param {Object} payload Request payload
        @param {Object} payload.data Data
        @param {String} payload.data.name Settings name
        @param {Object} payload.client Database client
        @return {Promise}
    */
    settings.getSettings = function (obj) {
        return new Promise(function (resolve, reject) {
            let payload;
            let name = obj.data.name;
            let client = db.getClient(obj.client);

            function callback(ok) {
                let sql;

                sql = "SELECT id, etag, data FROM \"$settings\"";
                sql += "WHERE name = $1";

                // If etag checks out, pass back cached
                if (ok) {
                    resolve(settings.data[name].data);
                    return;
                }

                // If here, need to query for the current settings
                client.query(sql, [name]).then(function (resp) {
                    let rec;

                    // If we found something, cache it
                    if (resp.rows.length) {
                        rec = resp.rows[0];
                        settings.data[name] = {
                            id: rec.id,
                            etag: rec.etag,
                            data: rec.data
                        };
                    }

                    // Send back the settings if any were found, otherwise
                    // "false"
                    if (settings.data[name]) {
                        resolve(settings.data[name].data);
                        return;
                    }

                    resolve(false);
                }).catch(reject);
            }

            // Check if settings have been changed if we already have them
            if (settings.data[name]) {
                payload = {
                    name: "$settings",
                    id: settings.data[name].id,
                    etag: settings.data[name].etag,
                    client: client,
                    callback: callback
                };

                checkEtag(payload).then(callback).catch(reject);

                return;
            }

            // Request the settings from the database
            callback(false);
        });
    };

    /**
        Resolve settings definitions as array of objects.
        @method getSettingsDefinition
        @for Services.Settings
        @param {Object} Request payload
        @param {Client} payload.client Database client
        @return {Promise}
    */
    settings.getSettingsDefinition = function (obj) {
        return new Promise(function (resolve, reject) {
            let sql;
            let client = db.getClient(obj.client);

            sql = "SELECT definition FROM \"$settings\" ";
            sql += "WHERE definition is NOT NULL";

            function definition(row) {
                return row.definition;
            }

            function callback(resp) {
                resolve(resp.rows.map(definition));
            }

            client.query(sql).then(callback).catch(reject);
        });
    };

    /**
        Resolves to object properties `definition` and `etag`.
        @method getSettingsRow
        @for Services.Settings
        @param {Object} payload Request payload
        @param {Object} payload.client Database client
        @param {String} payload.name Settings name
        @return {Promise}
    */
    settings.getSettingsRow = function (obj) {
        return new Promise(function (resolve, reject) {
            let ret = {};

            function callback(resp) {
                if (resp !== false) {
                    ret.etag = settings.data[obj.data.name].etag;
                    ret.data = settings.data[obj.data.name].data;
                    resolve(ret);
                    return;
                }

                resolve(false);
            }

            settings.getSettings(obj).then(callback).catch(reject);
        });
    };

    /**
        Create or upate settings.
        @method saveSettings
        @for Services.Settings
        @param {Object} payload
        @param {Object} payload.data Payload data
        @param {String} payload.data.name Name of settings
        @param {String} payload.data.etag Etag
        @param {Object} payload.data.data Settings data
        @param {Object} payload.client Database client
        @return {Promise}
    */
    settings.saveSettings = function (obj) {
        return new Promise(function (resolve, reject) {
            let row;
            let sql = "SELECT * FROM \"$settings\" WHERE name = $1;";
            let name = obj.data.name;
            let data = obj.data.data;
            let etag = obj.etag || f.createId();
            let params = [name, data, etag, obj.client.currentUser()];
            let client = db.getClient(obj.client);

            function done() {
                settings[name] = {
                    id: name,
                    data: data,
                    etag: etag
                };
                resolve(true);
            }

            function update(resp) {
                return new Promise(function (resolve, reject) {
                    let msg;

                    // If found existing, update
                    if (resp.rows.length) {
                        row = resp.rows[0];

                        if (
                            settings[name] &&
                            settings[name].etag !== row.etag
                        ) {
                            msg = "Settings for \"" + name;
                            msg += "\" changed by another user. Save failed.";
                            reject(msg);
                            return;
                        }

                        sql = "UPDATE \"$settings\" SET ";
                        sql += " data = $2, etag = $3, ";
                        sql += " updated = now(), updated_by = $4 ";
                        sql += "WHERE name = $1;";
                        client.query(sql, params, done);
                        return;
                    }

                    // otherwise create new
                    sql = "INSERT INTO \"$settings\" (name, data, etag, id, ";
                    sql += " created, created_by, updated, updated_by, ";
                    sql += "is_deleted) VALUES ";
                    sql += "($1, $2, $3, $1, now(), $4, now(), $4, false);";

                    client.query(sql, params).then(resolve).catch(reject);
                });
            }

            client.query(sql, [name]).then(
                update
            ).then(
                done
            ).catch(
                reject
            );
        });
    };

    /**
        @class Settings
        @constructor
        @namespace Services
    */
    exports.Settings = function () {
        return settings;
    };

}(exports));