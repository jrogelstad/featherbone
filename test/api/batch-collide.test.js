/*
    A package's own data, where the database already holds the same
    record under another id.

    A batch record carries an id derived from the package's contents,
    so a database that acquired the same record some other way has it
    under a different one. The natural key then refuses the insert,
    and the install stops half applied -- which is what deploying the
    Job Shop help links into an instance that already had some did.

    The package wins. These claims are about that, and about the one
    thing it must not become: a way for a package to overwrite records
    by colliding with them on purpose is the same mechanism, so the
    write still goes through the ordinary request path and is still a
    deployment, audited and held like any other.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const VALUE = "FBT Collide";
const MINE = "fbtbatchexisting";
const THEIRS = "fbtbatchhelp1";

function helpLinks() {
    return db.withClient(settings.testDb, (client) => client.query(
        (
            "SELECT id, module, resource FROM help_link " +
            "WHERE display_value = $1 AND NOT is_deleted"
        ),
        [VALUE]
    ));
}

async function clear() {
    await db.withClient(settings.testDb, (client) => client.query(
        "DELETE FROM help_link WHERE display_value = $1 OR id = $2",
        [VALUE, THEIRS]
    ));
}

function flags(username, data) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE identity SET is_org_admin = $2, " +
            "  is_platform_admin = $3, updated = now(), " +
            "  updated_by = 'fbtest' " +
            "WHERE lower(username) = lower($1)"
        ),
        [
            username,
            data.isOrgAdmin === true,
            data.isPlatformAdmin === true
        ]
    ));
}

async function signedIn() {
    let session = new Session(ROOT);
    let resp = await session.signIn(
        settings.adminUser,
        settings.password,
        "FBTest"
    );

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

describe("a package's record meeting one already here", function () {
    let target;

    before(async function () {
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        await clear();

        /*
            The record as this database already holds it: the same
            natural key, a different id, and a resource that says it
            came from somewhere other than the package.
        */
        await db.withClient(settings.testDb, (client) => client.query(
            (
                "INSERT INTO help_link (_pk,id,created,created_by," +
                "updated,updated_by,is_deleted,owner,etag,module," +
                "icon,display_value,label,resource) VALUES (" +
                "nextval('object__pk_seq'),$1,now(),'fbtest',now()," +
                "'fbtest',false,'fbtest',$1,'somewhere-else'," +
                "'article',$2,$2,'/help/old.html#stale')"
            ),
            [MINE, VALUE]
        ));
    });

    after(async function () {
        await clear();
        await flags(settings.adminUser, {});
    });

    it("has the record under its own id to begin with",
            async function () {
        let resp = await helpLinks();

        assert.equal(resp.rows.length, 1);
        assert.equal(resp.rows[0].id, MINE);
        assert.match(resp.rows[0].resource, /stale/);
    });

    it("deploys rather than stopping on the natural key",
            async function () {
        let session = await signedIn();
        let overview = await session.get("/platform/overview");

        target = (overview.fleet || []).find(
            (one) => one.database === settings.testDb
        );
        assert.ok(target, "the instance is listed");

        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtbatch",
            version: "1.0.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    it("leaves one record, carrying what the package said",
            async function () {
        let resp = await helpLinks();

        assert.equal(
            resp.rows.length,
            1,
            "one record, not two under two ids"
        );
        assert.equal(
            resp.rows[0].id,
            MINE,
            "the record already here is the one written to"
        );
        assert.equal(resp.rows[0].module, "fbtbatch");
        assert.match(
            resp.rows[0].resource,
            /from-the-package/,
            "and it carries the package's values"
        );
    });

    it("leaves the instance open afterwards", async function () {
        let session = await signedIn();
        let overview = await session.get("/platform/overview");
        let now = (overview.fleet || []).find(
            (one) => one.id === target.id
        );

        assert.equal(now.isMaintenance, false, "not left held");
        assert.equal(now.isActive, true);
    });
});
