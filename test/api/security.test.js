/*
    Security checks from the improvement plan and review: webhook
    signature (plan 1.2), secrets in SQL text (plan 1.8), session cookie
    flags, unauthenticated access to internal routes, exposure of secrets
    and sessions to ordinary users, and what failed sign-ins disclose.
    Correct behavior is asserted; known defects are marked todo.
    (server.js doNotice/doSignIn/doGetSessions/doDisconnectSession and the
    "Block unauthorized requests" middleware, crud.js encrypted columns)
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const access = require("./lib/access");

const MARK = "fbt-" + Date.now().toString(36);

// Session id as stored in "$session" (cookie is s:<sid>.<signature>)
function sessionId(session) {
    let value = decodeURIComponent(session.cookie.split("=")[1]);
    return value.slice(2, value.lastIndexOf("."));
}

describe("security", function () {
    let admin;
    let user;
    let userS;

    before(async function () {
        admin = await signedIn();
        user = await access.createUser(admin);
        userS = await signedIn(user.name, user.password);
    });

    after(async function () {
        try {
            await db.query(
                "DELETE FROM notice WHERE payload->>'marker' = $1",
                [MARK]
            );
        } finally {
            await access.dropAll();
        }
    });

    describe("webhook /notice (plan 1.2)", function () {
        let hasNotice;

        async function notices() {
            if (!hasNotice) {
                return 0;
            }
            let resp = await db.query(
                "SELECT count(*)::int AS n FROM notice " +
                "WHERE payload->>'marker' = $1",
                [MARK]
            );
            return resp.rows[0].n;
        }

        before(async function () {
            let resp = await admin.raw("GET", "/feather/notice");
            hasNotice = Boolean(
                resp.status === 200 && resp.body && resp.body.name
            );
        });

        it("rejects a notice without a signature", async function () {
            let start = await notices();
            let resp = await new Session().raw("POST", "/notice", {
                marker: MARK,
                event: "unsigned"
            });

            assert.ok(resp.status === 401 || resp.status === 403, "status " +
                    resp.status);
            assert.equal(await notices(), start);
        });

        it("rejects a notice with an invalid signature", async function () {
            let start = await notices();
            let resp = await new Session().raw("POST", "/notice", {
                marker: MARK,
                event: "bad-signature"
            }, {
                "X-Hub-Signature": "sha256=not-a-valid-signature",
                "X-Signature": "not-a-valid-signature"
            });

            assert.ok(resp.status === 401 || resp.status === 403, "status " +
                    resp.status);
            assert.equal(await notices(), start);
        });
    });

    // Plan 1.8: crud.js interpolates the pgcrypto key into SQL text for
    // encrypted columns, where pg_stat_activity (and statement logging)
    // can see it. TenantService.pgPassword is the core encrypted column.
    it("keeps the crypto key out of SQL text (plan 1.8)", {
        todo: "plan 1.8: crud.js puts the pgcrypto key in SQL text"
    }, async function (t) {
        let key = settings.config.pgCryptoKey;
        let svc = await admin.create("TenantService", {
            name: MARK,
            pgHost: "127.0.0.1",
            pgPort: "5432",
            pgUser: "nobody",
            pgPassword: "Tenant-Secret-" + MARK
        });
        let texts = [];

        try {
            // Idle backends keep their last statement in pg_stat_activity
            let seen = await access.poll(async function () {
                await admin.read("TenantService", svc.id);
                let resp = await db.query(
                    "SELECT query FROM pg_stat_activity " +
                    "WHERE datname = $1 AND pid <> pg_backend_pid() " +
                    "  AND query LIKE '%pgp_sym_%'",
                    [settings.testDb]
                );
                texts = texts.concat(resp.rows.map((r) => r.query));
                return resp.rows.length > 0;
            }, 3000, 50);

            if (!seen) {
                t.skip("encrypted column queries not observable in " +
                        "pg_stat_activity");
                return;
            }
            assert.ok(
                !texts.some((q) => q.includes(key)),
                "crypto key found in: " + texts.find((q) => q.includes(key))
            );
        } finally {
            await admin.remove("TenantService", svc.id);
        }
    });

    it("does not show decrypted tenant service passwords to ordinary users", {
        todo: (
            "defect: TenantService grants everyone read and returns " +
            "pgPassword decrypted"
        )
    }, async function () {
        let secret = "Tenant-Secret-" + MARK;
        let svc = await admin.create("TenantService", {
            name: MARK + "-2",
            pgHost: "127.0.0.1",
            pgPort: "5432",
            pgUser: "nobody",
            pgPassword: secret
        });

        try {
            let rows = await userS.list("TenantServices", {});
            assert.ok(
                !JSON.stringify(rows).includes(secret),
                "ordinary user can read the tenant service password"
            );
        } finally {
            await admin.remove("TenantService", svc.id);
        }
    });

    describe("session cookie", function () {
        let cookie;

        before(async function () {
            let resp = await new Session().signIn(user.name, user.password);
            cookie = resp.headers.get("set-cookie") || "";
        });

        it("is HttpOnly and scoped to /", function () {
            assert.match(cookie, /^connect\.sid=/);
            assert.match(cookie, /;\s*HttpOnly/i);
            assert.match(cookie, /;\s*Path=\//i);
            assert.match(cookie, /;\s*Expires=/i);
        });

        it("sets SameSite", {
            todo: "defect: no SameSite attribute (urlencoded POSTs are " +
                    "accepted, so cross-site forms can ride the session)"
        }, function () {
            assert.match(cookie, /;\s*SameSite=(Lax|Strict)/i);
        });
    });

    describe("unauthenticated requests", function () {
        const blocked = [
            ["POST", "/data/contacts", {}],
            ["POST", "/data/contact", {}],
            ["GET", "/data/contact/fbt-none"],
            ["PATCH", "/data/contact/fbt-none", []],
            ["DELETE", "/data/contact/fbt-none"],
            ["POST", "/data/user-accounts", {}],
            ["POST", "/data/user-account", {}],
            ["PATCH", "/data/user-account/fbt-none", []],
            ["GET", "/feather/contact"],
            ["GET", "/profile"],
            ["GET", "/settings/globalSettings"],
            ["GET", "/settings-definition"],
            ["GET", "/workbooks"],
            ["GET", "/do/is-authorized?feather=Contact&action=canRead"],
            ["POST", "/do/save-authorization", {}],
            ["POST", "/do/change-password/", {}],
            ["POST", "/do/change-role-password/", {password: "x"}],
            ["POST", "/do/disconnect/fbt-none"]
        ];

        it("are refused with 401 on internal routes", async function () {
            let result = {};
            let i = 0;

            while (i < blocked.length) {
                let resp = await new Session().raw(
                    blocked[i][0],
                    blocked[i][1],
                    blocked[i][2]
                );
                result[blocked[i][0] + " " + blocked[i][1]] = [
                    resp.status,
                    resp.body
                ];
                i += 1;
            }

            let expected = {};
            blocked.forEach(function (b) {
                expected[b[0] + " " + b[1]] = [401, "Unauthorized session"];
            });
            assert.deepEqual(result, expected);
        });

        it("cannot list sessions", async function () {
            let resp = await new Session().raw("GET", "/sessions");
            assert.equal(resp.status, 401);
        });

        it("get 401 from /currency/base", async function () {
            let resp = await new Session().raw("GET", "/currency/base");
            assert.equal(resp.status, 401);
        });
    });

    it("does not let an ordinary user end another user's session", async function () {
        let victim = await signedIn();
        let resp = await userS.raw(
            "POST",
            "/do/disconnect/" + sessionId(victim)
        );

        assert.ok(resp.status === 401 || resp.status === 403, "status " +
                resp.status);
        resp = await victim.raw("POST", "/data/contacts", {filter: {limit: 1}});
        assert.equal(resp.status, 200);
    });

    describe("failed sign-in", function () {
        let wrong;
        let unknown;

        before(async function () {
            wrong = await new Session().signIn(user.name, "wrong-password");
            unknown = await new Session().signIn("fbt_nobody_" + MARK, "x");
            await db.query(
                "UPDATE user_account SET sign_in_attempts = 0 WHERE name = $1",
                [user.name]
            );
        });

        it("answers 401", function () {
            assert.equal(wrong.status, 401);
            assert.equal(unknown.status, 401);
        });

        it("does not return the raw Postgres error", function () {
            assert.doesNotMatch(
                String(wrong.body),
                /password authentication failed/
            );
        });

        it("does not reveal whether the user or database exists", function () {
            assert.doesNotMatch(String(unknown.body), new RegExp(
                settings.testDb
            ));
            assert.equal(String(unknown.body), String(wrong.body));
        });
    });
});
