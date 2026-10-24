/*
    The client half of a package (ADR-002 section 2).

    `Module.script` is source code in a table that the browser
    compiles. Two of these were named in the ADR -- `Script.script` for
    the server and `Module.script` for the client -- and the server
    half already loads from installed packages. This is the other half:
    when the server holds the package for the version a database
    deployed, the module read answers with the file, so what the
    browser compiles changes only by deployment access. A module with
    no package on this server still answers from its row.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const BASE2 = settings.baseUrl.replace(
    "/" + settings.testDb,
    "/" + settings.testDb2
);

const PROPS = ["id", "name", "script", "version", "dependencies"];

function modules(session) {
    return session.raw("POST", "/data/modules", {properties: PROPS});
}

function rowScript(database, name) {
    return db.withClient(database, async function (client) {
        let resp = await client.query(
            (
                "SELECT script FROM module " +
                "WHERE name = $1 AND NOT is_deleted"
            ),
            [name]
        );

        return (
            resp.rows.length
            ? resp.rows[0].script
            : undefined
        );
    });
}

describe("a module's client script comes from its package", function () {
    let here;
    let there;

    before(async function () {
        /*
            The harness grants each user the instance it bootstraps,
            and the second database is read here too (B.7 makes the
            profile on the strength of the grant).
        */
        await db.ensureIdentity(
            settings.basicUser,
            settings.password,
            settings.testDb2
        );
        here = new Session();
        there = new Session(BASE2);

        let one = await here.signIn(settings.basicUser, settings.password);
        let two = await there.signIn(settings.basicUser, settings.password);

        assert.equal(one.status, 200, JSON.stringify(one.body));
        assert.equal(two.status, 200, JSON.stringify(two.body));
    });

    it("the row itself is empty, so the answer can only be the file",
            async function () {
        assert.equal(
            await rowScript(settings.testDb, "fbtest"),
            "",
            "the harness deploys the fixture with no script in the row"
        );
    });

    it("serves the version this database deployed", async function () {
        let resp = await modules(here);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let fixture = resp.body.find((row) => row.name === "fbtest");

        assert.ok(fixture, "the module is listed");
        assert.equal(fixture.version, "1.0.0");
        assert.match(
            String(fixture.script),
            /1\.0\.0 from disk/,
            "the package's file, not the row"
        );
    });

    it("and the other version to the other database, from the same " +
            "process", async function () {
        let resp = await modules(there);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let fixture = resp.body.find((row) => row.name === "fbtest");

        assert.equal(fixture.version, "1.1.0");
        assert.match(String(fixture.script), /1\.1\.0 from disk/);
    });

    /*
        Core is not the example of this any more: the checkout the
        server runs from is itself Core's package (`packages.js`
        `builtin`), so its client script comes from disk like any
        other's. A module nothing on this server holds a package for is
        made here instead.
    */
    it("leaves a module with no package answering from its row",
            async function () {
        const NAME = "fbtnopkg";
        const SCRIPT = "// fbtnopkg 9.9.9 from its row";

        await db.withClient(settings.testDb, (client) => client.query(
            (
                "INSERT INTO module (_pk, id, created, created_by, " +
                "  updated, updated_by, is_deleted, owner, etag, " +
                "  name, script, version" +
                ") VALUES (" +
                "  nextval('object__pk_seq'), $1, now(), 'admin', " +
                "  now(), 'admin', false, 'admin', $1, $2, $3, '9.9.9'" +
                ")"
            ),
            ["fbtnopkgrow01", NAME, SCRIPT]
        ));

        let failed;

        try {
            let resp = await modules(here);
            let found = resp.body.find((row) => row.name === NAME);
            let stored = await rowScript(settings.testDb, NAME);

            assert.ok(found, NAME + " is listed");
            assert.equal(stored, SCRIPT, "the row holds the script");
            assert.equal(
                found.script,
                SCRIPT,
                "no package on disk for it, so the row stands"
            );
        } catch (err) {
            failed = err;
        }

        await db.withClient(settings.testDb, (client) => client.query(
            "DELETE FROM module WHERE name = $1",
            [NAME]
        ));
        if (failed) {
            throw failed;
        }
    });

    it("serves Core's own script from the checkout", async function () {
        let resp = await modules(here);
        let core = resp.body.find((row) => row.name === "Core");

        assert.ok(core, "Core is listed");
        assert.ok(
            String(core.script).length > 0,
            "the checkout is Core's package, so there is a file to read"
        );
    });

    it("serves the file to a super user too", async function () {
        let admin = new Session();
        let signed = await admin.signIn(settings.adminUser, settings.password);

        assert.equal(signed.status, 200, JSON.stringify(signed.body));

        let resp = await modules(admin);

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        let fixture = resp.body.find((row) => row.name === "fbtest");

        assert.match(
            String(fixture.script),
            /1\.0\.0 from disk/,
            "a super user's browser compiles the same code as anyone's"
        );
    });

    it("changes nothing in the database", async function () {
        assert.equal(
            await rowScript(settings.testDb, "fbtest"),
            "",
            "reading is not writing"
        );
    });
});
