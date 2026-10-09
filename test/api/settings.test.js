/*
    Settings API: GET/PUT /settings/:name with etag, /settings-definition,
    encrypted settings properties (globalSettings.smtpPassword is
    isEncrypted: stored with pgp_sym_encrypt, returned decrypted), unknown
    names, and who may read or write settings.
    (server.js doGetSettingsRow/doSaveSettings/doGetSettingsDefinition,
    server/services/settings.js)

    globalSettings is restored in after(); settings rows created here are
    deleted.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const {matchGolden} = require("../harness/golden");
const access = require("./lib/access");

const SECRET = "Smtp-Secret-" + Date.now().toString(36);

async function row(name) {
    let resp = await db.query(
        "SELECT etag, data, definition FROM \"$settings\" WHERE name = $1",
        [name]
    );
    return resp.rows[0];
}

describe("settings", function () {
    let admin;
    let basicS;
    let originalSql;
    let originalApi;
    let createdNames = [];

    before(async function () {
        admin = await signedIn();
        let u = await access.createUser(admin);
        basicS = await signedIn(u.name, u.password);
        originalSql = await row("globalSettings");
        originalApi = await admin.get("/settings/globalSettings");

        let data = Object.assign({}, originalApi.data, {
            smtpUser: "fbt-smtp@example.com",
            smtpPassword: SECRET
        });
        await admin.call("PUT", "/settings/globalSettings", {
            etag: originalApi.etag,
            data
        });
    });

    after(async function () {
        try {
            let current = await admin.get("/settings/globalSettings");
            await admin.call("PUT", "/settings/globalSettings", {
                etag: current.etag,
                data: originalApi.data
            });
            // Put back the exact stored json (etag stays in step with the
            // server's cache)
            await db.query(
                "UPDATE \"$settings\" SET data = $1 WHERE name = $2",
                [
                    (
                        originalSql.data === null
                        ? null
                        : JSON.stringify(originalSql.data)
                    ),
                    "globalSettings"
                ]
            );
            if (createdNames.length) {
                await db.query(
                    "DELETE FROM \"$settings\" WHERE name = ANY($1)",
                    [createdNames]
                );
            }
        } finally {
            await access.dropAll();
        }
    });

    it("/settings-definition lists the settings definitions",
            async function () {
        let defs = await admin.get("/settings-definition");
        let summary = {};

        defs.forEach(function (def) {
            summary[def.name] = {
                module: def.module,
                properties: Object.keys(def.properties).sort(),
                encrypted: Object.keys(def.properties).filter(
                    (key) => def.properties[key].isEncrypted
                )
            };
        });

        assert.deepEqual(summary.globalSettings.encrypted, ["smtpPassword"]);
        assert.equal(
            defs.find((d) => d.name === "catalog"),
            undefined,
            "catalog has no definition"
        );
        matchGolden("settings-definitions", summary);
    });

    it("GET returns data and the stored etag", async function () {
        let resp = await admin.get("/settings/globalSettings");
        let stored = await row("globalSettings");

        assert.deepEqual(Object.keys(resp).sort(), ["data", "etag"]);
        assert.equal(resp.etag, stored.etag);
        assert.equal(resp.data.smtpUser, "fbt-smtp@example.com");
    });

    it("stores encrypted properties encrypted and returns them decrypted",
            async function () {
        let stored = await row("globalSettings");
        let cipher = stored.data.smtpPassword;

        assert.equal(typeof cipher, "string");
        assert.ok(!cipher.includes(SECRET), "plaintext stored");
        assert.match(cipher, /^\\x[0-9a-f]+$/);
        let plain = await db.query(
            "SELECT pgp_sym_decrypt($1::BYTEA, $2) AS value",
            [cipher, settings.config.pgCryptoKey]
        );
        assert.equal(plain.rows[0].value, SECRET);

        // Other properties are stored as sent
        assert.equal(stored.data.smtpUser, "fbt-smtp@example.com");

        let resp = await admin.get("/settings/globalSettings");
        assert.equal(resp.data.smtpPassword, SECRET);
    });

    it("PUT round trip changes data and etag", async function () {
        let before = await admin.get("/settings/globalSettings");
        let data = Object.assign({}, before.data, {smtpPort: 2525});
        let resp = await admin.call("PUT", "/settings/globalSettings", {
            etag: before.etag,
            data
        });

        assert.equal(resp, true);
        let after = await admin.get("/settings/globalSettings");
        assert.equal(after.data.smtpPort, 2525);
        assert.equal(after.data.smtpPassword, SECRET);
        assert.notEqual(after.etag, before.etag);
        assert.equal(after.etag, (await row("globalSettings")).etag);
    });

    it("rejects a PUT with a stale etag", async function () {
        let current = await admin.get("/settings/globalSettings");
        let resp = await admin.raw("PUT", "/settings/globalSettings", {
            etag: "fbt-stale-etag",
            data: current.data
        });

        assert.ok(resp.status >= 400, "status " + resp.status);
    });

    it("answers false for an unknown settings name", async function () {
        let resp = await admin.raw("GET", "/settings/fbtNoSuchSettings");

        assert.equal(resp.status, 200);
        assert.equal(resp.body, false);
    });

    it("PUT to a new name creates a settings row without definition",
            async function () {
        let name = "fbtSettings" + Date.now().toString(36);
        createdNames.push(name);
        let resp = await admin.call("PUT", "/settings/" + name, {
            data: {answer: 42}
        });

        assert.equal(resp, true);
        let stored = await row(name);
        assert.deepEqual(stored.data, {answer: 42});
        assert.equal(stored.definition, null);
        let got = await admin.get("/settings/" + name);
        assert.deepEqual(got, {etag: stored.etag, data: {answer: 42}});
    });

    it("requires a session", async function () {
        let anon = new Session();
        let resp = await anon.raw("GET", "/settings/globalSettings");
        assert.equal(resp.status, 401);
        resp = await anon.raw("PUT", "/settings/globalSettings", {data: {}});
        assert.equal(resp.status, 401);
        resp = await anon.raw("GET", "/settings-definition");
        assert.equal(resp.status, 401);
    });

    it("lets a non-super user read ordinary settings", async function () {
        let resp = await basicS.get("/settings/globalSettings");
        assert.equal(resp.data.smtpUser, "fbt-smtp@example.com");
    });

    it("does not give decrypted secrets to a non-super user",
            async function () {
        let resp = await basicS.get("/settings/globalSettings");
        assert.notEqual(resp.data.smtpPassword, SECRET);
    });

    it("does not let a non-super user write settings", async function () {
        let name = "fbtBasicWrote" + Date.now().toString(36);
        createdNames.push(name);
        let resp = await basicS.raw("PUT", "/settings/" + name, {
            data: {owned: true}
        });

        assert.ok(resp.status === 401 || resp.status === 403, "status " +
                resp.status);
        assert.equal(await row(name), undefined);
    });

    // A settings row inherits `object`, so "$auth" can grant `canUpdate`
    // on it the way it does on a workbook. That grant is what the
    // "Settings" box in a workbook's permissions sets.
    describe("a role the settings grant canUpdate", function () {
        async function grant(value) {
            if (value) {
                await db.query(
                    "INSERT INTO \"$auth\" (object_pk, role, can_read, " +
                    "  can_update) " +
                    "SELECT _pk, 'everyone', true, true " +
                    "FROM \"$settings\" WHERE name = 'globalSettings' " +
                    "ON CONFLICT (object_pk, role) DO UPDATE " +
                    "  SET can_read = true, can_update = true"
                );
                return;
            }
            await db.query(
                "DELETE FROM \"$auth\" WHERE role = 'everyone' " +
                "AND object_pk = (SELECT _pk FROM \"$settings\" " +
                "  WHERE name = 'globalSettings')"
            );
        }

        before(async function () {
            await grant(true);
        });

        after(async function () {
            await grant(false);
        });

        it("may write them", async function () {
            let before = await basicS.get("/settings/globalSettings");
            let data = Object.assign({}, before.data, {smtpPort: 2626});
            let resp = await basicS.call("PUT", "/settings/globalSettings", {
                etag: before.etag,
                data
            });

            assert.equal(resp, true);
            assert.equal(
                (await admin.get("/settings/globalSettings")).data.smtpPort,
                2626
            );
        });

        it("sees the decrypted secret", async function () {
            let resp = await basicS.get("/settings/globalSettings");
            assert.equal(resp.data.smtpPassword, SECRET);
        });

        it("is reported by /settings/is-authorized", async function () {
            assert.equal(
                await basicS.get("/settings/is-authorized/globalSettings"),
                true
            );
            await grant(false);
            try {
                assert.equal(
                    await basicS.get("/settings/is-authorized/globalSettings"),
                    false
                );
                assert.equal(
                    await admin.get("/settings/is-authorized/globalSettings"),
                    true
                );
            } finally {
                await grant(true);
            }
        });
    });
});
