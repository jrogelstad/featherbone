/*
    Node identity (tenant plan A.2): every server process registers a unique
    node id, and startup cleanup only removes locks and subscriptions that
    belong to nodes which are no longer running.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {Client} = require("pg");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Events} = require("../../server/services/events");
const {signedIn} = require("../harness/http");
const {uniq} = require("../harness/fixtures");

function connect() {
    let client = new Client({
        database: settings.testDb,
        host: settings.pgHost,
        password: settings.pgPassword,
        port: settings.pgPort,
        user: settings.pgUser
    });
    return client.connect().then(() => client);
}

describe("node identity", function () {
    let admin;
    let clients = [];
    let events = new Events();

    before(async function () {
        admin = await signedIn();
    });

    after(async function () {
        await Promise.all(clients.map((c) => c.end()));
    });

    it("gives the running server a per-process node id", async function () {
        let kind = await admin.create("Kind", {
            code: uniq("NDI"),
            description: "node id probe"
        });
        await admin.raw("POST", "/do/lock", {id: kind.id, eventKey: "ek-nd"});
        let resp = await db.query(
            "SELECT _nodeid(lock) AS n FROM object WHERE id = $1",
            [kind.id]
        );
        await admin.raw("POST", "/do/unlock", {id: kind.id});
        assert.match(resp.rows[0].n, /^[a-z0-9_]+_\d+_[0-9a-f]{6}$/);
    });

    it("cleans up dead nodes but leaves live nodes alone", async function () {
        let dead = uniq("dead").toLowerCase().replace(/\W/g, "_");
        let live = uniq("live").toLowerCase().replace(/\W/g, "_");
        let kindDead = await admin.create("Kind", {
            code: uniq("NDD"),
            description: "locked by a dead node"
        });
        let kindLive = await admin.create("Kind", {
            code: uniq("NDL"),
            description: "locked by a live node"
        });

        async function register(node, kind) {
            await db.query(
                "INSERT INTO \"$subscription\" VALUES ($1, 'ek', 'sid', $2)",
                [node, kind.id]
            );
            await db.query(
                "UPDATE object SET lock = ROW('someone', now(), $1, 'ek', " +
                "'Editing')::lock WHERE id = $2",
                [node, kind.id]
            );
        }

        await register(dead, kindDead);
        await register(live, kindLive);

        // The live node's listener connection holds the advisory lock
        let listener = await connect();
        clients.push(listener);
        await events.listen(
            Object.assign(listener, {tenant: () => undefined}),
            live,
            () => undefined
        );

        let cleaner = await connect();
        clients.push(cleaner);
        let cleaned = await events.cleanupNodes(cleaner);
        assert.ok(cleaned.includes(dead), "dead node cleaned");
        assert.ok(!cleaned.includes(live), "live node left alone");

        let subs = await db.query(
            "SELECT nodeid FROM \"$subscription\" WHERE nodeid = ANY($1)",
            [[dead, live]]
        );
        assert.deepEqual(subs.rows.map((r) => r.nodeid), [live]);
        let locks = await db.query(
            "SELECT id, _nodeid(lock) AS n FROM object WHERE id = ANY($1)",
            [[kindDead.id, kindLive.id]]
        );
        let byId = Object.fromEntries(locks.rows.map((r) => [r.id, r.n]));
        assert.equal(byId[kindDead.id], null);
        assert.equal(byId[kindLive.id], live);

        // Once the live node's connection closes it counts as dead
        await listener.end();
        clients.splice(clients.indexOf(listener), 1);
        await new Promise((r) => setTimeout(r, 200));
        cleaned = await events.cleanupNodes(cleaner);
        assert.ok(cleaned.includes(live), "stopped node cleaned");
    });
});
