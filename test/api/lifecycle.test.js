/*
    Template management and the expired-demo sweep (tenant plan D.4).

    A platform administrator copies a quiet instance into a frozen
    template database from the Instances screen, and new instances
    provision from it. The service account does the copying -- it owns
    what it installed -- and only the pg_database template mark needs a
    superuser, so the mark is best effort and a template without it
    provisions all the same.

    A demo instance with an expiration in the past is closed by the
    sweep: the server runs it hourly, the route runs it on demand, and
    closing stops sign-ins without touching the data.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const TPL_DB = (settings.testDb + "_tpl").toLowerCase();
const FROM_TPL_DB = (settings.testDb + "_oftpl").toLowerCase();

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

async function demoClock(database, isDemo, expiration) {
    await db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE tenant SET is_demo = $2, expiration = $3, " +
            "is_active = true WHERE pg_database = $1"
        ),
        [database, isDemo, expiration]
    ));
}

async function cleanup() {
    await db.withClient("postgres", async function (client) {
        await client.query(
            "DROP DATABASE IF EXISTS " + FROM_TPL_DB + " WITH (FORCE)"
        );
        await client.query(
            "ALTER DATABASE " + TPL_DB + " IS_TEMPLATE false"
        ).catch(function () {
            return;
        });
        await client.query(
            "DROP DATABASE IF EXISTS " + TPL_DB + " WITH (FORCE)"
        );
    });
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            (
                "DELETE FROM \"$provision\" WHERE tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = $1)"
            ),
            [FROM_TPL_DB]
        ).catch(function () {
            return;
        });
        await client.query(
            (
                "DELETE FROM access_grant WHERE _tenant_tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = $1)"
            ),
            [FROM_TPL_DB]
        );
        await client.query(
            "DELETE FROM tenant WHERE pg_database = $1",
            [FROM_TPL_DB]
        );
    });
}

describe("templates and the demo sweep (D.4)", function () {
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

        /*
            The harness grants each user the instance it bootstraps;
            the closed-demo test signs in to the second one, so grant
            that too (the profile makes itself on the strength of the
            grant, B.7).
        */
        await db.ensureIdentity(
            settings.basicUser,
            settings.password,
            settings.testDb2
        );
    });

    after(async function () {
        await demoClock(settings.testDb2, false, null);
        await flags(settings.adminUser, {});
        await cleanup();
    });

    it("refuses a template build from anyone below platform",
            async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let resp = await admin.raw("POST", "/admin/template", {
            name: TPL_DB,
            source: settings.testDb2
        });

        assert.equal(resp.status, 401);
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("refuses to copy a database that is not a registered instance",
            async function () {
        let resp = await admin.raw("POST", "/admin/template", {
            name: TPL_DB,
            source: settings.managerDb
        });

        assert.equal(resp.status, 400);
    });

    it("builds a template from a quiet instance", async function () {
        let resp = await admin.raw("POST", "/admin/template", {
            name: TPL_DB,
            source: settings.testDb2
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.template, TPL_DB);

        let there = await db.withClient(
            "postgres",
            (client) => client.query(
                "SELECT datistemplate FROM pg_database WHERE datname = $1",
                [TPL_DB]
            )
        );

        assert.equal(there.rows.length, 1, "the template exists");
        /*
            The service account is not a superuser here, so the mark is
            expected to be best effort; what matters is the build said
            so rather than failing.
        */
        assert.equal(resp.body.marked, there.rows[0].datistemplate);

        let audited = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT 1 FROM admin_audit " +
                    "WHERE action = 'template.built' AND detail LIKE $1"
                ),
                [TPL_DB + "%"]
            )
        );

        assert.equal(audited.rows.length, 1, "and audited");
    });

    it("the template provisions a new instance", async function () {
        let resp = await admin.raw("POST", "/admin/instance/provision", {
            database: FROM_TPL_DB,
            name: "From template",
            service,
            template: TPL_DB
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.state, "active");

        // And the administrator can sign in to what it produced
        let base = settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + FROM_TPL_DB
        );
        let s = new Session(base);
        let signedIn = await s.signIn(
            settings.adminUser,
            settings.password
        );

        assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
        await s.signOut();
    });

    it("rebuilding replaces the template in place", async function () {
        let resp = await admin.raw("POST", "/admin/template", {
            name: TPL_DB,
            source: settings.testDb2
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    it("the sweep closes an expired demo and only that",
            async function () {
        let yesterday = new Date(Date.now() - 86400000).toISOString();

        await demoClock(settings.testDb2, true, yesterday);

        let resp = await admin.raw(
            "POST",
            "/admin/instances/sweep",
            {}
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.ok(
            resp.body.length >= 1,
            "the expired demo is in the answer"
        );

        let rows = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT pg_database, is_active FROM tenant " +
                    "WHERE NOT is_deleted AND pg_database = ANY($1)"
                ),
                [[settings.testDb, settings.testDb2]]
            )
        );
        let one = rows.rows.find(
            (row) => row.pg_database === settings.testDb2
        );
        let other = rows.rows.find(
            (row) => row.pg_database === settings.testDb
        );

        assert.equal(one.is_active, false, "the expired demo closed");
        assert.equal(other.is_active, true, "everything else untouched");

        let audited = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT 1 FROM admin_audit " +
                    "WHERE action = 'instance.demo_expired' " +
                    "  AND detail LIKE $1"
                ),
                ["%" + settings.testDb2 + "%"]
            )
        );

        assert.equal(audited.rows.length, 1, "and audited");
    });

    it("a closed demo refuses sign-in until it is reopened",
            async function () {
        let base = settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + settings.testDb2
        );
        let attempt = await new Session(base).signIn(
            settings.basicUser,
            settings.password
        );

        assert.equal(attempt.status, 401);

        // Put the fixture back the way the other suites expect it
        await demoClock(settings.testDb2, false, null);

        let again = await new Session(base).signIn(
            settings.basicUser,
            settings.password
        );

        assert.equal(again.status, 200, JSON.stringify(again.body));
    });

    it("running the sweep again closes nothing", async function () {
        let resp = await admin.raw(
            "POST",
            "/admin/instances/sweep",
            {}
        );

        assert.equal(resp.status, 200);
        assert.deepEqual(resp.body, []);
    });
});
