/*
    A grant is the whole of the entry boundary, whoever owns the person.

    `provisionProfile` made the local profile only for an identity whose
    home organization owned the instance, so a person from outside --
    a reseller, platform staff, somebody left over from a move -- who
    held an active grant was let in by sign-in and then refused with
    "User account not found" on a first visit. The grant is the
    decision (platform.js `instancesFor` already lists such instances);
    the profile follows from it.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const GUEST = "fbt_xorg_guest";
const STRANGER = "fbt_xorg_stranger";
const DISABLED = "fbt_xorg_disabled";
const OTHER_ORG = "FBXorgOther";

function mgr(fn) {
    return db.withClient(settings.managerDb, fn);
}

function instance(fn) {
    return db.withClient(settings.testDb, fn);
}

async function profile(name) {
    return await instance(async function (client) {
        let resp = await client.query(
            (
                "SELECT u._pk, u.is_super, " +
                "  (SELECT count(*) FROM role_membership m " +
                "    WHERE m._parent_role_pk = u._pk " +
                "      AND m.role = 'everyone')::int AS everyone " +
                "FROM user_account u WHERE u.name = $1"
            ),
            [name]
        );

        return resp.rows[0];
    });
}

async function cleanUp() {
    let names = [GUEST, STRANGER, DISABLED];

    await instance(async function (client) {
        await client.query(
            (
                "DELETE FROM role_membership WHERE _parent_role_pk IN (" +
                "  SELECT _pk FROM user_account WHERE name = ANY($1))"
            ),
            [names]
        );
        await client.query(
            "DELETE FROM user_account WHERE name = ANY($1)",
            [names]
        );
    });
    await mgr(async function (client) {
        await client.query(
            (
                "DELETE FROM access_grant WHERE _identity_identity_pk IN (" +
                "  SELECT _pk FROM identity WHERE username = ANY($1))"
            ),
            [names]
        );
        await client.query(
            "DELETE FROM organization_admin WHERE _identity_identity_pk IN (" +
            "  SELECT _pk FROM identity WHERE username = ANY($1))",
            [names]
        );
        await client.query(
            "DELETE FROM identity WHERE username = ANY($1)",
            [names]
        );
        await client.query(
            "DELETE FROM organization WHERE name = $1",
            [OTHER_ORG]
        );
    });
}

async function signIn(name) {
    return await new Session().signIn(name, settings.password);
}

describe("a grant is enough to enter, from any organization", function () {
    before(async function () {
        await cleanUp();
        await mgr(async function (client) {
            await client.query(
                (
                    "INSERT INTO organization (_pk,id,created,created_by," +
                    "updated,updated_by,is_deleted,owner,etag,name," +
                    "is_active,authentication,is_two_factor_required) " +
                    "VALUES (nextval('object__pk_seq'),'fbtxorgorg1'," +
                    "now(),'fbtest',now(),'fbtest',false,'fbtest'," +
                    "'fbtxorgorg1',$1,true,'password',false)"
                ),
                [OTHER_ORG]
            );
        });

        // Home is the other organization; the instance is FBTest's
        await db.ensureIdentity(GUEST, settings.password, settings.testDb);
        await db.ensureIdentity(STRANGER, settings.password);
        await db.ensureIdentity(
            DISABLED,
            settings.password,
            settings.testDb
        );
        await mgr(async function (client) {
            await client.query(
                (
                    "UPDATE identity SET _organization_organization_pk = (" +
                    "  SELECT _pk FROM organization WHERE name = $1) " +
                    "WHERE username = ANY($2)"
                ),
                [OTHER_ORG, [GUEST, STRANGER, DISABLED]]
            );
            await client.query(
                "UPDATE identity SET status = 'disabled' WHERE username = $1",
                [DISABLED]
            );
        });
    });

    after(cleanUp);

    it("makes the profile for a person granted in", async function () {
        assert.equal(await profile(GUEST), undefined, "no profile yet");

        let resp = await signIn(GUEST);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let made = await profile(GUEST);

        assert.ok(made, "the profile is made on the first visit");
        assert.equal(made.everyone, 1, "in 'everyone' and nothing else");
        assert.equal(made.is_super, false, "with no authority of its own");
    });

    it("still refuses a person with no grant", async function () {
        let resp = await signIn(STRANGER);

        assert.notEqual(resp.status, 200);
        assert.equal(await profile(STRANGER), undefined, "and makes nothing");
    });

    it("still refuses a revoked grant", async function () {
        await mgr(async function (client) {
            await client.query(
                (
                    "UPDATE access_grant SET is_active = false " +
                    "WHERE _identity_identity_pk = (" +
                    "  SELECT _pk FROM identity WHERE username = $1)"
                ),
                [GUEST]
            );
        });
        await instance(async function (client) {
            await client.query(
                "DELETE FROM role_membership WHERE _parent_role_pk = (" +
                "  SELECT _pk FROM user_account WHERE name = $1)",
                [GUEST]
            );
            await client.query(
                "DELETE FROM user_account WHERE name = $1",
                [GUEST]
            );
        });

        let resp = await signIn(GUEST);

        assert.notEqual(resp.status, 200);
        assert.equal(await profile(GUEST), undefined);
    });

    it("still refuses a disabled identity", async function () {
        let resp = await signIn(DISABLED);

        assert.notEqual(resp.status, 200);
        assert.equal(await profile(DISABLED), undefined);
    });
});
