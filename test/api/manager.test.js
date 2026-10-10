/*
    One mode, one shape (tenant plan section 9). Every installation has a
    manager database holding the registry, the identities and the
    sessions, and one or more instances registered in it. A database says
    which it is in "$db", and the server refuses to start against the
    wrong one.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {Config} = require("../../server/config");
const {signedIn} = require("../harness/http");
const settings = require("../harness/env");

const config = new Config();
const KINDS = ["manager", "instance"];

describe("the manager", function () {
    let admin;
    let conf;

    before(async function () {
        admin = await signedIn();
        conf = await config.read();
    });

    describe("the \"$db\" marker", function () {
        it("says this is an instance, at a schema this version knows",
                async function () {
            let resp = await db.query(
                "SELECT kind, schema_version FROM \"$db\""
            );

            assert.equal(resp.rows.length, 1, "expected exactly one row");
            assert.equal(resp.rows[0].kind, "instance");
            assert.ok(KINDS.includes(resp.rows[0].kind));
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

            assert.equal(
                (await signedIn()).user.mode,
                stored || conf.mode || "prod"
            );
        });

        it("refuses a kind or a mode it does not know", async function () {
            await assert.rejects(
                () => db.query("UPDATE \"$db\" SET mode = 'staging'"),
                /violates check constraint/i
            );
            await assert.rejects(
                () => db.query("UPDATE \"$db\" SET kind = 'both'"),
                /violates check constraint/i
            );
        });

        it("holds one row and nothing else", async function () {
            await assert.rejects(
                () => db.query(
                    "INSERT INTO \"$db\" (kind, schema_version) " +
                    "VALUES ('instance', '2')"
                ),
                /duplicate key|unique/i
            );
        });
    });

    describe("configuration", function () {
        it("names a manager database and nothing else", function () {
            // This process reads server/config.json; the server under
            // test gets its own manager through the environment, so the
            // names need not match
            assert.equal(typeof config.managerDatabase(conf), "string");
            assert.ok(config.managerDatabase(conf).length > 0);
            // Retired with the single-mode collapse
            assert.equal(conf.serverRole, undefined);
            assert.equal(conf.controlPlane, undefined);
        });
    });

    describe("where the manager's feathers live", function () {
        it("keeps the registry an ordinary feather the catalog knows",
                async function () {
            // Tenant and TenantService are declared in
            // scripts/feathers-manager.json, which an instance does not
            // install. This copy came from a combined database, so it
            // has them -- what matters is that they are ordinary
            // feathers, not that they are everywhere.
            let feather = await admin.get("/feather/tenant-service");

            assert.equal(feather.name, "TenantService");
            assert.deepEqual(feather.authorizations, []);
        });

        it("does not grant anyone the service credentials",
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

    describe("the registry", function () {
        it("lists the instance under test, and the manager is not in it",
                async function () {
            let resp = await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    "SELECT pg_database FROM tenant WHERE NOT is_deleted"
                )
            );
            let names = resp.rows.map((r) => r.pg_database);

            assert.ok(
                names.includes(settings.testDb),
                "expected " + settings.testDb + " in " + names.join(", ")
            );
            assert.equal(names.includes(settings.managerDb), false);
        });

        it("keeps sessions in the manager, not in the instance",
                async function () {
            // The copy carries whatever sessions the source database
            // happened to hold, so start from nothing
            await db.query("DELETE FROM \"$session\"");
            await signedIn();

            let here = await db.query("SELECT count(*)::int AS n FROM \"$session\"");
            let there = await db.withClient(
                settings.managerDb,
                (client) => client.query(
                    "SELECT count(*)::int AS n FROM \"$session\""
                )
            );

            assert.equal(here.rows[0].n, 0, "instance should hold none");
            assert.ok(there.rows[0].n > 0, "manager should hold them");
        });
    });
});
