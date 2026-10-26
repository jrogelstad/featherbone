/*
    Exporting a module as a zip (server/services/packager.js).

    The service wants a database client, so these hand it one that
    answers from canned rows -- by looking at the SQL rather than by
    counting the queries, so adding a query somewhere else in the
    service does not quietly shift what this test is answering.

    What the zip ends up holding is the point: a package that comes
    back short is only discovered when somebody installs it somewhere
    else and finds a piece missing.
*/
/*jslint node*/
"use strict";

const {after, before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");

// Adds the String helpers the services take for granted.
require("../../common/string");

const {Packager} = require("../../server/services/packager");

const DOWNLOADS = path.join(process.cwd(), "files", "downloads");
const UPLOADS = path.join(process.cwd(), "files", "upload");
const ICON = "fbt-packager-icon.svg";

// The one module row addModule reads the manifest from.
const MODULE = {
    dependencies: [],
    name: "Fbt",
    npm: [],
    script: "// nothing",
    version: "1.0.0"
};

// jslint objects to fs.mkdirSync and friends by name; the services in
// this repo index fs the same way for the same reason.
const MKDIR = "mkdirSync";
const UNLINK = "unlinkSync";
const WRITE = "writeFileSync";

let made = [];

/*
    Answers the queries the export makes. Everything it is not asked
    about comes back empty, which is what an instance holding nothing
    but a module would answer anyway.
*/
function clientOf(answers) {
    return {
        query: function (sql, params) {
            let text = String(sql);
            let asked = params || [];

            function when(fragment, rows) {
                return (
                    text.includes(fragment)
                    ? {rows}
                    : null
                );
            }

            /*
                The layouts a given WHERE clause would actually return,
                so a query that asks only for its own module's layouts
                gets only those -- which is the bug this is here to
                catch, not something to paper over.
            */
            function layouts() {
                let rows = answers.dashboards || [];
                let unowned = text.includes("module = '' AND");

                return rows.filter(function (row) {
                    if (row.module === asked[0]) {
                        return true;
                    }
                    return unowned && !row.module && asked[1] !== false;
                });
            }

            return Promise.resolve(
                when("FROM _module", [MODULE]) ||
                when("\"$dashboard\"", layouts()) ||
                when("brandingSettings", answers.branding || []) ||
                {rows: []}
            );
        }
    };
}

function exported(answers, sub) {
    let packager = new Packager();

    return packager.package(
        clientOf(answers),
        "Fbt",
        "admin",
        sub
    ).then(function (filename) {
        let zip = new AdmZip(path.join(DOWNLOADS, filename));
        let entries = {};

        made.push(path.join(DOWNLOADS, filename));
        zip.getEntries().forEach(function (entry) {
            entries[entry.entryName] = entry.getData();
        });
        return {
            entries,
            manifest: JSON.parse(String(entries["manifest.json"])),
            names: Object.keys(entries)
        };
    });
}

describe("packaging a module", function () {
    before(function () {
        fs[MKDIR](DOWNLOADS, {recursive: true});
        fs[MKDIR](UPLOADS, {recursive: true});
        fs[WRITE](path.join(UPLOADS, ICON), "<svg/>");
    });

    after(function () {
        made.forEach(function (one) {
            try {
                fs[UNLINK](one);
            } catch (ignore) {
                return;
            }
        });
        try {
            fs[UNLINK](path.join(UPLOADS, ICON));
        } catch (ignore) {
            return;
        }
    });

    /*
        Save Layout records no module, so every layout somebody builds
        on the Home tab has a blank one. Selecting only layouts whose
        module matches meant an export carried none of them, while
        carrying the wallpaper that goes with them (John, Oct 2026).
    */
    it("carries the layouts nobody assigned a module", async function () {
        let out = await exported({
            dashboards: [{
                config: {tiles: []},
                description: "",
                is_default: true,
                label: "Overview",
                module: "",
                name: "Overview",
                sequence: 0
            }]
        });
        let layouts = JSON.parse(String(out.entries["dashboards.json"]));

        assert.ok(
            out.names.includes("dashboards.json"),
            "in the zip: " + out.names.join(" ")
        );
        assert.equal(layouts.length, 1);
        assert.equal(
            layouts[0].module,
            "Fbt",
            "stamped with the module that is carrying it"
        );
        assert.ok(
            out.manifest.files.some(function (one) {
                return one.type === "dashboard";
            }),
            "and named in the manifest"
        );
    });

    it("leaves the layouts out when they are not wanted", async function () {
        let out = await exported({
            dashboards: [{
                config: {tiles: []},
                description: "",
                is_default: false,
                label: "Overview",
                module: "",
                name: "Overview",
                sequence: 0
            }]
        }, {includeDashboard: false});

        assert.ok(
            !out.names.includes("dashboards.json"),
            "in the zip: " + out.names.join(" ")
        );
    });

    /*
        The app's own icon travels with every export, the way its title
        does: it says which application this is, which is not part of
        "the dashboard board" the checkbox is about.
    */
    it("carries the app's icon and title", async function () {
        let out = await exported({
            branding: [{data: {icon: ICON, title: "Fbt Shop"}}]
        }, {includeDashboard: false});

        assert.equal(out.manifest.title, "Fbt Shop");
        assert.ok(
            out.names.includes("icon.svg"),
            "in the zip: " + out.names.join(" ")
        );
        assert.equal(String(out.entries["icon.svg"]), "<svg/>");
    });

    it("says nothing about an icon that is not there", async function () {
        let out = await exported({
            branding: [{data: {icon: "fbt-missing.png", title: "Fbt Shop"}}]
        }, {includeDashboard: false});

        assert.ok(
            !out.names.some(function (one) {
                return one.startsWith("icon.");
            }),
            "in the zip: " + out.names.join(" ")
        );
    });
});
