/*
    The instance trail on the Instances screen is the organization's.

    `systemAudit` read every instance.* and database.* row in the
    manager, so any organization administrator could read the names of
    other customers' instances, and the cluster's databases, from their
    own screen. An organization sees its own rows; a platform
    administrator, who answers for all of them, sees everything.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const PLATFORM = "fbt_scope_platform";
const ORG_ADMIN = "fbt_scope_orgadmin";
const OTHER_ORG = "FBScopeOther";
const MINE = "Scoped Mine (fbt_scope_mine)";
const THEIRS = "Scoped Theirs (fbt_scope_theirs)";
const CLUSTER = "fbt_scope_cluster from template x";

function mgr(fn) {
    return db.withClient(settings.managerDb, fn);
}

async function record(action, orgId, detail) {
    await mgr(async function (client) {
        await client.query(
            (
                "INSERT INTO admin_audit (" +
                "_pk,id,created,created_by,updated,updated_by,is_deleted," +
                "owner,etag,action,occurred," +
                "_on_behalf_of_organization_pk,detail) VALUES (" +
                "nextval('object__pk_seq'),$1,now(),'fbtest',now()," +
                "'fbtest',false,'fbtest',$1,$2,now()," +
                "(SELECT _pk FROM organization WHERE id = $3),$4)"
            ),
            [
                "fbts" + Date.now().toString(36) + (
                    Math.random().toString(36).slice(2, 8)
                ),
                action,
                orgId,
                detail
            ]
        );
    });
}

async function cleanUp() {
    await mgr(async function (client) {
        await client.query(
            "DELETE FROM admin_audit WHERE detail LIKE '%fbt_scope_%'"
        );
        await client.query(
            "DELETE FROM organization WHERE name = $1",
            [OTHER_ORG]
        );
    });
}

async function trail(who) {
    let session = new Session();
    let resp = await session.signIn(who, settings.password);

    assert.equal(resp.status, 200, JSON.stringify(resp.body));

    let overview = await session.get("/admin/instances");

    return overview.audit.map((row) => row.detail);
}

describe("the instance trail is scoped to the organization", function () {
    before(async function () {
        await cleanUp();
        await db.ensureIdentity(
            PLATFORM,
            settings.password,
            settings.testDb,
            {isOrgAdmin: true, isPlatformAdmin: true}
        );
        await db.ensureIdentity(
            ORG_ADMIN,
            settings.password,
            settings.testDb,
            {isOrgAdmin: true}
        );

        let other = await mgr(async function (client) {
            let made = await client.query(
                (
                    "INSERT INTO organization (_pk,id,created,created_by," +
                    "updated,updated_by,is_deleted,owner,etag,name," +
                    "is_active,authentication,is_two_factor_required) " +
                    "VALUES (nextval('object__pk_seq'),'fbtscopeorg1'," +
                    "now(),'fbtest',now(),'fbtest',false,'fbtest'," +
                    "'fbtscopeorg1',$1,true,'password',false) RETURNING id"
                ),
                [OTHER_ORG]
            );

            return made.rows[0].id;
        });

        await record("instance.registered", db.FIXTURE.organizationId, MINE);
        await record("instance.dropped", other, THEIRS);
        await record("database.created", undefined, CLUSTER);
    });

    after(async function () {
        await cleanUp();
        await mgr(async function (client) {
            await client.query(
                (
                    "DELETE FROM organization_admin WHERE " +
                    "_identity_identity_pk IN (SELECT _pk FROM identity " +
                    "WHERE username = ANY($1))"
                ),
                [[PLATFORM, ORG_ADMIN]]
            );
            await client.query(
                (
                    "DELETE FROM access_grant WHERE _identity_identity_pk " +
                    "IN (SELECT _pk FROM identity WHERE username = ANY($1))"
                ),
                [[PLATFORM, ORG_ADMIN]]
            );
            await client.query(
                "DELETE FROM identity WHERE username = ANY($1)",
                [[PLATFORM, ORG_ADMIN]]
            );
        });
    });

    it("shows an organization only its own rows", async function () {
        let details = await trail(ORG_ADMIN);

        assert.ok(details.includes(MINE), "their organization's own");
        assert.ok(
            !details.includes(THEIRS),
            "not another organization's instances"
        );
        assert.ok(
            !details.includes(CLUSTER),
            "nor the cluster's databases, which belong to nobody"
        );
    });

    it("shows a platform administrator everything", async function () {
        let details = await trail(PLATFORM);

        assert.ok(details.includes(MINE));
        assert.ok(details.includes(THEIRS), "every organization's");
        assert.ok(details.includes(CLUSTER), "and the cluster's");
    });
});
