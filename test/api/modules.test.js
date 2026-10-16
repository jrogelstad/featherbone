/*
    Packages on disk, served per database (ADR-002).

    The harness deploys the fbtest fixture to two databases on one
    server: the suite copy at 1.0.0 and a second copy, registered as a
    tenant of the first, at 1.1.0. The package's code exists only under
    test/fixtures/modules -- neither database holds a data_service row
    for it -- so these answers can only come from the server's installed
    packages, chosen by each database's own deployed version.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session, signedIn} = require("../harness/http");

describe("packages on disk", function () {
    let admin;
    let admin2;

    before(async function () {
        admin = await signedIn();

        // Its own sign-in, against the second database's URL
        let base = settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + settings.testDb2
        );
        admin2 = new Session(base);
        let signedIn2 = await admin2.signIn();
        assert.equal(
            signedIn2.status,
            200,
            "sign in to the second database: " + JSON.stringify(signedIn2.body)
        );
    });

    it("code deployed to a database is not in its data_service rows",
            async function () {
        let resp = await db.query(
            "SELECT count(*)::int AS n FROM data_service " +
            "WHERE module = 'fbtest'"
        );

        assert.equal(resp.rows[0].n, 0, "the fixture lives on disk only");
    });

    it("serves the version the first database deployed", async function () {
        let resp = await admin.post("/fbtest/version", {});

        assert.equal(resp.version, "1.0.0");
        assert.equal(resp.source, "disk");
        assert.equal(resp.database, settings.testDb);
    });

    it("serves the version the second database deployed, from the same " +
            "process and the same mounted route", async function () {
        let resp = await admin2.post("/fbtest/version", {});

        assert.equal(resp.version, "1.1.0");
        assert.equal(resp.source, "disk");
        assert.equal(resp.database, settings.testDb2);
        /*
            And the library this package declares in its own
            package.json reached its own service, with no ModuleNpm
            row anywhere (ADR-002 question 1).
        */
        assert.equal(
            resp.library,
            "function",
            "the package's declared library is loaded for it"
        );
    });

    it("keeps the two registries isolated under interleaving",
            async function () {
        let answers = await Promise.all([
            admin.post("/fbtest/version", {}),
            admin2.post("/fbtest/version", {}),
            admin.post("/fbtest/version", {}),
            admin2.post("/fbtest/version", {})
        ]);

        assert.deepEqual(
            answers.map((a) => a.version),
            ["1.0.0", "1.1.0", "1.0.0", "1.1.0"]
        );
    });

    it("still serves data from both databases", async function () {
        let one = await admin.list("Kinds", {properties: ["id"]});
        let two = await admin2.list("Kinds", {properties: ["id"]});

        assert.ok(Array.isArray(one));
        assert.ok(Array.isArray(two));
    });
});
