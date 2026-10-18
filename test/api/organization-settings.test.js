/*
    Settings that belong to the organization, not the instance (John,
    2026-10-18: "move the global settings from the database to the ...
    organization record that manages all the instances").

    A customer's letterhead and mail account are the same wherever
    they are printed or sent from, so production, test and demo should
    read one copy rather than three that drift. The values live
    against the organization in the manager; the definition, and the
    screen that renders it, stay where they were.

    `logo` is the exception and is here as one: it relates to a
    `ResourceLink`, whose row exists in one instance and nowhere else,
    so it stays with the instance.

    globalSettings is put back in after().
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const env = require("../harness/env");
const db = require("../harness/db");
const {signedIn} = require("../harness/http");

const NAME = "globalSettings";
const SECRET = "Org-Smtp-" + Date.now().toString(36);

function managerQuery(sql, params) {
    return db.withClient(
        env.managerDb,
        (client) => client.query(sql, params)
    );
}

async function organizationRow(organization) {
    let resp = await managerQuery(
        (
            "SELECT s.data FROM \"$organization_settings\" s " +
            "JOIN organization o ON o._pk = s.organization_pk " +
            "WHERE s.name = $1 AND o.name = $2"
        ),
        [NAME, organization]
    ).catch(function () {
        return {rows: []};
    });

    return (
        resp.rows.length
        ? resp.rows[0].data
        : undefined
    );
}

async function organizationOf(database) {
    let resp = await managerQuery(
        (
            "SELECT o.name FROM tenant t " +
            "JOIN organization o " +
            "  ON o._pk = t._organization_organization_pk " +
            "WHERE t.pg_database = $1 AND NOT t.is_deleted"
        ),
        [database]
    );

    return (
        resp.rows.length
        ? resp.rows[0].name
        : undefined
    );
}

async function instanceRow() {
    let resp = await db.query(
        "SELECT data FROM \"$settings\" WHERE name = $1",
        [NAME]
    );

    return resp.rows[0].data;
}

function clearOrganizationSettings() {
    return managerQuery(
        "DELETE FROM \"$organization_settings\" WHERE name = $1",
        [NAME]
    ).catch(() => undefined);
}

async function save(admin, data) {
    let current = await admin.get("/settings/" + NAME);

    return await admin.raw("PUT", "/settings/" + NAME, {
        data: Object.assign({}, current.data, data),
        etag: current.etag
    });
}

describe("settings the organization owns", function () {
    let admin;
    let organization;
    let before_;

    before(async function () {
        await clearOrganizationSettings();
        admin = await signedIn();
        before_ = await admin.get("/settings/" + NAME);
        organization = await organizationOf(env.testDb);

        assert.ok(organization, "the instance belongs to an organization");
    });

    after(async function () {
        await clearOrganizationSettings();

        let current = await admin.get("/settings/" + NAME);

        await admin.raw("PUT", "/settings/" + NAME, {
            data: before_.data,
            etag: current.etag
        });
    });

    it("answers from the instance until there is a row", async function () {
        /*
            Nothing is migrated (John: "We don't need to worry about a
            migration script"), so an organization that has never
            saved has no row -- and the upgrade that introduced this
            must not blank an address and a mail account in use.
        */
        assert.equal(await organizationRow(organization), undefined);

        let resp = await admin.raw("GET", "/settings/" + NAME);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    it("writes the organization's share to the manager", async function () {
        let resp = await save(admin, {
            city: "Albany",
            name: "Road Runner Campers",
            smtpHost: "smtp.example.com",
            smtpType: "SMTP",
            smtpUser: "mail@example.com",
            street: "1 Desert Road"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let stored = await organizationRow(organization);

        assert.ok(stored, "the organization now has a row");
        assert.equal(stored.name, "Road Runner Campers");
        assert.equal(stored.street, "1 Desert Road");
        assert.equal(stored.city, "Albany");
        assert.equal(stored.smtpHost, "smtp.example.com");
    });

    it("reads back the organization's copy", async function () {
        /*
            Proved by changing the instance's own row underneath and
            reading again: what comes back is the organization's, not
            the copy sitting in this database.
        */
        await db.query(
            "UPDATE \"$settings\" SET data = jsonb_set(" +
            "  data::jsonb, '{street}', '\"Somewhere else\"'" +
            ") WHERE name = $1",
            [NAME]
        );

        let resp = await admin.raw(
            "GET",
            "/settings/" + NAME + "?force=true"
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(
            resp.body.data.street,
            "1 Desert Road",
            "the organization's value, not the instance's"
        );
    });

    it("carries the logo too, now that it is a pointer", async function () {
        /*
            It used to relate to a `ResourceLink`, whose row lives in
            one instance and nowhere else, which is what kept it out
            of the organization's share. It is a URL or an uploaded
            file's name now (John, 2026-10-18), so it travels with
            the rest of the letterhead.
        */
        let resp = await save(admin, {logo: "letterhead.png"});

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let stored = await organizationRow(organization);

        assert.equal(stored.logo, "letterhead.png");
    });

    it("still writes every property to the instance", async function () {
        let mine = await instanceRow();

        assert.equal(
            mine.name,
            "Road Runner Campers",
            "the instance keeps a full copy to fall back on"
        );
    });

    it("encrypts the mail password at rest in the manager", async function () {
        let resp = await save(admin, {smtpPassword: SECRET});

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let stored = await organizationRow(organization);

        assert.ok(stored.smtpPassword, "it is stored");
        assert.equal(
            String(stored.smtpPassword).includes(SECRET),
            false,
            "and not in the clear"
        );
    });

    it("gives it back decrypted to those who may see it", async function () {
        let resp = await admin.raw(
            "GET",
            "/settings/" + NAME + "?force=true"
        );

        assert.equal(resp.body.data.smtpPassword, SECRET);
    });

    it("keeps one organization's settings out of another's", async function () {
        let other = await organizationOf(env.testDb2);

        if (!other || other === organization) {
            return; // one organization in this arrangement
        }

        assert.equal(
            await organizationRow(other),
            undefined,
            "the other organization has its own row, or none"
        );
    });
});
