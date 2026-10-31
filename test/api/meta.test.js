/*
    Formats and notes on list rows: POST /do/meta (server/services/
    meta.js), the `meta` column every object carries, and the rules
    around it. A note, and a format for everyone, need update
    authorization; a format for oneself needs only to be able to read
    the record, since it changes nothing anyone else sees. A user
    writes and clears only their own note, and only their own private
    format. Note HTML is sanitized; ordinary saves never touch meta;
    and a meta-only change is announced as "meta", not "update", so a
    list does not overwrite a row someone is editing.
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
            assert.equal(resp.body.format.cells.code.length, 1);
            assert.deepEqual(
                Object.keys(resp.body.format.cells.code[0]).sort(),
                [
                    "at", "background", "bold", "by", "color", "where",
                    "who"
                ]
            );
            assert.equal(resp.body.format.cells.code[0].by, editor.name);
            // An omitted who means what it meant before there was one
            assert.equal(resp.body.format.cells.code[0].who, "all");
            assert.equal(resp.body.format.cells.code[0].where, "*");

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
            assert.equal(resp.body.format.row[0].underline, true);
            assert.equal(resp.body.format.row[0].by, editor2.name);
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

    /*
        Who a format is for and where it applies (the spec in
        docs/list-format-scopes-spec.md). One entry per who and place,
        and per author for a private one, so nobody's colour sits on
        top of anyone else's.
    */
    describe("who and where a format applies", function () {
        let rec;
        const HERE = "sheet:fbtsheet1";
        const THERE = "sheet:fbtsheet2";

        before(async function () {
            rec = await newRec();
        });

        function fmt(session, body) {
            return meta(session, Object.assign({
                id: rec.id,
                action: "format",
                target: "cell",
                attr: "code"
            }, body));
        }

        function slots(body) {
            return body.format.cells.code.map(
                (one) => [one.who, one.where, one.by]
            ).sort();
        }

        it("keeps an entry per who, place and author", async function () {
            let expected;
            let resp = await fmt(editorS, {
                format: {background: "red"},
                who: "all"
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));

            resp = await fmt(editor2S, {
                format: {bold: true},
                who: "mine",
                where: HERE
            });
            assert.equal(resp.status, 200);

            resp = await fmt(editorS, {
                format: {italic: true},
                who: "mine",
                where: HERE
            });
            assert.equal(resp.status, 200);

            resp = await fmt(editorS, {
                format: {underline: true},
                who: "mine",
                where: "*"
            });
            assert.equal(resp.status, 200);

            expected = [
                ["all", "*", editor.name],
                ["mine", "*", editor.name],
                ["mine", HERE, editor.name],
                ["mine", HERE, editor2.name]
            ];
            assert.deepEqual(slots(resp.body), expected.sort());
        });

        it("replaces only its own entry", async function () {
            let resp = await fmt(editorS, {
                format: {background: "blue"},
                who: "mine",
                where: HERE
            });
            let mine;

            assert.equal(resp.status, 200);
            assert.equal(resp.body.format.cells.code.length, 4);

            mine = resp.body.format.cells.code.find(
                (one) => one.who === "mine" && one.where === HERE &&
                one.by === editor.name
            );
            assert.equal(mine.background, "blue");
            assert.equal(mine.italic, undefined, "replaced, not merged");

            // And the other author's entry for the same place is intact
            assert.equal(
                resp.body.format.cells.code.find(
                    (one) => one.by === editor2.name
                ).bold,
                true
            );
        });

        it("clears only its own entry", async function () {
            let expected;
            let resp = await meta(editorS, {
                id: rec.id,
                action: "clearFormat",
                target: "cell",
                attr: "code",
                who: "mine",
                where: HERE
            });

            assert.equal(resp.status, 200);
            expected = [
                ["all", "*", editor.name],
                ["mine", "*", editor.name],
                ["mine", HERE, editor2.name]
            ];
            assert.deepEqual(slots(resp.body), expected.sort());
        });

        it("tells one place from another", async function () {
            let resp = await fmt(editorS, {
                format: {bold: true},
                who: "all",
                where: THERE
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body.format.cells.code.length, 4);
            assert.ok(resp.body.format.cells.code.some(
                (one) => one.who === "all" && one.where === THERE
            ));
        });

        it("refuses an unknown who or a bad place", async function () {
            let resp = await fmt(editorS, {
                format: {bold: true},
                who: "everybody"
            });

            assert.equal(resp.status, 400);
            assert.match(String(resp.body), /Unknown who/);

            resp = await fmt(editorS, {
                format: {bold: true},
                who: "all",
                where: "sheet:'; drop table object; --"
            });
            assert.equal(resp.status, 400);
            assert.match(String(resp.body), /Invalid place/);
        });

        /*
            A record formatted before formats had a who and a where
            carries one object, which meant everyone, everywhere. It is
            read as that entry rather than migrated.
        */
        it("takes an entry beside an old format", async function () {
            let old = await newRec();
            let expected;
            let resp;

            await db.query(
                "UPDATE object SET meta = $2 WHERE id = $1",
                [old.id, JSON.stringify({
                    format: {
                        row: {
                            at: "2026-10-01T00:00:00.000Z",
                            background: "yellow",
                            by: editor2.name
                        }
                    }
                })]
            );

            resp = await meta(editorS, {
                id: old.id,
                action: "format",
                target: "row",
                format: {bold: true},
                who: "mine",
                where: HERE
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            expected = [
                ["all", "*", editor2.name],
                ["mine", HERE, editor.name]
            ];
            assert.deepEqual(resp.body.format.row.map(
                (one) => [one.who, one.where, one.by]
            ).sort(), expected.sort());
            assert.equal(
                resp.body.format.row.find(
                    (one) => one.who === "all"
                ).background,
                "yellow",
                "the old format keeps its colour"
            );
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

            // A format for everyone changes what everyone reads
            resp = await meta(readerS, {
                id: rec.id,
                action: "format",
                target: "row",
                format: {bold: true},
                who: "all"
            });
            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Not authorized to update/);
            assert.equal((await stored(rec.id)).meta, null);
        });

        /*
            A format for oneself is a view preference, so seeing the
            record is enough for one: a reader who could not mark up
            their own view of a list would be the worse answer (John,
            Oct 2026).
        */
        it("lets that user format for themselves", async function () {
            let resp = await meta(readerS, {
                id: rec.id,
                action: "format",
                target: "row",
                format: {bold: true},
                who: "mine"
            });

            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.deepEqual(resp.body.format.row.map(
                (one) => [one.who, one.by, one.bold]
            ), [["mine", reader.name, true]]);

            resp = await meta(readerS, {
                id: rec.id,
                action: "clearFormat",
                target: "row",
                who: "mine"
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.body, null);
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
