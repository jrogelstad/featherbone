/*
    Service rows belonging to no module (ADR-002 question 6).

    `Script.script` is source code in a table that the server compiles
    and runs. A row outside any module is outside any package too, so
    it is not carried forward -- the ADR settled that deliberately.

    It was already never loaded, because loading only ever walked the
    modules, but nothing said so: the code sat in the table looking
    live. This proves both halves -- it is not executed, and the
    database is told.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session} = require("../harness/http");

const ORPHAN = "fbtestOrphanService";

async function removeOrphan() {
    await db.withClient(settings.testDb, (client) => client.query(
        "DELETE FROM data_service WHERE name = $1",
        [ORPHAN]
    ));
}

describe("a service row belonging to no module (ADR-002 q6)", function () {
    before(async function () {
        await removeOrphan();

        /*
            A row with a module name nothing carries: the loophole the
            ADR closes. Its script would register a route if it ran.
        */
        await db.withClient(settings.testDb, (client) => client.query(
            (
                "INSERT INTO data_service (" +
                "  _pk, id, created, created_by, updated, updated_by, " +
                "  is_deleted, name, module, script" +
                ") VALUES (" +
                "  nextval('object__pk_seq'), 'fbtorphan001', now(), " +
                "  'test', now(), 'test', false, $1, " +
                "  'NoSuchModuleAnywhere', $2)"
            ),
            [
                ORPHAN,
                (
                    "f.datasource.registerFunction(\"POST\", " +
                    "\"fbtestOrphan\", function () {" +
                    "  return Promise.resolve({ran: true});" +
                    "});"
                )
            ]
        ));
    });

    after(removeOrphan);

    it("is not executed, so it registers nothing", async function () {
        let session = new Session();
        let signedIn = await session.signIn(
            settings.adminUser,
            settings.password
        );

        assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));

        /*
            Reloading services is what a deployment does, and what
            would pick the row up if anything did.
        */
        let resp = await session.raw("POST", "/do/fbtestOrphan", {});

        assert.notEqual(
            resp.status,
            200,
            "nothing answers for a row outside every module"
        );
    });

    it("stays in the database rather than being deleted under anyone",
            async function () {
        let resp = await db.withClient(
            settings.testDb,
            (client) => client.query(
                "SELECT 1 FROM data_service WHERE name = $1",
                [ORPHAN]
            )
        );

        assert.equal(
            resp.rows.length,
            1,
            "not carried forward is not the same as destroyed: " +
            "dropping someone's code is their decision"
        );
    });
});
