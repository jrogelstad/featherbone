/*
    Views are rebuilt from the catalog the database holds, not from the
    copy this process cached.

    An install script may alter the catalog in SQL: `scripts/tables.js`
    gives an existing database the base object's `meta` property, where
    list formats and notes live. The settings cache is filled before
    that runs, so the view rebuild at the end of the install used to
    read the pre-patch catalog and leave every view without the new
    column -- while the tables and the stored catalog had it. The
    client was then told each feather carries `meta`, and every read of
    one answered `column "meta" does not exist` (John, Oct 2026).

    Done here the way an upgrade does it: the column and the catalog
    altered in SQL behind the cache's back, then rolled back.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const env = require("../harness/env");

require("../../common/string.js");
require("../../common/core");
const {Feathers} = require("../../server/services/feathers");
const {Settings} = require("../../server/services/settings");

const settings = new Settings();

// A property no feather defines, so only this test can have put it in
// a view
const PROBE = "fbtProbe";
const PROBE_COL = "fbt_probe";
const SPEC = JSON.stringify({
    description: "Probe for view propagation",
    type: "string"
});

/*
    The plain feather views, one per feather, which carry every
    property a feather has. A relation view (`_feather$property`) or a
    child view (`_feather$$child`) selects the few columns its caller
    reads, so neither is expected to carry this one.
*/
const MISSING = (
    "SELECT v.viewname AS v FROM pg_views v " +
    "WHERE v.schemaname = 'public' " +
    "  AND v.viewname ~ '^_[a-z0-9_]+$' " +
    "  AND NOT EXISTS (" +
    "    SELECT 1 FROM information_schema.columns c " +
    "    WHERE c.table_schema = 'public' " +
    "      AND c.table_name = v.viewname " +
    "      AND c.column_name = $1" +
    "  ) ORDER BY 1"
);

const ON_OBJECT = (
    "SELECT 1 FROM information_schema.columns " +
    "WHERE table_schema = 'public' AND table_name = '_object' " +
    "  AND column_name = $1"
);

const PATCH = (
    "UPDATE \"$settings\" SET data = jsonb_set(" +
    "  data::jsonb, '{Object,properties," + PROBE + "}', $1::jsonb" +
    ")::json WHERE name = 'catalog'"
);

describe("view propagation reads the stored catalog", function () {
    let missing;
    let onObject;

    before(async function () {
        await db.withClient(env.testDb, async function (client) {
            client.currentDatabase = env.testDb;

            // Cache the catalog the way a boot does, before the patch
            await settings.getSettings({
                client,
                data: {name: "catalog"}
            });

            await client.query("BEGIN");
            await client.query(
                "ALTER TABLE object ADD COLUMN " + PROBE_COL + " text"
            );
            await client.query(PATCH, [SPEC]);

            await new Feathers().propagateViews(client);

            missing = (
                await client.query(MISSING, [PROBE_COL])
            ).rows.map((row) => row.v);
            onObject = (
                await client.query(ON_OBJECT, [PROBE_COL])
            ).rows.length;

            await client.query("ROLLBACK");
        });
    });

    /*
        The patch is rolled back, but this process cached it on the way
        through, so put back what the database kept for whatever reads
        the catalog next.
    */
    after(async function () {
        await db.withClient(env.testDb, async function (client) {
            client.currentDatabase = env.testDb;
            await settings.getSettings({
                client,
                data: {force: true, name: "catalog"}
            });
        });
    });

    it("rebuilds the base view with the new column", function () {
        assert.equal(onObject, 1);
    });

    it("leaves no feather view without it", function () {
        assert.deepEqual(missing, []);
    });
});

/*
    A childOf relation synthesizes a complementary `parentOf` property
    on the parent feather the first time the child declares it (for
    example, FeatherProperty.parent is childOf "properties", so Feather
    gets a synthesized Feather.properties parentOf property pointing
    back). Nothing retracts that synthesized property if a later
    upgrade changes the child relation to a plain (non-childOf)
    relation -- the child side updates cleanly, but the stale parentOf
    property lingers on the parent, because the catalog's own
    properties-cleanup exempts every parentOf property on the
    assumption that the parent's own source never declares it either
    way. That assumption holds until the mirrored child relation stops
    being childOf: the parent is then left depending on the child (via
    the stale parentOf property) while the child now depends on the
    parent too (a plain relation is not exempt from the view-creation
    dependency graph the way childOf is), and view creation reports
    "Relationships cause circular dependencies" and rolls back the
    whole deploy (John, demo, SupplyChain 2.2.58, Nov 2026).

    Reproduced here the same way as above: the catalog patched in SQL
    behind the cache's back to look like an upgrade that dropped
    childOf from FeatherProperty.parent without touching Feather's
    stale "properties" property, then rolled back.
*/
const CHILD_TYPE = JSON.stringify({childOf: "properties", relation: "Feather"});
const PLAIN_TYPE = JSON.stringify({properties: ["name"], relation: "Feather"});
const PATCH_CHILD = (
    "UPDATE \"$settings\" SET data = jsonb_set(" +
    "  data::jsonb, '{FeatherProperty,properties,parent,type}', $1::jsonb" +
    ")::json WHERE name = 'catalog'"
);
const FEATHER_VIEW_COLUMN = (
    "SELECT 1 FROM information_schema.columns " +
    "WHERE table_schema = 'public' AND table_name = '_feather' " +
    "  AND column_name = 'properties'"
);

const READ_STORED_PROPERTY = (
    "SELECT data->'Feather'->'properties'->'properties' AS prop " +
    "FROM \"$settings\" WHERE name = 'catalog'"
);

describe("view propagation retracts a stale parentOf property", function () {
    let threw;
    let staleColumn;
    let staleStored;

    before(async function () {
        await db.withClient(env.testDb, async function (client) {
            client.currentDatabase = env.testDb;
            // settings.saveSettings records who made the change; the
            // repair pass runs as the install/upgrade process itself.
            client.currentUser = function () {
                return "admin";
            };

            // Cache the catalog the way a boot does, before the patch
            await settings.getSettings({
                client,
                data: {name: "catalog"}
            });

            await client.query("BEGIN");

            // Simulate an upgrade that drops childOf from the child
            // side without anything retracting the parent's stale
            // complementary parentOf property.
            await client.query(PATCH_CHILD, [PLAIN_TYPE]);

            try {
                await new Feathers().propagateViews(client);
                threw = false;
            } catch (e) {
                threw = e.message || e;
            }

            staleColumn = (
                await client.query(FEATHER_VIEW_COLUMN)
            ).rows.length;

            /*
                Fixing only the in-memory copy used for *this* view
                rebuild is not enough: a separate, already-running (or
                later-started) server process reads the catalog from
                this same row, by its own un-forced getSettings call,
                and would still find the stale property and still try
                to select it -- exactly the live "column \"lines\"
                does not exist" this produced on an actual instance
                after the view-level fix alone was deployed and the
                server restarted (John, demo, Nov 2026). So the
                correction has to be visible here too, read straight
                off the row rather than through any process's cache.
            */
            staleStored = (
                await client.query(READ_STORED_PROPERTY)
            ).rows[0].prop;

            // Restore the child's real type before rolling back, so a
            // failed propagateViews (which may have already dropped
            // and not recreated views inside its own failed
            // transaction state) does not leave this connection
            // confused about what is live.
            await client.query(PATCH_CHILD, [CHILD_TYPE]);

            await client.query("ROLLBACK");
        });
    });

    /*
        The patch is rolled back, but this process cached it on the way
        through, so put back what the database kept for whatever reads
        the catalog next.
    */
    after(async function () {
        await db.withClient(env.testDb, async function (client) {
            client.currentDatabase = env.testDb;
            await settings.getSettings({
                client,
                data: {force: true, name: "catalog"}
            });
        });
    });

    it("does not report circular dependencies", function () {
        assert.equal(threw, false);
    });

    it("drops the stale parentOf column from the parent's view", function () {
        assert.equal(staleColumn, 0);
    });

    it("persists the correction to the stored catalog row", function () {
        assert.equal(staleStored, null);
    });
});
