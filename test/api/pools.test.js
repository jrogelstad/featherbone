/*
    One connection pool per database, for the whole process.

    A dozen services each do `new Database()`, and the pools used to
    live inside that call. Two consequences, both of which this file
    holds down:

    * the connection budget the README documents was wrong by the
      number of services -- `instances x (pgTenantPoolSize + 1)` counts
      one pool per instance, and there were as many as there are
      services;
    * "give up this database" could not work. Releasing a tenant before
      a template copy or a drop (tenant plan D.3) ended only the pool
      of whichever service asked, and every other service's idle
      connections kept the database busy. Reading an instance through
      one service and then building a template from it through another
      failed with "has 1 other session(s)" -- which is how this was
      found, in a run where a group deployment read the module table
      just before the template suite ran.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");
const {Database} = require("../../server/database");

const TPL_DB = (settings.testDb + "_pooltpl").toLowerCase();

function flags(username, data) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE identity SET is_org_admin = $2, " +
            "  is_platform_admin = $3 WHERE lower(username) = lower($1)"
        ),
        [
            username,
            data.isOrgAdmin === true,
            data.isPlatformAdmin === true
        ]
    ));
}

function instanceId(database) {
    return db.withClient(settings.managerDb, async function (client) {
        let resp = await client.query(
            "SELECT id FROM tenant WHERE pg_database = $1 AND NOT is_deleted",
            [database]
        );

        return resp.rows[0].id;
    });
}

function sessionsOn(database) {
    return db.withClient("postgres", async function (client) {
        let resp = await client.query(
            (
                "SELECT count(*)::int AS n FROM pg_stat_activity " +
                "WHERE datname = $1"
            ),
            [database]
        );

        return resp.rows[0].n;
    });
}

async function dropTemplate() {
    await db.withClient("postgres", async function (client) {
        await client.query(
            "ALTER DATABASE " + TPL_DB + " IS_TEMPLATE false"
        ).catch(function () {
            return;
        });
        await client.query(
            "DROP DATABASE IF EXISTS " + TPL_DB + " WITH (FORCE)"
        );
    });
}

describe("one pool per database", function () {
    let admin;

    before(async function () {
        await dropTemplate();
        await flags(settings.adminUser, {
            isOrgAdmin: true,
            isPlatformAdmin: true
        });
        admin = new Session();

        let resp = await admin.signIn(
            settings.adminUser,
            settings.password
        );

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
    });

    after(async function () {
        await dropTemplate();
        await flags(settings.adminUser, {});
    });

    it("gives two services the same pool", async function () {
        let one = new Database();
        let other = new Database();
        let tenant = {
            pgDatabase: "fbtest_pool_check",
            pgService: {
                pgHost: settings.pgHost,
                pgPassword: settings.pgPassword,
                pgPort: settings.pgPort,
                pgUser: settings.pgUser
            }
        };

        assert.equal(
            one.hasPool(tenant),
            false,
            "nothing has connected to it yet"
        );

        await one.getPool(tenant);

        assert.equal(
            other.hasPool(tenant),
            true,
            "the pool one service opened is the pool the next finds"
        );

        await other.endPool(tenant);

        assert.equal(
            one.hasPool(tenant),
            false,
            "and ending it ends it for both"
        );
    });

    it("lets go of an instance a deployment has touched",
            async function () {
        /*
            A deployment reads and writes the instance through the
            installer's own services, which is where the second pool
            came from. Then a template copy asks for the database to
            itself. Before the pools were shared, the installer's idle
            connection was still there and the copy refused -- which is
            how this was found: a group deployment ran just before the
            template suite.
        */
        let deployed = await admin.raw("POST", "/admin/instance/deploy", {
            id: await instanceId(settings.testDb2),
            module: "fbtest",
            version: "1.1.0"
        });

        assert.equal(deployed.status, 200, JSON.stringify(deployed.body));
        assert.ok(
            await sessionsOn(settings.testDb2) > 0,
            "the deployment left pooled connections behind, as pools do"
        );

        let built = await admin.raw("POST", "/admin/template", {
            name: TPL_DB,
            source: settings.testDb2
        });

        assert.equal(
            built.status,
            200,
            "the copy needs the database to itself, and gets it: " +
            JSON.stringify(built.body)
        );
        assert.equal(built.body.template, TPL_DB);
    });
});
