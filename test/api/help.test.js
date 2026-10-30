/*
    Help that travels with its module (ADR-003): which page answers for a
    form or a feather, the files themselves, the customer's own
    supplement, and that none of it is reachable without a session.

    The old mechanism -- a help record a form or worksheet pointed at --
    is gone, so what is claimed here is that nothing has to be configured
    for help to open, and that a path from a browser cannot leave the
    module's help folder.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const {uniq} = require("../harness/fixtures");

const MARK = uniq("FBTHELP");

describe("help", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    after(async function () {
        await db.query(
            "DELETE FROM help_link WHERE label LIKE $1",
            [MARK + "%"]
        );
    });

    describe("the window", function () {
        it("serves one page, which asks for its own topic", async function () {
            let resp = await admin.raw("GET", "/help");

            assert.equal(resp.status, 200);
            assert.match(resp.headers.get("content-type"), /text\/html/);
            assert.match(String(resp.body), /help-window\.js/);
        });

        it("is not reachable without a session", async function () {
            let out = new Session();

            assert.equal((await out.raw("GET", "/help")).status, 401);
            assert.equal((await out.raw("GET", "/help-topic")).status, 401);
            assert.equal(
                (await out.raw("GET", "/help/Core/worksheets.md")).status,
                401
            );
        });
    });

    describe("which page answers", function () {
        it("answers for a form from its own module", async function () {
            let topic = await admin.get("/help-topic?form=Module");

            assert.equal(topic.module, "Core");
            assert.equal(topic.path, "developing.md");
        });

        it("answers for a feather when the form has none", async function () {
            let topic = await admin.get("/help-topic?feather=Workbook");

            assert.equal(topic.module, "Core");
            assert.equal(topic.path, "workbooks.md");
        });

        /*
            The point of keying by form: one feather, two forms, and the
            form's own entry wins over the feather's.
        */
        it("prefers the form's page to the feather's", async function () {
            let byForm = await admin.get("/help-topic?form=Print Form");
            let byFeather = await admin.get("/help-topic?feather=Form");

            assert.equal(byForm.path, "print-forms.md");
            assert.equal(byFeather.path, "developing.md");
        });

        it("takes the feather from the form", async function () {
            let topic = await admin.get("/help-topic?form=Currency");

            // Currency has no page of its own; the generic one answers
            assert.equal(topic.module, "Core");
            assert.equal(topic.path, "worksheets.md");
        });

        it("always answers, with or without a topic", async function () {
            let nothing = await admin.get("/help-topic");
            let unknown = await admin.get("/help-topic?form=No Such Form");

            assert.equal(nothing.path, "worksheets.md");
            assert.equal(unknown.path, "worksheets.md");
        });

        it("names the module's contents, in reading order", async function () {
            let topic = await admin.get("/help-topic?feather=Workbook");
            let paths = topic.pages.map((page) => page.path);

            assert.ok(paths.includes("workbooks.md"), paths.join());
            assert.ok(paths.includes("glossary.md"), paths.join());
            assert.ok(
                paths.indexOf("workbooks.md") < paths.indexOf("glossary.md"),
                "the contents are in the order help.json names them"
            );
        });
    });

    /*
        How workbooks, filters and settings work is not about any one
        worksheet, so it has to be readable without being on the page
        it is about (John, Oct 2026). The window's contents is that way
        in, and the app's own Help opens it there.
    */
    describe("the contents of everything", function () {
        it("lists each module with help, framework first", async function () {
            let shelves = await admin.get("/help-contents");

            assert.ok(shelves.length > 0);
            assert.equal(shelves[0].module, "Core");
            assert.ok(
                shelves[0].pages.some((page) => page.path === "workbooks.md"),
                "the generic pages are there to be found"
            );
        });

        it("names only deployed modules", async function () {
            let shelves = await admin.get("/help-contents");
            let rows = await db.query(
                "SELECT name FROM module WHERE NOT is_deleted"
            );
            let held = new Set(rows.rows.map((row) => row.name));

            shelves.forEach(function (shelf) {
                assert.ok(held.has(shelf.module), shelf.module);
                assert.ok(shelf.pages.length, shelf.module + " has pages");
            });
        });

        it("is not reachable without a session", async function () {
            let out = new Session();

            assert.equal((await out.raw("GET", "/help-contents")).status, 401);
        });
    });

    describe("the files", function () {
        it("serves a page of the deployed version", async function () {
            let resp = await admin.raw("GET", "/help/Core/worksheets.md");

            assert.equal(resp.status, 200);
            assert.match(resp.headers.get("content-type"), /text\/markdown/);
            assert.match(String(resp.body), /^# Worksheets/);
        });

        it("refuses a path that leaves the help folder", async function () {
            let out = [
                "/help/Core/..%2fpackage.json",
                "/help/Core/../package.json",
                "/help/Core/%2e%2e%2fmanifest.json"
            ];
            let i = 0;

            while (i < out.length) {
                let resp = await admin.raw("GET", out[i]);

                i += 1;
                assert.ok(
                    resp.status >= 400,
                    out[i - 1] + " -> " + resp.status
                );
                assert.ok(
                    !String(resp.body).includes("\"dependencies\""),
                    "served something outside the help folder"
                );
            }
        });

        it("refuses a file that is not help", async function () {
            let resp = await admin.raw("GET", "/help/Core/help.json");
            let other = await admin.raw("GET", "/help/Core/server.js");

            // help.json is the index the server reads, not a page
            assert.equal(resp.status, 404);
            assert.equal(other.status, 404);
        });

        it("refuses a module not deployed here", async function () {
            let resp = await admin.raw("GET", "/help/NoSuchModule/a.md");

            assert.equal(resp.status, 404);
        });

        it("refuses a page the module does not carry", async function () {
            let resp = await admin.raw("GET", "/help/Core/no-such-page.md");

            assert.equal(resp.status, 404);
        });
    });

    /*
        A customer's own help is a help link that belongs to no module,
        naming the form it supplements. A deploy writes only links that
        belong to a module, so a deploy cannot touch it, and it is read
        when help opens rather than copied into a configuration.
    */
    describe("the customer's own help", function () {
        /*
            displayValue is the natural key, and the client is what fills
            it in (client/models/resource-link.js), so a record made over
            the API carries its own.
        */
        function link(form, module) {
            let label = MARK + "-" + form + "-" + (module || "mine");

            return admin.create("HelpLink", {
                displayValue: label,
                form,
                label,
                module,
                resource: "https://example.com/" + (module || "mine")
            });
        }

        it("comes back with the topic for that form", async function () {
            let mine = await link("Module");
            let topic = await admin.get("/help-topic?form=Module");

            assert.equal(topic.supplement.label, mine.label);
            assert.equal(topic.supplement.resource, mine.resource);
            // The standard page is still the standard page
            assert.equal(topic.path, "developing.md");
        });

        it("is not read for another form", async function () {
            let topic = await admin.get("/help-topic?form=Route");

            assert.equal(topic.supplement, null);
        });

        it("ignores a link that belongs to a module", async function () {
            await link("Route", "Core");

            let topic = await admin.get("/help-topic?form=Route");

            assert.equal(topic.supplement, null);
        });
    });
});
