/*
    Two nodes against the same databases (tenant plan F.3).

    A second server process is started on the harness databases and the
    multi-node claims are run rather than asserted: a session opened on
    one node works on the other (sessions are rows in the manager), a
    WebAuthn ceremony begun on one node is finished -- here, failed
    deliberately -- on the other (challenges are rows since E.2), a
    provisioning run claimed by one node answers busy on the other
    (FOR UPDATE SKIP LOCKED on the "$provision" row), and two processes
    contending for one named claim produce exactly one winner (E.1).

    Cron itself lives in the CronJob module, so "each job fires once"
    is proven at the primitive the module is to call: claimWork.
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

const PORT = settings.port + 4;
const CLAIM_DB = (settings.testDb + "_claim").toLowerCase();

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

/*
    One run of the claim contender: a bare process that loads the
    datasource against the harness manager and tries to claim the key.
    Separate processes, not promises, because the point is two NODES.
*/
function contend(key, seconds) {
    return new Promise(function (resolve, reject) {
        let child = spawn(process.execPath, [
            "-e",
            (
                "const datasource = require(\"./server/datasource\");\n" +
                "datasource.claimWork(" + JSON.stringify(key) + ", " +
                seconds + ").then(function (won) {\n" +
                "    console.log(won ? \"WIN\" : \"LOSE\");\n" +
                "    process.exit(0);\n" +
                "}).catch(function (err) {\n" +
                "    console.error(err.message || err);\n" +
                "    process.exit(1);\n" +
                "});"
            )
        ], {
            cwd: settings.root,
            env: Object.assign({}, process.env, {
                managerDatabase: settings.managerDb
            })
        });
        let out = "";
        let errOut = "";

        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (errOut += d));
        child.on("close", function (code) {
            if (code !== 0) {
                reject(new Error(errOut || ("exit " + code)));
                return;
            }
            resolve(out.trim());
        });
    });
}

async function cleanupClaim() {
    await db.withClient("postgres", (client) => client.query(
        "DROP DATABASE IF EXISTS " + CLAIM_DB + " WITH (FORCE)"
    ));
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            "DELETE FROM \"$claim\" WHERE key LIKE 'fbtest%'"
        ).catch(function () {
            return;
        });
        await client.query(
            (
                "DELETE FROM \"$provision\" WHERE tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = $1)"
            ),
            [CLAIM_DB]
        ).catch(function () {
            return;
        });
        await client.query(
            (
                "DELETE FROM access_grant WHERE _tenant_tenant_pk IN (" +
                "  SELECT _pk FROM tenant WHERE pg_database = $1)"
            ),
            [CLAIM_DB]
        );
        await client.query(
            "DELETE FROM tenant WHERE pg_database = $1",
            [CLAIM_DB]
        );
    });
}

describe("two nodes, one installation (F.3)", function () {
    let child;
    let baseB = "http://127.0.0.1:" + PORT + "/" + settings.testDb;

    before(async function () {
        await cleanupClaim();
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });

        let logFile = path.join(settings.artifacts, "server-node-b.log");

        child = spawn(process.execPath, ["server.js"], {
            cwd: settings.root,
            env: Object.assign({}, process.env, {
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
                throw new Error("node B exited; see " + logFile);
            }
            try {
                let resp = await fetch(baseB + "/", {redirect: "manual"});
                if (resp.status < 500) {
                    return;
                }
            } catch (ignore) {}
            await new Promise((r) => setTimeout(r, 250));
        }
        throw new Error("node B did not start; see " + logFile);
    });

    after(async function () {
        if (child && child.exitCode === null) {
            child.kill("SIGTERM");
        }
        await flags(settings.adminUser, {});
        await cleanupClaim();
    });

    it("a session opened on node A works on node B", async function () {
        let a = new Session();
        let resp = await a.signIn(settings.basicUser, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        // Same cookie, other process
        let b = new Session(baseB);
        b.cookie = a.cookie;

        let kinds = await b.raw("POST", "/data/kinds", {
            filter: {limit: 1}
        });

        assert.equal(
            kinds.status,
            200,
            "node B honors node A's session: " + JSON.stringify(kinds.body)
        );
        await a.signOut();
    });

    it("signing out on node B ends the session for node A too",
            async function () {
        let a = new Session();
        await a.signIn(settings.basicUser, settings.password);

        let b = new Session(baseB);
        b.cookie = a.cookie;
        await b.signOut();

        let after_ = await a.raw("POST", "/data/kinds", {
            filter: {limit: 1}
        });

        assert.notEqual(after_.status, 200, "one sign-out, both nodes");
    });

    it("a WebAuthn challenge issued by node A is consumed by node B",
            async function () {
        let a = new Session();
        await a.signIn(settings.basicUser, settings.password);

        let options = await a.raw("GET", "/webauthn/reg");
        assert.equal(options.status, 200);
        assert.ok(options.body.challenge, "node A issued a challenge");

        // Finish -- deliberately badly -- on node B with A's session
        let b = new Session(baseB);
        b.cookie = a.cookie;

        let finish = await b.raw("POST", "/webauthn/reg", {
            rawId: "AAAA",
            response: {
                attestationObject: "AAAA",
                clientDataJSON: "AAAA"
            }
        });

        /*
            The attestation is garbage, so it fails -- but it fails in
            the signature check, not for want of the challenge, which
            node B found in the manager and consumed:
        */
        assert.equal(finish.status, 500);
        assert.doesNotMatch(
            String(finish.body),
            /No current reg challenge/,
            "node B found node A's challenge"
        );

        let again = await b.raw("POST", "/webauthn/reg", {
            rawId: "AAAA",
            response: {
                attestationObject: "AAAA",
                clientDataJSON: "AAAA"
            }
        });

        assert.match(
            String(again.body),
            /No current reg challenge/,
            "and it was consumed: one ceremony, one challenge"
        );
        await a.signOut();
    });

    it("a provisioning run claimed on node A answers busy on node B",
            async function () {
        const {Client} = require("pg");
        let admin = new Session();
        await admin.signIn(settings.adminUser, settings.password);

        let adminB = new Session(baseB);
        adminB.cookie = admin.cookie;

        let overview = await admin.get("/admin/instances");
        let service = overview.services[0].id;

        /*
            Hold the template busy so node A's "requested" step takes
            its time failing (the guarded clone polls the busy source
            for a few seconds) while node B tries the same build.
        */
        let holder = new Client({
            database: settings.testDb2,
            host: settings.pgHost,
            password: settings.pgPassword,
            port: settings.pgPort,
            user: settings.pgUser
        });
        await holder.connect();

        let busyAnswer;

        try {
            let first = admin.raw("POST", "/admin/instance/provision", {
                database: CLAIM_DB,
                name: "Claimed",
                service,
                template: settings.testDb2
            });

            // Give node A time to write the row and take the step lock
            await new Promise((r) => setTimeout(r, 1500));

            let row = await db.withClient(
                settings.managerDb,
                async function (client) {
                    let found = await client.query(
                        (
                            "SELECT t.id FROM tenant t " +
                            "WHERE t.pg_database = $1 AND NOT t.is_deleted"
                        ),
                        [CLAIM_DB]
                    );

                    return found.rows[0];
                }
            );
            assert.ok(row, "node A registered the build");

            let second = await adminB.raw(
                "POST",
                "/admin/instance/provision/resume",
                {id: row.id}
            );

            busyAnswer = second;
            await first;
        } finally {
            await holder.end();
        }

        assert.equal(
            busyAnswer.status,
            200,
            JSON.stringify(busyAnswer.body)
        );
        assert.equal(
            busyAnswer.body.busy,
            true,
            "node B found the step claimed: " +
            JSON.stringify(busyAnswer.body)
        );
    });

    it("two processes contending for one claim produce one winner",
            async function () {
        let results = await Promise.all([
            contend("fbtest_cron_job", 60),
            contend("fbtest_cron_job", 60)
        ]);

        results.sort();
        assert.deepEqual(results, ["LOSE", "WIN"]);
    });

    it("an expired claim is anyone's again", async function () {
        let won = await contend("fbtest_short_claim", 1);

        assert.equal(won, "WIN");

        await new Promise((r) => setTimeout(r, 1500));

        let again = await contend("fbtest_short_claim", 60);

        assert.equal(again, "WIN", "the window passed, the claim is free");

        let meanwhile = await contend("fbtest_short_claim", 60);

        assert.equal(meanwhile, "LOSE", "and held again");
    });
});
