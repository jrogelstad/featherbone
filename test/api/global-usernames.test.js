/*
    One name, one person, and administration as an appointment (John,
    Oct 2026).

    A username used to be unique only within an organization, which
    made the people who answer for several of them -- the platform
    administrator, and the reseller whose customers are their accounts
    -- impossible to express: each needed an account in every
    organization they touched. "It's not practical for them to have
    create many versions of themselves."

    So a username is unique across the installation, an identity's
    organization says who owns the account rather than who it may
    work for, the grant is the whole of the access boundary, and
    administering an organization is a row saying so -- as many as a
    person needs.

    What this file holds down: the name is one person, any existing
    person can be appointed over an organization or over the platform,
    one account administers several organizations, and an outsider
    appointed here is still not this organization's to take.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const PLATFORM = "fbt_gu_platform";
const RESELLER = "fbt_gu_reseller";
const PLAIN = "fbt_gu_plain";
const CANDIDATE = "fbt_gu_candidate";
const OTHER_ORG = "FBGuCustomer";

const DOC_COLS = (
    "_pk,id,created,created_by,updated,updated_by,is_deleted,owner,etag"
);

function docVals(id) {
    return (
        "nextval('object__pk_seq'),'" + id + "',now(),'fbtest',now()," +
        "'fbtest',false,'fbtest','" + id + "'"
    );
}

function manager(run) {
    return db.withClient(settings.managerDb, run);
}

function platformFlag(username, isPlatformAdmin) {
    return manager((client) => client.query(
        (
            "UPDATE identity SET is_platform_admin = $2, " +
            "  updated = now(), updated_by = 'fbtest' " +
            "WHERE lower(username) = lower($1)"
        ),
        [username, isPlatformAdmin]
    ));
}

function identityId(username) {
    return manager(async function (client) {
        let resp = await client.query(
            (
                "SELECT id FROM identity " +
                "WHERE lower(username) = lower($1) AND NOT is_deleted"
            ),
            [username]
        );

        return resp.rows[0].id;
    });
}

function appointments(username) {
    return manager(async function (client) {
        let resp = await client.query(
            (
                "SELECT o.name FROM organization_admin a " +
                "JOIN identity i ON i._pk = a._identity_identity_pk " +
                "JOIN organization o " +
                "  ON o._pk = a._organization_organization_pk " +
                "WHERE lower(i.username) = lower($1) " +
                "  AND a.is_active AND NOT a.is_deleted " +
                "ORDER BY o.name"
            ),
            [username]
        );

        return resp.rows.map((row) => row.name);
    });
}

// A second organization, with nobody of its own but an appointment
async function seedCustomer() {
    await manager(async function (client) {
        let found = await client.query(
            "SELECT _pk FROM organization WHERE name = $1",
            [OTHER_ORG]
        );

        if (found.rows.length) {
            return;
        }

        await client.query((
            "INSERT INTO organization (" + DOC_COLS + ",name,is_active," +
            "authentication,is_two_factor_required) VALUES (" +
            docVals("fbtgu0000001") + ",$1,true,'password',false)"
        ), [OTHER_ORG]);
    });
}

async function unseedCustomer() {
    await manager(async function (client) {
        await client.query(
            (
                "DELETE FROM organization_admin WHERE " +
                "_organization_organization_pk IN (SELECT _pk FROM " +
                "  organization WHERE name = $1)"
            ),
            [OTHER_ORG]
        );
        await client.query(
            "DELETE FROM organization WHERE name = $1",
            [OTHER_ORG]
        );
    });
}

async function signedIn(username) {
    let session = new Session();
    let resp = await session.signIn(username, settings.password);

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

describe("one name, one person (ADR-001 revisited)", function () {
    before(async function () {
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb);
        await db.ensureIdentity(RESELLER, settings.password, settings.testDb);
        await db.ensureIdentity(PLAIN, settings.password, settings.testDb);
        await db.ensureIdentity(
            CANDIDATE,
            settings.password,
            settings.testDb
        );
        await platformFlag(PLATFORM, true);
        await seedCustomer();
    });

    after(async function () {
        await unseedCustomer();
        await platformFlag(PLATFORM, false);
        await manager((client) => client.query(
            (
                "DELETE FROM organization_admin WHERE " +
                "_identity_identity_pk IN (SELECT _pk FROM identity " +
                "  WHERE lower(username) = ANY($1))"
            ),
            [[RESELLER, CANDIDATE, PLAIN]]
        ));
    });

    it("refuses one name to a second person", async function () {
        await assert.rejects(
            manager((client) => client.query((
                "INSERT INTO identity (" + DOC_COLS +
                ",_organization_organization_pk,username,full_name," +
                "email,password_hash,status,is_platform_admin," +
                "is_org_admin,failed_attempts) SELECT " +
                docVals("fbtgu0000002") +
                ",_pk,$1,$1,'','x','active',false,false,0 " +
                "FROM organization WHERE name = $2"
            ), [PLAIN, OTHER_ORG])),
            /identity_unique_username|duplicate key/i,
            "the name is taken, whichever organization is asking"
        );
    });

    it("appoints somebody who already exists", async function () {
        let admin = await signedIn(PLATFORM);
        let resp = await admin.raw("POST", "/admin/identity/org-admin", {
            id: await identityId(CANDIDATE),
            isOrgAdmin: true
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.deepEqual(await appointments(CANDIDATE), ["FBTest"]);
    });

    it("lets one account administer several orgs", async function () {
        let admin = await signedIn(PLATFORM);
        let id = await identityId(RESELLER);
        let here = await admin.raw("POST", "/admin/identity/org-admin", {
            id,
            isOrgAdmin: true
        });
        let organizations = await admin.get("/admin/overview");
        let customer = organizations.organizations.find(
            (row) => row.name === OTHER_ORG
        );
        let there = await admin.raw("POST", "/admin/identity/org-admin", {
            id,
            isOrgAdmin: true,
            organization: customer.id
        });

        assert.equal(here.status, 200, JSON.stringify(here.body));
        assert.equal(there.status, 200, JSON.stringify(there.body));
        let orgs = [OTHER_ORG, "FBTest"];

        assert.deepEqual(
            await appointments(RESELLER),
            orgs.sort(),
            "one account, two organizations"
        );
    });

    it("lets that one account act on either of them", async function () {
        let reseller = await signedIn(RESELLER);
        let overview = await reseller.get("/admin/overview");
        let customer = overview.organizations.find(
            (row) => row.name === OTHER_ORG
        );
        let theirs = await reseller.get(
            "/admin/overview?organization=" + customer.id
        );

        assert.equal(overview.tier, "organization", "here");
        assert.equal(
            theirs.organization.name,
            OTHER_ORG,
            "and over there, on one account and one sign-in"
        );
        assert.equal(theirs.tier, "organization");
    });

    it("refuses an organization without appointment", async function () {
        let plain = await signedIn(PLAIN);
        let admin = await signedIn(PLATFORM);
        let overview = await admin.get("/admin/overview");
        let customer = overview.organizations.find(
            (row) => row.name === OTHER_ORG
        );
        let resp = await plain.raw(
            "GET",
            "/admin/overview?organization=" + customer.id
        );

        assert.ok(resp.status >= 400, "status " + resp.status);
    });

    it("appoints a platform administrator", async function () {
        let admin = await signedIn(PLATFORM);
        let resp = await admin.raw("POST", "/admin/identity/platform-admin", {
            id: await identityId(CANDIDATE),
            isPlatformAdmin: true
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let appointed = await signedIn(CANDIDATE);
        let overview = await appointed.get("/admin/overview");

        assert.equal(overview.tier, "platform");
        assert.ok(
            overview.organizations.length > 1,
            "and sees every organization without an account in each"
        );

        await admin.raw("POST", "/admin/identity/platform-admin", {
            id: await identityId(CANDIDATE),
            isPlatformAdmin: false
        });
    });

    it("keeps platform appointment to platform admins", async function () {
        let reseller = await signedIn(RESELLER);
        let resp = await reseller.raw(
            "POST",
            "/admin/identity/platform-admin",
            {id: await identityId(PLAIN), isPlatformAdmin: true}
        );

        assert.ok(resp.status >= 400, "status " + resp.status);
        assert.equal(
            (await manager(async function (client) {
                let found = await client.query(
                    (
                        "SELECT is_platform_admin FROM identity " +
                        "WHERE lower(username) = lower($1)"
                    ),
                    [PLAIN]
                );

                return found.rows[0].is_platform_admin;
            })),
            false,
            "and nothing was granted"
        );
    });

    it("will not stand down the last platform admin", async function () {
        let admin = await signedIn(PLATFORM);
        let others = await manager(async function (client) {
            let found = await client.query(
                (
                    "SELECT count(*)::int AS n FROM identity " +
                    "WHERE is_platform_admin AND NOT is_deleted " +
                    "  AND status = 'active' " +
                    "  AND lower(username) <> lower($1)"
                ),
                [PLATFORM]
            );

            return found.rows[0].n;
        });

        if (others) {
            return; // Another file left one; the guard needs the last
        }

        let resp = await admin.raw(
            "POST",
            "/admin/identity/platform-admin",
            {id: await identityId(PLATFORM), isPlatformAdmin: false}
        );

        assert.ok(resp.status >= 400, "status " + resp.status);
        assert.match(String(resp.body), /last platform administrator/);
    });
});
