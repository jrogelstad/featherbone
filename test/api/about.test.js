/*
    About and the REST API reference: what an instance says it runs, and
    the OpenAPI document assembled for it, none of it without a session.
*/
/*jslint node*/
"use strict";

require("../../common/string");

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const env = require("../harness/env");
const {Session, signedIn} = require("../harness/http");

describe("about", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    it("names the framework, modules and software", async function () {
        let info = await admin.get("/about");
        let deployed = await db.query(
            "SELECT name FROM module WHERE NOT is_deleted AND name <> 'Core'"
        );
        let names = info.infrastructure.map((item) => item.name);

        assert.equal(info.name, "Featherbone");
        assert.match(info.version, /^\d+\.\d+\.\d+/);
        assert.ok(info.description.length > 20);
        assert.deepEqual(
            info.modules.map((mod) => mod.name).sort(),
            deployed.rows.map((row) => row.name).sort()
        );
        ["Node.js", "PostgreSQL", "Express", "Mithril"].forEach(
            (name) => assert.ok(names.includes(name), name)
        );
        info.infrastructure.forEach(
            (item) => assert.ok(item.version, item.name)
        );
    });

    it("serves the reference page", async function () {
        let resp = await admin.raw("GET", "/api");

        assert.equal(resp.status, 200);
        assert.match(resp.headers.get("content-type"), /text\/html/);
        assert.match(String(resp.body), /redoc\.standalone\.js/);
    });

    it("describes this instance's API", async function () {
        let doc = await admin.get("/openapi.json");
        let catalog = await db.query(
            "SELECT data FROM \"$settings\" WHERE name = 'catalog'"
        );
        let feathers = Object.keys(catalog.rows[0].data).filter(
            (key) => key !== "Object"
        );

        assert.match(doc.openapi, /^3\.0\./);
        assert.equal(doc.servers[0].url, "/" + env.testDb);
        assert.equal(doc["x-tagGroups"][0].name, "Core");
        assert.ok(doc.paths["/do/lock"].post);
        assert.ok(doc.paths["/about"].get);
        feathers.forEach(function (key) {
            let p = "/data/" + key.toSpinalCase() + "/{id}";

            assert.ok(doc.paths[p] && doc.paths[p].get, p);
            assert.ok(doc.components.schemas[key], key);
        });
    });

    it("is not reachable without a session", async function () {
        let out = new Session();

        assert.equal((await out.raw("GET", "/about")).status, 401);
        assert.equal((await out.raw("GET", "/openapi.json")).status, 401);
        assert.equal((await out.raw("GET", "/api")).status, 401);
    });
});
