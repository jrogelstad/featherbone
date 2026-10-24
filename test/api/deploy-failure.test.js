/*
    A package install that fails, and one that seeds its own feather.

    A deploy of SupplyChain failed on `relation "_sales_region" does not
    exist` and the platform console said "Deployed" over it. Three
    separate things were wrong, and each is pinned here:

    - A batch of records for a feather the install itself creates ran
      before that feather's view existed, because an umbrella install
      makes views at the end. It now waits for them.
    - The installer's rollback never marked its progress record failed,
      so the record stayed "processing" until the next restart swept it.
    - The fleet routes answer 200 with `ok: false` results, which is
      what the platform console has to read. The console's own half of
      this (it said "Deployed" whatever the answer) is client code and
      is not covered here.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const VALUE = "FBT Fail";

function flags(username, data) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE identity SET is_org_admin = $2, " +
            "  is_platform_admin = $3, updated = now(), " +
            "  updated_by = 'fbtest' " +
            "WHERE lower(username) = lower($1)"
        ),
        [
            username,
            data.isOrgAdmin === true,
            data.isPlatformAdmin === true
        ]
    ));
}

async function signedIn() {
    let session = new Session(ROOT);
    let resp = await session.signIn(
        settings.adminUser,
        settings.password,
        "FBTest"
    );

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

async function fleetEntry(session) {
    let overview = await session.get("/platform/overview");
    let found = (overview.fleet || []).find(
        (one) => one.database === settings.testDb
    );

    assert.ok(found, "the instance is listed");
    return found;
}

function failedLinks() {
    return db.withClient(settings.testDb, (client) => client.query(
        "SELECT id FROM help_link WHERE display_value = $1",
        [VALUE]
    ));
}

describe("a package install that fails", function () {
    let session;
    let target;
    let processId = "fbtfail" + Date.now().toString(36);

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        session = await signedIn();
        target = await fleetEntry(session);
    });

    after(async function () {
        // Whatever happened above, leave the instance open
        await session.raw("POST", "/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: false
        });
        await flags(settings.adminUser, {});
    });

    it("answers with an error that names the package and the reason",
            async function () {
        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtfail",
            processId,
            version: "1.0.0"
        });

        assert.ok(resp.status >= 400, "not a success: " + resp.status);
        assert.match(JSON.stringify(resp.body), /fbtfail 1\.0\.0 was not deployed/);
    });

    it("rolls back what the package had already written",
            async function () {
        let resp = await failedLinks();

        assert.equal(resp.rows.length, 0, "the first batch is undone");
    });

    it("marks the install's progress record failed, with the reason",
            async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT status, error_message FROM server_process " +
                "WHERE id = $1",
                [processId]
            )
        );

        assert.equal(resp.rows.length, 1, "the record exists");
        assert.equal(resp.rows[0].status, "E", "failed, not processing");
        assert.ok(resp.rows[0].error_message, "and says why");
    });

    it("leaves the instance held, and lets it go on request",
            async function () {
        let held = await fleetEntry(session);
        let resp;
        let released;

        assert.equal(held.isMaintenance, true, "held after the failure");

        resp = await session.raw("POST", "/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: false
        });
        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        released = await fleetEntry(session);
        assert.equal(released.isMaintenance, false);
    });

    it("reports the failure in the fleet answer, which is a 200",
            async function () {
        let resp = await session.raw("POST", "/platform/instances/deploy", {
            instances: [target.id],
            module: "fbtfail",
            version: "1.0.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.failed, 1);
        assert.equal(resp.body.deployed, 0);
        assert.equal(resp.body.results[0].ok, false);
        assert.match(resp.body.results[0].message, /was not deployed/);
    });
});

describe("a package that seeds records into its own feather", function () {
    let session;
    let target;

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        session = await signedIn();
        target = await fleetEntry(session);
    });

    after(async function () {
        await flags(settings.adminUser, {});
    });

    /*
        Installed through an umbrella manifest, as SupplyChain is: that
        is the only path that defers the views, so a flat package would
        pass without testing anything.
    */
    it("deploys, rather than failing on a view that is not there yet",
            async function () {
        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtseed",
            version: "1.0.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    it("has the records the package carried", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT code FROM fbt_seed WHERE NOT is_deleted " +
                "ORDER BY code"
            )
        );

        assert.deepEqual(
            resp.rows.map((row) => row.code),
            ["ALPHA", "BETA"]
        );
    });

    it("has the dashboard layout the package shipped", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT name, label, module, config FROM \"$dashboard\" " +
                "WHERE name = 'FbtSeedBoard' AND NOT is_deleted"
            )
        );
        let found = resp.rows[0];

        assert.ok(found, "the layout the package carried is there");
        assert.equal(found.label, "Seed Board");
        assert.equal(found.module, "fbtseed");
        // The whole spec travels, not just the name: a layout that
        // arrived without its tiles would be a board to assemble.
        assert.equal(found.config.tiles.length, 1);
        assert.equal(found.config.tiles[0].cols, 5);
        assert.equal(found.config.asOf, "2027-05-31");
    });

    it("makes the shipped layout the default", async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT name FROM \"$dashboard\" " +
                "WHERE is_default AND NOT is_deleted ORDER BY name"
            )
        );

        assert.deepEqual(
            resp.rows.map((row) => row.name),
            ["FbtSeedBoard"],
            "exactly one default, and it is the one shipped"
        );
    });

    it("leaves the instance open afterwards", async function () {
        let now = await fleetEntry(session);

        assert.equal(now.isMaintenance, false);
    });
});
