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
