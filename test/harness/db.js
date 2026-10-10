/*
    Regression test harness: database lifecycle.

    clone()     copy the source database (default "demo") into the test
                database, dropping any previous copy first
    bootstrap() create the super user the suite signs in as
    drop()      remove the test database and test roles
    query()     run SQL against the test database (assertion helper)
*/
/*jslint node*/
"use strict";

const {Client} = require("pg");
const {execFileSync} = require("child_process");
const format = require("pg-format");
const settings = require("./env");

function connection(database) {
    return {
        database,
        host: settings.pgHost,
        password: settings.pgPassword,
        port: settings.pgPort,
        user: settings.pgUser
    };
}

async function withClient(database, fn) {
    const client = new Client(connection(database));
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}

async function exists(client, name) {
    let resp = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = $1",
        [name]
    );
    return resp.rows.length > 0;
}

// Fallback when the source database has open connections (for example a
// running Featherbone server): dump and restore with the pg client tools.
function dumpRestore(target) {
    const envVars = Object.assign({}, process.env, {
        PGPASSWORD: settings.pgPassword
    });
    const common = [
        "-h", settings.pgHost,
        "-p", String(settings.pgPort),
        "-U", settings.pgUser
    ];
    const dump = execFileSync("pg_dump", common.concat([
        "-Fc", settings.sourceDb
    ]), {env: envVars, maxBuffer: 1024 * 1024 * 1024});
    execFileSync("pg_restore", common.concat([
        "--no-owner", "-d", target
    ]), {env: envVars, input: dump, maxBuffer: 1024 * 1024 * 64});
}

async function copyInto(client, target) {
    await client.query(format(
        "DROP DATABASE IF EXISTS %I WITH (FORCE)",
        target
    ));
    try {
        await client.query(format(
            "CREATE DATABASE %I TEMPLATE %I",
            target,
            settings.sourceDb
        ));
    } catch (err) {
        if (!/being accessed by other users/.test(err.message)) {
            throw err;
        }
        // Source is in use: create empty and copy with pg_dump
        await client.query(format("CREATE DATABASE %I", target));
        dumpRestore(target);
    }
}

/*
    Say what a copy is for. The source may still carry a schema 1 marker
    ("controlPlane", "tenant" or "both"), whose check constraint would
    refuse the new values, so the constraint is replaced the same way
    `scripts/tables.js` replaces it on an upgrade.
*/
async function markAs(database, kind) {
    await withClient(database, async function (client) {
        await client.query(
            "ALTER TABLE \"$db\" DROP CONSTRAINT IF EXISTS \"$db_kind_check\""
        );
        await client.query(format("UPDATE \"$db\" SET kind = %L", kind));
        await client.query(
            "ALTER TABLE \"$db\" ADD CONSTRAINT \"$db_kind_check\" " +
            "CHECK (kind IN ('manager', 'instance'))"
        );
    });
}

/*
    Register the instance under test in the manager, so the server can
    reach it. Any registry rows the source database happened to carry
    are dropped first: they point at databases this run knows nothing
    about, and the server would open a pool for each one.
*/
async function registerInstance() {
    await withClient(settings.managerDb, async function (client) {
        await client.query("DELETE FROM tenant");
        await client.query("DELETE FROM tenant_service");
        await client.query((
            "INSERT INTO tenant_service (_pk, id, created, created_by, " +
            "updated, updated_by, is_deleted, owner, etag, name, pg_host, " +
            "pg_port, pg_user, pg_password) VALUES " +
            "(nextval('object__pk_seq'), 'fbtsvc', now(), $1, now(), $1, " +
            "false, $1, 'fbtsvce', 'Default service', $2, $3, $1, " +
            "pgp_sym_encrypt($4, $5)::text)"
        ), [
            settings.pgUser, settings.pgHost, String(settings.pgPort),
            settings.pgPassword, settings.pgCryptoKey
        ]);
        await client.query((
            "INSERT INTO tenant (_pk, id, created, created_by, updated, " +
            "updated_by, is_deleted, owner, etag, name, is_active, " +
            "_pg_service_tenant_service_pk, pg_database) SELECT " +
            "nextval('object__pk_seq'), 'fbtinst', now(), $1, now(), $1, " +
            "false, $1, 'fbtinste', $2, true, _pk, $2 " +
            "FROM tenant_service WHERE id = 'fbtsvc'"
        ), [settings.pgUser, settings.testDb]);
    });
}

async function clone() {
    if (settings.testDb === settings.sourceDb) {
        throw new Error("FB_TEST_DB must differ from the source database");
    }
    if (settings.managerDb === settings.sourceDb) {
        throw new Error(
            "FB_TEST_MANAGER_DB must differ from the source database"
        );
    }
    if (settings.managerDb === settings.testDb) {
        throw new Error("FB_TEST_MANAGER_DB must differ from FB_TEST_DB");
    }

    await withClient("postgres", async function (client) {
        if (!await exists(client, settings.sourceDb)) {
            throw new Error(
                "Source database \"" + settings.sourceDb +
                "\" not found. Set FB_TEST_SOURCE_DB."
            );
        }
        await copyInto(client, settings.testDb);
        await copyInto(client, settings.managerDb);
    });

    await markAs(settings.testDb, "instance");
    await markAs(settings.managerDb, "manager");
    await registerInstance();
}

async function ensureRole(client, name, password) {
    let resp = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [name]
    );
    let verb = (
        resp.rows.length
        ? "ALTER"
        : "CREATE"
    );
    await client.query(format(
        verb + " ROLE %I LOGIN PASSWORD %L",
        name,
        password
    ));
}

// Create a Featherbone user account plus its Postgres login role in SQL
// (the API needs a signed-in user to create users, and POST
// /data/user-account is currently broken; see api/users.test.js).
// Returns the account id.
async function createUser(client, name, password, isSuper) {
    await ensureRole(client, name, password);

    let everyone = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'everyone'"
    );
    if (everyone.rows.length) {
        await client.query(format("GRANT everyone TO %I", name));
    }

    await client.query("DELETE FROM user_account WHERE name = $1", [name]);
    let id = "fbtest" + Date.now().toString(36) + (
        isSuper
        ? "s"
        : "b"
    );
    await client.query((
        "INSERT INTO user_account (" +
        "  id, name, is_super, is_active, is_login, change_password, " +
        "  sign_in_attempts, is_locked, is_deleted, owner, etag, " +
        "  created, created_by, updated, updated_by) " +
        "VALUES ($1, $2, $3, true, true, false, 0, false, false, " +
        "  $2, $1, now(), $2, now(), $2)"
    ), [id, name, Boolean(isSuper)]);
    return id;
}

// Create the super user the suite signs in with and a basic (non-super,
// member of "everyone" only) user for authorization tests.
async function bootstrap() {
    await withClient(settings.testDb, async function (client) {
        await createUser(client, settings.adminUser, settings.password, true);
        await createUser(client, settings.basicUser, settings.password, false);
    });
}

async function drop() {
    if (settings.keepDb) {
        return;
    }
    await withClient("postgres", async function (client) {
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.testDb
        ));
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.managerDb
        ));
        let roles = [settings.adminUser, settings.basicUser];
        let i = 0;
        while (i < roles.length) {
            try {
                await client.query(format(
                    "DROP ROLE IF EXISTS %I",
                    roles[i]
                ));
            } catch (ignore) {
                // Role still referenced elsewhere; leave it
            }
            i += 1;
        }
    });
}

// Assertion helper: query the test database directly
async function query(sql, params) {
    return withClient(settings.testDb, (client) => client.query(sql, params));
}

module.exports = {bootstrap, clone, createUser, drop, query, withClient};
