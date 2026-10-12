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
function dumpRestore() {
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
        "--no-owner", "-d", settings.testDb
    ]), {env: envVars, input: dump, maxBuffer: 1024 * 1024 * 64});
}

/*
    A deterministic set of ids keeps the fixture rows recognizable and
    the inserts idempotent.
*/
const FIXTURE = {
    serviceId: "fbtsvc000001",
    tenantId: "fbttenant001",
    moduleId: "fbtmodule001",
    routeId: "fbtroute0001"
};

// Register the second copy as a tenant of the first, and deploy the
// fbtest fixture: module rows point at versions of a package that only
// exists on disk, which is what ADR-002 is for. The first copy runs
// 1.0.0, the second 1.1.0.
async function deployFixtures() {
    const DOC = (
        "_pk,id,created,created_by,updated,updated_by,is_deleted," +
        "owner,etag"
    );
    const VALS = (
        "nextval('object__pk_seq'),$1,now(),'admin',now(),'admin'," +
        "false,'admin',$1"
    );

    await withClient(settings.testDb, async function (client) {
        await client.query((
            "INSERT INTO tenant_service (" + DOC + ",name,pg_host," +
            "pg_port,pg_user,pg_password) VALUES (" + VALS + ",$2,$3," +
            "$4,$5,pgp_sym_encrypt($6, $7)::text)"
        ), [
            FIXTURE.serviceId, "Fixture service", settings.pgHost,
            String(settings.pgPort), settings.pgUser,
            settings.pgPassword, settings.pgCryptoKey
        ]);
        await client.query((
            "INSERT INTO tenant (" + DOC + ",name,is_active," +
            "_pg_service_tenant_service_pk,pg_database) SELECT " + VALS +
            ",$2,true,_pk,$3 FROM tenant_service WHERE id = $4"
        ), [
            FIXTURE.tenantId, settings.testDb2, settings.testDb2,
            FIXTURE.serviceId
        ]);
        await client.query((
            "INSERT INTO module (" + DOC + ",name,script,version) " +
            "VALUES (" + VALS + ",'fbtest','','1.0.0')"
        ), [FIXTURE.moduleId]);
        await client.query((
            "INSERT INTO route (" + DOC + ",module,path,function) " +
            "VALUES (" + VALS + ",'fbtest','/version','fbtestVersion')"
        ), [FIXTURE.routeId]);
    });

    await withClient(settings.testDb2, async function (client) {
        await client.query((
            "INSERT INTO module (" + DOC + ",name,script,version) " +
            "VALUES (" + VALS + ",'fbtest','','1.1.0')"
        ), [FIXTURE.moduleId]);
        await client.query((
            "INSERT INTO route (" + DOC + ",module,path,function) " +
            "VALUES (" + VALS + ",'fbtest','/version','fbtestVersion')"
        ), [FIXTURE.routeId]);
    });
}

async function clone() {
    if (settings.testDb === settings.sourceDb) {
        throw new Error("FB_TEST_DB must differ from the source database");
    }
    if (settings.testDb2 === settings.testDb) {
        throw new Error("FB_TEST_DB2 must differ from FB_TEST_DB");
    }

    await withClient("postgres", async function (client) {
        if (!await exists(client, settings.sourceDb)) {
            throw new Error(
                "Source database \"" + settings.sourceDb +
                "\" not found. Set FB_TEST_SOURCE_DB."
            );
        }
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.testDb
        ));
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.testDb2
        ));
        try {
            await client.query(format(
                "CREATE DATABASE %I TEMPLATE %I",
                settings.testDb,
                settings.sourceDb
            ));
        } catch (err) {
            if (!/being accessed by other users/.test(err.message)) {
                throw err;
            }
            // Source is in use: create empty and copy with pg_dump
            await client.query(format(
                "CREATE DATABASE %I",
                settings.testDb
            ));
            dumpRestore();
        }

        // Nothing is connected to the fresh copy yet, so a template
        // clone is cheap and always available
        await client.query(format(
            "CREATE DATABASE %I TEMPLATE %I",
            settings.testDb2,
            settings.testDb
        ));
    });

    await deployFixtures();
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
            settings.testDb2
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
