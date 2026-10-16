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
const {Identities} = require("../../server/services/identities");

const identities = new Identities();

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

/*
    A deterministic set of ids keeps the fixture rows recognizable and
    the inserts idempotent.
*/
const FIXTURE = {
    serviceId: "fbtsvc000001",
    tenantId: "fbttenant001",
    tenant2Id: "fbttenant002",
    moduleId: "fbtmodule001",
    routeId: "fbtroute0001",
    /*
        The organization both test instances belong to. Sign-in is by
        identity (ADR-001), so every test user is an identity in it
        with a grant to the instance it signs in to; the Postgres login
        role is kept only while the role path still exists (B.8).
    */
    organizationId: "fbtorg000001",
    organizationName: "FBTest"
};

const DOC_COLS = (
    "_pk,id,created,created_by,updated,updated_by,is_deleted," +
    "owner,etag"
);
const DOC_VALS = (
    "nextval('object__pk_seq'),$1,now(),'admin',now(),'admin'," +
    "false,'admin',$1"
);

async function copyInto(client, target, template) {
    await client.query(format(
        "DROP DATABASE IF EXISTS %I WITH (FORCE)",
        target
    ));
    try {
        await client.query(format(
            "CREATE DATABASE %I TEMPLATE %I",
            target,
            template
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
            "ALTER TABLE \"$db\" DROP CONSTRAINT IF EXISTS " +
            "\"$db_kind_check\""
        );
        await client.query(format("UPDATE \"$db\" SET kind = %L", kind));
        await client.query(
            "ALTER TABLE \"$db\" ADD CONSTRAINT \"$db_kind_check\" " +
            "CHECK (kind IN ('manager', 'instance'))"
        );
    });
}

/*
    Register both instances in the manager, so the server can reach
    them. Any registry rows the source database happened to carry are
    dropped first: they point at databases this run knows nothing
    about, and the server would open a pool for each one.
*/
async function registerInstances() {
    await withClient(settings.managerDb, async function (client) {
        await client.query("DELETE FROM tenant");
        await client.query("DELETE FROM tenant_service");
        await client.query((
            "INSERT INTO tenant_service (" + DOC_COLS + ",name," +
            "pg_host,pg_port,pg_user,pg_password) VALUES (" + DOC_VALS +
            ",$2,$3,$4,$5,pgp_sym_encrypt($6, $7)::text)"
        ), [
            FIXTURE.serviceId, "Fixture service", settings.pgHost,
            String(settings.pgPort), settings.pgUser,
            settings.pgPassword, settings.pgCryptoKey
        ]);

        async function addTenant(id, database) {
            await client.query((
                "INSERT INTO tenant (" + DOC_COLS + ",name,is_active," +
                "_pg_service_tenant_service_pk,pg_database) SELECT " +
                DOC_VALS + ",$2,true,_pk,$3 FROM tenant_service " +
                "WHERE id = $4"
            ), [id, database, database, FIXTURE.serviceId]);
        }

        await addTenant(FIXTURE.tenantId, settings.testDb);
        await addTenant(FIXTURE.tenant2Id, settings.testDb2);

        // The organization, and both instances in it
        await client.query("DELETE FROM access_grant");
        await client.query("DELETE FROM identity");
        await client.query("DELETE FROM organization");
        await client.query((
            "INSERT INTO organization (" + DOC_COLS + ",name,is_active," +
            "authentication,is_two_factor_required) VALUES (" + DOC_VALS +
            ",$2,true,'password',false)"
        ), [FIXTURE.organizationId, FIXTURE.organizationName]);
        await client.query((
            "UPDATE tenant SET _organization_organization_pk = " +
            "  (SELECT _pk FROM organization WHERE id = $1)"
        ), [FIXTURE.organizationId]);
    });
}

/*
    Make `name` an identity in the test organization, with a grant to
    `database`, creating or updating as needed. Idempotent, so a suite
    may call it for a user the harness already made. `opts.hash`
    stores a verifier as given (the migration path imports pg_authid
    verifiers); otherwise the password is hashed the application's
    way. Resolves to the identity's primary key.
*/
async function ensureIdentity(name, password, database, opts) {
    opts = opts || {};

    return await withClient(settings.managerDb, async function (client) {
        let org = await client.query(
            "SELECT _pk FROM organization WHERE id = $1",
            [FIXTURE.organizationId]
        );
        let orgPk = org.rows[0]._pk;
        let hash = opts.hash || identities.hashPassword(password);
        let found = await client.query(
            (
                "SELECT _pk FROM identity " +
                "WHERE _organization_organization_pk = $1 " +
                "  AND lower(username) = lower($2) AND NOT is_deleted"
            ),
            [orgPk, name]
        );
        let pk;

        if (found.rows.length) {
            pk = found.rows[0]._pk;
            await client.query(
                (
                    "UPDATE identity SET password_hash = $2, " +
                    "  status = 'active', failed_attempts = 0, " +
                    "  locked_until = null, " +
                    "  is_org_admin = $3, is_platform_admin = $4, " +
                    "  updated = now(), updated_by = 'fbtest' " +
                    "WHERE _pk = $1"
                ),
                [
                    pk,
                    hash,
                    Boolean(opts.isOrgAdmin),
                    Boolean(opts.isPlatformAdmin)
                ]
            );
        } else {
            let made = await client.query((
                "INSERT INTO identity (" + DOC_COLS +
                ",_organization_organization_pk,username,full_name," +
                "email,password_hash,status,is_platform_admin," +
                "is_org_admin,failed_attempts) VALUES (" + DOC_VALS +
                ",$2,$3,$3,'',$4,'active',$5,$6,0) RETURNING _pk"
            ), [
                opts.id || ("fbti" + Date.now().toString(36) + (
                    Math.random().toString(36).slice(2, 6)
                )),
                orgPk,
                name,
                hash,
                Boolean(opts.isPlatformAdmin),
                Boolean(opts.isOrgAdmin)
            ]);
            pk = made.rows[0]._pk;
        }

        if (database) {
            let grant = await client.query(
                (
                    "SELECT g._pk FROM access_grant g " +
                    "JOIN tenant t ON g._tenant_tenant_pk = t._pk " +
                    "WHERE g._identity_identity_pk = $1 " +
                    "  AND t.pg_database = $2 AND NOT g.is_deleted"
                ),
                [pk, database]
            );

            if (grant.rows.length) {
                await client.query(
                    "UPDATE access_grant SET is_active = true WHERE _pk = $1",
                    [grant.rows[0]._pk]
                );
            } else {
                await client.query((
                    "INSERT INTO access_grant (" + DOC_COLS +
                    ",_identity_identity_pk,_tenant_tenant_pk,is_active," +
                    "granted) SELECT " + DOC_VALS +
                    ",$2,_pk,true,now() FROM tenant WHERE pg_database = $3"
                ), [
                    opts.grantId || ("fbtg" + Date.now().toString(36) + (
                        Math.random().toString(36).slice(2, 6)
                    )),
                    pk,
                    database
                ]);
            }
        }

        return pk;
    });
}

/*
    Deploy the fbtest fixture: module rows point at versions of a
    package that exists only on disk under test/fixtures/modules, which
    is what ADR-002 is for. The first instance runs 1.0.0, the second
    1.1.0.
*/
async function deployFixtures() {
    async function deploy(database, version) {
        await withClient(database, async function (client) {
            await client.query((
                "INSERT INTO module (" + DOC_COLS + ",name,script," +
                "version) VALUES (" + DOC_VALS + ",'fbtest','',$2)"
            ), [FIXTURE.moduleId, version]);
            await client.query((
                "INSERT INTO route (" + DOC_COLS + ",module,path," +
                "function) VALUES (" + DOC_VALS +
                ",'fbtest','/version','fbtestVersion')"
            ), [FIXTURE.routeId]);
        });
    }

    await deploy(settings.testDb, "1.0.0");
    await deploy(settings.testDb2, "1.1.0");
}

async function clone() {
    if (settings.testDb === settings.sourceDb) {
        throw new Error("FB_TEST_DB must differ from the source database");
    }
    if (settings.testDb2 === settings.testDb) {
        throw new Error("FB_TEST_DB2 must differ from FB_TEST_DB");
    }
    if (
        settings.managerDb === settings.sourceDb ||
        settings.managerDb === settings.testDb ||
        settings.managerDb === settings.testDb2
    ) {
        throw new Error(
            "FB_TEST_MANAGER_DB must differ from the other databases"
        );
    }

    await withClient("postgres", async function (client) {
        if (!await exists(client, settings.sourceDb)) {
            throw new Error(
                "Source database \"" + settings.sourceDb +
                "\" not found. Set FB_TEST_SOURCE_DB."
            );
        }
        await copyInto(client, settings.testDb, settings.sourceDb);

        // Nothing is connected to the fresh copy yet, so template
        // clones of it are cheap and always available
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.testDb2
        ));
        await client.query(format(
            "CREATE DATABASE %I TEMPLATE %I",
            settings.testDb2,
            settings.testDb
        ));
        await client.query(format(
            "DROP DATABASE IF EXISTS %I WITH (FORCE)",
            settings.managerDb
        ));
        await client.query(format(
            "CREATE DATABASE %I TEMPLATE %I",
            settings.managerDb,
            settings.testDb
        ));
    });

    await markAs(settings.testDb, "instance");
    await markAs(settings.testDb2, "instance");
    await markAs(settings.managerDb, "manager");
    await registerInstances();
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

    // And the identity that signs in as them
    let here = await client.query("SELECT current_database() AS db");

    await ensureIdentity(name, password, here.rows[0].db);
    return id;
}

// Create the super user the suite signs in with and a basic (non-super,
// member of "everyone" only) user for authorization tests.
async function bootstrap() {
    await withClient(settings.testDb, async function (client) {
        await createUser(client, settings.adminUser, settings.password, true);
        await createUser(client, settings.basicUser, settings.password, false);
    });

    // The second database carries the same super user, so suites that
    // talk to both do not depend on whatever accounts the source holds
    if (settings.testDb2 !== settings.testDb) {
        await withClient(settings.testDb2, async function (client) {
            await createUser(client, settings.adminUser, settings.password, true);
        });
    }
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

module.exports = {
    FIXTURE,
    bootstrap,
    clone,
    createUser,
    drop,
    ensureIdentity,
    query,
    withClient
};
