/*
    The control plane (tenant plan A.1): a database records what it is
    for in "$db", the framework's own feathers say where they belong, and
    the tenant registry names the database this process was configured
    against rather than assuming it is whatever `pgDatabase` holds.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {Config} = require("../../server/config");
const {signedIn} = require("../harness/http");

const config = new Config();
const KINDS = ["controlPlane", "tenant", "both"];

describe("control plane", function () {
    let admin;
    let conf;

    before(async function () {
        admin = await signedIn();
        conf = await config.read();
    });

    describe("the \"$db\" marker", function () {
        it("records a kind this version knows and a schema version",
                async function () {
            let resp = await db.query(
                "SELECT kind, schema_version FROM \"$db\""
            );

            assert.equal(resp.rows.length, 1, "expected exactly one row");
            assert.ok(
                KINDS.includes(resp.rows[0].kind),
                "kind " + resp.rows[0].kind
            );
            assert.match(resp.rows[0].schema_version, /^\d+$/);
        });

        it("records the mode the database shows a banner for",
                async function () {
            let resp = await db.query("SELECT mode FROM \"$db\"");
            let mode = resp.rows[0].mode;

            // Null is allowed: a database installed before the mode
            // moved here falls back to the `mode` setting
            assert.ok(
                mode === null || config.modes().includes(mode),
                "mode " + mode
            );
        });

        it("reports its own mode at sign-in, not the server's",
                async function () {
            let resp = await db.query("SELECT mode FROM \"$db\"");
            let stored = resp.rows[0].mode;
            let conf = await config.read();

            assert.equal(
                (await signedIn()).user.mode,
                stored || conf.mode || "prod"
            );
        });

        it("refuses a mode it does not know", async function () {
            await assert.rejects(
                () => db.query(
                    "UPDATE \"$db\" SET mode = 'staging'"
                ),
                /violates check constraint/i
            );
        });

        it("holds one row and nothing else", async function () {
            await assert.rejects(
                () => db.query(
                    "INSERT INTO \"$db\" (kind, schema_version) " +
                    "VALUES ('tenant', '1')"
                ),
                /duplicate key|unique/i
            );
            await assert.rejects(
                () => db.query(
                    "UPDATE \"$db\" SET kind = 'something else'"
                ),
                /violates check constraint/i
            );
        });
    });

    describe("configuration", function () {
        it("defaults to the ordinary connection and both roles",
                function () {
            // The suite runs against a copy of a single database
            // install, so there is nothing to split
            assert.equal(config.serverRole(conf), "both");
            assert.equal(config.isValidRole(conf), true);
            assert.equal(
                config.controlPlane(conf).pgDatabase,
                conf.pgDatabase
            );
        });
    });

    describe("where the framework's feathers live", function () {
        it("keeps the tenant registry out of the catalog by itself",
                async function () {
            // Tenant and TenantService are declared in
            // scripts/feathers-control-plane.json, which a tenant
            // database does not install. This copy came from a "both"
            // database, so it has them -- what matters is that they are
            // ordinary feathers the catalog knows, not that they are
            // everywhere.
            let feather = await admin.get("/feather/tenant-service");

            assert.equal(feather.name, "TenantService");
            assert.deepEqual(feather.authorizations, []);
        });

        it("does not grant anyone the tenant service credentials",
                async function () {
            let resp = await db.query(
                "SELECT auth.role FROM \"$auth\" AS auth, " +
                "  \"$feather\" AS feather " +
                "WHERE feather.id IN ('tenant', 'tenant_service') " +
                "  AND feather._pk = auth.object_pk"
            );

            assert.deepEqual(resp.rows, []);
        });
    });
});
