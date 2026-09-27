/*
    Record locks: POST /do/lock and /do/unlock (server.js doLock/doUnlock
    -> datasource.lock/unlock -> crud.lock/unlock) and how PATCH and
    DELETE (crud.doUpdate/doDelete) treat a record locked by another user
    or another browser instance (eventKey). Also pins that there is no
    etag-based optimistic concurrency: a JSON patch "test" op is the only
    guard against stale writes.

    A second super user is created in SQL for the "other session".
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {signedIn} = require("../harness/http");
const {uniq} = require("../harness/fixtures");
const {
    dropUser,
    escapeRegExp,
    expectError,
    signedInAs
} = require("./lib/data-api");

describe("record locking", function () {
    let admin;
    let other;

    async function lockRow(id) {
        let resp = await db.query(
            "SELECT to_json(lock) AS lock FROM object WHERE id = $1",
            [id]
        );
        return resp.rows[0].lock;
    }

    function newKind(description) {
        return admin.create("Kind", {
            code: uniq("LCK"),
            description: description || "Lock me"
        });
    }

    before(async function () {
        admin = await signedIn();
        other = await signedInAs("lock");
    });

    after(async function () {
        await dropUser(other);
    });

    describe("POST /do/lock", function () {
        let kind;

        before(async function () {
            kind = await newKind();
        });

        it("locks a record for the user and browser instance",
                async function () {
            let resp = await admin.raw("POST", "/do/lock", {
                id: kind.id,
                eventKey: "ek-admin-1"
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.body, true);

            let lock = await lockRow(kind.id);
            assert.equal(lock.username, settings.adminUser);
            assert.equal(lock._eventkey, "ek-admin-1");
            assert.equal(lock.process, "Editing");
            assert.ok(lock._nodeid, "node id recorded");
            assert.ok(!Number.isNaN(Date.parse(lock.created)));
        });

        it("shows the lock on read without internal keys", async function () {
            let read = await admin.read("Kind", kind.id);
            assert.deepEqual(
                Object.keys(read.lock).sort(),
                ["created", "process", "username"]
            );
            assert.equal(read.lock.username, settings.adminUser);
        });

        it("is idempotent for the same eventKey", async function () {
            let resp = await admin.raw("POST", "/do/lock", {
                id: kind.id,
                eventKey: "ek-admin-1"
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.body, true);
        });

        it("refuses the same user in another browser instance",
                async function () {
            expectError(
                await admin.raw("POST", "/do/lock", {
                    id: kind.id,
                    eventKey: "ek-admin-2"
                }),
                500,
                "Record " + kind.id + " on Kind is already locked by " +
                settings.adminUser
            );
        });

        it("refuses another user", async function () {
            expectError(
                await other.raw("POST", "/do/lock", {
                    id: kind.id,
                    eventKey: "ek-other"
                }),
                500,
                "Record " + kind.id + " on Kind is already locked by " +
                settings.adminUser
            );
            assert.equal((await lockRow(kind.id))._eventkey, "ek-admin-1");
        });

        it("validates its input", async function () {
            expectError(
                await admin.raw("POST", "/do/lock", {
                    id: "nosuchid",
                    eventKey: "ek"
                }),
                500,
                "Record nosuchid not found."
            );
            expectError(
                await admin.raw("POST", "/do/lock", {id: kind.id}),
                500,
                "Lock requires an eventkey."
            );
            expectError(
                await admin.raw("POST", "/do/lock", {eventKey: "ek"}),
                500,
                "Lock requires an object id."
            );
        });
    });

    describe("changes to a locked record", function () {
        let kind;

        before(async function () {
            kind = await newKind("Locked");
            await admin.post("/do/lock", {id: kind.id, eventKey: "ek-a"});
        });

        it("refuses a PATCH from another user", async function () {
            let resp = await other.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "Other"}
            ]);
            expectError(
                resp,
                500,
                new RegExp(
                    "^Record " + kind.id + " object type .* is locked by " +
                    escapeRegExp(settings.adminUser) +
                    " and cannot be updated\\.$"
                )
            );
            assert.equal((await admin.read("Kind", kind.id)).description, "Locked");
        });

        it("names the object type in the PATCH lock error", {
            todo: "defect: message says 'object type undefined' - " +
                    "crud.js:2109 reads objectType that was not selected"
        }, async function () {
            let resp = await other.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "Other"}
            ]);
            expectError(
                resp,
                500,
                "Record " + kind.id + " object type Kind is locked by " +
                settings.adminUser + " and cannot be updated."
            );
        });

        it("refuses a DELETE from another user", async function () {
            expectError(
                await other.raw("DELETE", "/data/kind/" + kind.id),
                500,
                "Record " + kind.id + " type Kind is locked by " +
                settings.adminUser + " and cannot be deleted."
            );
            let row = await db.query(
                "SELECT is_deleted FROM object WHERE id = $1",
                [kind.id]
            );
            assert.equal(row.rows[0].is_deleted, false);
        });

        it("refuses the lock holder without the matching eventKey",
                async function () {
            let resp = await admin.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "No key"}
            ]);
            expectError(resp, 500, /is locked by .* cannot be updated/);
            resp = await admin.raw(
                "PATCH",
                "/data/kind/" + kind.id + "?eventKey=ek-wrong",
                [{op: "replace", path: "/description", value: "Wrong key"}]
            );
            expectError(resp, 500, /is locked by .* cannot be updated/);
        });

        it("does not let another user unlock it", async function () {
            let resp = await other.raw("POST", "/do/unlock", {id: kind.id});
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, []);
            assert.equal((await lockRow(kind.id))._eventkey, "ek-a");
        });

        it("accepts a PATCH with the holder's eventKey and releases the lock",
                async function () {
            let resp = await admin.raw(
                "PATCH",
                "/data/kind/" + kind.id + "?eventKey=ek-a",
                [{op: "replace", path: "/description", value: "Saved"}]
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal((await admin.read("Kind", kind.id)).description, "Saved");
            assert.equal(await lockRow(kind.id), null);
        });

        it("lets the other user change it once unlocked", async function () {
            let resp = await other.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "Other"}
            ]);
            assert.equal(resp.status, 200);
            let read = await admin.read("Kind", kind.id);
            assert.equal(read.description, "Other");
            assert.equal(read.updatedBy, other.userName);
        });

        it("lets the holder delete with its eventKey, clearing the lock",
                async function () {
            let doomed = await newKind("Delete me");
            await admin.post("/do/lock", {id: doomed.id, eventKey: "ek-d"});
            let resp = await admin.raw(
                "DELETE",
                "/data/kind/" + doomed.id + "?eventKey=ek-d"
            );
            assert.equal(resp.status, 200);
            let row = await db.query(
                "SELECT is_deleted, lock IS NULL AS unlocked FROM object " +
                "WHERE id = $1",
                [doomed.id]
            );
            assert.deepEqual(row.rows[0], {is_deleted: true, unlocked: true});
        });
    });

    describe("POST /do/unlock", function () {
        it("releases the caller's lock and answers the ids",
                async function () {
            let kind = await newKind();
            await admin.post("/do/lock", {id: kind.id, eventKey: "ek-u"});
            let resp = await admin.raw("POST", "/do/unlock", {id: kind.id});
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, [{id: kind.id}]);
            assert.equal(await lockRow(kind.id), null);

            // Nothing left to release
            resp = await admin.raw("POST", "/do/unlock", {id: kind.id});
            assert.deepEqual(resp.body, []);
        });

        it("without an id releases every lock of the user on this node",
                async function () {
            let a = await newKind();
            let b = await newKind();
            let theirs = await newKind();
            await admin.post("/do/lock", {id: a.id, eventKey: "ek-1"});
            await admin.post("/do/lock", {id: b.id, eventKey: "ek-2"});
            await other.post("/do/lock", {id: theirs.id, eventKey: "ek-3"});

            let resp = await admin.raw("POST", "/do/unlock", {});
            assert.equal(resp.status, 200);
            let ids = resp.body.map((r) => r.id);
            assert.ok(ids.includes(a.id) && ids.includes(b.id));
            assert.ok(!ids.includes(theirs.id));
            assert.equal(await lockRow(a.id), null);
            assert.equal(await lockRow(b.id), null);
            assert.equal((await lockRow(theirs.id)).username, other.userName);

            await other.post("/do/unlock", {id: theirs.id});
            assert.equal(await lockRow(theirs.id), null);
        });
    });

    describe("concurrent edits (etag)", function () {
        let kind;

        before(async function () {
            kind = await newKind("Original");
            // Someone else saves first; kind.etag is now stale
            await admin.patch("Kind", kind.id, [
                {op: "replace", path: "/description", value: "First"}
            ]);
        });

        it("does not reject a write based on a stale etag", async function () {
            // Pinned: etag is regenerated on every save but never checked
            let resp = await other.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/etag", value: kind.etag},
                {op: "replace", path: "/description", value: "Second"}
            ]);
            assert.equal(resp.status, 200);
            let read = await admin.read("Kind", kind.id);
            assert.equal(read.description, "Second");
            assert.notEqual(read.etag, kind.etag);
        });

        it("honors a JSON patch test op as a stale-write guard",
                async function () {
            let resp = await other.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "test", path: "/etag", value: kind.etag},
                {op: "replace", path: "/description", value: "Third"}
            ]);
            expectError(resp, 500, /^Test operation failed/);
            assert.match(resp.body, /TEST_OPERATION_FAILED/);
            assert.equal((await admin.read("Kind", kind.id)).description, "Second");
        });
    });
});
