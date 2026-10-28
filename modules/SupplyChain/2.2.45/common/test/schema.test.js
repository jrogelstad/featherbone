/*
    The package's part of the database schema (ADR-003): the tables its
    feathers create with their columns and triggers, the views over them,
    and their indexes. Compared with golden files in ./golden. Core's own
    schema goldens hold Core alone.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {db, golden} = require("featherbone-test");
const {carried, toSnake} = require("./package");

const {matchGolden} = golden.at(__dirname);
const KEEP_ALL = {drop: new Set()};

describe("schema (SupplyChain)", function () {
    let tables;

    before(function () {
        tables = new Set(carried().feathers.map(toSnake));
    });

    it("tables, parents, columns and triggers", async function () {
        let parents = await db.query(
            "SELECT c.relname AS t, p.relname AS parent " +
            "FROM pg_inherits i " +
            "JOIN pg_class c ON c.oid = i.inhrelid " +
            "JOIN pg_class p ON p.oid = i.inhparent " +
            "JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' ORDER BY 1, i.inhseqno"
        );
        let cols = await db.query(
            "SELECT c.relname AS t, a.attname AS col, " +
            "  format_type(a.atttypid, a.atttypmod) AS type, " +
            "  a.attnotnull AS notnull, " +
            "  pg_get_expr(d.adbin, d.adrelid) AS def " +
            "FROM pg_class c " +
            "JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "JOIN pg_attribute a ON a.attrelid = c.oid " +
            "LEFT JOIN pg_attrdef d ON d.adrelid = c.oid " +
            "  AND d.adnum = a.attnum " +
            "WHERE n.nspname = 'public' AND c.relkind = 'r' " +
            "  AND a.attnum > 0 AND NOT a.attisdropped AND a.attislocal"
        );
        let trg = await db.query(
            "SELECT tgrelid::regclass::text AS t, " +
            "  pg_get_triggerdef(oid) AS def " +
            "FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2"
        );
        let out = {};

        tables.forEach(function (t) {
            out[t] = {columns: {}, inherits: [], triggers: []};
        });
        parents.rows.filter((r) => out[r.t]).forEach(function (r) {
            out[r.t].inherits.push(r.parent);
        });
        cols.rows.filter((r) => out[r.t]).forEach(function (r) {
            out[r.t].columns[r.col] = r.type + (
                r.notnull
                ? " not null"
                : ""
            ) + (
                r.def
                ? " default " + r.def
                : ""
            );
        });
        trg.rows.forEach(function (r) {
            let t = r.t.replace(/^public\./, "").replace(/"/g, "");

            if (out[t]) {
                out[t].triggers.push(r.def);
            }
        });
        assert.ok(Object.keys(out).length > 50);
        matchGolden("schema-tables", out, KEEP_ALL);
    });

    // Compared in name order: CREATE OR REPLACE VIEW can only append
    // columns, so an upgraded database has the same columns in another
    // order than a fresh install.
    it("views and their columns", async function () {
        let resp = await db.query(
            "SELECT c.relname AS v, " +
            "  string_agg(a.attname || ' ' || " +
            "    format_type(a.atttypid, a.atttypmod), ', ' " +
            "    ORDER BY a.attname) AS cols " +
            "FROM pg_class c " +
            "JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "JOIN pg_attribute a ON a.attrelid = c.oid " +
            "WHERE n.nspname = 'public' AND c.relkind = 'v' " +
            "  AND a.attnum > 0 AND NOT a.attisdropped " +
            "GROUP BY c.relname"
        );
        let out = {};

        resp.rows.forEach(function (r) {
            if (tables.has(r.v.slice(1).split("$")[0])) {
                out[r.v] = r.cols;
            }
        });
        matchGolden("schema-views", out, KEEP_ALL);
    });

    it("indexes", async function () {
        let resp = await db.query(
            "SELECT tablename AS t, indexname AS i, indexdef AS def " +
            "FROM pg_indexes WHERE schemaname = 'public'"
        );
        let out = {};

        resp.rows.forEach(function (r) {
            if (tables.has(r.t)) {
                out[r.i] = r.def;
            }
        });
        assert.ok(Object.keys(out).length > 100);
        matchGolden("schema-indexes", out, KEEP_ALL);
    });
});
