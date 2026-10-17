/*
    The fleet view, and Deploy from the screen (ADR-002).

    One server, two instances, two versions of one module: the overview
    says what each instance carries, which of them is behind a package
    the server holds, and what there is to deploy. Deploying from the
    screen is the same act as the command line's -- hold the instance,
    apply the package, record the version, let it go -- and is a
    platform administrator's alone.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

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

function moduleVersion(database, name) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            (
                "SELECT version FROM module " +
                "WHERE name = $1 AND NOT is_deleted"
            ),
            [name]
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

async function restore() {
    /*
        The fixture state the other suites expect: the first instance
        on 1.0.0, the second on 1.1.0 (the harness writes both), and
        the fixture's code on disk only -- deploying it here writes a
        data_service row, which modules.test.js asserts is absent.
    */
    await db.withClient(settings.testDb, async function (client) {
        await client.query(
            "UPDATE module SET version = '1.0.0' WHERE name = 'fbtest'"
        );
        await client.query(
            "DELETE FROM data_service WHERE module = 'fbtest'"
        );
    });
    await db.withClient(settings.managerDb, (client) => client.query(
        "UPDATE tenant SET is_maintenance = false"
    ));
}

describe("the fleet view (ADR-002)", function () {
    let admin;
    let first;

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

    it("says what the server holds", async function () {
        let overview = await admin.get("/admin/instances");
        let held = overview.packages || [];

        assert.ok(held.length >= 2, JSON.stringify(held));
        assert.ok(
            held.some(
                (one) => one.name === "fbtest" && one.version === "1.0.0"
            ),
            "the older version"
        );

        let newest = held.find(
            (one) => one.name === "fbtest" && one.version === "1.1.0"
        );

        assert.ok(newest, "and the newer one");
        assert.equal(newest.isNewest, true);
        assert.equal(newest.newest, "1.1.0");
    });

    it("says what each instance carries, and which is behind",
            async function () {
        let overview = await admin.get("/admin/instances");
        let one = overview.instances.find(
            (row) => row.database === settings.testDb
        );
        let other = overview.instances.find(
            (row) => row.database === settings.testDb2
        );

        assert.ok(one && other, "both instances are listed");

        let here = one.modules.find((mod) => mod.name === "fbtest");
        let there = other.modules.find((mod) => mod.name === "fbtest");

        assert.equal(here.version, "1.0.0");
        assert.equal(here.isBehind, true, "a newer package is installed");
        assert.equal(here.newest, "1.1.0");
        assert.ok(one.behind >= 1, "and the row counts it");

        assert.equal(there.version, "1.1.0");
        assert.equal(there.isBehind, false, "this one is current");
        assert.equal(
            other.behind,
            0,
            "two instances of one server on different versions"
        );
    });

    it("refuses a deployment from anyone below platform",
            async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let overview = await admin.get("/admin/instances");
        let one = overview.instances.find(
            (row) => row.database === settings.testDb
        );

        first = one.id;

        let resp = await admin.raw("POST", "/admin/instance/deploy", {
            id: first,
            module: "fbtest",
            version: "1.1.0"
        });

        assert.equal(resp.status, 401, JSON.stringify(resp.body));
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("refuses a package the server does not hold", async function () {
        let resp = await admin.raw("POST", "/admin/instance/deploy", {
            id: first,
            module: "fbtest",
            version: "9.9.9"
        });

        assert.equal(resp.status, 400, JSON.stringify(resp.body));
        assert.match(JSON.stringify(resp.body), /not installed/);
    });

    it("deploys, and the instance is open again afterwards",
            async function () {
        let resp = await admin.raw("POST", "/admin/instance/deploy", {
            id: first,
            module: "fbtest",
            version: "1.1.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(
            await moduleVersion(settings.testDb, "fbtest"),
            "1.1.0",
            "the version is recorded where it was deployed"
        );
        assert.equal(
            await maintenanceOf(settings.testDb),
            false,
            "and the hold is released"
        );

        let overview = await admin.get("/admin/instances");
        let one = overview.instances.find(
            (row) => row.database === settings.testDb
        );

        assert.equal(one.behind, 0, "nothing behind any more");

        let trail = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT action FROM admin_audit " +
                    "WHERE action IN " +
                    "  ('instance.deploy_began', 'instance.deployed') " +
                    "  AND detail LIKE $1"
                ),
                ["fbtest 1.1.0 into%"]
            )
        );

        assert.equal(
            trail.rows.length,
            2,
            "both the beginning and the end are audited"
        );
    });

    /*
        One at a time or a group, John's answer of 2026-10-16: a test
        database before production is the same act with one name in the
        list, and an urgent patch goes to the fleet. A group is a
        sequence of single deployments, which is what makes it a
        rolling outage rather than a simultaneous one.
    */
    describe("and the same act across a group", function () {
        before(restore);
        after(restore);

        it("refuses a group from anyone below platform", async function () {
            await flags(settings.adminUser, {isOrgAdmin: true});

            let resp = await admin.raw("POST", "/admin/instances/deploy", {
                instances: [first],
                module: "fbtest",
                version: "1.1.0"
            });

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
            await flags(settings.adminUser, {
                isOrgAdmin: true,
                isPlatformAdmin: true
            });
        });

        it("will not start without instances named", async function () {
            let resp = await admin.raw("POST", "/admin/instances/deploy", {
                instances: [],
                module: "fbtest",
                version: "1.1.0"
            });

            assert.equal(resp.status, 400, JSON.stringify(resp.body));
        });

        it("refuses a package the server does not hold before it " +
                "touches anything", async function () {
            let resp = await admin.raw("POST", "/admin/instances/deploy", {
                instances: [first],
                module: "fbtest",
                version: "9.9.9"
            });

            assert.equal(resp.status, 400, JSON.stringify(resp.body));
            assert.equal(
                await maintenanceOf(settings.testDb),
                false,
                "and nothing was held"
            );
        });

        it("deploys to every instance named, and lets each go",
                async function () {
            let overview = await admin.get("/admin/instances");
            let ids = overview.instances.filter(
                (row) => (
                    row.database === settings.testDb ||
                    row.database === settings.testDb2
                )
            ).map((row) => row.id);

            assert.equal(ids.length, 2, "both instances are named");

            let resp = await admin.raw("POST", "/admin/instances/deploy", {
                instances: ids,
                module: "fbtest",
                version: "1.1.0"
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal(resp.body.deployed, 2);
            assert.equal(resp.body.failed, 0);
            assert.ok(resp.body.results.every((one) => one.ok));

            assert.equal(
                await moduleVersion(settings.testDb, "fbtest"),
                "1.1.0"
            );
            assert.equal(
                await moduleVersion(settings.testDb2, "fbtest"),
                "1.1.0"
            );
            assert.equal(await maintenanceOf(settings.testDb), false);
            assert.equal(await maintenanceOf(settings.testDb2), false);

            let trail = await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "SELECT action, detail FROM admin_audit " +
                        "WHERE action IN " +
                        "  ('fleet.deploy_began', 'fleet.deploy_finished') " +
                        "ORDER BY created"
                    )
                )
            );

            assert.equal(trail.rows.length, 2, "the group is audited too");
            assert.match(
                trail.rows[1].detail,
                /2 deployed, 0 failed/
            );
        });

        it("refuses the whole group when one instance is not there",
                async function () {
            let overview = await admin.get("/admin/instances");
            let real = overview.instances.find(
                (row) => row.database === settings.testDb
            ).id;
            let resp = await admin.raw("POST", "/admin/instances/deploy", {
                instances: ["fbt-no-such-instance", real],
                module: "fbtest",
                version: "1.1.0"
            });

            /*
                An instance that is not there is refused before the
                run begins: a group that cannot be carried out as
                asked should not be half carried out.
            */
            assert.equal(resp.status, 404, JSON.stringify(resp.body));
            assert.equal(
                await maintenanceOf(settings.testDb),
                false,
                "and nothing was held"
            );
        });
    });
});
