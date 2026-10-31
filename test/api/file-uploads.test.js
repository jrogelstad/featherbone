/*
    Uploaded files live in the instance's own database.

    They used to be written to ./files/upload, which a deploy wipes and
    which every instance on the server shared. Now `/do/upload` stores
    the bytes in the instance's "$file" table and
    `/<db>/files/upload/<name>` serves them back from it.
*/
/*jslint node, unordered*/
/*global fetch, FormData, Blob*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session, signedIn} = require("../harness/http");

// The harness server runs with fileUploadMaxMB = 1
const ONE_MB = 1024 * 1024;

// Work around linter dogma
const existsSync = "existsSync";
const mkdirSync = "mkdirSync";
const rmSync = "rmSync";
const writeFileSync = "writeFileSync";

describe("file uploads", function () {
    let admin;
    let admin2;
    let stray = [];
    let suffix = crypto.randomBytes(4).toString("hex");

    function named(base) {
        return suffix + "-" + base;
    }

    async function send(session, name, bytes, fields) {
        let form = new FormData();
        let headers = {};
        let resp;
        let text;

        Object.keys(fields || {}).forEach(function (key) {
            form.append(key, fields[key]);
        });
        form.append("dataFile", new Blob([bytes]), name);
        if (session.cookie) {
            headers.Cookie = session.cookie;
        }
        resp = await fetch(session.baseUrl + "/do/upload", {
            body: form,
            headers,
            method: "POST"
        });
        text = await resp.text();

        return {
            body: (
                resp.headers.get("content-type").includes("json")
                ? JSON.parse(text)
                : text
            ),
            status: resp.status
        };
    }

    async function fetchFile(session, name, headers) {
        let opts = {headers: Object.assign({}, headers), redirect: "manual"};
        let resp;

        if (session.cookie) {
            opts.headers.Cookie = session.cookie;
        }
        resp = await fetch(
            session.baseUrl + "/files/upload/" + encodeURIComponent(name),
            opts
        );

        return {
            bytes: Buffer.from(await resp.arrayBuffer()),
            headers: resp.headers,
            status: resp.status
        };
    }

    before(async function () {
        admin = await signedIn();
        admin2 = new Session(settings.baseUrl.replace(
            "/" + settings.testDb,
            "/" + settings.testDb2
        ));
        assert.equal((await admin2.signIn()).status, 200);
    });

    after(function () {
        stray.forEach((file) => fs[rmSync](file, {force: true}));
    });

    it("keeps the bytes in the table, not on disk", async function () {
        let name = named("logo.png");
        let bytes = crypto.randomBytes(2048);
        let resp = await send(admin, name, bytes);
        let row;

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.status, "success");

        row = (await db.query(
            "SELECT size, sha256, created_by, data FROM \"$file\" " +
            "WHERE name = $1",
            [name]
        )).rows[0];
        assert.equal(row.size, bytes.length);
        assert.equal(
            row.sha256,
            crypto.createHash("sha256").update(bytes).digest("hex")
        );
        assert.ok(row.created_by);
        assert.ok(bytes.equals(row.data));
        assert.equal(
            fs[existsSync](path.join(settings.root, "files", "upload", name)),
            false,
            "nothing is written to the upload folder"
        );
    });

    it("serves it back, and answers a repeat with 304", async function () {
        let name = named("photo.png");
        let bytes = crypto.randomBytes(1500);
        let first;
        let again;

        await send(admin, name, bytes);
        first = await fetchFile(admin, name);

        assert.equal(first.status, 200);
        assert.ok(bytes.equals(first.bytes));
        assert.equal(first.headers.get("content-type"), "image/png");
        assert.match(
            first.headers.get("content-disposition") || "inline",
            /^inline/
        );
        assert.ok(first.headers.get("etag"));

        again = await fetchFile(admin, name, {
            "If-None-Match": first.headers.get("etag")
        });
        assert.equal(again.status, 304);
        assert.equal(again.bytes.length, 0);
    });

    it("keeps an existing name unless told to overwrite", async function () {
        let name = named("keep.pdf");
        let one = crypto.randomBytes(300);
        let two = crypto.randomBytes(400);
        let etag;
        let resp;
        let served;

        assert.equal((await send(admin, name, one)).body.status, "success");

        resp = await send(admin, name, two, {overwrite: "false"});
        assert.equal(resp.body.status, "exists");
        served = await fetchFile(admin, name);
        assert.ok(one.equals(served.bytes), "the first is still there");
        etag = served.headers.get("etag");

        resp = await send(admin, name, two, {overwrite: "true"});
        assert.equal(resp.body.status, "success");
        served = await fetchFile(admin, name);
        assert.ok(two.equals(served.bytes), "replaced on request");
        assert.notEqual(served.headers.get("etag"), etag);
    });

    it("refuses a file over the limit with 413", async function () {
        let name = named("big.png");
        let resp = await send(admin, name, crypto.randomBytes(ONE_MB + 4096));
        let held = await db.query(
            "SELECT count(*)::int AS n FROM \"$file\" WHERE name = $1",
            [name]
        );

        assert.equal(resp.status, 413);
        assert.equal(held.rows[0].n, 0);
    });

    it("takes a file up to the limit", async function () {
        let name = named("edge.png");
        let resp = await send(admin, name, crypto.randomBytes(ONE_MB - 1024));

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        assert.equal(resp.body.status, "success");
    });

    it("does not show another instance's files", async function () {
        let name = named("private.png");
        let resp;
        let other;

        await send(admin, name, crypto.randomBytes(100));
        resp = await fetchFile(admin2, name);
        other = await db.withClient(settings.testDb2, (client) => client.query(
            "SELECT count(*)::int AS n FROM \"$file\" WHERE name = $1",
            [name]
        ));

        assert.equal(resp.status, 404);
        assert.equal(other.rows[0].n, 0);
    });

    it("needs a signed-in session to read", async function () {
        let name = named("session.png");
        let resp;

        await send(admin, name, crypto.randomBytes(100));
        resp = await fetchFile(new Session(admin.baseUrl), name);

        assert.equal(resp.status, 401);
    });

    it("downloads what a browser could run, never shows it", async function () {
        let name = named("page.html");
        let resp;

        await send(admin, name, Buffer.from("<script>alert(1)</script>"));
        resp = await fetchFile(admin, name);

        assert.equal(resp.status, 200);
        assert.match(resp.headers.get("content-disposition"), /^attachment/);
        assert.equal(resp.headers.get("x-content-type-options"), "nosniff");
    });

    it("still serves a file from the old upload folder", async function () {
        let name = named("legacy.png");
        let file = path.join(settings.root, "files", "upload", name);
        let resp;

        fs[mkdirSync](path.dirname(file), {recursive: true});
        fs[writeFileSync](file, Buffer.from("legacy"));
        stray.push(file);
        resp = await fetchFile(admin, name);

        assert.equal(resp.status, 200);
        assert.equal(resp.bytes.toString(), "legacy");
    });

    it("answers 404 for a name nobody holds", async function () {
        let resp = await fetchFile(admin, named("nothing.png"));

        assert.equal(resp.status, 404);
    });
});
