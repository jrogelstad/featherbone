/*
    SQL-level integrity of the cloned database (what the installer and
    feathers service build from the catalog): money-format columns are
    type mono, every feather table inherits object and has its _<table>
    view and insert/update/delete triggers; plus golden snapshots of
    tables/columns/types, views, indexes and functions so schema drift
    during the refactor is caught. Todos track missing relation indexes
    (plan 3.1) and missing unique natural-key indexes (plan 2.6).

    Feathers created by other test files after the run started are left
    out, so the snapshot only covers the installed schema.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {matchGolden} = require("../harness/golden");
const {runStarted} = require("./lib/data-api");

const KEEP_ALL = {drop: new Set()};

// Formats stored as the mono composite (tools.js formats.money and the
// SupplyChain common/money-formats.js data service)
const MONEY_FORMATS = new Set(["money", "unitCost", "salesPrice",
        "purchasePrice"]);

function toSnake(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

describe("database schema", function () {
    let catalog;
    let feathers; // installed feather names, excluding Object
    let tables; // table -> {parents, columns: {name: type}}
    let skipTables; // tables of feathers created during this run

    before(async function () {
        let started = await runStarted();
        let resp = await db.query(
            "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
        );
        catalog = resp.rows[0].data;

        resp = await db.query(
            "SELECT id FROM \"$feather\" WHERE created >= $1",
            [started]
        );
        skipTables = new Set(resp.rows.map((r) => r.id));
        feathers = Object.keys(catalog).filter(
            (name) => name !== "Object" && !skipTables.has(toSnake(name))
        ).sort();

        resp = await db.query(
            "SELECT c.relname AS t, a.attname AS col, " +
            "  format_type(a.atttypid, a.atttypmod) AS type " +
            "FROM pg_class c " +
            "JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "JOIN pg_attribute a ON a.attrelid = c.oid " +
            "WHERE n.nspname = 'public' AND c.relkind = 'r' " +
            "  AND a.attnum > 0 AND NOT a.attisdropped"
        );
        tables = {};
        resp.rows.forEach(function (r) {
            if (!tables[r.t]) {
                tables[r.t] = {parents: [], columns: {}};
            }
            tables[r.t].columns[r.col] = r.type;
        });

        resp = await db.query(
            "SELECT c.relname AS t, p.relname AS parent " +
            "FROM pg_inherits i " +
            "JOIN pg_class c ON c.oid = i.inhrelid " +
            "JOIN pg_class p ON p.oid = i.inhparent " +
            "JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' ORDER BY i.inhseqno"
        );
        resp.rows.forEach(function (r) {
            if (tables[r.t]) {
                tables[r.t].parents.push(r.parent);
            }
        });
    });

    function ancestors(table) {
        let out = [];
        let queue = (tables[table] || {parents: []}).parents.slice();
        while (queue.length) {
            let t = queue.shift();
            if (!out.includes(t)) {
                out.push(t);
                queue = queue.concat((tables[t] || {parents: []}).parents);
            }
        }
        return out;
    }

    describe("feather tables", function () {
        it("has a table for every feather", function () {
            let missing = feathers.filter((name) => !tables[toSnake(name)]);
            assert.deepEqual(missing, []);
        });

        it("inherits every feather table from object via its parent",
                function () {
            let problems = [];
            feathers.forEach(function (name) {
                let table = toSnake(name);
                let parent = toSnake(catalog[name].inherits || "Object");
                if (!tables[table]) {
                    return;
                }
                if (!tables[table].parents.includes(parent)) {
                    problems.push(
                        table + " parents " +
                        JSON.stringify(tables[table].parents) +
                        ", expected " + parent
                    );
                }
                if (!ancestors(table).includes("object")) {
                    problems.push(table + " does not inherit object");
                }
            });
            assert.deepEqual(problems, []);
        });

        it("stores every money-format property as mono", function () {
            let problems = [];
            let checked = 0;
            feathers.forEach(function (name) {
                let table = toSnake(name);
                let props = catalog[name].properties || {};
                Object.keys(props).forEach(function (key) {
                    if (!MONEY_FORMATS.has(props[key].format)) {
                        return;
                    }
                    let col = toSnake(key);
                    let type = (tables[table] || {columns: {}}).columns[col];
                    checked += 1;
                    if (type !== "mono") {
                        problems.push(table + "." + col + " is " + type);
                    }
                });
            });
            assert.ok(checked > 50, "found " + checked + " money properties");
            assert.deepEqual(problems, []);
        });

        it("has a column for every stored property", function () {
            let problems = [];
            feathers.forEach(function (name) {
                let table = toSnake(name);
                let props = catalog[name].properties || {};
                let cols = (tables[table] || {columns: {}}).columns;
                Object.keys(props).forEach(function (key) {
                    let t = props[key].type;
                    let col = toSnake(key);
                    if (t && typeof t === "object") {
                        if (t.parentOf) {
                            return; // child array, stored on the child
                        }
                        col = "_" + col + "_" + toSnake(t.relation) + "_pk";
                    }
                    if (!cols[col]) {
                        problems.push(table + "." + col);
                    }
                });
            });
            assert.deepEqual(problems, []);
        });

        it("has a _<table> view for every feather", async function () {
            let resp = await db.query(
                "SELECT viewname FROM pg_views WHERE schemaname = 'public'"
            );
            let views = new Set(resp.rows.map((r) => r.viewname));
            let missing = feathers.map(toSnake).filter(
                (t) => !views.has("_" + t)
            );
            assert.deepEqual(missing, []);
        });

        it("has insert, update and delete triggers on every feather table",
                async function () {
            let resp = await db.query(
                "SELECT tgrelid::regclass::text AS t, tgname, " +
                "  p.proname AS fn " +
                "FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid " +
                "WHERE NOT tgisinternal"
            );
            let have = new Set(
                resp.rows.map((r) => r.t + " " + r.tgname + " " + r.fn)
            );
            let missing = [];
            feathers.map(toSnake).forEach(function (t) {
                ["insert", "update", "delete"].forEach(function (op) {
                    let want = t + " " + t + "_" + op + "_trigger " +
                            op + "_trigger";
                    if (!have.has(want)) {
                        missing.push(want);
                    }
                });
            });
            assert.deepEqual(missing, []);
        });
    });

    describe("indexes", function () {
        let indexed; // "table.column" that lead some index
        let unique; // "table.column" with a single-column unique index

        before(async function () {
            let resp = await db.query(
                "SELECT c.relname AS t, a.attname AS col, i.indisunique, " +
                "  i.indnatts " +
                "FROM pg_index i " +
                "JOIN pg_class c ON c.oid = i.indrelid " +
                "JOIN pg_namespace n ON n.oid = c.relnamespace " +
                "JOIN pg_attribute a ON a.attrelid = c.oid " +
                "  AND a.attnum = i.indkey[0] " +
                "WHERE n.nspname = 'public'"
            );
            indexed = new Set(resp.rows.map((r) => r.t + "." + r.col));
            unique = new Set(resp.rows.filter(
                (r) => r.indisunique && r.indnatts === 1
            ).map((r) => r.t + "." + r.col));
        });

        it("indexes the primary and surrogate keys of every table",
                function () {
            let missing = [];
            Object.keys(tables).forEach(function (t) {
                if (skipTables.has(t) || t.startsWith("$")) {
                    return;
                }
                if (!unique.has(t + "._pk")) {
                    missing.push(t + "._pk");
                }
                if (tables[t].columns.id && !unique.has(t + ".id")) {
                    missing.push(t + ".id");
                }
            });
            assert.deepEqual(missing, []);
        });

        it("indexes every relation column", {
            todo: "plan 3.1: relation columns (_<prop>_<table>_pk) have no " +
                    "index, so joins and child lookups scan"
        }, function () {
            let missing = [];
            Object.keys(tables).sort().forEach(function (t) {
                if (skipTables.has(t)) {
                    return;
                }
                Object.keys(tables[t].columns).forEach(function (col) {
                    if (
                        /^_.+_pk$/.test(col) &&
                        !indexed.has(t + "." + col)
                    ) {
                        missing.push(t + "." + col);
                    }
                });
            });
            assert.deepEqual(missing, []);
        });

        it("enforces every natural key with a unique index", {
            todo: "plan 2.6: natural keys are only checked by crud.js, " +
                    "never by a unique index"
        }, function () {
            let missing = [];
            feathers.forEach(function (name) {
                let props = catalog[name].properties || {};
                Object.keys(props).forEach(function (key) {
                    if (!props[key].isNaturalKey) {
                        return;
                    }
                    let target = toSnake(name) + "." + toSnake(key);
                    if (!unique.has(target)) {
                        missing.push(target);
                    }
                });
            });
            assert.deepEqual(missing, []);
        });
    });

    describe("golden snapshots", function () {
        it("tables, parents, columns and triggers", async function () {
            let resp = await db.query(
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
            let out = {};
            Object.keys(tables).forEach(function (t) {
                if (skipTables.has(t)) {
                    return;
                }
                out[t] = {
                    inherits: tables[t].parents,
                    columns: {},
                    triggers: []
                };
            });
            resp.rows.forEach(function (r) {
                if (!out[r.t]) {
                    return;
                }
                out[r.t].columns[r.col] = (
                    r.type +
                    (
                        r.notnull
                        ? " not null"
                        : ""
                    ) + (
                        r.def
                        ? " default " + r.def
                        : ""
                    )
                );
            });
            resp = await db.query(
                "SELECT tgrelid::regclass::text AS t, " +
                "  pg_get_triggerdef(oid) AS def " +
                "FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2"
            );
            resp.rows.forEach(function (r) {
                let t = r.t.replace(/^public\./, "").replace(/"/g, "");
                if (out[t]) {
                    out[t].triggers.push(r.def);
                }
            });
            assert.ok(Object.keys(out).length > 150);
            matchGolden("schema-tables", out, KEEP_ALL);
        });

        it("views and their columns", async function () {
            let resp = await db.query(
                "SELECT c.relname AS v, " +
                "  string_agg(a.attname || ' ' || " +
                "    format_type(a.atttypid, a.atttypmod), ', ' " +
                "    ORDER BY a.attnum) AS cols " +
                "FROM pg_class c " +
                "JOIN pg_namespace n ON n.oid = c.relnamespace " +
                "JOIN pg_attribute a ON a.attrelid = c.oid " +
                "WHERE n.nspname = 'public' AND c.relkind = 'v' " +
                "  AND a.attnum > 0 AND NOT a.attisdropped " +
                "GROUP BY c.relname"
            );
            let out = {};
            resp.rows.forEach(function (r) {
                let base = r.v.slice(1).split("$")[0];
                if (!skipTables.has(base)) {
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
                if (!skipTables.has(r.t)) {
                    out[r.i] = r.def;
                }
            });
            matchGolden("schema-indexes", out, KEEP_ALL);
        });

        it("functions and composite types", async function () {
            let resp = await db.query(
                "SELECT p.proname || '(' || " +
                "  pg_get_function_identity_arguments(p.oid) || ')' AS sig, " +
                "  pg_get_functiondef(p.oid) AS def " +
                "FROM pg_proc p " +
                "JOIN pg_namespace n ON n.oid = p.pronamespace " +
                "WHERE n.nspname = 'public' AND NOT EXISTS (" +
                "  SELECT 1 FROM pg_depend d " +
                "  WHERE d.objid = p.oid AND d.deptype = 'e')"
            );
            let functions = {};
            resp.rows.forEach((r) => (functions[r.sig] = r.def));

            resp = await db.query(
                "SELECT t.typname AS type, string_agg(a.attname || ' ' || " +
                "  format_type(a.atttypid, a.atttypmod), ', ' " +
                "  ORDER BY a.attnum) AS cols " +
                "FROM pg_type t " +
                "JOIN pg_namespace n ON n.oid = t.typnamespace " +
                "JOIN pg_class c ON c.oid = t.typrelid AND c.relkind = 'c' " +
                "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 " +
                "WHERE n.nspname = 'public' GROUP BY t.typname"
            );
            let types = {};
            resp.rows.forEach((r) => (types[r.type] = r.cols));
            assert.equal(
                types.mono,
                "amount numeric, currency text, effective " +
                "timestamp with time zone, base_amount numeric"
            );
            matchGolden("schema-routines", {functions, types}, KEEP_ALL);
        });
    });
});
