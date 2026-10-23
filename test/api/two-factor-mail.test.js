/*
    The second factor by email (tenant plan C.2): when the user's
    organization requires one, a correct password does not sign anyone
    in. A confirmation code is mailed to the address on their profile,
    and the sign-in completes only with that code.

    The mail goes out through the organization's SMTP account (Settings)
    since mail was routed through server/services/notify.js; a
    throwaway SMTP server stands in for the provider.
    (server.js doSignIn and sendMagicLink)
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const access = require("./lib/access");
const {claims, decoded, sink} = require("./lib/mailsink");

const NAME = "globalSettings";

describe("second factor by email", function () {
    let admin;
    let smtp;
    let before_;
    let wasRequired;

    function manager(sql, params) {
        return db.withClient(
            settings.managerDb,
            (client) => client.query(sql, params)
        );
    }

    async function require2fa(on) {
        await manager(
            (
                "UPDATE organization SET is_two_factor_required = $1 " +
                "WHERE _pk IN (SELECT _organization_organization_pk " +
                "  FROM tenant WHERE pg_database = $2)"
            ),
            [on, settings.testDb]
        );
    }

    before(async function () {
        admin = await signedIn();
        smtp = await sink();

        let resp = await manager(
            (
                "SELECT o.is_two_factor_required AS required " +
                "FROM organization o JOIN tenant t " +
                "  ON t._organization_organization_pk = o._pk " +
                "WHERE t.pg_database = $1"
            ),
            [settings.testDb]
        );

        wasRequired = resp.rows[0].required === true;
        before_ = await admin.get("/settings/" + NAME);

        let current = await admin.get("/settings/" + NAME);
        let saved = await admin.raw("PUT", "/settings/" + NAME, {
            data: Object.assign({}, current.data, {
                smtpHost: "127.0.0.1",
                smtpPassword: "secret",
                smtpPort: smtp.port,
                smtpSecure: false,
                smtpType: "SMTP",
                smtpUser: "noreply@example.com"
            }),
            etag: current.etag
        });

        assert.equal(saved.status, 200, JSON.stringify(saved.body));
        await require2fa(true);
    });

    after(async function () {
        await require2fa(wasRequired);
        await smtp.close();
        await manager(
            "DELETE FROM \"$organization_settings\" WHERE name = $1",
            [NAME]
        ).catch(() => undefined);

        let current = await admin.get("/settings/" + NAME);

        await admin.raw("PUT", "/settings/" + NAME, {
            data: before_.data,
            etag: current.etag
        });
        await access.dropAll();
    });

    it("mails a code, and signing in takes that code", async function () {
        let user = await access.createUser(admin, {});
        let person = new Session();
        let sent = smtp.mails.length;
        let resp = await person.signIn(user.name, user.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.success, true, "the envelope, not a session");
        assert.ok(resp.body.confirmUrl, "where the code is sent to");
        assert.ok(resp.body.email, "the address, masked");

        // Nobody is in yet
        let early = await person.raw("POST", "/data/contacts", {});

        assert.ok(
            early.status === 401 || early.status === 403 ||
            early.status === 302,
            "a password alone gets nowhere, got " + early.status
        );

        // The code arrives, through the organization's account
        // (the strategy does not wait for the mail, so neither can we)
        for (let i = 0; i < 50 && smtp.mails.length === sent; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.equal(smtp.mails.length, sent + 1, "a mail went out");

        let mail = smtp.mails[smtp.mails.length - 1];

        assert.match(mail.from, /noreply@example\.com/);
        assert.match(mail.to[0], new RegExp(user.email.replace(".", "\\.")));

        let text = decoded(mail.raw);

        assert.match(text, /Subject: Featherbone confirmation code/);

        let code = text.match(/<b>(\d{5})<\/b>/)[1];

        /*
            The link is the browser's to hold and the code is the
            mail's, so the code cannot be read out of the link: it
            carries a hash of it, and neither the password just
            typed nor the instance's credentials.
        */
        let said = claims(resp.body.confirmUrl);

        assert.equal(said.confirmCode, undefined, "no code in the link");
        assert.match(said.confirm, /^[0-9a-f]{64}$/);
        assert.equal(said.password, undefined);
        assert.equal(said.tenant, undefined);
        assert.equal(said.username, user.name);

        // A wrong code is refused
        let wrong = await person.raw(
            "GET",
            resp.body.confirmUrl + "&confirmCode=00000"
        );

        assert.ok(wrong.status >= 400, "wrong code: " + wrong.status);

        let still = await person.raw("POST", "/data/contacts", {});

        assert.ok(
            still.status === 401 || still.status === 403 ||
            still.status === 302,
            "a wrong code gets nowhere, got " + still.status
        );

        // The right one completes the sign-in
        let right = await person.raw(
            "GET",
            resp.body.confirmUrl + "&confirmCode=" + code
        );

        assert.ok(right.status < 400, String(right.status));

        let who = await person.raw("POST", "/connect");

        assert.equal(who.status, 200, JSON.stringify(who.body));
        assert.equal(who.body.data.authorized.name, user.name);

        let after = await person.raw("POST", "/data/contacts", {});

        assert.notEqual(after.status, 401, "the code signed them in");
        assert.notEqual(after.status, 403, "the code signed them in");
    });
});
