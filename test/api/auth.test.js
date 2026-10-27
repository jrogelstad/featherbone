/*
    Sign-in, session and sign-out behavior (server.js doSignIn/doSignOut,
    database.authenticate, deserializeUser).
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");

describe("authentication", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    it("signs in with valid credentials and returns the user profile",
            async function () {
        let s = new Session();
        let resp = await s.signIn();

        assert.equal(resp.status, 200);
        assert.equal(resp.body.name, settings.adminUser);
        assert.equal(resp.body.isSuper, true);
        assert.equal(resp.body.changePassword, false);
        assert.ok(s.cookie, "session cookie set");
    });

    it("rejects a wrong password with 401 and counts the attempt",
            async function () {
        // The counter lives on the identity, in the manager (ADR-001
        // B.2), not on the instance's user_account any more
        function attempts() {
            return db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "SELECT failed_attempts FROM identity " +
                        "WHERE lower(username) = lower($1) " +
                        "  AND NOT is_deleted"
                    ),
                    [settings.adminUser]
                )
            );
        }

        let before = await attempts();
        let resp = await new Session().signIn(undefined, "not-the-password");

        assert.equal(resp.status, 401);

        let after = await attempts();

        assert.equal(
            after.rows[0].failed_attempts,
            before.rows[0].failed_attempts + 1
        );

        // A good sign-in afterwards still works, and resets the counter
        assert.equal((await new Session().signIn()).status, 200);
        assert.equal((await attempts()).rows[0].failed_attempts, 0);
    });

    it("rejects an unknown user", async function () {
        let resp = await new Session().signIn("fbtest_nobody", "x");
        assert.equal(resp.status, 401);
    });

    it("blocks data requests without a session", async function () {
        let resp = await new Session().raw("POST", "/data/contacts", {});
        assert.ok(
            resp.status === 401 || resp.status === 403 ||
            resp.status === 302,
            "expected an auth failure, got " + resp.status
        );
    });

    it("serves data requests with a session", async function () {
        let rows = await admin.list("Contacts", {filter: {limit: 1}});
        assert.ok(Array.isArray(rows));
    });

    it("ends the session on sign-out", async function () {
        let s = await signedIn();
        let out = await s.signOut();
        assert.ok(out.status < 400, "sign-out status " + out.status);

        let resp = await s.raw("POST", "/data/contacts", {});
        assert.ok(
            resp.status >= 300,
            "request after sign-out should fail, got " + resp.status
        );
    });

    /*
        The signed-in label in the ribbon reads all of this off the
        connect payload (John, Oct 2026: "I'd like to see who I'm
        logged as over near the alarm bell"). The organization is the
        part worth a test: it is not on the session, it is read from
        the manager, and it is the one thing a screen could not say
        before.
    */
    it("tells a connected client who it is signed in as", async function () {
        let resp = await admin.raw("POST", "/connect");
        let who = resp.body.data.authorized;

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(who.name, settings.adminUser);
        assert.ok(who.organization, "the organization is named");
        assert.equal(typeof who.organizationId, "string");

        /*
            What it says of their authority is read where the authority
            lives: the platform flag on the identity, and administering
            this organization as an appointment over it (ADR-001
            revision 4).
        */
        let identity = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT i.is_platform_admin, " +
                    "  (a._pk IS NOT NULL) AS is_org_admin " +
                    "FROM identity i " +
                    "LEFT JOIN tenant t ON t.pg_database = $2 " +
                    "LEFT JOIN organization_admin a " +
                    "  ON a._identity_identity_pk = i._pk " +
                    "    AND a._organization_organization_pk = " +
                    "      t._organization_organization_pk " +
                    "    AND a.is_active AND NOT a.is_deleted " +
                    "WHERE lower(i.username) = lower($1) " +
                    "  AND NOT i.is_deleted"
                ),
                [settings.adminUser, settings.testDb]
            )
        );

        assert.equal(who.isOrgAdmin, identity.rows[0].is_org_admin);
        assert.equal(who.isPlatformAdmin, identity.rows[0].is_platform_admin);
    });

    it("answers a connect from nobody the way it always did",
            async function () {
        let resp = await new Session().raw("POST", "/connect");

        assert.ok(
            resp.status < 500,
            "status " + resp.status + " " + JSON.stringify(resp.body)
        );
        assert.ok(
            !resp.body.data || !resp.body.data.authorized,
            "and nobody is reported signed in"
        );
    });

    // Improvement plan 1.6: failed sign-ins must not strand connections
    it("does not leak database connections on failed sign-ins",
            async function () {
        async function connections() {
            let r = await db.query(
                "SELECT count(*)::int AS n FROM pg_stat_activity " +
                "WHERE datname = $1",
                [settings.testDb]
            );
            return r.rows[0].n;
        }
        let start = await connections();
        let i = 0;
        while (i < 5) {
            await new Session().signIn("fbtest_nobody", "x");
            i += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.equal(await connections(), start);
    });
});
