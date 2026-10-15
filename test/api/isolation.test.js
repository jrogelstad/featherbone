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

    The suite runs its own server with authStrategy=identity against
    the harness databases, seeds a second organization that shares
    usernames with the first, and then tries to cross the line: by
    signing in, and through every write the administration routes
    offer. It also covers F.2's substance -- one person with an
    identity in each organization, separate credentials, and revoking
    one leaving the other working.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Identities} = require("../../server/services/identities");

const identities = new Identities();
const PORT = settings.port + 3;
const OTHER_PW = "Fbtest-Other-Org-2!";
const OTHER_ORG = "FBOther";
const OTHER_ONLY = "fbt_other_only";

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
                ",$1,$2,$2,'',$3,'active',false,$4,0) RETURNING _pk"
            ), [
                orgPk,
                name,
                identities.hashPassword(password),
                Boolean(flags && flags.isOrgAdmin)
            ]);

            return resp.rows[0]._pk;
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
        await client.query(
            (
                "UPDATE identity SET is_org_admin = true " +
                "WHERE _pk = $1"
            ),
            [adminA]
        );

        /*
            Organization B: the same two usernames, different
            passwords, plus one name that exists only here. No grant to
            anything of A's -- that is the point.
        */
        let orgB = await organization("fbtorg000002", OTHER_ORG);

        await identity(
            "fbtisob00001",
            orgB,
            settings.adminUser,
            OTHER_PW,
            {isOrgAdmin: true}
        );
        await identity(
            "fbtisob00002",
            orgB,
            settings.basicUser,
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
    let child;
    let base = "http://127.0.0.1:" + PORT + "/" + settings.testDb;
    let idsOther = {};
    let hashes = {};

    before(async function () {
        await seed();

        await db.withClient(settings.managerDb, async function (client) {
            let resp = await identityPk(client, OTHER_ORG, OTHER_ONLY);
            idsOther.onlyThere = resp.rows[0].id;

            resp = await identityPk(client, OTHER_ORG, settings.basicUser);
            idsOther.sameName = resp.rows[0].id;
            hashes.b = resp.rows[0].password_hash;

            resp = await identityPk(client, "FBTest", settings.basicUser);
            hashes.a = resp.rows[0].password_hash;
        });

        let logFile = path.join(settings.artifacts, "server-isolation.log");

        child = spawn(process.execPath, ["server.js"], {
            cwd: settings.root,
            env: Object.assign({}, process.env, {
                authStrategy: "identity",
                managerDatabase: settings.managerDb,
                modulesDir: settings.modulesDir,
                PORT: String(PORT),
                clientPort: String(PORT),
                logSilent: "true",
                twoFactorAuth: "false"
            }),
            stdio: [
                "ignore",
                fs.openSync(logFile, "w"),
                fs.openSync(logFile, "a")
            ]
        });

        let started = Date.now();
        while (Date.now() - started < 60000) {
            if (child.exitCode !== null) {
                throw new Error(
                    "isolation server exited; see " + logFile
                );
            }
            try {
                let resp = await fetch(base + "/", {redirect: "manual"});
                if (resp.status < 500) {
                    return;
                }
            } catch (ignore) {}
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error("isolation server did not start; see " + logFile);
    });

    after(async function () {
        if (child && child.exitCode === null) {
            child.kill("SIGTERM");
        }
        await unseed();
    });

    describe("sign-in", function () {
        it("keeps one password per organization for one username",
                async function () {
            // The same name in both organizations, and the two
            // identities really do hold different secrets
            assert.notEqual(hashes.a, hashes.b, "two separate hashes");

            let mine = new Session(base);
            let resp = await mine.signIn(
                settings.basicUser,
                settings.password
            );

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("refuses the other organization's password for that name",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(settings.basicUser, OTHER_PW);

            assert.equal(
                resp.status,
                401,
                "B's password must not open A's instance"
            );
        });

        it("refuses the other organization's administrator outright",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(settings.adminUser, OTHER_PW);

            assert.equal(resp.status, 401, JSON.stringify(resp.body));

            // And A's own administrator is untouched by any of it
            let ours = new Session(base);

            assert.equal(
                (
                    await ours.signIn(settings.adminUser, settings.password)
                ).status,
                200
            );
        });

        it("refuses a name that exists only in the other organization",
                async function () {
            let theirs = new Session(base);
            let resp = await theirs.signIn(OTHER_ONLY, OTHER_PW);

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
        });

        it("grants no authorization in the instance it was refused from",
                async function () {
            let theirs = new Session(base);

            await theirs.signIn(settings.basicUser, OTHER_PW);

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

        it("cannot reset the password of its own name over there",
                async function () {
            // The case item 1.1 described: one administrator reaching
            // another organization's user who happens to share a name
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
                        settings.basicUser
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

        it("cannot make them an administrator", async function () {
            let resp = await admin.raw("POST", "/admin/identity/org-admin", {
                id: idsOther.sameName,
                isOrgAdmin: true
            });

            assert.equal(resp.status, 404, JSON.stringify(resp.body));
        });
    });

    describe("one person in two organizations (F.2)", function () {
        it("keeps each identity on its own credential", async function () {
            let mine = new Session(base);

            assert.equal(
                (
                    await mine.signIn(settings.basicUser, settings.password)
                ).status,
                200,
                "their identity here works"
            );

            let other = new Session(base);

            assert.equal(
                (await other.signIn(settings.basicUser, OTHER_PW)).status,
                401,
                "their identity there is no use here"
            );
        });

        it("leaves one working when the other is revoked",
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
                    [OTHER_ORG, settings.basicUser]
                )
            );

            let mine = new Session(base);

            assert.equal(
                (
                    await mine.signIn(settings.basicUser, settings.password)
                ).status,
                200,
                "disabling their other identity must not reach this one"
            );
        });
    });
});
