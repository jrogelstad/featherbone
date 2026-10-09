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
const {Tools} = require("./tools");
const f = require("../../common/core");
const events = new Events();
const pgdb = new Database();
const tools = new Tools();
const dbsettings = {};
const dbencrypted = {};

/**
    @module Settings
*/

/*
    Remember which properties of a settings row are encrypted, so reads
    can keep them away from users who may not see them. Called wherever a
    definition is in hand; a row without a definition has no secrets.
*/
function noteEncrypted(db, name, definition) {
    let props = (
        definition
        ? definition.properties
        : null
    );

    if (!dbencrypted[db]) {
        dbencrypted[db] = {};
    }

    dbencrypted[db][name] = (
        props
        ? Object.keys(props).filter((key) => props[key].isEncrypted)
        : []
    );
}

/*
    Blank encrypted properties unless the caller may change this row. The
    values are decrypted on the way out of the database and the result is
    cached for every user of this database, so the copy is made here
    rather than in the cache.
*/
async function withoutSecrets(obj, name, data) {
    let db = obj.client.database;
    let keys = (dbencrypted[db] || {})[name];
    let copy;

    if (!keys || !keys.length || !data) {
        return data;
    }

    if (await settings.settingIsAuthorized({
        client: obj.client,
        data: {
            name: name,
            user: obj.user
        }
    })) {
        return data;
    }

    copy = f.copy(data);
    keys.forEach(function (key) {
        if (copy[key] !== undefined) {
            copy[key] = "";
        }
    });

    return copy;
}

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

                noteEncrypted(db, name, rec.definition);

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
                return await withoutSecrets(
                    obj,
                    name,
                    dbsettings[db].data[name].data
                );
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
            return await withoutSecrets(
                obj,
                name,
                dbsettings[db].data[name].data
            );
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
                // What `getSettings` resolved to, not the cached row:
                // encrypted properties are blanked for users who may not
                // see them
                ret.data = resp;
                resolve(ret);
                return;
            }

            resolve(false);
        }

        settings.getSettings(obj).then(callback).catch(reject);
    });
};

/**
    Whether a user may change a settings row.

    A tenant super user always may. Otherwise the row itself has to grant
    `canUpdate` to one of the user's roles: settings rows inherit
    `object`, so the grant is an ordinary "$auth" row, the same kind a
    workbook carries. A row nobody has been granted is therefore super
    users only, which is what every settings row starts as.

    @method settingIsAuthorized
    @for Services.Settings
    @param {Object} payload
    @param {Object} payload.data Payload data
    @param {String} payload.data.name Settings name
    @param {String} [payload.data.user] User. Defaults to current user
    @param {Object} payload.client Database client
    @return {Promise} Resolves to Boolean
*/
settings.settingIsAuthorized = async function (obj) {
    let resp;
    let client = obj.client;
    let name = obj.data.name;
    let user = obj.data.user || client.currentUser();
    let sql = (
        "SELECT auth.can_update " +
        "FROM \"$settings\" AS settings, \"$auth\" AS auth, pg_authid " +
        "WHERE settings.name = $1 " +
        "  AND settings._pk = auth.object_pk " +
        "  AND auth.role = pg_authid.rolname " +
        "  AND pg_has_role($2, pg_authid.oid, 'member') " +
        "  AND auth.can_update " +
        "LIMIT 1;"
    );

    if (!name) {
        throw new Error("Authorization check requires name");
    }

    if (await tools.isSuperUser({
        client: client,
        user: user
    })) {
        return true;
    }

    resp = await client.query(sql, [name, user]);
    return resp.rows.length > 0;
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
    @param {Boolean} [payload.isInternal] Skip the super user check. For
    settings the server maintains itself, such as the feather catalog,
    where the authorization decision belongs to the work that triggered
    the save. Never set from a request payload.
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
        noteEncrypted(db, name, (
            row
            ? row.definition
            : null
        ));

        if (!dbsettings[db].data[name]) {
            dbsettings[db].data[name] = {};
        }
        dbsettings[db].data[name].id = name;
        dbsettings[db].data[name].data = d;
        dbsettings[db].data[name].etag = tag;
    }

    try {
        if (!obj.isInternal && !await settings.settingIsAuthorized({
            client: client,
            data: {
                name: name,
                user: obj.user
            }
        })) {
            msg = "Not authorized to change settings \"" + name + "\"";
            return Promise.reject({
                statusCode: 401,
                message: msg
            });
        }

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
                (
                    dbsettings[db].data[name] &&
                    dbsettings[db].data[name].etag !== row.etag
                ) || (
                    // The caller saved from a version that is out of date
                    obj.data.etag !== undefined &&
                    obj.data.etag !== row.etag
                )
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
