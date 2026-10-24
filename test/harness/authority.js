/*
    Authority for a test identity, written where the server reads it.

    Being a platform administrator is a flag on the person
    (`identity.is_platform_admin`). Administering an organization is an
    appointment over that organization -- a row in `organization_admin`
    -- and not a rank the person carries about with them
    (`admin.js contextFor`, which asks `isOrgAdminOf`). The
    `identity.is_org_admin` column is left over from before that:
    `manager.identity` derives `isOrgAdmin` from the appointment, and
    nothing reads the column any more.

    Each suite used to carry its own copy of a `flags` helper that set
    the column, so every one of them granted an authority the server
    does not recognise. This is that helper, written once and against
    the appointment.

    What it writes is the authority the manager answers for, which is
    what the `/admin` routes ask about. It deliberately does not touch
    `user_account.is_super` in the instances, although appointing
    somebody through the screen does: the suites toggle authority over
    and over, the screen lowers that flag whenever anybody stands down
    (a flag cannot say what raised it), and lowering it here would take
    away the super user the harness set up at bootstrap. The screen's
    own effect on profiles belongs to the tests that go through the
    route.
*/
/*jslint node*/
"use strict";

const db = require("./db");
const settings = require("./env");

/*
    The organization an appointment is over: the one asked for by id or
    name, or else the one that owns the test instance, which is the
    organization a suite signing in to it means.
*/
async function organizationPk(client, named) {
    let resp;

    if (named === undefined) {
        resp = await client.query(
            (
                "SELECT _organization_organization_pk AS pk FROM tenant " +
                "WHERE pg_database = $1 AND NOT is_deleted"
            ),
            [settings.testDb]
        );
    } else {
        resp = await client.query(
            (
                "SELECT _pk AS pk FROM organization " +
                "WHERE (id = $1 OR name = $1) AND NOT is_deleted"
            ),
            [named]
        );
    }

    if (!resp.rows.length || resp.rows[0].pk === null) {
        throw new Error(
            "No organization for " + (named || settings.testDb) +
            " to appoint an administrator over"
        );
    }

    return resp.rows[0].pk;
}

// The appointment, set either way.
async function setAppointment(client, identityPk, orgPk, isOrgAdmin) {
    let found = await client.query(
        (
            "SELECT _pk AS pk FROM organization_admin " +
            "WHERE _identity_identity_pk = $1 " +
            "  AND _organization_organization_pk = $2 " +
            "  AND NOT is_deleted"
        ),
        [identityPk, orgPk]
    );
    if (found.rows.length) {
        let row = found.rows[0];

        await client.query(
            (
                "UPDATE organization_admin " +
                "SET is_active = $2, appointed = now(), updated = now() " +
                "WHERE _pk = $1"
            ),
            [row.pk, isOrgAdmin]
        );
        return;
    }

    if (!isOrgAdmin) {
        return;
    }

    await client.query(
        (
            "INSERT INTO organization_admin (" +
            "  id, created, created_by, updated, updated_by, " +
            "  is_deleted, etag, _identity_identity_pk, " +
            "  _organization_organization_pk, is_active, appointed" +
            ") VALUES (" +
            "  $1, now(), 'tests', now(), 'tests', false, $1, $2, $3, " +
            "  true, now()" +
            ")"
        ),
        ["fbt" + Date.now() + identityPk + orgPk, identityPk, orgPk]
    );
}

/*
    flags(username, {isOrgAdmin, isPlatformAdmin, organization}) --
    the same signature the suites' own copies had, plus an organization
    to be appointed over when it is not the test instance's.
*/
async function flags(username, data) {
    let wanted = data || {};
    let isOrgAdmin = wanted.isOrgAdmin === true;
    let isPlatformAdmin = wanted.isPlatformAdmin === true;

    await db.withClient(settings.managerDb, async function (client) {
        let who = await client.query(
            "SELECT _pk AS pk FROM identity " +
            "WHERE lower(username) = lower($1)",
            [username]
        );

        if (!who.rows.length) {
            throw new Error("No identity \"" + username + "\"");
        }

        let identityPk = who.rows[0].pk;
        let orgPk = await organizationPk(client, wanted.organization);

        await client.query(
            (
                "UPDATE identity " +
                "SET is_platform_admin = $2, updated = now(), " +
                "  updated_by = 'fbtest' " +
                "WHERE _pk = $1"
            ),
            [identityPk, isPlatformAdmin]
        );
        await setAppointment(client, identityPk, orgPk, isOrgAdmin);
    });
}

module.exports = {flags};
