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
const {claims, decoded, sink} = require("./lib/mailsink");

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

        /*
            The grant makes the profile now. Take it away again to get
            back to the state of an account granted before it did, so
            the screen's no-profile branch stays covered.
        */
        assert.equal(before.hasProfile, true, "made when granted");
        await db.query(
            "DELETE FROM role_membership WHERE _parent_role_pk IN (" +
            "SELECT _pk FROM user_account WHERE name = $1)",
            [name]
        );
        await db.query("DELETE FROM user_account WHERE name = $1", [name]);
        before = await row(name);
        assert.equal(before.hasProfile, false, "no profile to edit");

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

    it("gives somebody a profile in the instance when they are added",
            async function () {
        let name = access.track(access.uniq("fbt_lst"));
        let made = await admin.raw("POST", "/admin/identity", {
            fullName: "Listed Person",
            password: "Info-Pw-3",
            username: name
        });

        assert.ok(made.status < 300, JSON.stringify(made.body));

        /*
            The lists inside the instance -- the user account field on
            a record, assignments -- read user_account, so the person
            has to be in it before they have ever signed in.
        */
        let rows = await admin.findBy("userAccounts", "name", name);

        assert.equal(rows.length, 1, "listed before any sign-in");
        assert.equal(rows[0].name, name);
    });

    it("gives somebody an existing account a profile when it is granted",
            async function () {
        let name = access.track(access.uniq("fbt_grn"));
        let made = await admin.raw("POST", "/admin/identity", {
            fullName: "Granted Person",
            password: "Info-Pw-4",
            username: name
        });

        assert.ok(made.status < 300, JSON.stringify(made.body));

        // Take away the grant and the profile, as if never given
        let who = await row(name);
        let revoked = await admin.raw("POST", "/admin/grant", {
            id: who.id,
            isActive: false
        });

        assert.ok(revoked.status < 300, JSON.stringify(revoked.body));
        await db.query(
            "DELETE FROM role_membership WHERE _parent_role_pk IN (" +
            "SELECT _pk FROM user_account WHERE name = $1)",
            [name]
        );
        await db.query("DELETE FROM user_account WHERE name = $1", [name]);

        let granted = await admin.raw("POST", "/admin/grant", {id: who.id});

        assert.ok(granted.status < 300, JSON.stringify(granted.body));

        let found = await db.query(
            "SELECT count(*)::int AS n FROM user_account WHERE name = $1",
            [name]
        );

        assert.equal(found.rows[0].n, 1);
    });

    /*
        At the application level an organization administrator is a
        super user in the organization's instances: they administer
        what is in them, and who may open a workbook is set on the
        workbook, so they have to see them all (John, Oct 2026). The
        platform's own administration is another application and does
        not come into it.
    */
    // Appointing an organization administrator is for an organization
    // or platform administrator, which the suite's own user is not
    async function appointer() {
        let name = access.track(access.uniq("fbt_pa"));

        await db.ensureIdentity(name, settings.password, settings.testDb);
        await db.withClient(
            settings.managerDb,
            (client) => client.query(
                "UPDATE identity SET is_platform_admin = true " +
                "WHERE lower(username) = lower($1)",
                [name]
            )
        );

        let session = new Session();
        let resp = await session.signIn(name, settings.password, "FBTest");

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        return session;
    }

    async function isSuper(name) {
        let resp = await db.query(
            "SELECT is_super FROM user_account WHERE name = $1",
            [name]
        );

        return resp.rows.length && resp.rows[0].is_super;
    }

    it("makes an appointed organization administrator a super user in " +
            "their instances, and stands them down again", async function () {
        let name = access.track(access.uniq("fbt_oa"));
        let made = await admin.raw("POST", "/admin/identity", {
            password: "Info-Pw-5",
            username: name
        });

        assert.ok(made.status < 300, JSON.stringify(made.body));
        assert.equal(await isSuper(name), false, "an ordinary user to begin");

        let who = await row(name);
        let boss = await appointer();
        let resp = await boss.raw("POST", "/admin/identity/org-admin", {
            id: who.id,
            isOrgAdmin: true
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));
        assert.equal(await isSuper(name), true, "appointed");

        resp = await boss.raw("POST", "/admin/identity/org-admin", {
            id: who.id,
            isOrgAdmin: false
        });
        assert.ok(resp.status < 300, JSON.stringify(resp.body));
        assert.equal(await isSuper(name), false, "stood down");
    });

    it("gives an organization administrator a super user profile when " +
            "they are granted an instance", async function () {
        let name = access.track(access.uniq("fbt_og"));

        await admin.raw("POST", "/admin/identity", {
            password: "Info-Pw-6",
            username: name
        });

        let who = await row(name);
        let boss = await appointer();
        let appointed = await boss.raw("POST", "/admin/identity/org-admin", {
            id: who.id,
            isOrgAdmin: true
        });

        assert.ok(appointed.status < 300, JSON.stringify(appointed.body));

        // As if their profile here had never been made
        await db.query(
            "DELETE FROM role_membership WHERE _parent_role_pk IN (" +
            "SELECT _pk FROM user_account WHERE name = $1)",
            [name]
        );
        await db.query("DELETE FROM user_account WHERE name = $1", [name]);

        let granted = await boss.raw("POST", "/admin/grant", {id: who.id});

        assert.ok(granted.status < 300, JSON.stringify(granted.body));
        assert.equal(await isSuper(name), true);
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

        // Already there from the grant; sign-in must cope with that
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

/*
    A user made without a password: the 2.2.0 way. The administrator
    gives an email address, the person is mailed a link that signs
    them in, and the first thing they meet is the page that makes them
    choose a password. The mail goes out through the organization's
    SMTP account (Settings), not the installation's config.json.

    A throwaway SMTP server stands in for the mail provider.
*/
const NAME = "globalSettings";

describe("mail the system sends: invitations and forgotten passwords",
        function () {
    let admin;
    let before_;
    let smtp;

    async function useSmtp(port) {
        let current = await admin.get("/settings/" + NAME);
        let resp = await admin.raw("PUT", "/settings/" + NAME, {
            data: Object.assign({}, current.data, {
                smtpHost: "127.0.0.1",
                smtpPassword: "secret",
                smtpPort: port,
                smtpSecure: false,
                smtpType: "SMTP",
                smtpUser: "noreply@example.com"
            }),
            etag: current.etag
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    }

    before(async function () {
        admin = await signedIn();
        before_ = await admin.get("/settings/" + NAME);
        smtp = await sink();
    });

    after(async function () {
        await smtp.close();
        await db.withClient(
            settings.managerDb,
            (client) => client.query(
                "DELETE FROM \"$organization_settings\" WHERE name = $1",
                [NAME]
            )
        ).catch(() => undefined);

        let current = await admin.get("/settings/" + NAME);

        await admin.raw("PUT", "/settings/" + NAME, {
            data: before_.data,
            etag: current.etag
        });
        await access.dropAll();
    });

    it("mails a link that signs them in and asks for a password",
            async function () {
        await useSmtp(smtp.port);

        let name = access.track(access.uniq("fbt_inv"));
        let resp = await admin.raw("POST", "/admin/identity", {
            email: name + "@example.com",
            fullName: "Invited Person",
            sendInvite: true,
            username: name
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));
        assert.equal(resp.body.created, true);
        assert.equal(resp.body.mail, "sent", JSON.stringify(resp.body));

        // It left through the organization's account
        let mail = smtp.mails[smtp.mails.length - 1];

        assert.match(mail.from, /noreply@example\.com/);
        assert.match(mail.to[0], new RegExp(name + "@example\\.com"));

        let text = decoded(mail.raw);

        assert.match(text, /Subject: New\s+account created/);
        assert.ok(text.includes(name), "it names the user");

        let link = text.match(/href="([^"]+)"/)[1];

        assert.ok(
            link.includes("/auth/magiclink/callback?token="),
            link
        );
        assert.ok(
            !text.includes("Invited-Pw"),
            "no password travels in the mail"
        );

        /*
            The link is signed, not encrypted: whoever holds it can read
            it. It says who it is for and which database, and no more.
        */
        let said = claims(link);

        assert.equal(said.username, name);
        assert.equal(said.database, settings.testDb);

        let plumbing = ["code", "exp", "iat"];
        let kept = Object.keys(said).filter(
            (key) => plumbing.indexOf(key) < 0
        );

        kept.sort();
        assert.deepEqual(kept, ["database", "destination", "username"]);

        // The link signs them in, and the profile says change it
        let person = new Session();
        let arrived = await person.raw(
            "GET",
            link.slice(link.indexOf("/auth/magiclink"))
        );

        assert.ok(arrived.status < 400, String(arrived.status));

        let who = await person.raw("POST", "/connect");

        assert.equal(who.status, 200, JSON.stringify(who.body));
        assert.equal(who.body.data.authorized.name, name);
        assert.equal(
            who.body.data.authorized.changePassword,
            true,
            "sent to the change-password page on arrival"
        );

        // And the password they choose is the one that works afterwards
        let chosen = await person.raw("POST", "/do/change-role-password", {
            password: "Invited-Pw-1"
        });

        assert.ok(chosen.status < 300, JSON.stringify(chosen.body));
        assert.equal(
            (await new Session().signIn(name, "Invited-Pw-1")).status,
            200
        );
    });

    it("sends the sign-in link for a user account without its password " +
            "or the instance's credentials", async function () {
        await useSmtp(smtp.port);

        let name = access.track(access.uniq("fbt_acc"));
        let contact = await access.createContact(admin, name);
        let sent = smtp.mails.length;
        let resp = await admin.raw("POST", "/data/user-account", {
            contact: {id: contact.id},
            membership: [{role: "everyone"}],
            name,
            password: "Acc-Pw-Secret-1"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        await access.poll(() => smtp.mails.length > sent, 5000);
        assert.equal(smtp.mails.length, sent + 1, "a mail went out");

        let text = decoded(smtp.mails[smtp.mails.length - 1].raw);
        let said = claims(text);

        assert.equal(said.username, name);
        assert.equal(said.database, settings.testDb);

        let all = JSON.stringify(said);

        assert.ok(!all.includes("Acc-Pw-Secret-1"), "no password");
        assert.ok(!all.includes("pgPassword"), "no database credentials");
        assert.equal(said.tenant, undefined);
        assert.equal(said.password, undefined);
    });

    it("says so when the mail cannot go, and keeps the user",
            async function () {
        let dead = await sink();
        let port = dead.port;

        await dead.close();
        await useSmtp(port);

        let name = access.track(access.uniq("fbt_inv"));
        let resp = await admin.raw("POST", "/admin/identity", {
            email: name + "@example.com",
            sendInvite: true,
            username: name
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));
        assert.equal(resp.body.created, true);
        assert.equal(resp.body.mail, "failed");
        assert.ok(resp.body.mailError, "and why");
        assert.ok(await row(name), "the user is there to be given a password");
    });

    it("needs an address, and refuses a password as well",
            async function () {
        let name = access.uniq("fbt_inv");
        let resp = await admin.raw("POST", "/admin/identity", {
            sendInvite: true,
            username: name
        });

        assert.equal(resp.status, 400);

        resp = await admin.raw("POST", "/admin/identity", {
            email: name + "@example.com",
            password: "Both-Pw-1",
            sendInvite: true,
            username: name
        });
        assert.equal(resp.status, 400);
    });

    // Open the mailed link as the person would, and say who it made them
    async function arrive(mail) {
        let text = decoded(mail.raw);
        let link = text.match(/href="([^"]+)"/)[1];
        let person = new Session();
        let arrived = await person.raw(
            "GET",
            link.slice(link.indexOf("/auth/magiclink"))
        );

        assert.ok(arrived.status < 400, String(arrived.status));

        let who = await person.raw("POST", "/connect");

        assert.equal(who.status, 200, JSON.stringify(who.body));

        return {person, user: who.body.data.authorized};
    }

    async function asked(name) {
        return await Promise.race([
            new Session().raw("POST", "/reset-password", {username: name}),
            new Promise((resolve) => setTimeout(
                () => resolve({status: "no answer"}),
                8000
            ))
        ]);
    }

    it("sends a forgotten-password link to a user with a contact",
            async function () {
        await useSmtp(smtp.port);

        let user = await access.createUser(admin, {});
        let sent = smtp.mails.length;
        let resp = await asked(user.name);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(smtp.mails.length, sent + 1, "a mail went out");

        let mail = smtp.mails[smtp.mails.length - 1];

        assert.match(mail.to[0], new RegExp(user.email.replace(".", "\\.")));
        assert.match(decoded(mail.raw), /reset your password/);

        let {person, user: me} = await arrive(mail);

        assert.equal(me.name, user.name);
        assert.equal(me.changePassword, true);

        let chosen = await person.raw("POST", "/do/change-role-password", {
            password: "Forgot-Pw-1"
        });

        assert.ok(chosen.status < 300, JSON.stringify(chosen.body));
        assert.equal(
            (await new Session().signIn(user.name, "Forgot-Pw-1")).status,
            200
        );
    });

    it("answers for a user made on the Users screen, who has no contact",
            async function () {
        await useSmtp(smtp.port);

        let name = access.track(access.uniq("fbt_forgot"));

        await admin.raw("POST", "/admin/identity", {
            email: name + "@example.com",
            fullName: "Forgetful Person",
            password: "Forgot-Pw-0",
            username: name
        });

        // Signing in makes the profile, which has no contact
        assert.equal(
            (await new Session().signIn(name, "Forgot-Pw-0")).status,
            200
        );

        let sent = smtp.mails.length;
        let resp = await asked(name);

        assert.equal(
            resp.status,
            200,
            "it used to wait for an answer that never came: " +
                JSON.stringify(resp.body)
        );
        assert.equal(smtp.mails.length, sent + 1, "a mail went out");

        let mail = smtp.mails[smtp.mails.length - 1];

        assert.match(mail.to[0], new RegExp(name + "@example\\.com"));

        let {user: me} = await arrive(mail);

        assert.equal(me.name, name);
        assert.equal(me.changePassword, true);
        assert.equal(me.email, name + "@example.com");
    });

    it("does not say it was sent when the mail cannot go",
            async function () {
        let dead = await sink();
        let port = dead.port;

        await dead.close();
        await useSmtp(port);

        let user = await access.createUser(admin, {});
        let resp = await asked(user.name);

        assert.equal(resp.status, 500, JSON.stringify(resp.body));
        assert.ok(
            !/smtp|ECONN|127\.0\.0\.1/i.test(JSON.stringify(resp.body)),
            "and gives nothing away about the mail server"
        );
    });

    it("refuses a user that does not exist", async function () {
        let resp = await asked(access.uniq("fbt_nobody"));

        assert.ok(resp.status >= 400, JSON.stringify(resp));
    });


    async function row(name) {
        let overview = await admin.get("/admin/overview");

        return overview.identities.find((one) => one.username === name);
    }
});
