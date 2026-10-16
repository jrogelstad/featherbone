/*
    An instance held for a deployment (ADR-002 question 7).

    A schema change is not attempted under live traffic, so the
    instance record carries the state: Deploy brackets itself with it,
    and a platform administrator can throw it by hand. While it is on,
    the instance answers 503 with an explanation rather than the 404 it
    used to give for anything it could not serve, nobody can sign in --
    except a platform administrator, because on an installation with
    one instance the screen that ends the maintenance is served from
    that instance.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const BASE2 = settings.baseUrl.replace(
    "/" + settings.testDb,
    "/" + settings.testDb2
);

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

async function clear() {
    await db.withClient(settings.managerDb, (client) => client.query(
        "UPDATE tenant SET is_maintenance = false"
    ));
}

async function instanceId(database) {
    let resp = await db.withClient(
        settings.managerDb,
        (client) => client.query(
            (
                "SELECT id FROM tenant " +
                "WHERE pg_database = $1 AND NOT is_deleted"
            ),
            [database]
        )
    );

    return resp.rows[0].id;
}

describe("an instance in maintenance (ADR-002 q7)", function () {
    let admin;
    let target;

    before(async function () {
        await clear();
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        /*
            The second instance is the one held, so the screens that
            control it stay reachable on the first. Both users need a
            grant there: the profile makes itself on the strength of it
            (B.7).
        */
        await db.ensureIdentity(
            settings.adminUser,
            settings.password,
            settings.testDb2
        );
        await db.ensureIdentity(
            settings.basicUser,
            settings.password,
            settings.testDb2
        );
        admin = new Session();
        let resp = await admin.signIn(settings.adminUser, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        target = await instanceId(settings.testDb2);
    });

    after(async function () {
        await clear();
        await flags(settings.adminUser, {});
    });

    it("refuses the state to anyone below platform", async function () {
        await flags(settings.adminUser, {isOrgAdmin: true});

        let resp = await admin.raw("POST", "/admin/instance/maintenance", {
            id: target,
            isMaintenance: true
        });

        assert.equal(resp.status, 401, JSON.stringify(resp.body));
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
    });

    it("holds the instance, and says so on the screen", async function () {
        let resp = await admin.raw("POST", "/admin/instance/maintenance", {
            id: target,
            isMaintenance: true
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let overview = await admin.get("/admin/instances");
        let row = overview.instances.find((one) => one.id === target);

        assert.ok(row, "the instance is listed");
        assert.equal(row.isMaintenance, true);

        let audited = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT 1 FROM admin_audit " +
                    "WHERE action = 'instance.maintenance_began' " +
                    "  AND detail LIKE $1"
                ),
                ["%" + settings.testDb2 + "%"]
            )
        );

        assert.equal(audited.rows.length, 1, "and audited");
    });

    it("refuses an ordinary identity, with the reason", async function () {
        let resp = await new Session(BASE2).signIn(
            settings.basicUser,
            settings.password
        );

        assert.equal(resp.status, 401);
        assert.match(
            JSON.stringify(resp.body),
            /Down for maintenance/,
            "told what is happening, not just refused"
        );
    });

    it("lets a platform administrator in, who has to get in",
            async function () {
        let there = new Session(BASE2);
        let resp = await there.signIn(
            settings.adminUser,
            settings.password
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        /*
            But not to the application: the schema is moving, so this
            is a 503 that says why rather than the 404 an unservable
            database used to give.
        */
        let data = await there.raw("POST", "/data/kinds", {
            filter: {limit: 1}
        });

        assert.equal(data.status, 503, JSON.stringify(data.body));
        assert.match(String(data.body.message), /maintenance/i);

        // The administration routes do answer -- that is how it ends
        let overview = await there.raw("GET", "/admin/instances");

        assert.equal(overview.status, 200, JSON.stringify(overview.body));

        let ended = await there.raw("POST", "/admin/instance/maintenance", {
            id: target,
            isMaintenance: false
        });

        assert.equal(ended.status, 200, JSON.stringify(ended.body));
    });

    it("and afterwards everyone is back", async function () {
        let resp = await new Session(BASE2).signIn(
            settings.basicUser,
            settings.password
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let kinds = await new Session(BASE2).raw("POST", "/data/kinds", {
            filter: {limit: 1}
        });

        assert.notEqual(kinds.status, 503, "no longer held");

        let audited = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT 1 FROM admin_audit " +
                    "WHERE action = 'instance.maintenance_ended' " +
                    "  AND detail LIKE $1"
                ),
                ["%" + settings.testDb2 + "%"]
            )
        );

        assert.equal(audited.rows.length, 1, "the end is audited too");
    });
});
