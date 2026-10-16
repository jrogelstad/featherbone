/*
    Passkeys on the identity (tenant plan C.1/E.2) and the
    organization's two-factor policy (C.2).

    A passkey belongs to the identity in the manager, so one credential
    follows its owner to every database the identity can reach and no
    further: the lookup joins the access grant. Ceremony challenges live
    in the manager too, one use each with an expiry, so a ceremony begun
    on one node can finish on another and a replay finds nothing.

    A real authenticator cannot run here, so the ceremonies are proven
    to the edge of the signature check: options issued, challenges
    stored and consumed, the grant boundary enforced, and a failed
    assertion burning its challenge.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const FAKE_CRED = "fbtest-fake-credential-id";

async function identityPk(username) {
    let resp = await db.withClient(
        settings.managerDb,
        (client) => client.query(
            (
                "SELECT i._pk, i.id FROM identity i " +
                "JOIN organization o " +
                "  ON i._organization_organization_pk = o._pk " +
                "WHERE o.name = 'FBTest' AND i.username = $1"
            ),
            [username]
        )
    );

    return resp.rows[0];
}

async function challengeRow(identityPk_, kind) {
    let resp = await db.withClient(
        settings.managerDb,
        (client) => client.query(
            (
                "SELECT challenge, expires " +
                "FROM \"$identity_challenge\" " +
                "WHERE identity_pk = $1 AND kind = $2"
            ),
            [identityPk_, kind]
        )
    );

    return resp.rows[0];
}

async function cleanup() {
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            "DELETE FROM \"$identity_credential\" WHERE credential_id = $1",
            [FAKE_CRED]
        ).catch(function () {
            return;
        });
        await client.query(
            "UPDATE organization SET is_two_factor_required = false " +
            "WHERE name = 'FBTest'"
        );
    });
}

describe("passkeys on the identity (C.1)", function () {
    let session;
    let me;

    before(async function () {
        await cleanup();
        session = new Session();
        let resp = await session.signIn(
            settings.basicUser,
            settings.password
        );
        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        me = await identityPk(settings.basicUser);
        assert.ok(me, "the identity exists");
    });

    after(cleanup);

    it("registration options carry the identity and store the challenge",
            async function () {
        let resp = await session.raw("GET", "/webauthn/reg");

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.user.id, me.id, "the manager identity");
        assert.ok(resp.body.challenge, "a challenge is issued");

        let stored = await challengeRow(me._pk, "reg");
        assert.ok(stored, "and stored in the manager, not in memory");
        assert.equal(stored.challenge, resp.body.challenge);
        assert.ok(
            new Date(stored.expires) > new Date(),
            "with time still on it"
        );
    });

    it("asks for registration when the identity has no passkey",
            async function () {
        let resp = await session.raw("GET", "/webauthn/auth");

        assert.equal(resp.status, 200);
        assert.equal(resp.body.registrationRequired, true);
    });

    it("offers the identity's credentials once it has one",
            async function () {
        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "INSERT INTO \"$identity_credential\" (" +
                "  credential_id, identity_pk, public_key, counter" +
                ") VALUES ($1, $2, 'fake-pem', 7)"
            ),
            [FAKE_CRED, me._pk]
        ));

        let resp = await session.raw("GET", "/webauthn/auth");

        assert.equal(resp.status, 200);
        assert.ok(Array.isArray(resp.body.allowCredentials));
        assert.ok(
            resp.body.allowCredentials.some(
                (row) => row.id === FAKE_CRED
            ),
            "the credential is offered"
        );

        let stored = await challengeRow(me._pk, "auth");
        assert.ok(stored, "the assertion challenge is in the manager");
    });

    it("a failed assertion burns its challenge", async function () {
        let resp = await session.raw("POST", "/webauthn/auth", {
            rawId: FAKE_CRED,
            response: {
                authenticatorData: "AAAA",
                clientDataJSON: "AAAA",
                signature: "AAAA"
            }
        });

        assert.equal(resp.status, 200);
        assert.equal(resp.body.authenticated, false);
        assert.equal(resp.body.error, true);

        let gone = await challengeRow(me._pk, "auth");
        assert.equal(gone, undefined, "consumed, success or not");

        let again = await session.raw("POST", "/webauthn/auth", {
            rawId: FAKE_CRED,
            response: {
                authenticatorData: "AAAA",
                clientDataJSON: "AAAA",
                signature: "AAAA"
            }
        });

        assert.equal(again.body.authenticated, false);
        assert.match(
            String(again.body.message || "x"),
            /challenge|missing/i,
            "a replay finds no challenge"
        );
    });

    it("a credential without a grant on this instance is a stranger",
            async function () {
        /*
            Reassign the fake credential to an identity with no grant
            here: fbt_nogrant is seeded by identity.test.js, so make
            one of our own.
        */
        await db.ensureIdentity(
            "fbt_cred_nogrant",
            settings.password,
            settings.testDb2
        );

        let other = await identityPk("fbt_cred_nogrant");

        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "UPDATE \"$identity_credential\" SET identity_pk = $2 " +
                "WHERE credential_id = $1"
            ),
            [FAKE_CRED, other._pk]
        ));

        // Issue a fresh challenge for the signed-in user
        await session.raw("GET", "/webauthn/auth");

        let resp = await session.raw("POST", "/webauthn/auth", {
            rawId: FAKE_CRED,
            response: {
                authenticatorData: "AAAA",
                clientDataJSON: "AAAA",
                signature: "AAAA"
            }
        });

        assert.equal(resp.body.authenticated, false);
        assert.equal(resp.body.error, true);
        assert.match(
            String(resp.body.message),
            /missing/i,
            "not theirs, not here"
        );
    });
});

describe("the organization decides the second factor (C.2)", function () {
    after(cleanup);

    it("sign-in answers the user when no policy demands more",
            async function () {
        let s = new Session();
        let resp = await s.signIn(settings.basicUser, settings.password);

        assert.equal(resp.status, 200);
        assert.equal(resp.body.name, settings.basicUser);
        await s.signOut();
    });

    it("sign-in asks for the second factor when the organization does",
            async function () {
        await db.withClient(settings.managerDb, (client) => client.query(
            "UPDATE organization SET is_two_factor_required = true " +
            "WHERE name = 'FBTest'"
        ));

        let s = new Session();
        let resp = await s.signIn(settings.basicUser, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(
            resp.body.success,
            true,
            "the two-factor envelope, not the user: " +
            JSON.stringify(resp.body)
        );
        assert.equal(resp.body.name, undefined);

        // And back off again
        await db.withClient(settings.managerDb, (client) => client.query(
            "UPDATE organization SET is_two_factor_required = false " +
            "WHERE name = 'FBTest'"
        ));

        let plain = await new Session().signIn(
            settings.basicUser,
            settings.password
        );
        assert.equal(plain.body.name, settings.basicUser);
    });
});
