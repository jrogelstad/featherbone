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
/*jslint node*/
const settings = {};
const {Database} = require("../database");
const {Events} = require("./events");
const f = require("../../common/core");
const events = new Events();
const pgdb = new Database();
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
settings.getSettings = async function (obj) {
    let name = obj.data.name;
    let theClient = obj.client;
    let db = theClient.database;
    if (!dbsettings[db]) {
        dbsettings[db] = {data: {}};
    }

    async function fetch() {
        let sql = (
            "SELECT id, etag, data, definition FROM \"$settings\"" +
            "WHERE name = $1"
        );
        let rec;
        let pkeys;
        let p;
        let i = 0;

        try {

            // If here, need to query for the current settings
            let resp = await theClient.query(sql, [name]);

            // If we found something, cache it
            if (resp.rows.length) {
                rec = resp.rows[0];

                // Handle decryption
                if (rec.definition && rec.data) {
                    sql = "SELECT pgp_sym_decrypt($1::BYTEA, $2) AS value;";
                    pkeys = Object.keys(rec.definition.properties);
                    while (i < pkeys.length) {
                        p = rec.definition.properties[pkeys[i]];
                        if (p.isEncrypted) {
                            resp = await theClient.query(sql, [
                                rec.data[pkeys[i]],
                                pgdb.cryptoKey()
                            ]);
                            rec.data[pkeys[i]] = resp.rows[0].value;
                        }
                        i += 1;
                    }
                }

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
                    await events.subscribe(
                        theClient,
                        obj.subscription,
                        [rec.id]
                    );
                }
                return dbsettings[db].data[name].data;
            }

            return false;
        } catch (e) {
            return Promise.reject(e);
        }
    }

    try {
        if (obj.data.force) {
            return await fetch();
        }

        if (dbsettings[db].data[name]) {
            // Handle subscription
            if (obj.subscription) {
                await events.subscribe(
                    theClient,
                    obj.subscription,
                    [dbsettings[db].data[name].id]
                );
            }
            return dbsettings[db].data[name].data;
        }

        // Request the settings from the database
        return await fetch();
    } catch (e) {
        return Promise.reject(e);
    }
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
settings.saveSettings = async function (obj) {
    let row;
    let sql = "SELECT * FROM \"$settings\" WHERE name = $1;";
    let name = obj.data.name;
    let d = obj.data.data;
    let edat = f.copy(d);
    let tag = obj.etag || f.createId();
    let params = [name, edat, tag, obj.client.currentUser()];
    let client = obj.client;
    let db = obj.client.database;
    let msg;
    let resp;
    let pkeys;
    let p;
    let i = 0;

    if (!dbsettings[db]) {
        dbsettings[db] = {data: {}};
    }

    function done() {
        if (!dbsettings[db].data[name]) {
            dbsettings[db].data[name] = {};
        }
        dbsettings[db].data[name].id = name;
        dbsettings[db].data[name].data = d;
        dbsettings[db].data[name].etag = tag;
    }

    try {
        resp = await client.query(sql, [name]);

        // If found existing, update
        if (resp.rows.length) {
            row = resp.rows[0];

            // Handle encryption where applicable
            if (row.definition) {
                pkeys = Object.keys(row.definition.properties);
                sql = "SELECT pgp_sym_encrypt($1, $2)::TEXT AS value;";
                while (i < pkeys.length) {
                    p = row.definition.properties[pkeys[i]];
                    if (p.isEncrypted) {
                        resp = await client.query(sql, [
                            edat[pkeys[i]],
                            pgdb.cryptoKey()
                        ]);
                        edat[pkeys[i]] = resp.rows[0].value;
                    }
                    i += 1;
                }
            }

            if (
                dbsettings[db].data[name] &&
                dbsettings[db].data[name].etag !== row.etag
            ) {
                msg = "Settings for \"" + name;
                msg += "\" changed by another user. Save failed.";
                return Promise.reject(msg);
            }

            sql = (
                "UPDATE \"$settings\" SET " +
                " data = $2, etag = $3, " +
                " updated = now(), updated_by = $4 " +
                "WHERE name = $1;"
            );
            await client.query(sql, params);
            done();
            return true;
        }

        // otherwise create new
        sql = (
            "INSERT INTO \"$settings\" (name, data, etag, id, " +
            " created, created_by, updated, updated_by, " +
            "is_deleted) VALUES " +
            "($1, $2, $3, $1, now(), $4, now(), $4, false);"
        );

        await client.query(sql, params);

        done();

        return true;
    } catch (e) {
        return Promise.reject(e);
    }
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
