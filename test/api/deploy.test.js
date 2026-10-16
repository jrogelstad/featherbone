/*
    Install apart from Deploy (ADR-002 section 6).

    Install registers a package's files on this server and changes no
    database. Deploy applies one installed (module, version) to one
    database, records the version there -- which is what dispatch reads
    and what the fleet view compares against the server's packages
    (question 2) -- and holds the instance while it does it
    (question 7).

    The two acts are run through the command line here, because that is
    what they are: `--package` and `--packages` never open a database,
    and `--deploy` is the only thing that touches one.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {execFile} = require("child_process");
const db = require("../harness/db");
const settings = require("../harness/env");

const DEP_DB = (settings.testDb + "_dep").toLowerCase();

function cli(args, modulesDir) {
    return new Promise(function (resolve) {
        execFile(
            process.execPath,
            ["install.js"].concat(args),
            {
                cwd: settings.root,
                env: Object.assign({}, process.env, {
                    managerDatabase: settings.managerDb,
                    modulesDir: modulesDir || settings.modulesDir
                })
            },
            function (err, stdout, stderr) {
                resolve({
                    code: (
                        err
                        ? err.code || 1
                        : 0
                    ),
                    err,
                    out: String(stdout) + String(stderr)
                });
            }
        );
    });
}

function moduleVersion(database, name) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            (
                "SELECT version FROM module " +
                "WHERE name = $1 AND NOT is_deleted"
            ),
            [name]
        );

        return (
            resp.rows.length
            ? resp.rows[0].version
            : undefined
        );
    });
}

function maintenanceOf(database) {
    return db.withClient(settings.managerDb, async function (client) {
        let resp = await client.query(
            (
                "SELECT is_maintenance FROM tenant " +
                "WHERE pg_database = $1 AND NOT is_deleted"
            ),
            [database]
        );

        return (
            resp.rows.length
            ? resp.rows[0].is_maintenance
            : undefined
        );
    });
}

async function teardown() {
    await db.withClient(settings.managerDb, (client) => client.query(
        "DELETE FROM tenant WHERE pg_database = $1",
        [DEP_DB]
    ));
    await db.withClient("postgres", (client) => client.query(
        "DROP DATABASE IF EXISTS " + DEP_DB + " WITH (FORCE)"
    ));
}

describe("install, then deploy (ADR-002 section 6)", function () {
    before(async function () {
        await teardown();

        /*
            A database of its own to deploy into, cloned from the
            source rather than from a served instance: this process
            cannot let go of the server's connections, and a clone
            source must be quiet (D.2).
        */
        await db.withClient("postgres", (client) => client.query(
            "CREATE DATABASE " + DEP_DB + " TEMPLATE " + settings.sourceDb
        ));
        await db.withClient(DEP_DB, (client) => client.query(
            "UPDATE \"$db\" SET kind = 'instance'"
        ));
        await db.withClient(settings.managerDb, (client) => client.query(
            (
                "INSERT INTO tenant (_pk, id, created, created_by, " +
                "  updated, updated_by, is_deleted, owner, etag, name, " +
                "  is_active, is_maintenance, pg_database, " +
                "  _pg_service_tenant_service_pk, " +
                "  _organization_organization_pk) " +
                "SELECT nextval('object__pk_seq'), 'fbtdeploy001', " +
                "  now(), 'test', now(), 'test', false, 'test', " +
                "  'fbtdeploy001', 'Deploy target', true, false, $1, " +
                "  t._pg_service_tenant_service_pk, " +
                "  t._organization_organization_pk " +
                "FROM tenant t WHERE t.pg_database = $2 LIMIT 1"
            ),
            [DEP_DB, settings.testDb]
        ));
    });

    after(teardown);

    it("lists what the server holds, without a database",
            async function () {
        let resp = await cli(["--packages"]);

        assert.equal(resp.code, 0, resp.out);
        assert.match(resp.out, /fbtest 1\.0\.0/);
        assert.match(resp.out, /fbtest 1\.1\.0/);
    });

    it("installs a package and deploys nothing", async function () {
        let into = fs.mkdtempSync(path.join(os.tmpdir(), "fb-install-"));
        let before_ = await moduleVersion(DEP_DB, "fbtest");

        assert.equal(before_, undefined, "nothing deployed yet");

        let resp = await cli([
            "--package",
            path.join(settings.modulesDir, "fbtest", "1.1.0")
        ], into);

        assert.equal(resp.code, 0, resp.out);
        assert.match(resp.out, /Installed fbtest 1\.1\.0/);
        assert.match(
            resp.out,
            /Nothing is deployed yet/,
            "says so rather than leaving it to be assumed"
        );
        assert.ok(
            fs.existsSync(
                path.join(into, "fbtest", "1.1.0", "service.js")
            ),
            "the files are where the server looks"
        );
        assert.equal(
            await moduleVersion(DEP_DB, "fbtest"),
            undefined,
            "and no database carries it"
        );

        // Again, into the same place
        let twice = await cli([
            "--package",
            path.join(settings.modulesDir, "fbtest", "1.1.0")
        ], into);

        assert.notEqual(twice.code, 0, twice.out);
        assert.match(twice.out, /already installed/);
        assert.match(twice.out, /force/, "and says what would replace it");

        let forced = await cli([
            "--package",
            path.join(settings.modulesDir, "fbtest", "1.1.0"),
            "--force"
        ], into);

        assert.equal(forced.code, 0, forced.out);
        fs.rmSync(into, {recursive: true, force: true});
    });

    it("will not guess which version to deploy", async function () {
        let resp = await cli(["--deploy", "fbtest", "--instance", DEP_DB]);

        assert.notEqual(resp.code, 0);
        assert.match(resp.out, /1\.0\.0, 1\.1\.0/, "names what is there");
    });

    it("refuses a package the server does not hold", async function () {
        let resp = await cli([
            "--deploy",
            "nosuchmodule@9.9.9",
            "--instance",
            DEP_DB
        ]);

        assert.notEqual(resp.code, 0);
        assert.match(resp.out, /No package "nosuchmodule"/);
    });

    it("refuses to deploy into a database that is not there",
            async function () {
        let resp = await cli([
            "--deploy",
            "fbtest@1.0.0",
            "--instance",
            "fbtest_no_such_database"
        ]);

        assert.notEqual(resp.code, 0);
        assert.match(resp.out, /no database/i);
    });

    it("deploys, holding the instance while it does", async function () {
        let resp = await cli([
            "--deploy",
            "fbtest@1.0.0",
            "--instance",
            DEP_DB
        ]);

        assert.equal(resp.code, 0, resp.out);
        assert.match(resp.out, /Holding "/, "held for the deployment");
        assert.match(resp.out, /is open again/, "and let go afterwards");
        assert.equal(
            await moduleVersion(DEP_DB, "fbtest"),
            "1.0.0",
            "the database records what it carries"
        );
        assert.equal(
            await maintenanceOf(DEP_DB),
            false,
            "and is open at the end"
        );
    });

    it("moves a deployed module from one version to another",
            async function () {
        let resp = await cli([
            "--deploy",
            "fbtest@1.1.0",
            "--instance",
            DEP_DB
        ]);

        assert.equal(resp.code, 0, resp.out);
        assert.equal(
            await moduleVersion(DEP_DB, "fbtest"),
            "1.1.0",
            "the record follows the deployment, whether the manifest " +
            "ships a client module file (which records it while " +
            "installing) or only services (which does not)"
        );
    });

    it("leaves the served instances alone", async function () {
        assert.equal(
            await moduleVersion(settings.testDb, "fbtest"),
            "1.0.0",
            "one instance on 1.0.0"
        );
        assert.equal(
            await moduleVersion(settings.testDb2, "fbtest"),
            "1.1.0",
            "another on 1.1.0, from the same server"
        );
    });
});
