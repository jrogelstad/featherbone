/*
    The platform console (tenant plan G.2 and G.3).

    Organizations were command-line only: `install.js --instance <name>
    --organization "<name>"` made one and left the service account as
    its administrator. Onboarding is now an act on a screen -- create
    the organization, give it an administrator, build its first
    instance -- and a platform administrator can see every instance on
    the installation rather than one organization's.

    It is served where no database is named, so the context it runs in
    has no instance: the claims below are as much about that as about
    the organizations. Authority is read from the identity each time,
    never taken from the session, so an organization administrator who
    finds the address gets nothing.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {flags} = require("../harness/authority");

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const PLATFORM = "fbt_platform_admin";
const ORG_ADMIN = "fbt_platform_org";
const NEW_ORG = "FBHerbal";
const NEW_ADMIN = "fbt_herbal_admin";
const NEW_PW = "Fbtest-Herbal-4!";


async function dropOrganization(name) {
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            (
                "DELETE FROM access_grant WHERE _identity_identity_pk IN (" +
                "  SELECT _pk FROM identity " +
                "  WHERE _organization_organization_pk = (" +
                "    SELECT _pk FROM organization WHERE name = $1))"
            ),
            [name]
        );
        await client.query(
            (
                "DELETE FROM identity WHERE " +
                "_organization_organization_pk = (" +
                "  SELECT _pk FROM organization WHERE name = $1)"
            ),
            [name]
        );
        await client.query(
            "DELETE FROM organization WHERE name = $1",
            [name]
        );
    });
}

async function signedInPlatform() {
    let session = new Session(ROOT);
    let resp = await session.signIn(PLATFORM, settings.password, "FBTest");

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

describe("the platform console (G.2, G.3)", function () {
    before(async function () {
        await db.ensureIdentity(PLATFORM, settings.password);
        await db.ensureIdentity(ORG_ADMIN, settings.password);
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        await flags(ORG_ADMIN, {isOrgAdmin: true});
        await dropOrganization(NEW_ORG);
    });

    after(async function () {
        await dropOrganization(NEW_ORG);
        await flags(PLATFORM, {});
        await flags(ORG_ADMIN, {});
    });

    it("refuses the console to a caller with no session",
            async function () {
        let resp = await new Session(ROOT).raw("GET", "/platform/overview");

        assert.equal(resp.status, 401);
    });

    it("refuses it to an organization administrator", async function () {
        let session = new Session(ROOT);

        await session.signIn(ORG_ADMIN, settings.password, "FBTest");

        let resp = await session.raw("GET", "/platform/overview");

        assert.equal(resp.status, 401, JSON.stringify(resp.body));
        assert.match(String(resp.body), /platform administrator/i);
    });

    it("will not take the session's word for the authority",
            async function () {
        let session = await signedInPlatform();

        // The flag goes while the session stands
        await flags(PLATFORM, {isOrgAdmin: true});

        let resp = await session.raw("GET", "/platform/overview");

        assert.equal(resp.status, 401, JSON.stringify(resp.body));

        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
    });

    it("lists the people who could be appointed", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let names = overview.people.map((one) => one.username);

        assert.ok(names.includes(PLATFORM), "a person who can sign in");
        assert.ok(names.includes(ORG_ADMIN), "from another account too");
        /*
            The server orders by lower(username) in the database's
            collation, which is not JavaScript's: en_US ignores the
            underscore, so fbtest_admin sorts before fbt_forgot there
            and after it in a C-collated cluster. Ask the database.
        */
        let ordered = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                "SELECT n FROM unnest($1::text[]) AS n ORDER BY lower(n)",
                [names]
            )
        );

        assert.deepEqual(
            names,
            ordered.rows.map((row) => row.n),
            "in name order"
        );
        assert.ok(
            overview.people.every((one) => one.username),
            "each one named"
        );
    });

    it("lists every organization with what it owns", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let home = overview.organizations.find((o) => o.name === "FBTest");

        assert.ok(home, "the harness organization is listed");
        assert.ok(home.instances >= 2, "with its instances counted");
        assert.ok(home.identities >= 2, "and its people");
        assert.equal(home.isActive, true);
    });

    it("lists every instance on the installation", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let names = overview.fleet.map((i) => i.database);

        assert.ok(
            names.includes(settings.testDb) &&
            names.includes(settings.testDb2),
            "both instances, whoever owns them"
        );
        assert.equal(
            overview.fleet.find(
                (i) => i.database === settings.testDb
            ).organization,
            "FBTest",
            "each one says who owns it"
        );
    });

    it("creates an organization", async function () {
        let session = await signedInPlatform();
        let made = await session.post("/platform/organization", {
            name: NEW_ORG
        });

        assert.equal(made.name, NEW_ORG);
        assert.equal(made.isActive, true);

        let overview = await session.get("/platform/overview");
        let fresh = overview.organizations.find((o) => o.name === NEW_ORG);

        assert.ok(fresh, "and it is listed");
        assert.equal(fresh.instances, 0);
        assert.equal(
            fresh.administrators,
            0,
            "with nobody to administer it yet, which the screen says"
        );
    });

    it("refuses a second organization by the same name",
            async function () {
        let session = await signedInPlatform();
        let resp = await session.raw("POST", "/platform/organization", {
            name: NEW_ORG.toLowerCase()
        });

        assert.equal(resp.status, 400, JSON.stringify(resp.body));
        assert.match(String(resp.body), /already exists/i);
    });

    it("gives it its first administrator", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let fresh = overview.organizations.find((o) => o.name === NEW_ORG);
        let made = await session.post(
            "/platform/organization/administrator",
            {
                fullName: "Herbal Administrator",
                organization: fresh.id,
                password: NEW_PW,
                username: NEW_ADMIN
            }
        );

        assert.equal(made.created, true);

        let after = await session.get("/platform/overview");

        assert.equal(
            after.organizations.find(
                (o) => o.name === NEW_ORG
            ).administrators,
            1
        );
        assert.deepEqual(
            after.organizations.find(
                (o) => o.name === NEW_ORG
            ).administratorNames,
            [NEW_ADMIN + " -- Herbal Administrator"],
            "the count's tooltip says who they are"
        );

        // And they are a real identity: they can sign in at the picker
        let theirs = new Session(ROOT);
        let signedIn = await theirs.signIn(NEW_ADMIN, NEW_PW, NEW_ORG);

        assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
        assert.equal(signedIn.body.isOrgAdmin, true);

        // Granted no instance: who reaches what is theirs to say
        let mine = await theirs.get("/my/instances");

        assert.deepEqual(mine.instances, []);
    });

    it("refuses an administrator's password that is too short",
            async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let fresh = overview.organizations.find((o) => o.name === NEW_ORG);
        let resp = await session.raw(
            "POST",
            "/platform/organization/administrator",
            {
                organization: fresh.id,
                password: "short",
                username: "fbt_herbal_two"
            }
        );

        assert.equal(resp.status, 400, JSON.stringify(resp.body));
    });

    it("renames it, and changes how it signs in", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let fresh = overview.organizations.find((o) => o.name === NEW_ORG);
        let saved = await session.post("/platform/organization/update", {
            authentication: "both",
            id: fresh.id,
            name: NEW_ORG + " Nutrition"
        });

        assert.equal(saved.name, NEW_ORG + " Nutrition");
        assert.equal(saved.authentication, "both");

        // Put the name back for the rest of the file
        await session.post("/platform/organization/update", {
            id: fresh.id,
            name: NEW_ORG
        });
    });

    it("closes it, and closing stops its people signing in",
            async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");
        let fresh = overview.organizations.find((o) => o.name === NEW_ORG);

        await session.post("/platform/organization/status", {
            id: fresh.id,
            isActive: false
        });

        let shut = await new Session(ROOT).signIn(
            NEW_ADMIN,
            NEW_PW,
            NEW_ORG
        );

        assert.equal(shut.status, 401, "a closed organization is closed");

        await session.post("/platform/organization/status", {
            id: fresh.id,
            isActive: true
        });

        let again = await new Session(ROOT).signIn(
            NEW_ADMIN,
            NEW_PW,
            NEW_ORG
        );

        assert.equal(again.status, 200, JSON.stringify(again.body));
    });

    it("acts on an instance with no instance of its own",
            async function () {
        let session = await signedInPlatform();

        /*
            The whole point of the console: the Instances screen's own
            actions, reached where no database is named. Maintenance is
            the cheapest one to prove it with -- it writes the registry
            and nothing else.
        */
        let overview = await session.get("/platform/overview");
        let target = overview.fleet.find(
            (i) => i.database === settings.testDb2
        );

        await session.post("/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: true,
            organization: target.organizationId
        });

        let held = await session.get("/platform/overview");

        assert.equal(
            held.fleet.find((i) => i.database === settings.testDb2)
                .isMaintenance,
            true
        );

        await session.post("/platform/instance/maintenance", {
            id: target.id,
            isMaintenance: false,
            organization: target.organizationId
        });

        let free = await session.get("/platform/overview");

        assert.equal(
            free.fleet.find((i) => i.database === settings.testDb2)
                .isMaintenance,
            false
        );
    });

    it("offers what a new instance can be built on", async function () {
        let session = await signedInPlatform();
        let overview = await session.get("/platform/overview");

        assert.ok(
            overview.services.length >= 1,
            "the connections registered here"
        );
        assert.ok(
            Array.isArray(overview.templates),
            "and the cluster's templates"
        );
    });
});
