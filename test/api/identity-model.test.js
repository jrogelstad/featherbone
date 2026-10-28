/*
    The control plane's own feathers (tenant plan A.3): an organization
    owns the identities that reach its instances, and a grant says which
    instances each identity may reach.

    The constraint that matters most here is the one improvement item 1.1
    is about: a username belongs to an organization, not to the cluster, so
    two customers may each employ an `alice` and neither can see the other.
    Postgres role names could never do that.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");

// The control plane lives in the manager database, not in an instance
function manager(sql, params) {
    return db.withClient(
        settings.managerDb,
        (client) => client.query(sql, params)
    );
}

async function managerCatalog() {
    let resp = await manager(
        "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
    );

    return resp.rows[0].data;
}

const FEATHERS = ["Organization", "Identity", "AccessGrant", "AdminAudit"];

// Rows here inherit Document, so every insert carries its columns.
const DOC = (
    "_pk,id,created,created_by,updated,updated_by,is_deleted,owner,etag"
);
const DOC_VALUES = (
    "nextval('object__pk_seq'),$1,now(),'admin',now(),'admin',false," +
    "'admin',$2"
);

function addOrganization(id, name) {
    return manager(
        "INSERT INTO organization (" + DOC + "," +
        "name,is_active,authentication,is_two_factor_required) VALUES (" +
        DOC_VALUES + ",$3,true,'password',false)",
        [id, "etag_" + id, name]
    );
}

function addIdentity(id, organizationId, username) {
    return manager(
        "INSERT INTO identity (" + DOC + "," +
        "_organization_organization_pk,username,full_name,status," +
        "is_platform_admin,is_org_admin,failed_attempts) " +
        "SELECT " + DOC_VALUES + ",_pk,$3,$3,'active',false,false,0 " +
        "FROM organization WHERE id = $4",
        [id, "etag_" + id, username, organizationId]
    );
}

describe("the identity model", function () {
    let catalog;
    const made = [];

    before(async function () {
        catalog = await managerCatalog();
    });

    after(async function () {
        // Leave the copy as it was found, so order between files cannot matter
        await manager("DELETE FROM identity WHERE id = ANY($1)", [made]);
        await manager("DELETE FROM organization WHERE id = ANY($1)", [made]);
    });

    describe("the feathers", function () {
        FEATHERS.forEach(function (name) {
            it("declares \"" + name + "\" and grants it to nobody",
                    async function () {
                let id = name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
                let granted = await manager(
                    "SELECT auth.role FROM \"$auth\" AS auth, " +
                    "  \"$feather\" AS feather " +
                    "WHERE feather.id = $1 AND feather._pk = auth.object_pk",
                    [id]
                );

                assert.ok(catalog[name], name + " is declared");
                assert.equal(catalog[name].module, "Core");
                // Same choice as Tenant: reachable only to a super user
                // until A.4 gives the administration model its own roles
                assert.deepEqual(granted.rows, []);
            });
        });

        it("lets an instance exist without a contact", function () {
            // The installer registers an instance it has just created
            // and has nobody to name as the contact; a contact belongs
            // to the owning organization anyway (tenant plan A.3), so
            // requiring one here only blocked `install --instance`
            let feather = catalog.Tenant;

            assert.notEqual(
                feather.properties.contact.isRequired,
                true
            );
        });

        it("hangs an organization off an instance", function () {
            let feather = catalog.Tenant;

            assert.equal(
                feather.properties.organization.type.relation,
                "Organization"
            );
            // Existing rows predate organizations; A.5 backfills them
            assert.notEqual(
                feather.properties.organization.isRequired,
                true
            );
        });
    });

    // A username was once unique only within an organization; it is now
    // unique across the installation (global-usernames.test.js).
    describe("usernames are unique across the installation", function () {
        it("refuses an \"alice\" in a second organization", async function () {
            made.push("fbt_org_a", "fbt_org_b", "fbt_id_a", "fbt_id_b");
            await addOrganization("fbt_org_a", "Fbtest Acme");
            await addOrganization("fbt_org_b", "Fbtest Globex");
            await addIdentity("fbt_id_a", "fbt_org_a", "fbt_alice");

            await assert.rejects(
                () => addIdentity("fbt_id_b", "fbt_org_b", "fbt_alice"),
                /identity_unique_username|duplicate key/i
            );
        });

        it("refuses the same username twice in one organization",
                async function () {
            made.push("fbt_org_c", "fbt_id_c1", "fbt_id_c2");
            await addOrganization("fbt_org_c", "Fbtest Initech");
            await addIdentity("fbt_id_c1", "fbt_org_c", "fbt_bob");

            await assert.rejects(
                () => addIdentity("fbt_id_c2", "fbt_org_c", "fbt_bob"),
                /identity_unique_username|duplicate key/i
            );
        });

        it("treats a username as case-insensitive",
                async function () {
            made.push("fbt_id_c3");

            await assert.rejects(
                () => addIdentity("fbt_id_c3", "fbt_org_c", "FBT_BOB"),
                /identity_unique_username|duplicate key/i
            );
        });

        it("frees a username once the identity is deleted",
                async function () {
            made.push("fbt_id_c4");
            await manager(
                "UPDATE identity SET is_deleted = true WHERE id = $1",
                ["fbt_id_c1"]
            );

            // The index is partial on NOT is_deleted, so a soft-deleted
            // row must not reserve its name forever
            await addIdentity("fbt_id_c4", "fbt_org_c", "fbt_bob");

            let resp = await manager(
                "SELECT count(*)::int AS n FROM identity " +
                "WHERE username = 'fbt_bob' AND NOT is_deleted"
            );

            assert.equal(resp.rows[0].n, 1);
        });
    });

    describe("organization names", function () {
        it("refuses a second organization with the same name",
                async function () {
            made.push("fbt_org_d");

            await assert.rejects(
                () => addOrganization("fbt_org_d", "FBTEST ACME"),
                /organization_unique_name|duplicate key/i
            );
        });
    });
});
