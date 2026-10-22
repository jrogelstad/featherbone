/*
    Signing in as somebody an identity provider vouches for (ADR-001
    C.3 and C.4).

    The half that talks to the provider cannot be run here: there is no
    Microsoft Entra ID in the room, and standing one up to test against
    would be testing `openid-client` rather than Featherbone. So the
    code is split at the seam -- `server/services/oidc.js` does the
    redirect, the code exchange and the token checks, and hands
    `{subject, claims}` to `server/services/federation.js`, which
    decides who that is.

    This file drives the deciding half directly against the manager,
    which is where every claim worth making lives: a subject is an
    identity, a subject that is not yet one may be made into one if the
    provider is allowed to, the person who was here before single
    sign-on is linked rather than duplicated, group claims are applied
    on every sign-in and not just the first, and an organization that
    has moved to single sign-on cannot be signed in to with a password.

    What is NOT covered, and is to be proven against a real directory:
    discovery, PKCE, the state and nonce round trip, id-token signature,
    issuer and audience checks, and the userinfo fallback.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Federation} = require("../../server/services/federation");
const {Platform} = require("../../server/services/platform");

const federation = new Federation();
const platform = new Platform();
const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const ORG = "FBFederated";
const ISSUER = "https://login.microsoftonline.com/fbtest-directory/v2.0";
const SUBJECT = "fbtest-subject-0001";
const LOCAL_USER = "fbt_was_here_first";
// A registry row of its own: the organization's instance
const FED_DB = "fbtest_federated";

/*
    The harness's manager, not the installation's: this file runs in
    its own process, and the services' own `run` would open the
    manager named in config.json rather than the throwaway copy the
    suite built.
*/
function manager(fn) {
    return db.withClient(settings.managerDb, fn);
}

async function organizationPk(client) {
    let resp = await client.query(
        "SELECT _pk FROM organization WHERE name = $1",
        [ORG]
    );

    return resp.rows[0]._pk;
}

// The provider as federation reads it, with the secret already out
function providerRow(client) {
    return organizationPk(client).then(
        (pk) => federation.providerFor(client, pk)
    );
}

async function seed() {
    await manager(async function (client) {
        await client.query(
            (
                "INSERT INTO organization (_pk,id,created,created_by," +
                "updated,updated_by,is_deleted,owner,etag,name," +
                "is_active,authentication,is_two_factor_required) " +
                "SELECT nextval('object__pk_seq'),'fbtfed000001',now()," +
                "'fbtest',now(),'fbtest',false,'fbtest','fbtfed000001'," +
                "$1,true,'both',false " +
                "WHERE NOT EXISTS (" +
                "  SELECT 1 FROM organization WHERE name = $1)"
            ),
            [ORG]
        );

        let pk = await organizationPk(client);

        /*
            An instance of its own, so the grants a made identity gets
            are its organization's. Only the registry row is needed:
            a grant is a row, and nothing here opens the database.
        */
        await client.query(
            (
                "INSERT INTO tenant (_pk,id,created,created_by,updated," +
                "updated_by,is_deleted,owner,etag,name,pg_database," +
                "is_active,is_demo,_organization_organization_pk) " +
                "SELECT nextval('object__pk_seq'),'fbtfedten001',now()," +
                "'fbtest',now(),'fbtest',false,'fbtest','fbtfedten001'," +
                "'Federated',$2,true,false,$1 " +
                "WHERE NOT EXISTS (" +
                "  SELECT 1 FROM tenant WHERE pg_database = $2)"
            ),
            [pk, FED_DB]
        );
        await client.query(
            "DELETE FROM identity_provider " +
            "WHERE _organization_organization_pk = $1",
            [pk]
        );
        await platform.saveProvider(client, {
            adminGroup: "fbtest-admins",
            by: "fbtest",
            clientId: "fbtest-client",
            clientSecret: "fbtest-secret",
            defaultInstances: [FED_DB],
            isJustInTime: false,
            issuer: ISSUER,
            kind: "azure-ad",
            name: "Microsoft",
            organization: (
                await client.query(
                    "SELECT id FROM organization WHERE _pk = $1",
                    [pk]
                )
            ).rows[0].id
        });
    });
}

async function unseed() {
    await manager(async function (client) {
        let resp = await client.query(
            "SELECT _pk FROM organization WHERE name = $1",
            [ORG]
        );

        if (!resp.rows.length) {
            return;
        }

        let pk = resp.rows[0]._pk;

        await client.query(
            (
                "DELETE FROM identity_federation " +
                "WHERE _identity_identity_pk IN (" +
                "  SELECT _pk FROM identity " +
                "  WHERE _organization_organization_pk = $1)"
            ),
            [pk]
        );
        await client.query(
            (
                "DELETE FROM access_grant WHERE _identity_identity_pk IN (" +
                "  SELECT _pk FROM identity " +
                "  WHERE _organization_organization_pk = $1)"
            ),
            [pk]
        );
        await client.query(
            "DELETE FROM identity WHERE _organization_organization_pk = $1",
            [pk]
        );
        await client.query(
            "DELETE FROM tenant WHERE pg_database = $1",
            [FED_DB]
        );
        await client.query(
            "DELETE FROM identity_provider " +
            "WHERE _organization_organization_pk = $1",
            [pk]
        );
        await client.query("DELETE FROM organization WHERE _pk = $1", [pk]);
    });
}

function justInTime(value) {
    return manager(async function (client) {
        await client.query(
            (
                "UPDATE identity_provider SET is_just_in_time = $2 " +
                "WHERE _organization_organization_pk = $1"
            ),
            [await organizationPk(client), value]
        );
    });
}

function policy(value) {
    return manager(async function (client) {
        await client.query(
            "UPDATE organization SET authentication = $2 WHERE _pk = $1",
            [await organizationPk(client), value]
        );
    });
}

// What the provider would have told us
function claims(extra) {
    return Object.assign({
        email: "ada@fbtest.example",
        name: "Ada Lovelace",
        preferred_username: "ada@fbtest.example",
        sub: SUBJECT
    }, extra);
}

function resolve(extra, subject) {
    return manager(async function (client) {
        return await federation.resolve(client, {
            claims: claims(extra),
            organizationPk: await organizationPk(client),
            provider: await providerRow(client),
            subject: subject || SUBJECT
        });
    });
}

describe("signing in through an identity provider (C.3, C.4)",
        function () {
    before(async function () {
        await unseed();
        await seed();
    });

    after(unseed);

    it("keeps the client secret encrypted and reads it back",
            async function () {
        let provider = await manager(providerRow);

        assert.equal(provider.clientSecret, "fbtest-secret");

        let stored = await manager((client) => client.query(
            "SELECT client_secret FROM identity_provider " +
            "WHERE issuer = $1",
            [ISSUER]
        ));

        assert.notEqual(
            stored.rows[0].client_secret,
            "fbtest-secret",
            "what is at rest is not the secret"
        );
    });

    it("never hands the secret to a screen", async function () {
        let listed = await manager((client) => platform.providers(client));
        let mine = listed.find((one) => one.issuer === ISSUER);

        assert.ok(mine, "the provider is listed");
        assert.equal(mine.hasSecret, true, "and says it has one");
        assert.equal(
            JSON.stringify(mine).includes("fbtest-secret"),
            false,
            "without saying what it is"
        );
    });

    it("refuses an unknown subject when it may not make accounts",
            async function () {
        await assert.rejects(resolve(), /does not make them/);
    });

    it("makes one when it may, granted what the provider says",
            async function () {
        await justInTime(true);

        let who = await resolve();

        assert.equal(who.created, true);
        assert.equal(who.identity.username, "ada@fbtest.example");

        let grants = await manager((client) => client.query(
            (
                "SELECT t.pg_database FROM access_grant g " +
                "JOIN tenant t ON t._pk = g._tenant_tenant_pk " +
                "WHERE g._identity_identity_pk = $1 AND g.is_active"
            ),
            [who.identity._pk]
        ));

        assert.deepEqual(
            grants.rows.map((row) => row.pg_database),
            [FED_DB],
            "the instances the provider names, and no others"
        );

        let audited = await manager((client) => client.query(
            (
                "SELECT 1 FROM admin_audit " +
                "WHERE action = 'identity.provisioned' " +
                "  AND detail LIKE '%first sign-in through%'"
            )
        ));

        assert.equal(audited.rows.length, 1, "and it is audited");
    });

    it("knows the same subject the second time", async function () {
        let who = await resolve();

        assert.equal(who.created, false);
        assert.equal(who.linked, false);
        assert.equal(who.identity.username, "ada@fbtest.example");

        let links = await manager((client) => client.query(
            "SELECT 1 FROM identity_federation WHERE subject = $1",
            [SUBJECT]
        ));

        assert.equal(links.rows.length, 1, "and did not link it twice");
    });

    it("follows the subject, not the user name", async function () {
        /*
            The provider renames somebody -- a marriage, a domain move.
            The subject is the same person, so the identity is the same
            one, and the old user name stays.
        */
        let who = await resolve({preferred_username: "ada@newname.example"});

        assert.equal(who.created, false);
        assert.equal(who.identity.username, "ada@fbtest.example");
    });

    it("links somebody who was here before single sign-on",
            async function () {
        await manager(async function (client) {
            await client.query(
                (
                    "INSERT INTO identity (_pk,id,created,created_by," +
                    "updated,updated_by,is_deleted,owner,etag," +
                    "_organization_organization_pk,username,full_name," +
                    "email,password_hash,status,is_platform_admin," +
                    "is_org_admin,failed_attempts) VALUES (" +
                    "nextval('object__pk_seq'),'fbtfed000009',now()," +
                    "'fbtest',now(),'fbtest',false,'fbtest'," +
                    "'fbtfed000009',$1,$2,$2,'','','active',false," +
                    "false,0)"
                ),
                [await organizationPk(client), LOCAL_USER]
            );
        });

        let who = await resolve(
            {preferred_username: LOCAL_USER},
            "fbtest-subject-0002"
        );

        assert.equal(who.linked, true, "linked, not duplicated");
        assert.equal(who.created, false);
        assert.equal(who.identity.username, LOCAL_USER);

        let rows = await manager(async function (client) {
            return await client.query(
                (
                    "SELECT count(*)::int AS n FROM identity " +
                    "WHERE username = $1 " +
                    "  AND _organization_organization_pk = $2"
                ),
                [LOCAL_USER, await organizationPk(client)]
            );
        });

        assert.equal(rows.rows[0].n, 1, "and there is still one of them");
    });

    it("applies a group claim every time, not just the first",
            async function () {
        let promoted = await resolve({groups: ["fbtest-admins"]});

        assert.equal(
            promoted.identity.username,
            "ada@fbtest.example",
            "the same person"
        );

        /*
            Administering an organization is an appointment over that
            organization now, so the claim writes one -- and over this
            provider's organization alone, an administrator elsewhere
            being somebody else's appointment.
        */
        function appointments() {
            return manager((client) => client.query(
                (
                    "SELECT count(*)::int AS n FROM organization_admin " +
                    "WHERE _identity_identity_pk = $1 " +
                    "  AND is_active AND NOT is_deleted"
                ),
                [promoted.identity._pk]
            ));
        }

        let after = await appointments();

        assert.equal(after.rows[0].n, 1, "promoted");

        await resolve({groups: ["something-else"]});

        let back = await appointments();

        assert.equal(
            back.rows[0].n,
            0,
            "and demoted when the claim goes"
        );
    });

    it("never makes anyone a platform administrator from a claim",
            async function () {
        await resolve({groups: ["fbtest-admins"]});

        let row = await manager((client) => client.query(
            (
                "SELECT is_platform_admin FROM identity " +
                "WHERE username = $1"
            ),
            ["ada@fbtest.example"]
        ));

        assert.equal(
            row.rows[0].is_platform_admin,
            false,
            "a provider speaks for one organization, and that flag " +
            "crosses all of them"
        );
    });

    it("refuses a suspended identity whatever the provider says",
            async function () {
        await manager((client) => client.query(
            "UPDATE identity SET status = 'disabled' WHERE username = $1",
            ["ada@fbtest.example"]
        ));

        await assert.rejects(resolve(), /No active user account/);

        await manager((client) => client.query(
            "UPDATE identity SET status = 'active' WHERE username = $1",
            ["ada@fbtest.example"]
        ));
    });

    it("refuses a subject that belongs to another organization",
            async function () {
        await manager(async function (client) {
            let other = await client.query(
                "SELECT _pk FROM organization WHERE name = 'FBTest'"
            );

            await assert.rejects(
                federation.resolve(client, {
                    claims: claims(),
                    organizationPk: other.rows[0]._pk,
                    provider: await providerRow(client),
                    subject: SUBJECT
                }),
                /another organization/
            );
        });
    });

    describe("and the policy that goes with it", function () {
        after(() => policy("both"));

        it("lets a password through while the policy is both",
                async function () {
            await policy("both");
            await manager(async function (client) {
                assert.equal(
                    await federation.passwordRefusal(
                        client,
                        await organizationPk(client)
                    ),
                    undefined
                );
            });
        });

        it("refuses one when the organization has moved to single " +
                "sign-on", async function () {
            await policy("sso");

            let refusal = await manager(async function (client) {
                return await federation.passwordRefusal(
                    client,
                    await organizationPk(client)
                );
            });

            assert.match(refusal, /single sign-on/);
        assert.match(refusal, /Microsoft/, "and names the provider");
        });

        it("and the picker refuses it too, without checking the password",
                async function () {
            await policy("sso");
            await db.ensureIdentity(
                "fbt_sso_only",
                settings.password
            );
            await manager(async function (client) {
                await client.query(
                    (
                        "UPDATE identity SET " +
                        "  _organization_organization_pk = $1 " +
                        "WHERE username = $2"
                    ),
                    [await organizationPk(client), "fbt_sso_only"]
                );
            });

            let resp = await new Session(ROOT).signIn(
                "fbt_sso_only",
                settings.password,
                ORG
            );

            assert.equal(resp.status, 401, JSON.stringify(resp.body));
            assert.match(
                JSON.stringify(resp.body),
                /single sign-on/,
                "and says what to do rather than 'wrong password'"
            );

            let attempts = await manager((client) => client.query(
                (
                    "SELECT failed_attempts FROM identity " +
                    "WHERE username = $1"
                ),
                ["fbt_sso_only"]
            ));

            assert.equal(
                attempts.rows[0].failed_attempts,
                0,
                "and counts no failure against them"
            );
        });
    });
});
