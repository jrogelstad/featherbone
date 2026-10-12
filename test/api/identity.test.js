/*
    Identity sign-in (ADR-001 B.1/B.2), behind authStrategy "identity".

    A second server is started against the same databases with
    authStrategy=identity, so the suite proves both strategies work on
    one build. Identities are seeded in the manager: one with the
    application's own scrypt hash, one with the verifier Postgres holds
    for the harness user, which is the migration path -- the password
    must keep working, and the verifier must be replaced by a scrypt
    hash on the first successful sign-in.
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
const access = require("./lib/access");
const {Identities} = require("../../server/services/identities");

const identities = new Identities();
const PORT = settings.port + 2;
const GENERIC = "Invalid sign in credentials.";

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

async function seed() {
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

    await db.withClient(settings.managerDb, async function (client) {
        let resp = await client.query((
            "INSERT INTO organization (" + DOC_COLS + ",name,is_active," +
            "authentication,is_two_factor_required) VALUES (" +
            docVals("fbtorg000001") +
            ",'FBTest',true,'password',false) RETURNING _pk"
        ));
        let orgPk = resp.rows[0]._pk;

        await client.query(
            "UPDATE tenant SET _organization_organization_pk = $1",
            [orgPk]
        );

        async function identity(id, name, hash) {
            let r = await client.query((
                "INSERT INTO identity (" + DOC_COLS +
                ",_organization_organization_pk,username,full_name," +
                "email,password_hash,status,is_platform_admin," +
                "is_org_admin,failed_attempts) VALUES (" + docVals(id) +
                ",$1,$2,$2,'',$3,'active',false,false,0) RETURNING _pk"
            ), [orgPk, name, hash]);
            return r.rows[0]._pk;
        }

        async function grant(id, identityPk) {
            await client.query((
                "INSERT INTO access_grant (" + DOC_COLS +
                ",_identity_identity_pk,_tenant_tenant_pk,is_active," +
                "granted) SELECT " + docVals(id) +
                ",$1,_pk,true,now() FROM tenant WHERE pg_database = $2"
            ), [identityPk, settings.testDb]);
        }

        // The application's own hash
        let adminPk = await identity(
            "fbtident0001",
            settings.adminUser,
            identities.hashPassword(settings.password)
        );
        await grant("fbtgrant0001", adminPk);

        /*
            The admin identity also reaches the second instance, so the
            B.5 tests can prove that creating a user who already exists
            in the organization grants access without touching the
            password they already have.
        */
        await client.query((
            "INSERT INTO access_grant (" + DOC_COLS +
            ",_identity_identity_pk,_tenant_tenant_pk,is_active," +
            "granted) SELECT " + docVals("fbtgrant0011") +
            ",$1,_pk,true,now() FROM tenant WHERE pg_database = $2"
        ), [adminPk, settings.testDb2]);

        // The imported Postgres verifier (migration path)
        let basicPk = await identity("fbtident0002", settings.basicUser, verifier);
        await grant("fbtgrant0002", basicPk);

        // A granted identity for the lock test: failures must never
        // disturb the identities above
        let lockPk = await identity(
            "fbtident0003",
            "fbt_lockme",
            identities.hashPassword(settings.password)
        );
        await grant("fbtgrant0003", lockPk);

        // Correct password, but no grant to the instance
        await identity(
            "fbtident0004",
            "fbt_nogrant",
            identities.hashPassword(settings.password)
        );

        // The clean case: an identity with no Postgres login role at
        // all, which is what every user looks like after B.4
        let norolePk = await identity(
            "fbtident0005",
            "fbt_norole",
            identities.hashPassword(settings.password)
        );
        await grant("fbtgrant0005", norolePk);
    });

    /*
        Sign-in requires the local profile in the instance (B.5), so the
        test users get user_account rows -- but no Postgres role: the
        identity path must never need one.
    */
    await db.withClient(settings.testDb, async function (client) {
        async function profile(name) {
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

describe("identity sign-in (authStrategy identity)", function () {
    let child;
    let base = "http://127.0.0.1:" + PORT + "/" + settings.testDb;

    before(async function () {
        await seed();

        let logFile = path.join(settings.artifacts, "server-identity.log");
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
                    "identity server exited; see " + logFile
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
        throw new Error("identity server did not start; see " + logFile);
    });

    after(function () {
        if (child && child.exitCode === null) {
            child.kill("SIGTERM");
        }
    });

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
            assert.equal(resp.authStrategy, "identity");
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
                An identity with a grant still needs the local profile
                the instance keeps (B.5), so creating one here is half
                the job: the screen says so, and this proves it.
            */
            let attempt = await new Session(base).signIn(
                name,
                "Admin-Ui-Pw-2"
            );
            assert.equal(attempt.status, 401);

            let contact = await access.createContact(admin, name);
            await admin.raw("POST", "/data/user-account", {
                contact: {id: contact.id},
                membership: [{role: "everyone"}],
                name,
                password: "ignored-the-identity-has-one"
            });

            assert.equal(
                (await new Session(base).signIn(name, "Admin-Ui-Pw-2")).status,
                200,
                "the password set on the identity is the one that counts"
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

        it("serves the same screen while sign-in still uses roles",
                async function () {
            /*
                The administration screen is readable before the
                cutover, which is the point: an administrator can see
                what identity sign-in would do before turning it on.
                This talks to the harness server, which runs the
                default "role" strategy against the same databases.
            */
            let roleAdmin = new Session();
            let resp = await roleAdmin.signIn(
                settings.adminUser,
                settings.password
            );
            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            let overview = await roleAdmin.get("/admin/overview");
            assert.equal(overview.authStrategy, "role");
            assert.equal(overview.organization.name, "FBTest");
            assert.ok(overview.identities.length > 0);
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
});
