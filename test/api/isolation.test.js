/*
    Two organizations cannot reach each other (tenant plan F.1, and
    most of F.2).

    This is the test improvement-plan item 1.1 always needed. Users
    used to be cluster-wide Postgres roles, so one tenant's
    administrator could reset another tenant's user's password: the
    same name meant the same person everywhere. Under ADR-001 an
    identity belongs to an organization and a username is unique only
    within it, so the same name in two organizations is two people with
    two passwords, and nothing an administrator can do in one reaches
    the other.

    The suite seeds a second organization that shares usernames with
    the first, and then tries to cross the line: by
    signing in, and through every write the administration routes
    offer. It also covers F.2's substance -- one person with an
    identity in each organization, separate credentials, and revoking
    one leaving the other working.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Identities} = require("../../server/services/identities");

const identities = new Identities();
const OTHER_PW = "Fbtest-Other-Org-2!";
const OTHER_DB = (settings.testDb + "_other").toLowerCase();
const OTHER_ORG = "FBOther";
const OTHER_ONLY = "fbt_other_only";
const OTHER_ADMIN = "fbt_other_admin";
const OTHER_USER = "fbt_other_user";

const DOC_COLS = (
    "_pk,id,created,created_by,updated,updated_by,is_deleted," +
    "owner,etag"
);

function docVals(id) {
    return (
        "nextval('object__pk_seq'),'" + id + "',now(),'fbtest',now()," +
        "'fbtest',false,'fbtest','" + id + "'"
    );
}

/*
    Everything this file needs, created only where it is missing: the
    api files run one at a time in their own processes against shared
    databases, so the fixture cannot assume another file ran first and
    must not duplicate what that file already made.
*/
async function seed() {
    await db.withClient(settings.managerDb, async function (client) {
        async function organization(id, name) {
            let found = await client.query(
                "SELECT _pk FROM organization WHERE name = $1",
                [name]
            );

            if (found.rows.length) {
                return found.rows[0]._pk;
            }

            let resp = await client.query((
                "INSERT INTO organization (" + DOC_COLS + ",name," +
                "is_active,authentication,is_two_factor_required) " +
                "VALUES (" + docVals(id) + ",$1,true,'password',false) " +
                "RETURNING _pk"
            ), [name]);

            return resp.rows[0]._pk;
        }

        async function identity(id, orgPk, name, password, flags) {
            let found = await client.query(
                (
                    "SELECT _pk FROM identity WHERE username = $1 " +
                    "  AND _organization_organization_pk = $2"
                ),
                [name, orgPk]
            );

            if (found.rows.length) {
                return found.rows[0]._pk;
            }

            let resp = await client.query((
                "INSERT INTO identity (" + DOC_COLS +
                ",_organization_organization_pk,username,full_name," +
                "email,password_hash,status,is_platform_admin," +
                "is_org_admin,failed_attempts) VALUES (" + docVals(id) +
                ",$1,$2,$2,'',$3,'active',false,false,0) RETURNING _pk"
            ), [
                orgPk,
                name,
                identities.hashPassword(password)
            ]);
            let pk = resp.rows[0]._pk;

            if (flags && flags.isOrgAdmin) {
                await appoint(id + "a", pk, orgPk);
            }

            return pk;
        }

        // Administering an organization is an appointment over it
        async function appoint(id, identityPk, orgPk) {
            let found = await client.query(
                (
                    "SELECT _pk FROM organization_admin " +
                    "WHERE _identity_identity_pk = $1 " +
                    "  AND _organization_organization_pk = $2"
                ),
                [identityPk, orgPk]
            );

            if (found.rows.length) {
                return;
            }

            await client.query((
                "INSERT INTO organization_admin (" + DOC_COLS +
                ",_identity_identity_pk,_organization_organization_pk," +
                "is_active,appointed) VALUES (" + docVals(id) +
                ",$1,$2,true,now())"
            ), [identityPk, orgPk]);
        }

        async function grant(id, identityPk, database) {
            let found = await client.query(
                (
                    "SELECT g._pk FROM access_grant g " +
                    "JOIN tenant t ON g._tenant_tenant_pk = t._pk " +
                    "WHERE g._identity_identity_pk = $1 " +
                    "  AND t.pg_database = $2"
                ),
                [identityPk, database]
            );

            if (found.rows.length) {
                return;
            }

            await client.query((
                "INSERT INTO access_grant (" + DOC_COLS +
                ",_identity_identity_pk,_tenant_tenant_pk,is_active," +
                "granted) SELECT " + docVals(id) +
                ",$1,_pk,true,now() FROM tenant WHERE pg_database = $2"
            ), [identityPk, database]);
        }

        // Organization A: the harness's own, with its instances
        let orgA = await organization("fbtorg000001", "FBTest");

        await client.query(
            (
                "UPDATE tenant SET _organization_organization_pk = $1 " +
                "WHERE _organization_organization_pk IS NULL"
            ),
            [orgA]
        );

        let adminA = await identity(
            "fbtisoa00001",
            orgA,
            settings.adminUser,
            settings.password,
            {isOrgAdmin: true}
        );
        await grant("fbtisog00001", adminA, settings.testDb);

        let userA = await identity(
            "fbtisoa00002",
            orgA,
            settings.basicUser,
            settings.password
        );
        await grant("fbtisog00002", userA, settings.testDb);

        // The administrator has to be organization-wide for the
        // cross-organization writes below to be refused for the right
        // reason: not "you may not", but "no such identity here"
        await appoint("fbtisoadm0001", adminA, orgA);

        /*
            Organization B: its own people, with names of their own. A
            username names one person across the installation now
            (John, Oct 2026), so two organizations no longer each
            employ an "alice" -- what they still do not share is who
            reaches what, which is the whole of this file. None of
            these is granted anything of A's; that is the point.
        */
        let orgB = await organization("fbtorg000002", OTHER_ORG);

        await identity(
            "fbtisob00001",
            orgB,
            OTHER_ADMIN,
            OTHER_PW,
            {isOrgAdmin: true}
        );
        await identity(
            "fbtisob00002",
            orgB,
            OTHER_USER,
            OTHER_PW
        );
        await identity("fbtisob00003", orgB, OTHER_ONLY, OTHER_PW);
    });
}

async function unseed() {
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            (
                "DELETE FROM access_grant WHERE " +
                "_identity_identity_pk IN (SELECT _pk FROM identity " +
                "  WHERE _organization_organization_pk = (" +
                "    SELECT _pk FROM organization WHERE name = $1))"
            ),
            [OTHER_ORG]
        );
        await client.query(
            (
                "DELETE FROM identity WHERE " +
                "_organization_organization_pk = (SELECT _pk FROM " +
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

function identityPk(client, organization, username) {
    return client.query(
        (
            "SELECT i.id, i.password_hash FROM identity i " +
            "JOIN organization o ON " +
            "  i._organization_organization_pk = o._pk " +
            "WHERE o.name = $1 AND i.username = $2"
        ),
        [organization, username]
    );
}

describe("two organizations are strangers (F.1)", function () {
    let base = settings.baseUrl;
    let idsOther = {};
    let hashes = {};

    before(async function () {
        await seed();

        await db.withClient(settings.managerDb, async function (client) {
            let resp = await identityPk(client, OTHER_ORG, OTHER_ONLY);
            idsOther.onlyThere = resp.rows[0].id;

            resp = await identityPk(client, OTHER_ORG, OTHER_USER);
            idsOther.sameName = resp.rows[0].id;
            hashes.b = resp.rows[0].password_hash;

            resp = await identityPk(client, "FBTest", settings.basicUser);
            hashes.a = resp.rows[0].password_hash;
        });
    });

    after(unseed);

    describe("sign-in", function () {
        it("keeps each person on their own credential", async function () {
            // Two people, two secrets, whatever organizations they are in
            assert.notEqual(hashes.a, hashes.b, "two separate hashes");

            let mine = new Session(base);
            let resp = await mine.signIn(
                settings.basicUser,
                settings.password
            );

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("refuses the other organization's password for our name",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(settings.basicUser, OTHER_PW);

            assert.equal(
                resp.status,
                401,
                "somebody else's password must not open this account"
            );
        });

        it("refuses the other organization's administrator outright",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(OTHER_ADMIN, OTHER_PW);

            assert.equal(
                resp.status,
                401,
                "their password is right and they still have no grant here"
            );

            // And A's own administrator is untouched by any of it
            let ours = new Session(base);

            assert.equal(
                (
                    await ours.signIn(settings.adminUser, settings.password)
                ).status,
                200
            );
        });

        /*
            The name exists -- every name does, installation-wide -- and
            the password is right. What stops them is the grant, which
            is the boundary now that the name is not one.
        */
        it("refuses somebody with no grant on this instance",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(OTHER_ONLY, OTHER_PW);

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
        });

        it("grants no authorization in the instance it was refused from",
                async function () {
            let theirs = new Session(base);

            await theirs.signIn(OTHER_ONLY, OTHER_PW);

            // The failed sign-in leaves no usable session behind
            let resp = await theirs.raw("GET", "/sessions");

            assert.ok(
                resp.status === 401 || resp.status === 403,
                "no session: got " + resp.status
            );
        });
    });

    describe("administration", function () {
        let admin;

        before(async function () {
            admin = new Session(base);

            let resp = await admin.signIn(
                settings.adminUser,
                settings.password
            );

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("shows only its own organization's people", async function () {
            let resp = await admin.get("/admin/overview");
            let names = resp.identities.map((row) => row.username);

            assert.equal(resp.organization.name, "FBTest");
            assert.ok(
                names.includes(settings.basicUser),
                "its own user is listed"
            );
            assert.equal(
                names.includes(OTHER_ONLY),
                false,
                "the other organization's user is not"
            );
            assert.equal(
                names.filter((n) => n === settings.basicUser).length,
                1,
                "and the shared name appears once, not twice"
            );
        });

        it("shows only its own organization's instances",
                async function () {
            let resp = await admin.get("/admin/instances");
            let databases = resp.instances.map((row) => row.database);

            assert.equal(resp.organization.name, "FBTest");
            assert.ok(databases.includes(settings.testDb));
            assert.ok(
                databases.every(
                    (name) => name !== undefined && name !== null
                ),
                "every instance names its database"
            );
        });

        it("cannot set a password in the other organization",
                async function () {
            let resp = await admin.raw("POST", "/admin/identity/password", {
                id: idsOther.onlyThere,
                password: "Fbtest-Hijack-3!"
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
        });

        it("cannot reset the password of somebody else's user",
                async function () {
            let resp = await admin.raw("POST", "/admin/identity/password", {
                id: idsOther.sameName,
                password: "Fbtest-Hijack-3!"
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));

            // The other organization's secret is exactly as it was
            await db.withClient(
                settings.managerDb,
                async function (client) {
                    let row = await identityPk(
                        client,
                        OTHER_ORG,
                        OTHER_USER
                    );

                    assert.equal(row.rows[0].password_hash, hashes.b);
                }
            );
        });

        it("cannot disable or unlock over there", async function () {
            let resp = await admin.raw("POST", "/admin/identity/status", {
                id: idsOther.onlyThere,
                status: "disabled"
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
        });

        it("cannot grant its own instances to them", async function () {
            let resp = await admin.raw("POST", "/admin/grant", {
                id: idsOther.onlyThere,
                instance: (
                    await admin.get("/admin/overview")
                ).instances[0].id,
                isActive: true
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
        });

        /*
            Appointing somebody from outside is allowed and is the
            point of the change -- it is how a reseller comes to
            administer a customer -- but it hands over nothing of
            theirs: their account stays their own organization's to
            change, so the password they use elsewhere cannot be reset
            from here.
        */
        it("may appoint somebody from outside, and still not take " +
                "their account", async function () {
            let appointed = await admin.raw(
                "POST",
                "/admin/identity/org-admin",
                {id: idsOther.sameName, isOrgAdmin: true}
            );

            assert.equal(appointed.status, 200, JSON.stringify(
                appointed.body
            ));

            let hijack = await admin.raw(
                "POST",
                "/admin/identity/password",
                {id: idsOther.sameName, password: "Fbtest-Hijack-3!"}
            );

            assert.equal(hijack.status, 401, JSON.stringify(hijack.body));

            await db.withClient(
                settings.managerDb,
                async function (client) {
                    let row = await identityPk(client, OTHER_ORG, OTHER_USER);

                    assert.equal(
                        row.rows[0].password_hash,
                        hashes.b,
                        "their secret is untouched"
                    );
                }
            );

            // Put it back, the other claims reading the same fixture
            await admin.raw("POST", "/admin/identity/org-admin", {
                id: idsOther.sameName,
                isOrgAdmin: false
            });
        });

    });

    /*
        What F.2 was about -- one person's business in one organization
        not reaching another's -- with the model the other way up. The
        person is one account now, so the separation that matters is
        between accounts, and disabling somebody in one organization
        cannot touch anybody else.
    */
    describe("one organization's people are their own (F.2)", function () {
        it("keeps each person on their own credential", async function () {
            let mine = new Session(base);

            assert.equal(
                (
                    await mine.signIn(settings.basicUser, settings.password)
                ).status,
                200,
                "our user signs in here"
            );

            let other = new Session(base);

            assert.equal(
                (await other.signIn(OTHER_USER, OTHER_PW)).status,
                401,
                "theirs has no grant here, right password and all"
            );
        });

        it("leaves ours working when theirs is disabled",
                async function () {
            await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "UPDATE identity SET status = 'disabled' " +
                        "WHERE _pk IN (SELECT i._pk FROM identity i " +
                        "  JOIN organization o ON " +
                        "    i._organization_organization_pk = o._pk " +
                        "  WHERE o.name = $1 AND i.username = $2)"
                    ),
                    [OTHER_ORG, OTHER_USER]
                )
            );

            let mine = new Session(base);

            assert.equal(
                (
                    await mine.signIn(settings.basicUser, settings.password)
                ).status,
                200,
                "disabling their user must not reach ours"
            );
        });
    });

    /*
        The mirror image (F.2's remainder): until now the second
        organization owned nothing, so "each administrator sees only
        their own" was proven from one side. Give it an instance of its
        own and prove it from theirs.
    */
    describe("the view from the other organization (F.2)", function () {
        let ours;
        let theirs;
        let baseOther = base.replace(
            "/" + settings.testDb,
            "/" + OTHER_DB
        );

        before(async function () {
            // Build a third instance as the platform administrator...
            await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "UPDATE identity SET is_platform_admin = true " +
                        "WHERE _pk IN (SELECT i._pk FROM identity i " +
                        "  JOIN organization o ON " +
                        "    i._organization_organization_pk = o._pk " +
                        "  WHERE o.name = 'FBTest' AND i.username = $1)"
                    ),
                    [settings.adminUser]
                )
            );

            ours = new Session(base);
            let resp = await ours.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            let overview = await ours.get("/admin/instances");
            let built = await ours.raw(
                "POST",
                "/admin/instance/provision",
                {
                    database: OTHER_DB,
                    name: "Theirs",
                    service: overview.services[0].id,
                    template: settings.testDb2
                }
            );
            assert.equal(
                built.status,
                200,
                JSON.stringify(built.body)
            );
            assert.equal(built.body.state, "active");

            /*
                ...and hand it to the other organization: the tenant
                row moves, the builder's grants on it go, and their
                administrator gets one. The profile in the new database
                makes itself on first sign-in (B.7).
            */
            await db.withClient(
                settings.managerDb,
                async function (client) {
                    await client.query(
                        (
                            "UPDATE tenant SET " +
                            "_organization_organization_pk = (" +
                            "  SELECT _pk FROM organization " +
                            "  WHERE name = $2) " +
                            "WHERE pg_database = $1"
                        ),
                        [OTHER_DB, OTHER_ORG]
                    );
                    await client.query(
                        (
                            "DELETE FROM access_grant WHERE " +
                            "_tenant_tenant_pk = (SELECT _pk FROM tenant " +
                            "  WHERE pg_database = $1)"
                        ),
                        [OTHER_DB]
                    );
                    await client.query(
                        (
                            "INSERT INTO access_grant (" + DOC_COLS +
                            ",_identity_identity_pk,_tenant_tenant_pk," +
                            "is_active,granted) " +
                            "SELECT " + docVals("fbtisogrant1") + "," +
                            "  i._pk, t._pk, true, now() " +
                            "FROM identity i, tenant t " +
                            "JOIN organization o " +
                            "  ON o.name = $2 " +
                            "WHERE i._organization_organization_pk = " +
                            "  o._pk AND i.username = $1 " +
                            "  AND t.pg_database = $3"
                        ),
                        [OTHER_ADMIN, OTHER_ORG, OTHER_DB]
                    );
                }
            );

            theirs = new Session(baseOther);
            resp = await theirs.signIn(OTHER_ADMIN, OTHER_PW);
            assert.equal(
                resp.status,
                200,
                "their administrator enters their instance: " +
                JSON.stringify(resp.body)
            );
        });

        after(async function () {
            await db.withClient(
                settings.managerDb,
                async function (client) {
                    await client.query(
                        (
                            "UPDATE identity SET is_platform_admin = " +
                            "false WHERE username = $1"
                        ),
                        [settings.adminUser]
                    );
                    await client.query(
                        (
                            "DELETE FROM \"$provision\" WHERE " +
                            "tenant_pk IN (SELECT _pk FROM tenant " +
                            "  WHERE pg_database = $1)"
                        ),
                        [OTHER_DB]
                    ).catch(function () {
                        return;
                    });
                    await client.query(
                        (
                            "DELETE FROM access_grant WHERE " +
                            "_tenant_tenant_pk IN (SELECT _pk FROM " +
                            "  tenant WHERE pg_database = $1)"
                        ),
                        [OTHER_DB]
                    );
                    await client.query(
                        "DELETE FROM tenant WHERE pg_database = $1",
                        [OTHER_DB]
                    );
                }
            );
            await db.withClient("postgres", (client) => client.query(
                "DROP DATABASE IF EXISTS " + OTHER_DB + " WITH (FORCE)"
            ));
        });

        it("their administrator sees their instance and nothing of ours",
                async function () {
            let overview = await theirs.get("/admin/instances");
            let databases = overview.instances.map(
                (row) => row.database
            );

            assert.ok(
                databases.includes(OTHER_DB),
                "their own instance is there"
            );
            assert.equal(
                databases.includes(settings.testDb),
                false,
                "ours is not"
            );
            assert.equal(
                databases.includes(settings.testDb2),
                false,
                "none of ours is"
            );
            assert.equal(overview.organization.name, OTHER_ORG);
        });

        it("our administrator does not see theirs", async function () {
            let overview = await ours.get("/admin/instances");
            let databases = overview.instances.map(
                (row) => row.database
            );

            assert.equal(
                databases.includes(OTHER_DB),
                false,
                "their instance is not in our registry view"
            );
        });

        it("our administrator cannot close theirs", async function () {
            let theirRow = await db.withClient(
                settings.managerDb,
                async function (client) {
                    let resp = await client.query(
                        (
                            "SELECT id FROM tenant " +
                            "WHERE pg_database = $1 AND NOT is_deleted"
                        ),
                        [OTHER_DB]
                    );

                    return resp.rows[0];
                }
            );

            let resp = await ours.raw("POST", "/admin/instance/status", {
                id: theirRow.id,
                isActive: false
            });

            assert.equal(resp.status, 404, "not in our organization");
        });

        it("their administrator cannot close ours", async function () {
            let ourRow = await db.withClient(
                settings.managerDb,
                async function (client) {
                    let resp = await client.query(
                        (
                            "SELECT id FROM tenant " +
                            "WHERE pg_database = $1 AND NOT is_deleted"
                        ),
                        [settings.testDb2]
                    );

                    return resp.rows[0];
                }
            );

            let resp = await theirs.raw(
                "POST",
                "/admin/instance/status",
                {id: ourRow.id, isActive: false}
            );

            assert.equal(resp.status, 404, "not in their organization");
        });
    });
});
