/*
    The instance picker, at a URL with no database (tenant plan G.1).

    Sign-in here is against the manager alone: it proves the identity,
    and the instances it may reach come from its grants. Choosing one
    is what proves access to that instance, so the grant is read again
    at the door -- one sign-in now reaches several instances, which it
    never did when a session belonged to one instance from the start.

    The claims:

    * the picker answers at the root, signed in or not;
    * a user name that exists in more than one organization is asked
      which, and the organizations are never listed to someone who has
      not signed in;
    * the list is the grants and nothing else;
    * an identity session enters an instance it is granted and is
      refused one it is not, without losing the session;
    * a grant revoked after sign-in closes the door at the next entry.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Identities} = require("../../server/services/identities");

const identities = new Identities();
const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const TWIN_ORG = "FBPickerTwin";
const TWIN_PW = "Fbtest-Twin-Org-3!";
/*
    This file's own identities. The grants are the subject, and the
    harness users carry whatever grants the other api files gave them,
    so these two are made here: SOLO is granted the first instance and
    nothing else, and TWIN exists in two organizations.
*/
const SOLO = "fbt_picker_solo";
const TWIN = "fbt_picker_twin";

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

/*
    A second organization carrying the same user name as the harness's
    administrator, so "which organization is yours" has something to
    be ambiguous about. Made here rather than assumed: the api files
    run one at a time, each in its own process.
*/
async function seedTwin() {
    await db.withClient(settings.managerDb, async function (client) {
        let org = await client.query(
            "SELECT _pk FROM organization WHERE name = $1",
            [TWIN_ORG]
        );
        let orgPk;

        if (org.rows.length) {
            orgPk = org.rows[0]._pk;
        } else {
            let made = await client.query((
                "INSERT INTO organization (" + DOC_COLS + ",name," +
                "is_active,authentication,is_two_factor_required) " +
                "VALUES (" + docVals("fbtpick00001") +
                ",$1,true,'password',false) RETURNING _pk"
            ), [TWIN_ORG]);

            orgPk = made.rows[0]._pk;
        }

        let found = await client.query(
            (
                "SELECT _pk FROM identity WHERE username = $1 " +
                "  AND _organization_organization_pk = $2"
            ),
            [TWIN, orgPk]
        );

        if (!found.rows.length) {
            await client.query((
                "INSERT INTO identity (" + DOC_COLS +
                ",_organization_organization_pk,username,full_name," +
                "email,password_hash,status,is_platform_admin," +
                "is_org_admin,failed_attempts) VALUES (" +
                docVals("fbtpick00002") +
                ",$1,$2,$2,'',$3,'active',false,false,0)"
            ), [
                orgPk,
                TWIN,
                identities.hashPassword(TWIN_PW)
            ]);
        }
    });
}

async function unseedTwin() {
    await db.withClient(settings.managerDb, async function (client) {
        await client.query(
            (
                "DELETE FROM identity WHERE " +
                "_organization_organization_pk = (SELECT _pk FROM " +
                "  organization WHERE name = $1)"
            ),
            [TWIN_ORG]
        );
        await client.query(
            "DELETE FROM organization WHERE name = $1",
            [TWIN_ORG]
        );
    });
}

function grantState(username, database, isActive) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE access_grant SET is_active = $3, " +
            "  updated = now(), updated_by = 'fbtest' " +
            "WHERE _identity_identity_pk = (" +
            "    SELECT i._pk FROM identity i JOIN organization o " +
            "      ON o._pk = i._organization_organization_pk " +
            "    WHERE lower(i.username) = lower($1) AND o.name = $2)" +
            "  AND _tenant_tenant_pk = (" +
            "    SELECT _pk FROM tenant WHERE pg_database = $4)"
        ),
        [username, "FBTest", isActive, database]
    ));
}

describe("the instance picker (G.1)", function () {
    before(async function () {
        // Granted the first instance and nothing else
        await db.ensureIdentity(SOLO, settings.password, settings.testDb);
        // The same name in two organizations, granted nothing here
        await db.ensureIdentity(TWIN, settings.password);
        await seedTwin();
    });

    after(async function () {
        await unseedTwin();
        await grantState(SOLO, settings.testDb, true);
    });

    it("refuses an instance named after one of its own paths",
            async function () {
        /*
            The picker and the console answer at paths with no database
            in them, so an instance whose database were called
            "platform" could never be opened: the root route would
            answer first. The name is refused rather than allowed and
            then found wanting.
        */
        let admin = new Session();

        await admin.signIn(settings.adminUser, settings.password);
        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "UPDATE identity SET is_platform_admin = true " +
                "WHERE lower(username) = lower($1)"
            ),
            [settings.adminUser]
        ));

        let resp = await admin.raw("POST", "/admin/instance", {
            database: "platform",
            name: "Shadowed"
        });

        assert.ok(resp.status >= 400, "status " + resp.status);
        assert.match(
            JSON.stringify(resp.body),
            /cannot be created or dropped from here/,
            "refused for being a name the server answers itself, not " +
            "merely for not existing"
        );

        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "UPDATE identity SET is_platform_admin = false " +
                "WHERE lower(username) = lower($1)"
            ),
            [settings.adminUser]
        ));
    });

    it("answers at a URL with no database in it", async function () {
        let resp = await new Session(ROOT).raw("GET", "/");

        assert.equal(resp.status, 200);
        assert.ok(
            String(resp.body).includes("fb-picker"),
            "the picker page, not an instance's"
        );
    });

    it("refuses the list to a caller with no session", async function () {
        let resp = await new Session(ROOT).raw("GET", "/my/instances");

        assert.equal(resp.status, 401);
    });

    it("refuses a wrong password", async function () {
        let resp = await new Session(ROOT).signIn(
            SOLO,
            "not-the-password"
        );

        assert.equal(resp.status, 401);
    });

    it("signs in against the manager with no instance in play",
            async function () {
        let picker = new Session(ROOT);
        let resp = await picker.signIn(SOLO, settings.password);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.username, SOLO);
        assert.equal(resp.body.organization.name, "FBTest");
        assert.equal(resp.body.isPlatformAdmin, false);
    });

    it("asks which organization when the user name is in two",
            async function () {
        let resp = await new Session(ROOT).signIn(TWIN, settings.password);

        assert.equal(resp.status, 409, JSON.stringify(resp.body));
        assert.equal(resp.body.code, "organization-required");
        assert.ok(
            !JSON.stringify(resp.body).includes(TWIN_ORG),
            "and does not say where the name exists"
        );
    });

    it("takes the organization when it is named", async function () {
        let resp = await new Session(ROOT).signIn(
            TWIN,
            settings.password,
            "FBTest"
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.organization.name, "FBTest");
    });

    it("tells the two apart by their own passwords", async function () {
        let wrong = await new Session(ROOT).signIn(
            TWIN,
            TWIN_PW,
            "FBTest"
        );
        let right = await new Session(ROOT).signIn(
            TWIN,
            TWIN_PW,
            TWIN_ORG
        );

        assert.equal(wrong.status, 401, "the twin's password is not ours");
        assert.equal(right.status, 200, JSON.stringify(right.body));
        assert.equal(right.body.organization.name, TWIN_ORG);
    });

    it("lists the instances the grants reach, and no others",
            async function () {
        let solo = new Session(ROOT);

        await solo.signIn(SOLO, settings.password);

        let mine = await solo.get("/my/instances");

        assert.deepEqual(
            mine.instances.map((i) => i.database),
            [settings.testDb],
            "granted the first instance and not the second"
        );
        assert.equal(mine.identity.username, SOLO);

        let admin = new Session(ROOT);

        await admin.signIn(settings.adminUser, settings.password, "FBTest");

        let theirs = await admin.get("/my/instances");

        assert.ok(
            theirs.instances.some((i) => i.database === settings.testDb),
            "the harness administrator reaches the first instance"
        );
    });

    it("says nothing of another organization's instances",
            async function () {
        let twin = new Session(ROOT);

        await twin.signIn(TWIN, TWIN_PW, TWIN_ORG);

        let mine = await twin.get("/my/instances");

        assert.deepEqual(mine.instances, []);
    });

    it("enters an instance it is granted", async function () {
        let picker = new Session(ROOT);

        await picker.signIn(SOLO, settings.password);

        let resp = await picker.raw(
            "GET",
            "/" + settings.testDb + "/profile"
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    it("refuses one it is not, and keeps the session", async function () {
        let picker = new Session(ROOT);

        await picker.signIn(SOLO, settings.password);

        let resp = await picker.raw(
            "GET",
            "/" + settings.testDb2 + "/profile"
        );

        assert.equal(resp.status, 403, JSON.stringify(resp.body));
        assert.match(String(resp.body), /no access/i);

        // The session was signed in against the manager, not against
        // that instance, so it stands
        let mine = await picker.get("/my/instances");

        assert.equal(mine.identity.username, SOLO);
    });

    it("closes the door when the grant is revoked after sign-in",
            async function () {
        let picker = new Session(ROOT);

        await picker.signIn(SOLO, settings.password);

        let open = await picker.raw(
            "GET",
            "/" + settings.testDb + "/profile"
        );

        assert.equal(open.status, 200, "in while the grant is live");

        await grantState(SOLO, settings.testDb, false);

        /*
            Admission is recorded on the session, so the instance it
            is already in stays open until it leaves. What the revoked
            grant has to stop is entering again.
        */
        let other = new Session(ROOT);

        await other.signIn(SOLO, settings.password);

        let shut = await other.raw(
            "GET",
            "/" + settings.testDb + "/profile"
        );

        assert.equal(shut.status, 403, JSON.stringify(shut.body));

        await grantState(SOLO, settings.testDb, true);
    });
});
