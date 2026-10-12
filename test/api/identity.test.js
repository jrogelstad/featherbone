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
});
