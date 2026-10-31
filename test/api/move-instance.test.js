/*
    Moving an instance to another organization (platform console).

    The database is not touched; who answers for it is. Everyone the
    new organization does not answer for loses their grant, their super
    user flag and their sessions in it, and an organization left with
    no instance is closed unless that would lock out a platform
    administrator (John, 2026-10-31).

    Moves the harness's second instance and puts everything back after,
    since other files share it.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {flags} = require("../harness/authority");

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const PLATFORM = "fbt_move_platform";
const ORG_ADMIN = "fbt_move_orgadmin";
const LEAVER = "fbt_move_leaver";
const INSIDER = "fbt_move_insider";
const APPOINTED = "fbt_move_appointed";
const ORG_A = "FBMoveA";
const ORG_B = "FBMoveB";
const PEOPLE = [PLATFORM, ORG_ADMIN, LEAVER, INSIDER, APPOINTED];

let saved;

function mgr(fn) {
    return db.withClient(settings.managerDb, fn);
}

async function one(sql, params) {
    return await mgr(async function (client) {
        return (await client.query(sql, params)).rows[0];
    });
}

async function tenant2() {
    return await one(
        (
            "SELECT t._pk AS pk, t.id, o.id AS org_id, o.name AS org " +
            "FROM tenant t JOIN organization o " +
            "  ON o._pk = t._organization_organization_pk " +
            "WHERE t.pg_database = $1 AND NOT t.is_deleted"
        ),
        [settings.testDb2]
    );
}

async function grantActive(name) {
    let row = await one(
        (
            "SELECT g.is_active FROM access_grant g " +
            "JOIN identity i ON i._pk = g._identity_identity_pk " +
            "JOIN tenant t ON t._pk = g._tenant_tenant_pk " +
            "WHERE i.username = $1 AND t.pg_database = $2 " +
            "  AND NOT g.is_deleted"
        ),
        [name, settings.testDb2]
    );

    return Boolean(row && row.is_active);
}

async function isSuper(name) {
    return await db.withClient(settings.testDb2, async function (client) {
        let resp = await client.query(
            "SELECT is_super FROM user_account WHERE name = $1",
            [name]
        );

        return resp.rows[0].is_super;
    });
}

async function dropOrganizations() {
    await mgr(async function (client) {
        await client.query(
            (
                "DELETE FROM organization_admin " +
                "WHERE _organization_organization_pk IN (" +
                "  SELECT _pk FROM organization WHERE name = ANY($1))"
            ),
            [[ORG_A, ORG_B]]
        );
        await client.query(
            (
                "UPDATE identity SET _organization_organization_pk = (" +
                "  SELECT _pk FROM organization WHERE id = $2) " +
                "WHERE _organization_organization_pk IN (" +
                "  SELECT _pk FROM organization WHERE name = ANY($1))"
            ),
            [[ORG_A, ORG_B], db.FIXTURE.organizationId]
        );
        await client.query(
            "DELETE FROM organization WHERE name = ANY($1)",
            [[ORG_A, ORG_B]]
        );
    });
}

async function signedInPlatform() {
    let session = new Session(ROOT);
    let resp = await session.signIn(PLATFORM, settings.password, "FBTest");

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

async function organizationId(session, name) {
    let overview = await session.get("/platform/overview");

    return overview.organizations.find((o) => o.name === name).id;
}

describe("moving an instance to another organization", function () {
    before(async function () {
        await dropOrganizations();
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb2);
        await db.ensureIdentity(ORG_ADMIN, settings.password);
        await db.ensureIdentity(LEAVER, settings.password, settings.testDb2);
        await db.ensureIdentity(INSIDER, settings.password, settings.testDb2);
        await db.ensureIdentity(
            APPOINTED,
            settings.password,
            settings.testDb2
        );
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        await flags(ORG_ADMIN, {isOrgAdmin: true});

        // What gets put back: the owner, every grant, every super flag
        let owner = await tenant2();

        saved = await mgr(async function (client) {
            let grants = await client.query(
                (
                    "SELECT _pk AS pk, is_active FROM access_grant " +
                    "WHERE _tenant_tenant_pk = $1"
                ),
                [owner.pk]
            );

            return {grants: grants.rows, owner};
        });
        saved.supers = await db.withClient(
            settings.testDb2,
            async function (client) {
                return (await client.query(
                    "SELECT name, is_super FROM user_account"
                )).rows;
            }
        );

        let session = await signedInPlatform();

        await session.post("/platform/organization", {name: ORG_A});
        await session.post("/platform/organization", {name: ORG_B});

        let orgA = await organizationId(session, ORG_A);

        await session.post("/platform/organization/update", {
            authentication: "both",
            id: orgA,
            isTwoFactorRequired: true,
            name: ORG_A
        });

        // INSIDER belongs to A; APPOINTED administers A from FBTest
        await mgr(async function (client) {
            await client.query(
                (
                    "UPDATE identity SET _organization_organization_pk = (" +
                    "  SELECT _pk FROM organization WHERE id = $2) " +
                    "WHERE username = $1"
                ),
                [INSIDER, orgA]
            );
        });
        await flags(APPOINTED, {isOrgAdmin: true, organization: orgA});
    });

    after(async function () {
        await mgr(async function (client) {
            let i = 0;

            await client.query(
                (
                    "UPDATE tenant SET _organization_organization_pk = (" +
                    "  SELECT _pk FROM organization WHERE id = $2) " +
                    "WHERE _pk = $1"
                ),
                [saved.owner.pk, saved.owner.org_id]
            );
            while (i < saved.grants.length) {
                await client.query(
                    "UPDATE access_grant SET is_active = $2 WHERE _pk = $1",
                    [saved.grants[i].pk, saved.grants[i].is_active]
                );
                i += 1;
            }
        });
        await db.withClient(settings.testDb2, async function (client) {
            let i = 0;

            while (i < saved.supers.length) {
                await client.query(
                    "UPDATE user_account SET is_super = $2 WHERE name = $1",
                    [saved.supers[i].name, saved.supers[i].is_super]
                );
                i += 1;
            }
        });
        await dropOrganizations();
        await flags(PLATFORM, {});
        await flags(ORG_ADMIN, {});
        await flags(APPOINTED, {});
        await mgr(async function (client) {
            await client.query(
                (
                    "DELETE FROM access_grant WHERE _identity_identity_pk " +
                    "IN (SELECT _pk FROM identity WHERE username = ANY($1))"
                ),
                [PEOPLE]
            );
            await client.query(
                (
                    "DELETE FROM organization_admin WHERE " +
                    "_identity_identity_pk IN (SELECT _pk FROM identity " +
                    "WHERE username = ANY($1))"
                ),
                [PEOPLE]
            );
            await client.query(
                "DELETE FROM identity WHERE username = ANY($1)",
                [PEOPLE]
            );
        });
    });

    it("refuses anyone below platform administrator", async function () {
        let session = new Session(ROOT);
        let owner = await tenant2();

        await session.signIn(ORG_ADMIN, settings.password, "FBTest");

        let resp = await session.raw("POST", "/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: owner.org_id
        });

        assert.equal(resp.status, 401, JSON.stringify(resp.body));
    });

    it("says what it would do and changes nothing", async function () {
        let session = await signedInPlatform();
        let owner = await tenant2();
        let plan = await session.post("/platform/instance/move", {
            dryRun: true,
            id: owner.id,
            organization: owner.org_id,
            to: await organizationId(session, ORG_A)
        });
        let names = plan.revoked.map((row) => row.username);

        assert.ok(names.includes(LEAVER), "the old organization's people");
        assert.ok(!names.includes(INSIDER), "not the new one's");
        assert.ok(!names.includes(APPOINTED), "not its administrators");
        assert.ok(!names.includes(PLATFORM), "not platform administrators");
        assert.ok(
            plan.warnings.some((text) => (/second factor/).test(text)),
            "warns the second factor changes"
        );
        assert.ok(
            plan.warnings.some((text) => (/signs in with/).test(text)),
            "warns sign-in changes"
        );
        assert.equal(plan.closes, false, "FBTest keeps an instance");
        assert.equal((await tenant2()).org, "FBTest", "not moved");
        assert.equal(await grantActive(LEAVER), true, "nobody revoked");
    });

    it("refuses its own organization and a held one", async function () {
        let session = await signedInPlatform();
        let owner = await tenant2();
        let same = await session.raw("POST", "/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: owner.org_id
        });

        assert.equal(same.status, 400, JSON.stringify(same.body));

        await session.post("/platform/instance/maintenance", {
            id: owner.id,
            isMaintenance: true,
            organization: owner.org_id
        });

        let held = await session.raw("POST", "/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: await organizationId(session, ORG_A)
        });

        await session.post("/platform/instance/maintenance", {
            id: owner.id,
            isMaintenance: false,
            organization: owner.org_id
        });
        assert.equal(held.status, 400, JSON.stringify(held.body));
        assert.match(String(held.body), /maintenance/);
    });

    it("moves it, and the leavers lose everything", async function () {
        let session = await signedInPlatform();
        let owner = await tenant2();
        let theirs = new Session(ROOT + "/" + settings.testDb2);
        let signedIn = await theirs.signIn(LEAVER, settings.password);

        assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
        await db.withClient(settings.testDb2, (client) => client.query(
            "UPDATE user_account SET is_super = true WHERE name = $1",
            [LEAVER]
        ));

        let moved = await session.post("/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: await organizationId(session, ORG_A)
        });

        assert.equal(moved.to.name, ORG_A);
        assert.equal((await tenant2()).org, ORG_A);
        assert.equal(await grantActive(LEAVER), false, "leaver revoked");
        assert.equal(await isSuper(LEAVER), false, "and not a super user");
        assert.equal(await grantActive(INSIDER), true);
        assert.equal(await grantActive(APPOINTED), true);
        assert.equal(await grantActive(PLATFORM), true);

        let gone = await theirs.raw("GET", "/profile");

        assert.notEqual(gone.status, 200, "their session is gone");

        let trail = await mgr(async function (client) {
            return (await client.query(
                (
                    "SELECT a.action, o.name FROM admin_audit a " +
                    "JOIN organization o " +
                    "  ON o._pk = a._on_behalf_of_organization_pk " +
                    "WHERE a.action LIKE 'instance.moved_%' " +
                    "  AND a.detail LIKE $1"
                ),
                ["%(" + settings.testDb2 + ")%"]
            )).rows;
        });

        assert.ok(trail.some(
            (row) => row.action === "instance.moved_out" &&
            row.name === "FBTest"
        ), "the old organization's trail says where it went");
        assert.ok(trail.some(
            (row) => row.action === "instance.moved_in" &&
            row.name === ORG_A
        ), "the new one's says where it came from");

        let overview = await session.get("/platform/overview");
        let home = overview.organizations.find((o) => o.name === "FBTest");

        assert.equal(home.isActive, true, "FBTest keeps an instance");
    });

    it("closes an organization left with no instance", async function () {
        let session = await signedInPlatform();
        let owner = await tenant2();
        let moved = await session.post("/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: await organizationId(session, ORG_B)
        });

        assert.equal(moved.closes, true);
        assert.ok(
            moved.revoked.map((row) => row.username).includes(INSIDER),
            "A's own people are outsiders to B"
        );

        let overview = await session.get("/platform/overview");

        assert.equal(
            overview.organizations.find((o) => o.name === ORG_A).isActive,
            false
        );
    });

    it("keeps a platform administrator's home open", async function () {
        let session = await signedInPlatform();
        let owner = await tenant2();
        let orgB = await organizationId(session, ORG_B);

        await mgr(async function (client) {
            await client.query(
                (
                    "UPDATE identity SET _organization_organization_pk = (" +
                    "  SELECT _pk FROM organization WHERE id = $2) " +
                    "WHERE username = $1"
                ),
                [ORG_ADMIN, orgB]
            );
        });
        await db.ensureIdentity(ORG_ADMIN, settings.password, undefined, {
            isPlatformAdmin: true
        });
        // ensureIdentity keeps the home organization of an existing one
        assert.equal(
            (await one(
                (
                    "SELECT o.name FROM identity i JOIN organization o " +
                    "  ON o._pk = i._organization_organization_pk " +
                    "WHERE i.username = $1"
                ),
                [ORG_ADMIN]
            )).name,
            ORG_B
        );

        let moved = await session.post("/platform/instance/move", {
            id: owner.id,
            organization: owner.org_id,
            to: db.FIXTURE.organizationId
        });

        assert.equal(moved.closes, false);
        assert.ok(moved.warnings.some(
            (text) => text.includes(ORG_ADMIN)
        ), "and says why");

        let overview = await session.get("/platform/overview");

        assert.equal(
            overview.organizations.find((o) => o.name === ORG_B).isActive,
            true
        );
        assert.equal((await tenant2()).org, "FBTest", "home again");
    });
});
