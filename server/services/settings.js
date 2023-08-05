/*
    Framework for building object relational database apps
    Copyright (C) 2023  John Rogelstad

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
const settings = {};
const {Events} = require("./events");
const f = require("../../common/core");
const events = new Events();
const dbsettings = {};

/**
    @module Settings
*/

// ..........................................................
// PUBLIC
//

/**
    Return settings data.
    @method getSettings
    @for Services.Settings
    @param {Object} payload Request payload
    @param {Object} payload.data Data
    @param {String} payload.data.name Settings name
    @param {Boolean} payload.data.force Force reload
    @param {Object} payload.client Database client
    @param {Object} [payload.subscription] subscribe to changes
    @return {Promise}
*/
settings.getSettings = function (obj) {
    return new Promise(function (resolve, reject) {
        let name = obj.data.name;
        let theClient = obj.client;
        let db = theClient.database;
        if (!dbsettings[db]) {
            dbsettings[db] = {data: {}};
        }

        function fetch() {
            let sql = (
                "SELECT id, etag, data FROM \"$settings\"" +
                "WHERE name = $1"
            );

            // If here, need to query for the current settings
            theClient.query(sql, [name]).then(function (resp) {
                let rec;

                // If we found something, cache it
                if (resp.rows.length) {
                    rec = resp.rows[0];
                    if (!dbsettings[db].data[name]) {
                        dbsettings[db].data[name] = {data: {}};
                    }
                    dbsettings[db].data[name].id = rec.id;
                    dbsettings[db].data[name].etag = rec.etag;
                    // Careful not to break pre-existing pointer
                    // First clear old properties
                    Object.keys(
                        dbsettings[db].data[name].data
                    ).forEach(function (key) {
                        delete dbsettings[db].data[name].data[key];
                    });
                    // Populate new properties
                    Object.keys(rec.data || []).forEach(function (key) {
                        dbsettings[db].data[name].data[key] = rec.data[key];
                    });
                }

                // Send back the settings if any were found, otherwise
                // "false"
                if (dbsettings[db].data[name]) {
                    // Handle subscription
                    if (obj.subscription) {
                        events.subscribe(
                            theClient,
                            obj.subscription,
                            [rec.id]
                        ).then(
                            resolve.bind(null, dbsettings[db].data[name].data)
                        ).catch(
                            reject
                        );
                        return;
                    }
                    resolve(dbsettings[db].data[name].data);
                    return;
                }

                resolve(false);
            }).catch(reject);
        }

        if (obj.data.force) {
            fetch();
            return;
        }

        if (dbsettings[db].data[name]) {
            // Handle subscription
            if (obj.subscription) {
                events.subscribe(
                    theClient,
                    obj.subscription,
                    [dbsettings[db].data[name].id]
                ).then(
                    resolve.bind(null, dbsettings[db].data[name].data)
                ).catch(
                    reject
                );
                return;
            }
            resolve(dbsettings[db].data[name].data);
            return;
        }

        // Request the settings from the database
        fetch();
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
        let client = obj.client;

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
        let db = obj.client.database;

        function callback(resp) {
            if (resp !== false) {
                ret.etag = dbsettings[db].data[obj.data.name].etag;
                ret.data = dbsettings[db].data[obj.data.name].data;
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
        let d = obj.data.data;
        let tag = obj.etag || f.createId();
        let params = [name, d, tag, obj.client.currentUser()];
        let client = obj.client;
        let db = obj.client.database;

        if (!dbsettings[db]) {
            dbsettings[db] = {data: {}};
        }

        function update(resp) {
            let msg;

            function done() {
                if (!dbsettings[db].data[name]) {
                    dbsettings[db].data[name] = {};
                }
                dbsettings[db].data[name].id = name;
                dbsettings[db].data[name].data = d;
                dbsettings[db].data[name].etag = tag;
                resolve(true);
            }

            // If found existing, update
            if (resp.rows.length) {
                row = resp.rows[0];

                if (
                    dbsettings[db].data[name] &&
                    dbsettings[db].data[name].etag !== row.etag
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

            client.query(sql, params).then(done).catch(reject);
        }

        client.query(sql, [name]).then(
            update
        ).catch(
            reject
        );
    });
};

(function (exports) {
    "use strict";
    /**
        @class Settings
        @constructor
        @namespace Services
    */
    exports.Settings = function () {
        return settings;
    };

}(exports));