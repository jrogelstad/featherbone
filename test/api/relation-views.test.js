/*
    Relation views (`_<feather>$<property>`) read the related table, not
    its full view (item 4.2). Postgres expands every view a view names
    before it drops unused columns, so reading a full view cost a form
    load hundreds of milliseconds of planning.

    Rebuilds every view in the test copy, as an upgrade would.
*/
/*jslint node*/
"use strict";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");

require("../../common/string.js");
require("../../common/core");
const {Feathers} = require("../../server/services/feathers");

const VIEWS = (
    "SELECT c.relname AS v FROM pg_class c " +
    "JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'public' AND c.relkind = 'v' " +
    "AND c.relname ~ '^_[a-z0-9_]+\\$[a-z0-9_]+$' ORDER BY 1"
);

// Every relation view's rows, as one hash each
async function contents(client) {
    let views = (await client.query(VIEWS)).rows.map((r) => r.v);
    let out = {};
    let at = 0;

    while (at < views.length) {
        out[views[at]] = (await client.query(
            "SELECT md5(coalesce(string_agg(to_json(x)::text, '|' " +
            "ORDER BY x._pk), '')) AS h FROM " +
            "\"" + views[at] + "\" x"
        )).rows[0].h;
        at += 1;
    }
    return out;
}

describe("relation views (item 4.2)", function () {
    let earlier;
    let after;

    before(async function () {
        await db.withClient(settings.testDb, async function (client) {
            client.currentDatabase = settings.testDb;
            earlier = await contents(client);
            await client.query("BEGIN");
            await new Feathers().propagateViews(client);
            await client.query("COMMIT");
            after = await contents(client);
        });
    });

    it("read tables, never a full view", async function () {
        let resp = await db.query(
            "SELECT DISTINCT v.relname AS v, d.relname AS reads " +
            "FROM pg_class v " +
            "JOIN pg_rewrite rw ON rw.ev_class = v.oid " +
            "JOIN pg_depend dp ON dp.objid = rw.oid " +
            "  AND dp.classid = 'pg_rewrite'::regclass " +
            "  AND dp.refclassid = 'pg_class'::regclass " +
            "JOIN pg_class d ON d.oid = dp.refobjid AND d.oid <> v.oid " +
            "WHERE v.relkind = 'v' AND d.relkind = 'v' " +
            "  AND v.relname ~ '^_[a-z0-9_]+\\$[a-z0-9_]+$' " +
            "  AND d.relname !~ '\\$' " +
            "ORDER BY 1"
        );

        assert.deepEqual(
            resp.rows.map((r) => r.v + " reads " + r.reads),
            []
        );
    });

    it("answer exactly what they did before the rebuild", function () {
        assert.deepEqual(Object.keys(after), Object.keys(earlier));
        assert.deepEqual(
            Object.keys(after).filter((v) => after[v] !== earlier[v]),
            []
        );
    });
});
