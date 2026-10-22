/*
    What a database on packages may still change about itself, and what
    it is told (ADR-002 section 2).

    A module the server holds on disk runs from the package: the loader
    skips that module's `data_service` rows and reads `module.script`
    from the file. The rows stay -- they are the fallback for a module
    with no package, and the record of what a database carried before
    it was packaged -- but they are no longer what runs.

    Nothing used to say so. A super user could edit a service script in
    the Develop workbook, save it, see it saved, and get the package's
    code on the next load. This file holds down the two answers to
    that: the write is refused and says why, and the screens say which
    half of the split each module is on -- including the case nobody
    would otherwise notice, where the instance names a version this
    server does not hold and quietly falls back to its own tables.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

function flags(username, data) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE identity SET is_org_admin = $2, " +
            "  is_platform_admin = $3 WHERE lower(username) = lower($1)"
        ),
        [
            username,
            data.isOrgAdmin === true,
            data.isPlatformAdmin === true
        ]
    ));
}

function moduleRow(database) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            (
                "SELECT id, name, version, script FROM module " +
                "WHERE name = 'fbtest' AND NOT is_deleted"
            )
        );

        return resp.rows[0];
    });
}

function serviceRow(database) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            (
                "SELECT id, module, name FROM data_service " +
                "WHERE module = 'fbtest' AND NOT is_deleted LIMIT 1"
            )
        );

        return resp.rows[0];
    });
}

function setVersion(database, version) {
    return db.withClient(database, (client) => client.query(
        "UPDATE module SET version = $1 WHERE name = 'fbtest'",
        [version]
    ));
}

describe("a module served from its package (ADR-002)", function () {
    let admin;
    let was;
    let auditMark;

    before(async function () {
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
        was = (await moduleRow(settings.testDb)).version;

        /*
            The deployment below writes its own audit rows, and
            fleet.test.js counts the rows for the same package and
            version. Mark where this file starts so it can take back
            only what it added.
        */
        auditMark = await db.withClient(
            settings.managerDb,
            async function (client) {
                let resp = await client.query(
                    "SELECT coalesce(max(_pk), 0) AS mark FROM admin_audit"
                );

                return resp.rows[0].mark;
            }
        );
    });

    after(async function () {
        /*
            The fixture state the other files expect: the first
            instance back on its own version, and the fixture's code on
            disk only -- the leftover row the refusal test plants is
            taken away, which modules.test.js asserts is absent.
        */
        await db.withClient(settings.testDb, async function (client) {
            await client.query(
                "DELETE FROM data_service WHERE module = 'fbtest'"
            );
        });
        await setVersion(settings.testDb, was);
        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "DELETE FROM admin_audit WHERE _pk > $1 " +
                "  AND detail LIKE 'fbtest%'"
            ),
            [auditMark]
        ));
        await flags(settings.adminUser, {});
    });

    it("refuses a change to the client script, and says why",
            async function () {
        let row = await moduleRow(settings.testDb);

        assert.ok(row, "the fixture module is deployed here");

        let resp = await admin.raw(
            "PATCH",
            "/data/module/" + row.id,
            [{op: "replace", path: "/script", value: "// edited"}]
        );

        assert.equal(resp.status, 405, JSON.stringify(resp.body));
        assert.match(String(resp.body), /not stored in the database/);
        assert.match(
            String(resp.body),
            /deploy it/,
            "and says what to do instead"
        );

        let after = await moduleRow(settings.testDb);

        assert.equal(after.script, row.script, "and nothing changed");
    });

    it("lets the deployment itself write the record, and no code", async function () {
        /*
            The refusal is by where the call came from, not by who made
            it: Install and Deploy write these rows as part of their
            work and arrive with a client of their own.
        */
        let resp = await admin.raw("POST", "/admin/instance/deploy", {
            id: await db.withClient(
                settings.managerDb,
                async function (client) {
                    let found = await client.query(
                        (
                            "SELECT id FROM tenant " +
                            "WHERE pg_database = $1 AND NOT is_deleted"
                        ),
                        [settings.testDb]
                    );

                    return found.rows[0].id;
                }
            ),
            module: "fbtest",
            version: "1.1.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        // And, now that the code is on disk, writes none of it down
        assert.equal(
            await serviceRow(settings.testDb),
            undefined,
            "a package's services are served from its files"
        );
    });

    it("refuses a change to a service script", async function () {
        /*
            Deploying no longer writes one, so the row this guards is a
            leftover from before: a database that took the package the
            old way. Put one there the way it would have been.
        */
        await db.withClient(settings.testDb, async function (client) {
            await client.query(
                (
                    "INSERT INTO data_service " +
                    "  (id, name, module, script, is_deleted) " +
                    "VALUES ('fbtlegacyds', 'fbtest-service', 'fbtest', " +
                    "  '// leftover', false)"
                )
            );
        });

        let row = await serviceRow(settings.testDb);

        assert.ok(row, "the leftover row is there");

        let resp = await admin.raw(
            "PATCH",
            "/data/data-service/" + row.id,
            [{op: "replace", path: "/script", value: "// edited"}]
        );

        assert.equal(resp.status, 405, JSON.stringify(resp.body));
        assert.match(String(resp.body), /not stored in the database/);
    });

    it("refuses a new service row, whichever module it names",
            async function () {
        let resp = await admin.raw("POST", "/data/data-service", {
            id: "fbtnewds",
            module: "Core",
            name: "fbt-new-service",
            script: "// new"
        });

        assert.equal(resp.status, 405, JSON.stringify(resp.body));
        assert.equal(
            await db.withClient(settings.testDb, async function (client) {
                let found = await client.query(
                    "SELECT 1 FROM data_service WHERE name = $1",
                    ["fbt-new-service"]
                );

                return found.rows.length;
            }),
            0,
            "and nothing was written"
        );
    });

    it("still lets what an old installation holds be deleted",
            async function () {
        let row = await serviceRow(settings.testDb);
        let resp = await admin.raw(
            "DELETE",
            "/data/data-service/" + row.id
        );

        assert.ok(
            resp.status < 400,
            "status " + resp.status + " " + JSON.stringify(resp.body)
        );
    });

    it("says which modules run from the package and which from rows",
            async function () {
        let overview = await admin.get("/admin/instances");
        let here = overview.instances.find(
            (row) => row.database === settings.testDb
        );
        let fixture = here.modules.find((mod) => mod.name === "fbtest");

        assert.equal(fixture.isOnDisk, true, "this one is on disk");
        assert.equal(fixture.isVersionMissing, false);
        assert.equal(
            here.fromRows,
            here.modules.filter((mod) => !mod.isOnDisk).length,
            "and the row counts the ones that are not"
        );
    });

    it("says so when the instance names a version the server has not got",
            async function () {
        /*
            The failure nobody would notice: the instance carries a
            version this server does not hold, so it falls back to its
            own tables and runs code nobody meant to be running.
        */
        await setVersion(settings.testDb, "9.9.9");

        let overview = await admin.get("/admin/instances");
        let here = overview.instances.find(
            (row) => row.database === settings.testDb
        );
        let fixture = here.modules.find((mod) => mod.name === "fbtest");

        assert.equal(fixture.isOnDisk, false, "no package at that version");
        assert.equal(
            fixture.isVersionMissing,
            true,
            "and the server does hold the module, just not that one"
        );
        assert.ok(here.adrift >= 1, "which the instance row counts");

        // Rows may be what runs here, but they are still not written
        let row = await moduleRow(settings.testDb);
        let resp = await admin.raw(
            "PATCH",
            "/data/module/" + row.id,
            [{op: "replace", path: "/script", value: "// edited"}]
        );

        assert.equal(resp.status, 405, JSON.stringify(resp.body));

        await setVersion(settings.testDb, was);
    });
});
