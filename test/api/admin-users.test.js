/*
    An administrator changing a person's details from the Users screen
    (POST /admin/identity/info), and the contact details the screen
    lists (GET /admin/overview).

    The details a person edits for themselves live on their profile in
    the instance (first and last name, email, phone); the identity in
    the manager carries one name and one address. The screen reads the
    profile where there is one, writes it through the same code as
    "Edit my contact information", and keeps the identity in step.
    (server/services/admin.js updateIdentity, server/datasource.js
    changeUserInfo, server/services/manager.js setIdentityInfo)
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const access = require("./lib/access");

describe("administrator edits a user's details", function () {
    let admin;

    async function row(name) {
        let overview = await admin.get("/admin/overview");

        return overview.identities.find((one) => one.username === name);
    }

    async function edit(id, data) {
        return await admin.raw(
            "POST",
            "/admin/identity/info",
            Object.assign({id}, data)
        );
    }

    before(async function () {
        admin = await signedIn();
    });

    after(async function () {
        await access.dropAll();
    });

    it("keeps a name and address for someone who has not signed in yet",
            async function () {
        let name = access.track(access.uniq("fbt_info"));
        let made = await admin.raw("POST", "/admin/identity", {
            email: "before@example.com",
            fullName: "Before Change",
            password: "Info-Pw-1",
            username: name
        });

        assert.ok(made.status < 300, JSON.stringify(made.body));

        let before = await row(name);

        assert.equal(before.hasProfile, false, "no profile until sign-in");

        let resp = await edit(before.id, {
            email: "after@example.com",
            fullName: "After Change"
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));

        let after = await row(name);

        assert.equal(after.fullName, "After Change");
        assert.equal(after.email, "after@example.com");
        assert.equal(after.phone, undefined, "no phone without a profile");
    });

    it("writes the profile once there is one, phone included",
            async function () {
        let name = access.track(access.uniq("fbt_prof"));

        await admin.raw("POST", "/admin/identity", {
            email: "prof@example.com",
            fullName: "Prof Person",
            password: "Info-Pw-2",
            username: name
        });

        // The first sign-in makes the profile (B.7), with no contact
        assert.equal(
            (await new Session().signIn(name, "Info-Pw-2")).status,
            200
        );

        let before = await row(name);

        assert.equal(before.hasProfile, true);

        let resp = await edit(before.id, {
            email: "married@example.com",
            firstName: "Pat",
            lastName: "Married-Name",
            phone: "555-0100"
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));

        let after = await row(name);

        assert.equal(after.firstName, "Pat");
        assert.equal(after.lastName, "Married-Name");
        assert.equal(after.fullName, "Pat Married-Name");
        assert.equal(after.email, "married@example.com");
        assert.equal(after.phone, "555-0100");

        // The organization-wide record follows
        let held = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT full_name, email FROM identity " +
                    "WHERE username = $1 AND NOT is_deleted"
                ),
                [name]
            )
        );

        assert.equal(held.rows[0].full_name, "Pat Married-Name");
        assert.equal(held.rows[0].email, "married@example.com");

        // And changing one field leaves the others alone
        resp = await edit(before.id, {phone: "555-0222"});
        assert.ok(resp.status < 300, JSON.stringify(resp.body));

        let again = await row(name);

        assert.equal(again.phone, "555-0222");
        assert.equal(again.lastName, "Married-Name");
        assert.equal(again.email, "married@example.com");

        // The change is on the audit trail
        let overview = await admin.get("/admin/overview");

        assert.ok(
            overview.audit.some((one) => (
                one.action === "identity.info_changed" &&
                one.target === name
            )),
            "audited"
        );
    });

    it("updates the contact a user account already has", async function () {
        let user = await access.createUser(admin, {});
        let before = await row(user.name);

        assert.equal(before.firstName, "Test");

        let resp = await edit(before.id, {
            lastName: "Renamed",
            phone: "555-0300"
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));

        let after = await row(user.name);

        assert.equal(after.firstName, "Test");
        assert.equal(after.lastName, "Renamed");
        assert.equal(after.phone, "555-0300");
        assert.equal(after.email, user.email);
    });

    it("lets a user with no contact save their own details",
            async function () {
        let name = access.track(access.uniq("fbt_self"));

        await admin.raw("POST", "/admin/identity", {
            email: "self@example.com",
            password: "Info-Pw-3",
            username: name
        });

        let session = new Session();

        await session.signIn(name, "Info-Pw-3");

        let resp = await session.raw("POST", "/do/change-user-info", {
            email: "self.changed@example.com",
            firstName: "Sam",
            lastName: "Self",
            phone: "555-0400"
        });

        assert.ok(
            resp.status < 300,
            "a profile made at first sign-in has no contact yet: " +
                JSON.stringify(resp.body)
        );

        let after = await row(name);

        assert.equal(after.lastName, "Self");
        assert.equal(after.phone, "555-0400");
    });

    it("refuses a bad address, an unknown person and an ordinary user",
            async function () {
        let user = await access.createUser(admin, {});
        let target = await row(user.name);
        let resp = await edit(target.id, {email: "not-an-address"});

        assert.equal(resp.status, 400);

        resp = await edit("no-such-identity", {email: "a@example.com"});
        assert.equal(resp.status, 404);

        let ordinary = new Session();

        await ordinary.signIn(user.name, user.password);
        resp = await ordinary.raw("POST", "/admin/identity/info", {
            id: target.id,
            phone: "555-0500"
        });
        assert.equal(resp.status, 401, "not an administrator");
    });
});
