/*
    Helpers for the framework data API tests (crud, query, locking,
    catalog, schema): error assertions, extra sign-in users created in
    SQL, and the time the test run started (to tell installed metadata
    from records other test files create in the same database).
*/
/*jslint node*/
"use strict";

const assert = require("node:assert/strict");
const settings = require("../../harness/env");
const db = require("../../harness/db");
const {signedIn} = require("../../harness/http");

// Assert a raw() response is an error with the given status and a JSON
// string body matching pattern (string = exact, RegExp = match).
function expectError(resp, status, pattern) {
    assert.equal(
        resp.status,
        status,
        "expected HTTP " + status + ", got " + resp.status + ": " +
        JSON.stringify(resp.body)
    );
    if (pattern === undefined) {
        return;
    }
    assert.equal(typeof resp.body, "string", "error body is a JSON string");
    if (pattern instanceof RegExp) {
        assert.match(resp.body, pattern);
    } else {
        assert.equal(resp.body, pattern);
    }
}

// Value of op for path in a JSON patch
function patchValue(patch, path) {
    let op = patch.find((o) => o.path === path);
    return (
        op
        ? op.value
        : undefined
    );
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Super user account plus the identity that signs in as it (ADR-001).
// Returns the user name. Names are per test database so parallel runs
// do not collide.
async function createSuperUser(tag) {
    let name = "fbtest_" + tag + "_" + settings.testDb;
    await db.withClient(settings.testDb, async function (client) {
        await client.query(
            "DELETE FROM user_account WHERE name = $1",
            [name]
        );
        await client.query(
            "DELETE FROM \"$profiles\" WHERE role = $1",
            [name]
        );
        await client.query((
            "INSERT INTO user_account (" +
            "  id, name, is_super, is_active, is_login, change_password, " +
            "  sign_in_attempts, is_locked, is_deleted, owner, etag, " +
            "  created, created_by, updated, updated_by) " +
            "VALUES ($1, $2, true, true, true, false, 0, false, false, " +
            "  $2, $1, now(), $2, now(), $2)"
        ), [tag + Date.now().toString(36), name]);
    });

    // The identity that signs in as them (ADR-001), granted this instance
    await db.ensureIdentity(name, settings.password, settings.testDb);
    return name;
}

async function signedInAs(tag) {
    let name = await createSuperUser(tag);
    let session = await signedIn(name);
    session.userName = name;
    return session;
}

// The account dies with the test database; just end the session
async function dropUser(session) {
    if (!session) {
        return;
    }
    try {
        await session.signOut();
    } catch (ignore) {
        // Server may already be gone
    }
}

// When test/run.js bootstrapped this database. Metadata (feathers,
// workbooks, routes) created before it came with the cloned database;
// anything later was made by a test file.
async function runStarted() {
    let resp = await db.query(
        "SELECT created FROM user_account WHERE name = $1",
        [settings.adminUser]
    );
    return resp.rows[0].created;
}

module.exports = {
    createSuperUser,
    dropUser,
    escapeRegExp,
    expectError,
    patchValue,
    runStarted,
    signedInAs
};
