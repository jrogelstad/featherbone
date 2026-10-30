/*
    Formats and notes on list rows: POST /do/meta (server/services/
    meta.js), the `meta` column every object carries, and the rules
    around it. Writing needs update authorization; a user writes and
    clears only their own note; note HTML is sanitized; ordinary saves
    never touch meta; and a meta-only change is announced as "meta",
    not "update", so a list does not overwrite a row someone is editing.
*/
/*jslint node, unordered*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {signedIn} = require("../harness/http");
const access = require("./lib/access");

describe("list formats and notes (meta)", function () {
    let admin;
    let editorRole;
    let editor;
    let editor2;
    let reader;
    let editorS;
    let editor2S;
    let readerS;
    let fthr;

    function meta(session, body) {
        return session.raw("POST", "/do/meta", body);
    }

    async function stored(id) {
        let resp = await db.query(
            "SELECT meta, updated, updated_by FROM object WHERE id = $1",
            [id]
        );
        return resp.rows[0];
    }

    function newRec(code) {
        return admin.create(fthr.name, {code: code || access.uniq("M")});
    }

    before(async function () {
        admin = await signedIn();
        editorRole = access.track(access.uniq("fbt_editor"));
        await admin.create("Role", {name: editorRole, membership: []});

        editor = await access.createUser(admin);
        editor2 = await access.createUser(admin);
        reader = await access.createUser(admin);
        await admin.patch("UserAccount", editor.id, [{
            op: "add",
            path: "/membership/1",
            value: {role: editorRole}
        }]);
        await admin.patch("UserAccount", editor2.id, [{
            op: "add",
            path: "/membership/1",
            value: {role: editorRole}
        }]);

        let name = access.featherName("FbtMeta");
        fthr = await access.createFeather(admin, {
            name,
            plural: name + "s",
            properties: [
                {name: "code", type: "string", description: "Code"},
                {name: "note", type: "string", description: "Note"}
            ],
            authorizations: [{
                role: "everyone",
                canCreate: false,
                canRead: true,
                canUpdate: false,
                canDelete: false
            }, {
                role: editorRole,
                canCreate: true,
                canRead: true,
                canUpdate: true,
                canDelete: false
            }]
        });

        editorS = await signedIn(editor.name, editor.password);
        editor2S = await signedIn(editor2.name, editor2.password);
        readerS = await signedIn(reader.name, reader.password);
    });

    after(async function () {
        await access.deleteFeather(admin, fthr);
        await access.dropAll();
    });

    it("is inherited by every feather, empty at first", async function () {
        let feather = await admin.feather(fthr.name);
        let rec = await newRec();

        assert.equal(feather.properties.meta.isReadOnly, true);
        assert.equal(feather.properties.meta.isAlwaysLoad, true);
        assert.equal((await admin.read(fthr.name, rec.id)).meta, null);
    });

    describe("formats", function () {
        let rec;

        before(async function () {
            rec = await newRec();
        });

        it("formats a cell without an updated stamp", async function () {
            let was = await stored(rec.id);
            let resp = await meta(editorS, {
                id: rec.id,
                action: "format",
                target: "cell",
                attr: "code",
                format: {
                    background: "#ff0000",
                    color: "yellow",
                    bold: true,
                    italic: false,
                    junk: "x"
                }
            });
            let now;

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.deepEqual(
                Object.keys(resp.body.format.cells.code).sort(),
                ["at", "background", "bold", "by", "color"]
            );
            assert.equal(resp.body.format.cells.code.by, editor.name);

            now = await stored(rec.id);
            assert.deepEqual(now.meta, resp.body);
            assert.equal(String(now.updated), String(was.updated));
            assert.equal(now.updated_by, was.updated_by);
            assert.deepEqual(
                (await admin.read(fthr.name, rec.id)).meta,
                resp.body
            );
        });

        it("sets and clears a row format", async function () {
            let resp = await meta(editor2S, {
                id: rec.id,
                action: "format",
                target: "row",
                format: {underline: true}
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body.format.row.underline, true);
            assert.equal(resp.body.format.row.by, editor2.name);
            assert.ok(resp.body.format.cells.code, "cell format kept");

            resp = await meta(editorS, {
                id: rec.id,
                action: "clearFormat",
                target: "row"
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.body.format.row, undefined);
        });

        it("drops the format once nothing is set", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "format",
                target: "cell",
                attr: "code",
                format: {bold: false}
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body, null);
            assert.equal((await stored(rec.id)).meta, null);
        });

        it("refuses a color that is not hex or a swatch", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "format",
                target: "row",
                format: {background: "red;background:url(x)"}
            });

            assert.equal(resp.status, 400);
            assert.match(String(resp.body), /Invalid color/);
        });
    });

    describe("notes", function () {
        let rec;

        before(async function () {
            rec = await newRec();
        });

        it("saves a note with dangerous markup removed", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: (
                    "<p onclick=\"steal()\">Call <b>Bob</b>" +
                    "<script>steal()</script> " +
                    "<a href=\"javascript:steal()\">x</a> " +
                    "<a href=\"https://example.com\">site</a></p>" +
                    "<img src=x onerror=steal()>"
                )
            });
            let note;

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            note = resp.body.notes.code[0];
            assert.equal(note.by, editor.name);
            assert.ok(note.id && note.at);
            assert.doesNotMatch(
                note.html,
                /script|onclick|onerror|<img|javascript/
            );
            assert.match(note.html, /<b>Bob<\/b>/);
            assert.ok(note.html.includes(
                "<a href=\"https://example.com\" target=\"_blank\" " +
                "rel=\"noopener noreferrer\">site</a>"
            ), note.html);
        });

        it("keeps each user's note apart", async function () {
            let resp = await meta(editor2S, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "<p>Second opinion</p>"
            });

            assert.equal(resp.status, 200);
            assert.deepEqual(
                resp.body.notes.code.map((n) => n.by),
                [editor.name, editor2.name]
            );
        });

        it("edits only the caller's own note", async function () {
            let first = (await stored(rec.id)).meta.notes.code[0];
            let resp = await meta(editor2S, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "<p>Revised</p>"
            });
            let notes = resp.body.notes.code;

            assert.equal(notes.length, 2);
            assert.deepEqual(notes[0], first, "the other user's untouched");
            assert.equal(notes[1].html, "<p>Revised</p>");
            assert.ok(notes[1].updated, "edit stamped");
        });

        it("clears only the caller's own note", async function () {
            let resp = await meta(editor2S, {
                id: rec.id,
                action: "clearNote",
                attr: "code"
            });

            assert.equal(resp.status, 200);
            assert.deepEqual(
                resp.body.notes.code.map((n) => n.by),
                [editor.name]
            );

            // Nothing of theirs left, so nothing changes
            resp = await meta(editor2S, {
                id: rec.id,
                action: "clearNote",
                attr: "code"
            });
            assert.equal(resp.body.notes.code.length, 1);
        });

        it("takes a note with no text as cleared", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "<p><br></p><script>x()</script>"
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body, null);
        });

        it("accepts an inherited property as the column", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "createdBy",
                html: "ok"
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body.notes.createdBy[0].html, "ok");
        });
    });

    describe("authorization and validation", function () {
        let rec;

        before(async function () {
            rec = await newRec();
        });

        it("refuses a user who may read but not update", async function () {
            let resp = await meta(readerS, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "nope"
            });

            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Not authorized to update/);

            resp = await meta(readerS, {
                id: rec.id,
                action: "format",
                target: "row",
                format: {bold: true}
            });
            assert.equal(resp.status, 401);
            assert.equal((await stored(rec.id)).meta, null);
        });

        it("refuses unknown actions, columns and records", async function () {
            let resp = await meta(editorS, {
                id: rec.id,
                action: "erase"
            });
            assert.equal(resp.status, 400);

            resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "nosuch",
                html: "x"
            });
            assert.equal(resp.status, 400);
            assert.match(String(resp.body), /has no property "nosuch"/);

            resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "code;drop",
                html: "x"
            });
            assert.equal(resp.status, 400);

            resp = await meta(editorS, {
                id: "nosuchid",
                action: "note",
                attr: "code",
                html: "x"
            });
            assert.equal(resp.status, 404);
        });

        it("writes past another user's lock", async function () {
            let resp = await admin.raw("POST", "/do/lock", {
                id: rec.id,
                eventKey: "ek-meta"
            });
            let lock;

            assert.equal(resp.status, 200);
            resp = await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "while locked"
            });
            assert.equal(resp.status, 200);

            lock = await db.query(
                "SELECT (lock).username FROM object WHERE id = $1",
                [rec.id]
            );
            assert.equal(lock.rows[0].username, settings.adminUser);
            await admin.raw("POST", "/do/unlock", {id: rec.id});
        });
    });

    describe("ordinary saves", function () {
        let rec;

        before(async function () {
            rec = await newRec();
            await meta(editorS, {
                id: rec.id,
                action: "note",
                attr: "code",
                html: "keep me"
            });
        });

        it("ignore meta in a patch, keeping it", async function () {
            let resp = await editorS.raw(
                "PATCH",
                "/data/" + access.toSpinal(fthr.name) + "/" + rec.id,
                [{
                    op: "replace",
                    path: "/meta",
                    value: {notes: {}}
                }, {
                    op: "replace",
                    path: "/note",
                    value: "changed"
                }]
            );
            let row = await admin.read(fthr.name, rec.id);

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.equal(row.note, "changed");
            assert.equal(row.meta.notes.code[0].html, "keep me");
        });

        it("leave meta off a new record", async function () {
            let made = await admin.create(fthr.name, {
                code: access.uniq("C"),
                meta: {notes: {code: [{html: "copied", by: "x"}]}}
            });

            assert.equal((await stored(made.id)).meta, null);
        });
    });

    describe("change events", function () {
        it("call a meta-only change meta, not update", async function () {
            let rec = await newRec();
            let node = access.uniq("fbtnode");
            let seen = [];

            await db.withClient(settings.testDb, async function (client) {
                client.on("notification", function (msg) {
                    seen.push(JSON.parse(msg.payload));
                });
                await client.query("LISTEN " + node);
                await client.query(
                    "INSERT INTO \"$subscription\" VALUES ($1, $2, $3, $4)",
                    [node, "ek", "sub", rec.id]
                );

                await meta(editorS, {
                    id: rec.id,
                    action: "format",
                    target: "row",
                    format: {bold: true}
                });
                await admin.patch(fthr.name, rec.id, [{
                    op: "replace",
                    path: "/note",
                    value: "edited"
                }]);
                await access.poll(() => seen.length >= 2, 5000);
                await client.query(
                    "DELETE FROM \"$subscription\" WHERE nodeid = $1",
                    [node]
                );
            });

            assert.deepEqual(
                seen.map((s) => s.subscription.change),
                ["meta", "update"]
            );
            assert.deepEqual(Object.keys(seen[0].data).sort(), ["id", "table"]);
        });
    });
});
