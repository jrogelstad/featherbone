/*
    Provisioning as a resumable state machine (tenant plan D.1).

    A platform administrator builds an instance from a template through
    the Instances screen's routes: the tenant row and its provisioning
    record are written first, each step is claimed and committed on its
    own, and a build that fails part-way is resumed from the step it
    stopped at rather than started over. Dropping an instance drops the
    database through the guarded D.2 API and retires the registration.

    The failure used here is a real one: the guarded clone refuses a
    busy source, so holding a connection on the template makes the
    "requested" step fail exactly the way a production build would.
    Releasing the connection and resuming finishes the build without
    orphaning anything, which is the item's done-when.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {Client} = require("pg");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const PROV_DB = (settings.testDb + "_prov").toLowerCase();
const BARE_DB = (settings.testDb + "_bare").toLowerCase();

function flags(username, data) {
    return db.withClient(
        settings.managerDb,
        (client) => client.query(
            (
                "UPDATE identity SET is_org_admin = $2, " +
                "is_platform_admin = $3 WHERE username = $1"
            ),
            [
                username,
                data.isOrgAdmin === true,
                data.isPlatformAdmin === true
            ]
        )
    );
}

async function provisionRow(database) {
    return await db.withClient(
        settings.managerDb,
        async function (client) {
            let resp = await client.query(
                (
                    "SELECT p.state, p.detail, t.is_active, t.id " +
                    "FROM \"$provision\" p " +
                    "JOIN tenant t ON t._pk = p.tenant_pk " +
                    "WHERE t.pg_database = $1 AND NOT t.is_deleted"
                ),
                [database]
            );

            return resp.rows[0];
        }
    );
}

async function dbExists(name) {
    let resp = await db.withClient(
        "postgres",
        (client) => client.query(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            [name]
        )
    );

    return resp.rows.length > 0;
}

async function cleanup() {
    await db.withClient("postgres", async function (client) {
        await client.query(
            "DROP DATABASE IF EXISTS " + PROV_DB + " WITH (FORCE)"
        );
        await client.query(
            "DROP DATABASE IF EXISTS " + BARE_DB + " WITH (FORCE)"
        );
    });
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            (
                "DELETE FROM \"$provision\" WHERE tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = ANY($1))"
            ),
            [[PROV_DB, BARE_DB]]
        ).catch(function () {
            return;
        });
        await client.query(
            (
                "DELETE FROM access_grant WHERE _tenant_tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = ANY($1))"
            ),
            [[PROV_DB, BARE_DB]]
        );
        await client.query(
            "DELETE FROM tenant WHERE pg_database = ANY($1)",
            [[PROV_DB, BARE_DB]]
        );
    });
}

describe("provisioning (D.1)", function () {
    let admin;
    let service;

    before(async function () {
        await cleanup();
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        admin = new Session();
        let resp = await admin.signIn(
            settings.adminUser,
            settings.password
        );
        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let overview = await admin.get("/admin/instances");
        service = overview.services[0].id;
        assert.ok(service, "the fixture connection is listed");
    });

    after(async function () {
        await flags(settings.adminUser, {});
        await cleanup();
    });

    it("offers templates to build from", async function () {
        let overview = await admin.get("/admin/instances");

        assert.ok(Array.isArray(overview.templates));
    });

    it("refuses a build from anyone below platform", async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let resp = await admin.raw("POST", "/admin/instance/provision", {
            database: PROV_DB,
            name: "Provisioned",
            service,
            template: settings.testDb2
        });

        assert.equal(resp.status, 401);
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("a failed step leaves a resumable record, not an orphan",
            async function () {
        /*
            Hold a connection on the template: the guarded clone
            refuses a busy source, so the "requested" step fails the
            way it would in production.
        */
        let holder = new Client({
            database: settings.testDb2,
            host: settings.pgHost,
            password: settings.pgPassword,
            port: settings.pgPort,
            user: settings.pgUser
        });
        await holder.connect();

        let resp;

        try {
            resp = await admin.raw("POST", "/admin/instance/provision", {
                database: PROV_DB,
                name: "Provisioned",
                service,
                template: settings.testDb2
            });
        } finally {
            await holder.end();
        }

        assert.ok(resp.status >= 400, "the failed build answers an error");

        let row = await provisionRow(PROV_DB);
        assert.ok(row, "the provisioning record survives the failure");
        assert.equal(row.state, "requested", "stopped where it failed");
        assert.ok(row.detail.length > 0, "and says why");
        assert.equal(row.is_active, false, "not open for sign-in");
        assert.equal(
            await dbExists(PROV_DB),
            false,
            "no orphaned database"
        );
    });

    it("resume finishes the build from where it stopped",
            async function () {
        let row = await provisionRow(PROV_DB);
        let resp = await admin.raw(
            "POST",
            "/admin/instance/provision/resume",
            {id: row.id}
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.state, "active");
        assert.equal(await dbExists(PROV_DB), true);

        row = await provisionRow(PROV_DB);
        assert.equal(row.state, "active");
        assert.equal(row.is_active, true, "open for sign-in");
    });

    it("seeds every organization administrator into the new instance",
            async function () {
        let grant = await db.withClient(
            settings.managerDb,
            async function (client) {
                let resp = await client.query(
                    (
                        "SELECT g.is_active FROM access_grant g " +
                        "JOIN identity i " +
                        "  ON g._identity_identity_pk = i._pk " +
                        "JOIN tenant t ON g._tenant_tenant_pk = t._pk " +
                        "WHERE i.username = $1 AND t.pg_database = $2 " +
                        "  AND NOT g.is_deleted"
                    ),
                    [settings.adminUser, PROV_DB]
                );

                return resp.rows[0];
            }
        );

        assert.ok(grant, "the administrator holds a grant");
        assert.equal(grant.is_active, true);

        let account = await db.withClient(PROV_DB, async function (client) {
            let resp = await client.query(
                (
                    "SELECT is_super, is_active FROM user_account " +
                    "WHERE name = $1"
                ),
                [settings.adminUser]
            );

            return resp.rows[0];
        });

        assert.ok(account, "and a profile in the new instance");
        assert.equal(account.is_super, true, "a tenant super user");
    });

    it("signs the administrator in to what was just built",
            async function () {
        let base = settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + PROV_DB
        );
        let s = new Session(base);
        let resp = await s.signIn(settings.adminUser, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        await s.signOut();
    });

    it("resuming a finished build is a no-op", async function () {
        let row = await provisionRow(PROV_DB);
        let resp = await admin.raw(
            "POST",
            "/admin/instance/provision/resume",
            {id: row.id}
        );

        assert.equal(resp.status, 200);
        assert.equal(resp.body.state, "active");
    });

    it("refuses a database name that already exists", async function () {
        let resp = await admin.raw("POST", "/admin/instance/provision", {
            database: PROV_DB,
            name: "Again",
            service,
            template: settings.testDb2
        });

        assert.equal(resp.status, 400);
        assert.match(String(resp.body), /already exists/);
    });

    it("will not register a database whose marker is not an instance",
            async function () {
        await db.withClient("postgres", async function (client) {
            await client.query("CREATE DATABASE " + BARE_DB);
        });

        let resp = await admin.raw("POST", "/admin/instance", {
            database: BARE_DB,
            name: "Bare",
            service
        });

        assert.equal(resp.status, 400);
        assert.match(String(resp.body), /not a Featherbone instance/);
    });

    it("will not register the manager", async function () {
        let resp = await admin.raw("POST", "/admin/instance", {
            database: settings.managerDb,
            name: "Manager",
            service
        });

        assert.equal(resp.status, 400);
    });

    it("a closed instance refuses sign-in", async function () {
        let row = await provisionRow(PROV_DB);
        let resp = await admin.raw("POST", "/admin/instance/status", {
            id: row.id,
            isActive: false
        });
        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let base = settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + PROV_DB
        );
        let attempt = await new Session(base).signIn(
            settings.adminUser,
            settings.password
        );

        assert.equal(attempt.status, 401, "closed means closed");

        resp = await admin.raw("POST", "/admin/instance/status", {
            id: row.id,
            isActive: true
        });
        assert.equal(resp.status, 200);
    });

    it("refuses to drop the instance you are signed in to",
            async function () {
        let overview = await admin.get("/admin/instances");
        let current = overview.instances.find((row) => row.isCurrent);
        let resp = await admin.raw("POST", "/admin/instance/drop", {
            id: current.id
        });

        assert.equal(resp.status, 400);
        assert.match(String(resp.body), /inside itself/);
    });

    it("refuses a drop from anyone below platform", async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let row = await provisionRow(PROV_DB);
        let resp = await admin.raw("POST", "/admin/instance/drop", {
            id: row.id
        });

        assert.equal(resp.status, 401);
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("drops the database and retires the registration",
            async function () {
        let row = await provisionRow(PROV_DB);
        let resp = await admin.raw("POST", "/admin/instance/drop", {
            id: row.id
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(await dbExists(PROV_DB), false, "database gone");

        let gone = await provisionRow(PROV_DB);
        assert.equal(gone, undefined, "registration retired");

        let audit = await db.withClient(
            settings.managerDb,
            async function (client) {
                let found = await client.query(
                    (
                        "SELECT 1 FROM admin_audit " +
                        "WHERE action = 'instance.dropped' " +
                        "  AND detail LIKE $1"
                    ),
                    ["%" + PROV_DB + "%"]
                );

                return found.rows.length;
            }
        );

        assert.equal(audit, 1, "and the drop is audited");
    });
});
