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
        let before = await db.query(
            "SELECT sign_in_attempts FROM user_account WHERE name = $1",
            [settings.adminUser]
        );
        let resp = await new Session().signIn(undefined, "not-the-password");

        assert.equal(resp.status, 401);
        let after = await db.query(
            "SELECT sign_in_attempts FROM user_account WHERE name = $1",
            [settings.adminUser]
        );
        assert.equal(
            after.rows[0].sign_in_attempts,
            before.rows[0].sign_in_attempts + 1
        );

        // A good sign-in afterwards still works and resets nothing we
        // depend on for the rest of the suite
        assert.equal((await new Session().signIn()).status, 200);
        await db.query(
            "UPDATE user_account SET sign_in_attempts = 0 WHERE name = $1",
            [settings.adminUser]
        );
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

    // Improvement plan 1.6: failed sign-ins must not strand connections
    it("does not leak database connections on failed sign-ins", {
        todo: "plan 1.6: authenticate() leaks a pooled connection per failure"
    }, async function () {
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
