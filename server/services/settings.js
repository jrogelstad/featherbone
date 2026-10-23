/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
const {Config} = require("../config");
const {Database} = require("../database");
const {Events} = require("./events");
const {Platform} = require("./platform");
const {Tools} = require("./tools");
const f = require("../../common/core");
const config = new Config();
const events = new Events();
const pgdb = new Database();
const platform = new Platform();

/*
    Settings an administrator of the instance's organization may change
    without being a super user of the instance. See settingIsAuthorized.
*/
const ORG_ADMIN_SETTINGS = ["globalSettings"];
const tools = new Tools();
const dbsettings = {};
const dbencrypted = {};

/**
    @module Settings
*/

/*
    Settings that belong to the organization rather than to the
    instance (John, 2026-10-18). A customer's letterhead and their
    mail account are the same wherever they are printed or sent from,
    so production, test and demo should not each carry their own copy
    to be edited three times and drift twice. The organization record
    in the manager is what owns every instance, so that is where they
    live.

    Marked a property at a time -- `"isOrganization": true` in the
    settings definition -- not a document at a time, because one
    document can hold both kinds. `globalSettings.logo` is the case:
    it relates to a `ResourceLink`, which is an instance feather, so
    the row it points at exists in one instance and nowhere else. The
    address and the SMTP account move; the logo stays where its row
    is.

    The definition stays in each instance's own `$settings` as before,
    so the form that renders it is untouched, and only the values of
    the marked properties come from somewhere else.
*/
const ORG_TABLE = "\"$organization_settings\"";

function organizationProperties(definition) {
    let props = (definition || {}).properties || {};

    return Object.keys(props).filter(
        (key) => props[key].isOrganization === true
    );
}

/*
    Made on first use, like the manager's other bare tables, so an
    existing manager needs no reinstall. `CREATE TABLE IF NOT EXISTS`
    is not safe against itself -- two processes can both pass the
    existence check and one then dies on the catalog's unique index --
    so look first, and serialize on an advisory lock when it has to be
    made (the lesson `claimWork` learned).
*/
async function organizationTable(mclient) {
    let found = await mclient.query(
        "SELECT to_regclass('\"$organization_settings\"') IS NOT NULL " +
        "AS found"
    );

    if (found.rows[0].found) {
        return;
    }

    await mclient.query(
        "SELECT pg_advisory_lock(hashtext('featherbone.orgsettings'))"
    );

    try {
        await mclient.query(
            "CREATE TABLE IF NOT EXISTS " + ORG_TABLE + " (" +
            "  organization_pk bigint NOT NULL," +
            "  name text NOT NULL," +
            "  data jsonb NOT NULL DEFAULT '{}'::jsonb," +
            "  etag text NOT NULL," +
            "  updated timestamp with time zone NOT NULL DEFAULT now()," +
            "  updated_by text NOT NULL DEFAULT ''," +
            "  PRIMARY KEY (organization_pk, name)" +
            ")"
        );
    } finally {
        await mclient.query(
            "SELECT pg_advisory_unlock(hashtext('featherbone.orgsettings'))"
        );
    }
}

/*
    The organization's values for one settings document, decrypted,
    or undefined when the organization has none yet -- which is what
    every organization looks like until the first save, and why the
    caller falls back to the instance's own values rather than
    blanking an address and a mail account on upgrade.
*/
async function readOrganizationSettings(database, name, definition) {
    return await platform.run(async function (mclient) {
        let orgPk = await platform.organizationOf(mclient, database);

        if (orgPk === undefined) {
            return undefined;
        }

        await organizationTable(mclient);

        let resp = await mclient.query(
            "SELECT data FROM " + ORG_TABLE +
            " WHERE organization_pk = $1 AND name = $2",
            [orgPk, name]
        );

        if (!resp.rows.length) {
            return undefined;
        }

        let data = resp.rows[0].data || {};
        let props = (definition || {}).properties || {};
        let keys = Object.keys(data);
        let i = 0;

        // Same key, same cipher, in the manager this time
        while (i < keys.length) {
            let p = props[keys[i]];

            if (p && (p.isEncrypted && data[keys[i]])) {
                let got = await mclient.query(
                    "SELECT pgp_sym_decrypt($1::BYTEA, $2) AS value",
                    [data[keys[i]], pgdb.cryptoKey()]
                );

                data[keys[i]] = got.rows[0].value;
            }
            i += 1;
        }

        return data;
    });
}

async function writeOrganizationSettings(database, name, data, opts) {
    let definition = opts.definition;
    let user = opts.user || "";

    return await platform.run(async function (mclient) {
        let orgPk = await platform.organizationOf(mclient, database);

        if (orgPk === undefined) {
            /*
                An instance that belongs to no organization has
                nowhere to put these. It cannot be signed in to
                either, so this is a database being set up rather
                than one in use; let the instance keep them.
            */
            return false;
        }

        await organizationTable(mclient);

        let props = (definition || {}).properties || {};
        let store = f.copy(data);
        let keys = Object.keys(store);
        let i = 0;

        while (i < keys.length) {
            let p = props[keys[i]];

            if (p && (p.isEncrypted && store[keys[i]] !== undefined)) {
                let got = await mclient.query(
                    "SELECT pgp_sym_encrypt($1, $2)::TEXT AS value",
                    [store[keys[i]], pgdb.cryptoKey()]
                );

                store[keys[i]] = got.rows[0].value;
            }
            i += 1;
        }

        await mclient.query(
            "INSERT INTO " + ORG_TABLE + " (organization_pk, name, " +
            " data, etag, updated, updated_by) " +
            "VALUES ($1, $2, $3, $4, now(), $5) " +
            "ON CONFLICT (organization_pk, name) DO UPDATE SET " +
            "  data = $3, etag = $4, updated = now(), updated_by = $5",
            [orgPk, name, store, opts.etag, user]
        );

        return true;
    });
}

/*
    The other databases' cached copies of this settings document go:
    the values are the organization's now, so an edit made in one of
    its instances is an edit to what the others read. The saving
    database keeps its entry, which the save has just filled in with
    what was submitted -- callers hold a pointer to that object, and
    replacing it is what the read path takes care not to do. Other
    nodes keep their own caches, as they always have.
*/
function forgetElsewhere(name, except) {
    Object.keys(dbsettings).forEach(function (key) {
        if (key !== except && dbsettings[key].data) {
            delete dbsettings[key].data[name];
        }
    });
}

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

                /*
                    The organization's own values for the properties
                    marked as its own, laid over the instance's. An
                    organization that has never saved them has no row,
                    and the instance's values stand -- so nothing goes
                    blank on the upgrade that introduced this, and the
                    first save is what moves them.
                */
                let shared = organizationProperties(rec.definition);

                if (shared.length) {
                    let mine = await readOrganizationSettings(
                        db,
                        name,
                        rec.definition
                    );

                    if (mine) {
                        // A row never saved has a definition and no
                        // data yet; the organization's values still
                        // stand over it
                        rec.data = rec.data || {};
                        shared.forEach(function (key) {
                            if (mine[key] !== undefined) {
                                rec.data[key] = mine[key];
                            }
                        });
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
    The catalog of the client's own database, from cache when it is
    already loaded (ADR-002: a catalog belongs to a database, not to the
    process). Returns the parsed catalog object.

    @method catalogFor
    @for Services.Settings
    @param {Client} client Database client
    @return {Promise}
*/
settings.catalogFor = async function (theClient) {
    let db = theClient.database;

    if (
        dbsettings[db] &&
        dbsettings[db].data.catalog &&
        dbsettings[db].data.catalog.data
    ) {
        return dbsettings[db].data.catalog.data;
    }

    return await settings.getSettings({
        client: theClient,
        data: {name: "catalog"}
    });
};

/**
    The cached catalog of a database by name, or undefined when that
    database's catalog has not been read yet. Synchronous by design:
    URL name resolution happens before any client exists.

    @method cachedCatalog
    @for Services.Settings
    @param {String} database
    @return {Object|undefined}
*/
settings.cachedCatalog = function (database) {
    if (
        dbsettings[database] &&
        dbsettings[database].data.catalog
    ) {
        return dbsettings[database].data.catalog.data;
    }
    return undefined;
};

/**
    Every feather name any loaded catalog knows, merged. Only for
    mounting routes: requests are always validated against the single
    database they are for.

    @method unionCatalog
    @for Services.Settings
    @return {Object}
*/
settings.unionCatalog = function () {
    let ret = {};

    Object.keys(dbsettings).forEach(function (db) {
        let cat = settings.cachedCatalog(db);

        if (cat) {
            Object.keys(cat).forEach(function (name) {
                if (
                    ret[name] === undefined ||
                    ret[name].isReadOnly && !cat[name].isReadOnly
                ) {
                    ret[name] = cat[name];
                }
            });
        }
    });

    return ret;
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
        "FROM \"$settings\" AS settings, \"$auth\" AS auth " +
        "WHERE settings.name = $1 " +
        "  AND settings._pk = auth.object_pk " +
        "  AND auth.role IN (" + tools.memberNames(2) + ") " +
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

    if (resp.rows.length) {
        return true;
    }

    /*
        The people who administer the organization own what is shared
        across it. They need not be a super user of the instance: a
        profile made on first sign-in carries no authority, so without
        this an organization administrator was disabled out of their
        own global settings and needed platform help (John, Oct 2026:
        "you should only have to be an org admin"). Only the settings
        named in ORG_ADMIN_SETTINGS, so this does not widen anything
        else a super user alone may change.
    */
    if (ORG_ADMIN_SETTINGS.indexOf(name) === -1) {
        return false;
    }

    return await platform.run(
        (mclient) => platform.administersInstance(
            mclient,
            client.database,
            user
        )
    );
};

/*
    Settings the platform owns rather than the instance (tenant plan
    D.5). A setting is one of these when its own definition says
    `isPlatformOnly`, or when config.json's `platformOnlySettings`
    names it -- the second so an installation can lock down a module's
    setting without waiting for the module to declare it.

    The edition is the case this exists for: it decides what an
    instance offers, which is the platform's to say and not the
    customer's, even though the customer's own administrator is super
    user in their instance.
*/
async function isPlatformOnly(client, name) {
    let conf = await config.read();
    let named = conf.platformOnlySettings;

    if (Array.isArray(named) && named.indexOf(name) !== -1) {
        return true;
    }

    let resp = await client.query(
        "SELECT definition FROM \"$settings\" WHERE name = $1",
        [name]
    );

    return Boolean(
        resp.rows.length &&
        resp.rows[0].definition &&
        resp.rows[0].definition.isPlatformOnly === true
    );
}

/**
    Whether a setting belongs to the platform, and if so whether this
    user may change it. Resolves to a message when they may not, and to
    undefined when the question does not arise.

    @method platformRefusal
    @for Services.Settings
    @param {Object} client Database client
    @param {String} name Settings name
    @param {String} user
    @return {Promise} String or undefined
*/
settings.platformRefusal = async function (client, name, user) {
    if (!await isPlatformOnly(client, name)) {
        return;
    }

    let allowed = await platform.run(
        (mclient) => platform.isPlatformAdminOf(
            mclient,
            client.database,
            user
        )
    );

    if (allowed) {
        return;
    }

    return (
        "Settings \"" + name + "\" are the platform's to set. Ask a " +
        "platform administrator."
    );
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
        /*
            Before the instance's own authorization: a super user of
            the instance passes that check, and the point of a
            platform setting is that they should not pass this one
            (tenant plan D.5).
        */
        if (!obj.isInternal) {
            let refusal = await settings.platformRefusal(
                client,
                name,
                obj.user || client.currentUser()
            );

            if (refusal) {
                return Promise.reject({
                    message: refusal,
                    statusCode: 401
                });
            }
        }

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

            /*
                The organization's share goes to the organization,
                and the instance keeps the rest. Both are written:
                the instance's row still carries every property, so a
                database detached from its organization still has
                values to fall back on and the definition still
                matches what is stored beside it.
            */
            let shared = organizationProperties(row.definition);

            if (shared.length) {
                let mine = {};

                shared.forEach(function (key) {
                    if (d[key] !== undefined) {
                        mine[key] = d[key];
                    }
                });

                await writeOrganizationSettings(db, name, mine, {
                    definition: row.definition,
                    etag: tag,
                    user: obj.user || client.currentUser()
                });
            }

            sql = (
                "UPDATE \"$settings\" SET " +
                " data = $2, etag = $3, " +
                " updated = now(), updated_by = $4 " +
                "WHERE name = $1;"
            );
            await client.query(sql, params);
            done();

            if (shared.length) {
                forgetElsewhere(name, db);
            }

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
