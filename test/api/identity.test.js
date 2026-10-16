/*
    Identity sign-in (ADR-001 B.1/B.2), the only way in (B.8).

    Identities are seeded in the manager: one with the application's
    own scrypt hash, one with the verifier Postgres held for the harness
    user, which is the migration path -- the password must keep
    working, and the verifier must be replaced by a scrypt hash on the
    first successful sign-in.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const access = require("./lib/access");
const {Identities} = require("../../server/services/identities");

const identities = new Identities();
const GENERIC = "Invalid sign in credentials.";

async function seed() {
    /*
        The harness already made the organization, the admin and basic
        identities and their grants (test/harness/db.js). This adds what
        these tests need on top, through the same idempotent helper.
    */

    // The verifier Postgres holds for the basic harness user; reading
    // pg_authid needs the superuser the harness already requires
    let verifier;
    await db.withClient("postgres", async function (client) {
        let resp = await client.query(
            "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
            [settings.basicUser]
        );
        verifier = resp.rows[0].rolpassword;
    });
    assert.ok(verifier, "pg_authid verifier for " + settings.basicUser);

    // The imported Postgres verifier (migration path): replaces the
    // application hash the harness gave this identity
    await db.ensureIdentity(settings.basicUser, settings.password, settings.testDb, {
        hash: verifier
    });

    /*
        The admin identity also reaches the second instance, so the
        B.5 tests can prove that creating a user who already exists
        in the organization grants access without touching the
        password they already have.
    */
    await db.ensureIdentity(settings.adminUser, settings.password, settings.testDb2);

    // A granted identity for the lock test: failures must never
    // disturb the identities above
    await db.ensureIdentity("fbt_lockme", settings.password, settings.testDb, {
        id: "fbtident0003"
    });

    // Correct password, but no grant to the instance
    await db.ensureIdentity("fbt_nogrant", settings.password, undefined, {
        id: "fbtident0004"
    });

    // The clean case: an identity with no Postgres login role at
    // all, which is what every user looks like after B.4
    await db.ensureIdentity("fbt_norole", settings.password, settings.testDb, {
        id: "fbtident0005"
    });

    /*
        Granted the instance, with no local profile at all: what
        somebody looks like the moment they are granted an
        instance they have never opened (B.7).
    */
    await db.ensureIdentity("fbt_noprofile", settings.password, settings.testDb, {
        id: "fbtident0006"
    });

    // Neither granted nor profiled: nothing may be made for them
    await db.ensureIdentity("fbt_ungranted", settings.password, undefined, {
        id: "fbtident0007"
    });

    /*
        Sign-in requires the local profile in the instance (B.5), so the
        test users get user_account rows -- but no Postgres role: the
        identity path must never need one.
    */
    await db.withClient(settings.testDb, async function (client) {
        async function profile(name) {
            await client.query(
                "DELETE FROM user_account WHERE name = $1",
                [name]
            );
            await client.query(
                (
                    "INSERT INTO user_account (id, name, is_super, " +
                    "is_active, is_login, change_password, " +
                    "sign_in_attempts, is_locked, is_deleted, owner, " +
                    "etag, created, created_by, updated, updated_by) " +
                    "VALUES ($1, $2, false, true, true, false, 0, " +
                    "false, false, $2, $1, now(), $2, now(), $2)"
                ),
                ["fbtua" + name.slice(-6), name]
            );
        }

        await profile("fbt_lockme");
        await profile("fbt_nogrant");
        await profile("fbt_norole");
    });
}

describe("identity sign-in", function () {
    let base = settings.baseUrl;

    before(seed);

    it("signs in against the application's own hash and serves data",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn(settings.adminUser, settings.password);

        assert.equal(resp.status, 200);
        let rows = await s.list("Kinds", {properties: ["id"]});
        assert.ok(Array.isArray(rows));
    });

    it("verifies an imported Postgres verifier and re-hashes it",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn(settings.basicUser, settings.password);

        assert.equal(resp.status, 200);

        let hash;
        await db.withClient(settings.managerDb, async function (client) {
            let r = await client.query(
                "SELECT password_hash FROM identity WHERE username = $1",
                [settings.basicUser]
            );
            hash = r.rows[0].password_hash;
        });
        assert.ok(
            hash.startsWith("scrypt$"),
            "verifier replaced on first sign-in, got " + hash.slice(0, 12)
        );

        // And the password still works against the new hash
        let again = await new Session(base).signIn(
            settings.basicUser,
            settings.password
        );
        assert.equal(again.status, 200);
    });

    it("signs in with no Postgres login role involved at all",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn("fbt_norole", settings.password);

        assert.equal(resp.status, 200);

        // No such role exists, so nothing about this sign-in could
        // have touched pg_authid
        await db.withClient("postgres", async function (client) {
            let r = await client.query(
                "SELECT 1 FROM pg_roles WHERE rolname = 'fbt_norole'"
            );
            assert.equal(r.rows.length, 0);
        });

        let rows = await s.list("Kinds", {properties: ["id"]});
        assert.ok(Array.isArray(rows));
    });

    it("refuses a wrong password with nothing but the generic message",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn(settings.adminUser, "wrong-password-1!");

        assert.equal(resp.status, 401);
        assert.equal(resp.body, GENERIC);
    });

    it("refuses an unknown user with the same generic message",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn("fbt_nobody", "wrong-password-1!");

        assert.equal(resp.status, 401);
        assert.equal(resp.body, GENERIC);
        assert.ok(
            !JSON.stringify(resp.body).includes(settings.testDb),
            "must not name the database"
        );
    });

    it("refuses a correct password without an access grant",
            async function () {
        let s = new Session(base);
        let resp = await s.signIn("fbt_nogrant", settings.password);

        assert.equal(resp.status, 401);
        assert.equal(resp.body, GENERIC);
    });

    it("locks the identity on the fourth failure and audits the lock",
            async function () {
        let s = new Session(base);
        let resp;

        resp = await s.signIn("fbt_lockme", "bad1!");
        assert.equal(resp.status, 401);
        resp = await s.signIn("fbt_lockme", "bad2!");
        assert.equal(resp.status, 401);
        resp = await s.signIn("fbt_lockme", "bad3!");
        assert.equal(resp.body, (
            "Invalid sign in credentials. " +
            "One more attempt before account is locked."
        ));
        resp = await s.signIn("fbt_lockme", "bad4!");
        assert.equal(resp.body, (
            "Too many sign in attempts. Account is locked."
        ));

        // The right password no longer helps
        resp = await s.signIn("fbt_lockme", settings.password);
        assert.equal(resp.body, "User account is locked");

        await db.withClient(settings.managerDb, async function (client) {
            let r = await client.query(
                "SELECT status FROM identity WHERE username = 'fbt_lockme'"
            );
            assert.equal(r.rows[0].status, "locked");

            r = await client.query((
                "SELECT count(*)::int AS n FROM admin_audit " +
                "WHERE action = 'identity.locked' " +
                "  AND _target_identity_identity_pk = " +
                "    (SELECT _pk FROM identity " +
                "     WHERE username = 'fbt_lockme')"
            ));
            assert.equal(r.rows[0].n, 1, "lock leaves an audit row");
        });
    });

    it("keeps sessions in the manager on the identity path too",
            async function () {
        await db.withClient(settings.managerDb, async function (client) {
            let r = await client.query(
                "SELECT count(*)::int AS n FROM \"$session\""
            );
            assert.ok(r.rows[0].n > 0);
        });
    });

    /*
        The administration routes over the manager (ADR-001 tiers).
        They run inside an instance because the manager is not
        routable, and they act on that instance's organization.
    */
    describe("administration of the manager", function () {
        let admin;

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

        before(async function () {
            admin = new Session(base);
            let resp = await admin.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        after(async function () {
            await flags(settings.adminUser, {});
        });

        it("shows the organization, its instances and its identities",
                async function () {
            let resp = await admin.get("/admin/overview");

            assert.equal(resp.organization.name, "FBTest");
            assert.equal(resp.authStrategy, undefined, "no strategy flag");
            assert.ok(
                resp.identities.some(
                    (row) => row.username === settings.adminUser
                ),
                "the caller is in its own organization"
            );
            assert.ok(
                resp.instances.some(
                    (row) => row.database === settings.testDb
                ),
                "lists the instances of the organization"
            );

            let seeded = resp.identities.find(
                (row) => row.username === "fbt_norole"
            );
            assert.ok(seeded.grants.some(
                (g) => g.isActive === true
            ), "an identity carries the instances it may reach");
        });

        it("reports a locked account as locked and releases it",
                async function () {
            let name = access.track(access.uniq("fbt_lock2"));
            let contact = await access.createContact(admin, name);

            await admin.raw("POST", "/data/user-account", {
                contact: {id: contact.id},
                membership: [{role: "everyone"}],
                name,
                password: "Admin-Ui-Pw-1"
            });

            // Four failures lock it, as the sign-in tests prove
            let guest = new Session(base);
            let i = 0;
            while (i < 4) {
                await guest.signIn(name, "wrong-pw-" + i);
                i += 1;
            }

            let overview = await admin.get("/admin/overview");
            let locked = overview.identities.find(
                (row) => row.username === name
            );
            assert.equal(locked.status, "locked");
            assert.ok(locked.failedAttempts >= 4);

            let resp = await admin.raw(
                "POST",
                "/admin/identity/status",
                {id: locked.id, status: "active"}
            );
            assert.ok(resp.status < 300, JSON.stringify(resp.body));

            let reread = await admin.get("/admin/overview");
            let released = reread.identities.find(
                (row) => row.username === name
            );
            assert.equal(released.status, "active");
            assert.equal(released.failedAttempts, 0);
            assert.ok(
                reread.audit.some(
                    (row) => (
                        row.action === "identity.unlocked" &&
                        row.target === name
                    )
                ),
                "the release is audited"
            );

            // And the account works again
            assert.equal(
                (await new Session(base).signIn(name, "Admin-Ui-Pw-1")).status,
                200
            );
        });

        it("creates an identity and lets it sign in", async function () {
            let name = access.track(access.uniq("fbt_made"));

            let resp = await admin.raw("POST", "/admin/identity", {
                fullName: "Made Here",
                password: "Admin-Ui-Pw-2",
                username: name
            });
            assert.ok(resp.status < 300, JSON.stringify(resp.body));
            assert.equal(resp.body.created, true);

            /*
                The grant is enough: the local profile the instance
                keeps is made on the first sign-in (B.7). Creating an
                identity from the screen used to be half the job, and
                the other half was a SQL statement.
            */
            let attempt = await new Session(base).signIn(
                name,
                "Admin-Ui-Pw-2"
            );

            assert.equal(
                attempt.status,
                200,
                "the identity signs in with no profile prepared"
            );

            let profile = await db.withClient(
                settings.testDb,
                (client) => client.query(
                    (
                        "SELECT u.is_super, " +
                        "  (SELECT count(*)::int FROM role_membership rm " +
                        "    WHERE rm._parent_role_pk = u._pk " +
                        "      AND NOT rm.is_deleted) AS roles " +
                        "FROM user_account u WHERE u.name = $1"
                    ),
                    [name]
                )
            );

            assert.equal(profile.rows.length, 1, "and the profile is there");
            assert.equal(profile.rows[0].is_super, false);
            assert.equal(
                profile.rows[0].roles,
                1,
                "a member of everyone and nothing else"
            );

            // The password that counts is the identity's, either way
            assert.equal(
                (
                    await new Session(base).signIn(name, "wrong-password")
                ).status,
                401
            );
        });

        it("grants and revokes an instance", async function () {
            let overview = await admin.get("/admin/overview");
            let target = overview.identities.find(
                (row) => row.username === "fbt_nogrant"
            );
            let other = overview.instances.find(
                (row) => row.database === settings.testDb2
            );

            // Granting another instance is above an instance
            // administrator, so the admin identity is made an
            // organization administrator for this test
            await flags(settings.adminUser, {isOrgAdmin: true});

            let resp = await admin.raw("POST", "/admin/grant", {
                id: target.id,
                instance: other.id,
                isActive: true
            });
            assert.ok(resp.status < 300, JSON.stringify(resp.body));

            let granted = (await admin.get("/admin/overview")).identities.find(
                (row) => row.username === "fbt_nogrant"
            );
            assert.ok(
                granted.grants.some(
                    (g) => g.instance === other.id && g.isActive === true
                ),
                "the grant shows on the identity"
            );

            await admin.raw("POST", "/admin/grant", {
                id: target.id,
                instance: other.id,
                isActive: false
            });

            let revoked = (await admin.get("/admin/overview")).identities.find(
                (row) => row.username === "fbt_nogrant"
            );
            assert.ok(
                revoked.grants.some(
                    (g) => g.instance === other.id && g.isActive === false
                ),
                "a revoke keeps the row and deactivates it"
            );
        });

        it("keeps an instance administrator inside its own instance",
                async function () {
            await flags(settings.adminUser, {});

            let overview = await admin.get("/admin/overview");
            assert.equal(overview.tier, "instance");

            let target = overview.identities.find(
                (row) => row.username === "fbt_nogrant"
            );
            let other = overview.instances.find(
                (row) => row.database === settings.testDb2
            );
            let resp = await admin.raw("POST", "/admin/grant", {
                id: target.id,
                instance: other.id,
                isActive: true
            });

            assert.equal(resp.status, 401);
            assert.match(resp.body, /organization administrator/);

            // And it may not touch somebody who is not in its instance
            resp = await admin.raw("POST", "/admin/identity/password", {
                id: target.id,
                password: "Admin-Ui-Pw-3"
            });
            assert.equal(resp.status, 401);
            assert.match(resp.body, /no access to/);

            // Nor appoint administrators
            resp = await admin.raw("POST", "/admin/identity/org-admin", {
                id: target.id,
                isOrgAdmin: true
            });
            assert.equal(resp.status, 401);
        });

        it("names the tier an organization administrator has",
                async function () {
            await flags(settings.adminUser, {isOrgAdmin: true});
            assert.equal((await admin.get("/admin/overview")).tier,
                "organization");

            await flags(settings.adminUser, {isPlatformAdmin: true});
            assert.equal((await admin.get("/admin/overview")).tier,
                "platform");

            await flags(settings.adminUser, {});
        });

        it("refuses a user who is neither an administrator nor super",
                async function () {
            let basic = new Session(base);
            let resp = await basic.signIn(
                settings.basicUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            resp = await basic.raw("GET", "/admin/overview");
            assert.equal(resp.status, 401);
            assert.match(resp.body, /Not authorized/);
        });

        it("refuses a request with no session at all", async function () {
            let resp = await fetch(base + "/admin/overview");

            assert.equal(resp.status, 401);
        });
    });

    /*
        B.4 and B.5: creating users, setting passwords and revoking
        access write identities, grants and the local profile. Nothing
        in here may create or alter a Postgres role, which is what the
        pg_roles assertions are for.
    */
    describe("users on the identity path (B.4, B.5)", function () {
        let admin;

        async function identityRow(username) {
            let row;

            await db.withClient(settings.managerDb, async function (client) {
                let r = await client.query(
                    (
                        "SELECT i.*, g.is_active AS granted " +
                        "FROM identity i " +
                        "LEFT JOIN access_grant g " +
                        "  ON g._identity_identity_pk = i._pk " +
                        " AND g._tenant_tenant_pk = (" +
                        "   SELECT _pk FROM tenant WHERE pg_database = $2" +
                        " ) " +
                        "WHERE lower(i.username) = lower($1) " +
                        "  AND NOT i.is_deleted"
                    ),
                    [username, settings.testDb]
                );
                row = r.rows[0];
            });

            return row;
        }

        async function hasPgRole(name) {
            let found;

            await db.withClient("postgres", async function (client) {
                let r = await client.query(
                    "SELECT 1 FROM pg_roles WHERE rolname = $1",
                    [name]
                );
                found = r.rows.length > 0;
            });

            return found;
        }

        async function auditCount(action, username) {
            let n;

            await db.withClient(settings.managerDb, async function (client) {
                let r = await client.query(
                    (
                        "SELECT count(*)::int AS n FROM admin_audit " +
                        "WHERE action = $1 " +
                        "  AND _target_identity_identity_pk = (" +
                        "    SELECT _pk FROM identity " +
                        "    WHERE lower(username) = lower($2))"
                    ),
                    [action, username]
                );
                n = r.rows[0].n;
            });

            return n;
        }

        async function newUser(session, name, password) {
            let contact = await access.createContact(session, name);
            let resp = await session.raw("POST", "/data/user-account", {
                contact: {id: contact.id},
                membership: [{role: "everyone"}],
                name,
                password
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            return resp;
        }

        before(async function () {
            admin = new Session(base);
            let resp = await admin.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("creates an identity and a grant, and no Postgres role",
                async function () {
            let name = access.track(access.uniq("fbt_ident"));

            await newUser(admin, name, "Identity-Pw-1");

            let row = await identityRow(name);
            assert.ok(row, "identity created in the manager");
            assert.equal(row.status, "active");
            assert.ok(
                row.password_hash.startsWith("scrypt$"),
                "password stored as the application's own hash"
            );
            assert.equal(row.granted, true, "granted this instance");
            assert.equal(
                await hasPgRole(name),
                false,
                "no Postgres login role was created"
            );
            assert.equal(await auditCount("identity.created", name), 1);

            // And the local profile is there, which sign-in needs
            let profile = await admin.findBy("UserAccounts", "name", name);
            assert.equal(profile.length, 1);
        });

        it("lets the user it just created sign in", async function () {
            let name = access.track(access.uniq("fbt_signin"));

            await newUser(admin, name, "Identity-Pw-2");

            let resp = await new Session(base).signIn(name, "Identity-Pw-2");
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("sets the password on the identity, not on the cluster",
                async function () {
            let name = access.track(access.uniq("fbt_pwset"));

            await newUser(admin, name, "Identity-Pw-3");
            let original = await identityRow(name);

            // An administrator sets another user's password by
            // patching the account; /do/change-role-password/ is the
            // caller changing their own and signs the session out
            let account = await admin.findBy("UserAccounts", "name", name);

            await admin.patch("UserAccount", account[0].id, [{
                op: "replace",
                path: "/password",
                value: "Identity-Pw-4"
            }]);

            let updated = await identityRow(name);
            assert.notEqual(
                updated.password_hash,
                original.password_hash,
                "the stored hash changed"
            );
            assert.ok(updated.password_hash.startsWith("scrypt$"));
            assert.equal(await hasPgRole(name), false);
            assert.ok(await auditCount("identity.password_set", name) > 0);

            let signedInAgain = await new Session(base).signIn(
                name,
                "Identity-Pw-4"
            );
            assert.equal(signedInAgain.status, 200);
        });

        it("deactivating a user deactivates its grant and blocks sign-in",
                async function () {
            let name = access.track(access.uniq("fbt_deact"));

            await newUser(admin, name, "Identity-Pw-5");
            let account = await admin.findBy("UserAccounts", "name", name);

            await admin.update("UserAccount", account[0].id, function (rec) {
                rec.isActive = false;
            });

            let row = await identityRow(name);
            assert.equal(row.granted, false, "grant deactivated");
            assert.equal(
                row.status,
                "active",
                "the identity itself is untouched: it may hold other " +
                "instances"
            );

            let resp = await new Session(base).signIn(name, "Identity-Pw-5");
            assert.equal(resp.status, 401);
            assert.equal(resp.body, GENERIC);
        });

        it("deleting a user revokes access and keeps the identity",
                async function () {
            let name = access.track(access.uniq("fbt_del"));

            await newUser(admin, name, "Identity-Pw-6");
            let account = await admin.findBy("UserAccounts", "name", name);

            await admin.remove("UserAccount", account[0].id);

            let row = await identityRow(name);
            assert.ok(row, "identity survives the local delete");
            assert.equal(row.granted, false);
            assert.ok(await auditCount("grant.revoked", name) > 0);
        });

        it("grants a second instance without changing the password",
                async function () {
            let name = access.track(access.uniq("fbt_two"));

            await newUser(admin, name, "Identity-Pw-7");
            let first = await identityRow(name);

            // The same person, created again in the other instance
            let other = new Session(
                base.replace("/" + settings.testDb, "/" + settings.testDb2)
            );
            let resp = await other.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            await newUser(other, name, "Different-Pw-8");

            let updated = await identityRow(name);
            assert.equal(
                updated.password_hash,
                first.password_hash,
                "an existing identity keeps the password it had"
            );
            assert.equal(await auditCount("grant.added", name), 1);

            // The original password is the one that still works
            assert.equal(
                (await new Session(base).signIn(name, "Different-Pw-8")).status,
                401
            );
            assert.equal(
                (await new Session(base).signIn(name, "Identity-Pw-7")).status,
                200
            );
        });

        it("creates a group role with no Postgres role behind it",
                async function () {
            let name = access.track(access.uniq("fbt_group"));
            let role = await admin.create("Role", {isLogin: false, name});

            assert.equal(role.name, name);
            assert.equal(
                await hasPgRole(name),
                false,
                "a group role is rows in role and role_membership only"
            );

            // And a user may be made a member of it, which is a row too
            let user = access.track(access.uniq("fbt_member"));
            await newUser(admin, user, "Identity-Pw-9");
            let account = await admin.findBy("UserAccounts", "name", user);

            await admin.update("UserAccount", account[0].id, function (rec) {
                rec.membership.push({role: name});
            });

            let resp = await db.query(
                (
                    "SELECT rm.role FROM role_membership rm " +
                    "JOIN role r ON rm._parent_role_pk = r._pk " +
                    "WHERE r.name = $1 AND NOT rm.is_deleted"
                ),
                [user]
            );
            let roles = resp.rows.map((row) => row.role);

            let expected = ["everyone", name];

            roles.sort();
            expected.sort();
            assert.deepEqual(roles, expected);
            assert.equal(await hasPgRole(user), false);
        });
    });

    /*
        The local profile an instance needs, made on demand from a
        live grant (tenant plan B.7).
    */
    describe("the local profile a grant implies", function () {
        function profileOf(name) {
            return db.withClient(
                settings.testDb,
                (client) => client.query(
                    (
                        "SELECT u.name, u.is_super, u.is_active, " +
                        "  u.is_login, u.change_password, " +
                        "  (SELECT count(*)::int FROM role_membership rm " +
                        "    WHERE rm._parent_role_pk = u._pk " +
                        "      AND rm.role = 'everyone' " +
                        "      AND NOT rm.is_deleted) AS everyone " +
                        "FROM user_account u WHERE u.name = $1 " +
                        "  AND NOT u.is_deleted"
                    ),
                    [name]
                )
            );
        }

        it("is missing before the first sign-in", async function () {
            let resp = await profileOf("fbt_noprofile");

            assert.equal(resp.rows.length, 0, "nothing there yet");

            // Fixture sanity: the identity and its grant do exist
            let granted = await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "SELECT i.username, i.status, g.is_active, " +
                        "  t.pg_database FROM identity i " +
                        "LEFT OUTER JOIN access_grant g ON " +
                        "  g._identity_identity_pk = i._pk " +
                        "LEFT OUTER JOIN tenant t ON " +
                        "  g._tenant_tenant_pk = t._pk " +
                        "WHERE i.username = $1"
                    ),
                    ["fbt_noprofile"]
                )
            );

            assert.equal(
                granted.rows.length,
                1,
                "one identity, one grant: " + JSON.stringify(granted.rows)
            );
            assert.equal(granted.rows[0].status, "active");
            assert.equal(granted.rows[0].is_active, true);
            assert.equal(granted.rows[0].pg_database, settings.testDb);
        });

        it("lets a granted identity in and makes the profile",
                async function () {
            let session = new Session(base);
            let resp = await session.signIn(
                "fbt_noprofile",
                settings.password
            );

            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            let made = await profileOf("fbt_noprofile");

            assert.equal(made.rows.length, 1, "the profile was made");

            let row = made.rows[0];

            assert.equal(row.is_active, true);
            assert.equal(row.is_login, true);
            assert.equal(
                row.is_super,
                false,
                "and it carries no authority of its own"
            );
            assert.equal(row.change_password, false);
            assert.equal(row.everyone, 1, "a member of everyone, only");
        });

        it("records it in the audit trail", async function () {
            let resp = await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    (
                        "SELECT a.detail, i.username FROM admin_audit a " +
                        "LEFT OUTER JOIN identity i ON " +
                        "  a._target_identity_identity_pk = i._pk " +
                        "WHERE a.action = 'user_account.provisioned'"
                    )
                )
            );

            assert.ok(
                resp.rows.some((row) => row.username === "fbt_noprofile"),
                "the profile created is audited against the identity"
            );
        });

        it("signs in again without making a second one",
                async function () {
            let session = new Session(base);

            assert.equal(
                (
                    await session.signIn("fbt_noprofile", settings.password)
                ).status,
                200
            );

            let again = await profileOf("fbt_noprofile");

            assert.equal(again.rows.length, 1, "still exactly one");
        });

        it("makes nothing for an identity with no grant",
                async function () {
            let session = new Session(base);
            let resp = await session.signIn(
                "fbt_ungranted",
                settings.password
            );

            assert.equal(resp.status, 401, "refused, as before");

            let none = await profileOf("fbt_ungranted");

            assert.equal(
                none.rows.length,
                0,
                "and the refusal left nothing behind"
            );
        });

        it("makes nothing on a wrong password", async function () {
            let session = new Session(base);

            await session.signIn("fbt_noprofile2", settings.password);

            let none = await profileOf("fbt_noprofile2");

            assert.equal(none.rows.length, 0);
        });
    });

    /*
        The instances screen (tenant plan D.4). The registry lives in
        the manager, which is not routable, so these run inside an
        instance and act on that instance's organization.
    */
    describe("administration of the registry", function () {
        let admin;

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

        before(async function () {
            admin = new Session(base);
            let resp = await admin.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            await flags(settings.adminUser, {isOrgAdmin: true});
        });

        after(async function () {
            await flags(settings.adminUser, {});
        });

        it("lists the organization's instances and names the manager",
                async function () {
            let resp = await admin.get("/admin/instances");
            let here = resp.instances.find(
                (row) => row.database === settings.testDb
            );

            assert.equal(resp.organization.name, "FBTest");
            assert.equal(resp.manager.database, settings.managerDb);
            assert.ok(here, "the instance signed in to is listed");
            assert.equal(here.isCurrent, true);
            assert.equal(here.isActive, true);
            assert.ok(
                here.service && here.service.name,
                "an instance says what it connects through"
            );
            assert.ok(
                resp.instances.some(
                    (row) => row.database === settings.testDb2
                ),
                "and so is the organization's other instance"
            );
        });

        it("says which instances this server is actually serving",
                async function () {
            let resp = await admin.get("/admin/instances");
            let here = resp.instances.find(
                (row) => row.database === settings.testDb
            );

            // The server is answering this request through it
            assert.equal(here.isServed, true);
        });

        it("does not offer the manager as a database to register",
                async function () {
            let resp = await admin.get("/admin/instances");

            assert.equal(
                resp.databases.includes(settings.managerDb),
                false,
                "the manager is not an instance and must not be offered"
            );
        });

        it("refuses a database nothing is registered for", async function () {
            let resp = await admin.raw("POST", "/admin/instance", {
                database: "fbt_no_such_database",
                name: "Nope",
                service: "whatever"
            });

            assert.equal(resp.status, 400, JSON.stringify(resp.body));
        });

        it("wants a name and a connection", async function () {
            let overview = await admin.get("/admin/instances");
            let candidate = overview.databases[0];

            if (!candidate) {
                // Nothing spare in this cluster to register
                return;
            }

            let unnamed = await admin.raw("POST", "/admin/instance", {
                database: candidate,
                name: "",
                service: overview.services[0].id
            });

            assert.equal(unnamed.status, 400, JSON.stringify(unnamed.body));

            let unrouted = await admin.raw("POST", "/admin/instance", {
                database: candidate,
                name: "No connection",
                service: "fbt_no_such_service"
            });

            assert.equal(unrouted.status, 400, JSON.stringify(unrouted.body));
        });

        it("will not close the instance you are signed in to",
                async function () {
            let overview = await admin.get("/admin/instances");
            let here = overview.instances.find((row) => row.isCurrent);
            let resp = await admin.raw("POST", "/admin/instance/status", {
                id: here.id,
                isActive: false
            });

            assert.equal(resp.status, 400, JSON.stringify(resp.body));

            let reread = await admin.get("/admin/instances");

            assert.equal(
                reread.instances.find((row) => row.isCurrent).isActive,
                true,
                "and it is still open"
            );
        });

        it("closes another instance and opens it again", async function () {
            let overview = await admin.get("/admin/instances");
            let other = overview.instances.find(
                (row) => row.database === settings.testDb2
            );

            let closed = await admin.raw("POST", "/admin/instance/status", {
                id: other.id,
                isActive: false
            });

            assert.ok(closed.status < 300, JSON.stringify(closed.body));

            let afterClose = await admin.get("/admin/instances");

            assert.equal(
                afterClose.instances.find(
                    (row) => row.database === settings.testDb2
                ).isActive,
                false
            );
            assert.ok(
                afterClose.audit.some(
                    (row) => row.action === "instance.closed"
                ),
                "closing is audited"
            );

            let opened = await admin.raw("POST", "/admin/instance/status", {
                id: other.id,
                isActive: true
            });

            assert.ok(opened.status < 300, JSON.stringify(opened.body));

            let afterOpen = await admin.get("/admin/instances");

            assert.equal(
                afterOpen.instances.find(
                    (row) => row.database === settings.testDb2
                ).isActive,
                true,
                "left as it was found"
            );
        });

        it("shows an ordinary administrator only their own instance",
                async function () {
            await flags(settings.adminUser, {});

            let resp = await admin.get("/admin/instances");

            assert.equal(resp.tier, "instance");
            assert.equal(resp.instances.length, 1);
            assert.equal(resp.instances[0].isCurrent, true);
            assert.deepEqual(resp.databases, [], "nothing to register");
            assert.deepEqual(resp.orphans, []);
            assert.deepEqual(resp.audit, []);

            let refused = await admin.raw("POST", "/admin/instance/status", {
                id: resp.instances[0].id,
                isActive: false
            });

            assert.equal(refused.status, 401, JSON.stringify(refused.body));
            await flags(settings.adminUser, {isOrgAdmin: true});
        });
    });
});
