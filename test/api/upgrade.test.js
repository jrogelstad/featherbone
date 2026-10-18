/*
    Upgrading an instance's core from the screen (John, 2026-10-17:
    "how do I get its db up to 3.0.0 alpha?").

    Deploy applies a package the server holds in `modules/`. The
    framework is not one of those -- Core comes from the manifest in
    the checkout -- so until this existed a core upgrade was a command
    line and nothing else, which a hosted installation does not have.

    The act is the same as a deployment's and is tested the same way:
    a platform administrator's alone, the instance held while it runs
    and let go afterwards, audited at both ends, and the same across a
    named group one at a time.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Upgrade} = require("../../server/services/upgrade");

const upgrade = new Upgrade();

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

function coreVersion(database) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            "SELECT version FROM module WHERE name = 'Core' " +
            "AND NOT is_deleted"
        );

        return (
            resp.rows.length
            ? resp.rows[0].version
            : undefined
        );
    });
}

function maintenanceOf(database) {
    return db.withClient(settings.managerDb, async function (client) {
        let resp = await client.query(
            (
                "SELECT is_maintenance FROM tenant " +
                "WHERE pg_database = $1 AND NOT is_deleted"
            ),
            [database]
        );

        return resp.rows[0].is_maintenance;
    });
}

function auditActions(detail) {
    return db.withClient(settings.managerDb, async function (client) {
        let resp = await client.query(
            (
                "SELECT action FROM admin_audit " +
                "WHERE detail LIKE $1 ORDER BY _pk"
            ),
            ["%" + detail + "%"]
        );

        return resp.rows.map((row) => row.action);
    });
}

// Put a database back to a version behind this server, so the next
// upgrade has something to do.
function setCore(database, version) {
    return db.withClient(database, (client) => client.query(
        "UPDATE module SET version = $1 WHERE name = 'Core'",
        [version]
    ));
}

async function restore() {
    await db.withClient(settings.managerDb, (client) => client.query(
        "UPDATE tenant SET is_maintenance = false"
    ));
}

describe("upgrading an instance's core", function () {
    let admin;
    let first;
    let own = upgrade.version();

    before(async function () {
        await restore();
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        admin = new Session();

        let resp = await admin.signIn(settings.adminUser, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    after(async function () {
        await restore();
        await flags(settings.adminUser, {});
    });

    it("says which instances are behind this server", async function () {
        await setCore(settings.testDb, "2.2.0");

        let overview = await admin.get("/admin/instances");
        let one = overview.instances.find(
            (row) => row.database === settings.testDb
        );

        first = one.id;

        assert.equal(
            overview.serverVersion,
            own,
            "the screen is told what this server is"
        );
        assert.equal(one.coreVersion, "2.2.0");
        assert.equal(one.isCoreBehind, true);
    });

    it("counts an instance on this version as current", async function () {
        await setCore(settings.testDb, own);

        let overview = await admin.get("/admin/instances");
        let one = overview.instances.find(
            (row) => row.database === settings.testDb
        );

        assert.equal(one.coreVersion, own);
        assert.equal(one.isCoreBehind, false);
    });

    it("refuses an upgrade from anyone below platform", async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let resp = await admin.raw("POST", "/admin/instance/upgrade", {
            id: first
        });

        assert.equal(resp.status, 401, JSON.stringify(resp.body));
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("will not run without an instance named", async function () {
        let resp = await admin.raw("POST", "/admin/instance/upgrade", {});

        assert.equal(resp.status, 400, JSON.stringify(resp.body));
    });

    it("answers 404 for an instance that is not there", async function () {
        let resp = await admin.raw("POST", "/admin/instance/upgrade", {
            id: "nosuchinstance"
        });

        assert.equal(resp.status, 404, JSON.stringify(resp.body));
    });

    it("brings a database behind this server up to it", async function () {
        await setCore(settings.testDb, "2.2.0");
        assert.equal(await coreVersion(settings.testDb), "2.2.0");

        let resp = await admin.raw("POST", "/admin/instance/upgrade", {
            id: first
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.version, own);
        assert.equal(resp.body.database, settings.testDb);
        assert.equal(
            await coreVersion(settings.testDb),
            own,
            "the manifest's version is what the database now carries"
        );
    });

    it("lets the instance go again afterwards", async function () {
        assert.equal(
            await maintenanceOf(settings.testDb),
            false,
            "held while it ran, open again after"
        );
    });

    it("leaves both ends in the trail", async function () {
        let actions = await auditActions(settings.testDb);

        assert.ok(
            actions.includes("instance.upgrade_began"),
            JSON.stringify(actions)
        );
        assert.ok(
            actions.includes("instance.upgraded"),
            JSON.stringify(actions)
        );
    });

    it("runs on an instance that is already current", async function () {
        let resp = await admin.raw("POST", "/admin/instance/upgrade", {
            id: first
        });

        assert.equal(
            resp.status,
            200,
            "re-applying the manifest is how a changed script lands"
        );
        assert.equal(await coreVersion(settings.testDb), own);
        assert.equal(await maintenanceOf(settings.testDb), false);
    });

    describe("and the same act across a group", function () {
        it("refuses a group from anyone below platform", async function () {
            await flags(settings.adminUser, {isOrgAdmin: true});

            let resp = await admin.raw("POST", "/admin/instances/upgrade", {
                instances: [first]
            });

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
            await flags(settings.adminUser, {
                isOrgAdmin: true,
                isPlatformAdmin: true
            });
        });

        it("will not start without instances named", async function () {
            let resp = await admin.raw("POST", "/admin/instances/upgrade", {
                instances: []
            });

            assert.equal(resp.status, 400, JSON.stringify(resp.body));
        });

        it("refuses the whole group when one is not there", async function () {
            let resp = await admin.raw("POST", "/admin/instances/upgrade", {
                instances: [first, "nosuchinstance"]
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
            assert.equal(
                await maintenanceOf(settings.testDb),
                false,
                "nothing was touched"
            );
        });

        it("upgrades each instance named, and lets it go", async function () {
            await setCore(settings.testDb, "2.2.0");
            await setCore(settings.testDb2, "2.2.0");

            let overview = await admin.get("/admin/instances");
            let other = overview.instances.find(
                (row) => row.database === settings.testDb2
            );

            let resp = await admin.raw("POST", "/admin/instances/upgrade", {
                instances: [first, other.id]
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal(resp.body.upgraded, 2);
            assert.equal(resp.body.failed, 0);
            assert.equal(resp.body.version, own);
            assert.equal(await coreVersion(settings.testDb), own);
            assert.equal(await coreVersion(settings.testDb2), own);
            assert.equal(await maintenanceOf(settings.testDb), false);
            assert.equal(await maintenanceOf(settings.testDb2), false);
        });

        it("tracks each instance's own progress under its own id",
                async function () {
            await setCore(settings.testDb, "2.2.0");
            await setCore(settings.testDb2, "2.2.0");

            let overview = await admin.get("/admin/instances");
            let other = overview.instances.find(
                (row) => row.database === settings.testDb2
            );
            let pid1 = "RT-upg-fleet-1-" + Date.now();
            let pid2 = "RT-upg-fleet-2-" + Date.now();

            let resp = await admin.raw("POST", "/admin/instances/upgrade", {
                instances: [first, other.id],
                processIds: [pid1, pid2]
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            let poll1 = await admin.raw(
                "GET",
                "/admin/instance/process?id=" + first + "&processId=" + pid1
            );
            let poll2 = await admin.raw(
                "GET",
                (
                    "/admin/instance/process?id=" + other.id +
                    "&processId=" + pid2
                )
            );

            assert.equal(poll1.body.status, "C", JSON.stringify(poll1.body));
            assert.equal(poll2.body.status, "C", JSON.stringify(poll2.body));
        });
    });

    describe("progress, for the screen to poll", function () {
        it("writes a row the caller can poll by the id it chose",
                async function () {
            await setCore(settings.testDb, "2.2.0");

            let processId = "RT-upg-" + Date.now();
            let resp = await admin.raw("POST", "/admin/instance/upgrade", {
                id: first,
                processId
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            let poll = await admin.raw(
                "GET",
                (
                    "/admin/instance/process?id=" + first +
                    "&processId=" + processId
                )
            );

            assert.equal(poll.status, 200, JSON.stringify(poll.body));
            assert.equal(poll.body.status, "C");
            assert.equal(poll.body.percentComplete, 100);
        });

        it("answers null for a process id nobody wrote to",
                async function () {
            let resp = await admin.raw(
                "GET",
                "/admin/instance/process?id=" + first + "&processId=RT-nope"
            );

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal(resp.body, null);
        });

        it("refuses a poll from anyone below platform", async function () {
            await flags(settings.adminUser, {isOrgAdmin: true});

            let resp = await admin.raw(
                "GET",
                "/admin/instance/process?id=" + first + "&processId=RT-nope"
            );

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
            await flags(settings.adminUser, {
                isOrgAdmin: true,
                isPlatformAdmin: true
            });
        });

        it("answers 404 for an instance that is not there",
                async function () {
            let resp = await admin.raw(
                "GET",
                "/admin/instance/process?id=nosuchinstance&processId=x"
            );

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
        });

        it("will not poll without naming both the instance and the process",
                async function () {
            let resp = await admin.raw(
                "GET",
                "/admin/instance/process?id=" + first
            );

            assert.equal(resp.status, 400, JSON.stringify(resp.body));
        });
    });
});
