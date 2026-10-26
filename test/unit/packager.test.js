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
const os = require("os");
const path = require("path");

// Adds the String helpers the services take for granted.
require("../../common/string");

const {Packager} = require("../../server/services/packager");

const DOWNLOADS = path.join(process.cwd(), "files", "downloads");
const UPLOADS = path.join(process.cwd(), "files", "upload");
const ICON = "fbt-packager-icon.svg";

// What a package on disk holds, against what its rows hold.
const DISK_MODULE = "// from the package\n";
const DISK_SERVICE = "// from the package: a service\n";
const ROW_SERVICE = "// from the row\n";

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
const MKTEMP = "mkdtempSync";
const RMDIR = "rmSync";
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
                when("FROM _module", [answers.module || MODULE]) ||
                when("FROM data_service", answers.services || []) ||
                when("\"$dashboard\"", layouts()) ||
                when("brandingSettings", answers.branding || []) ||
                {rows: []}
            );
        }
    };
}

function exported(answers, sub) {
    let packager = new Packager();
    let mod = answers.module || MODULE;

    return packager.package(
        clientOf(answers),
        mod.name,
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

/*
    Where the code in a package comes from (ADR-002 section 2).

    An export used to read `module.script` and the `data_service` rows.
    Since ADR-002 a deployment writes code to neither, so for every
    module the server holds a package for it read the wrong thing twice
    over: an EMPTY module.js in the zip, and service files that were
    pre-ADR-002 copies the runtime had already stopped loading. Nobody
    finds that out until they install the package somewhere else.

    The rows are still right for a module the server holds no package
    for, which is where a module that has never been repackaged lives.
*/
describe("where a package gets its code", function () {
    let root;
    let saved;

    function row(name, version, script) {
        return {
            dependencies: [],
            name,
            npm: [],
            script,
            version
        };
    }

    // A package as `install.js --package` leaves it on disk.
    function place(name, version) {
        let dir = path.join(root, name, version);

        fs[MKDIR](dir, {recursive: true});
        fs[WRITE](path.join(dir, "manifest.json"), JSON.stringify({
            files: [
                {path: "module.js", type: "module"},
                {name: "doThing", path: "do-thing.js", type: "service"}
            ],
            module: name,
            version
        }));
        fs[WRITE](path.join(dir, "module.js"), DISK_MODULE);
        fs[WRITE](path.join(dir, "do-thing.js"), DISK_SERVICE);
    }

    function codeIn(out) {
        return {
            module: String(out.entries["module.js"]),
            service: String(out.entries["do-thing.js"])
        };
    }

    before(function () {
        root = fs[MKTEMP](path.join(os.tmpdir(), "fb-packager-"));
        saved = process.env.modulesDir;
        process.env.modulesDir = root;
        fs[MKDIR](DOWNLOADS, {recursive: true});
    });

    after(function () {
        if (saved === undefined) {
            delete process.env.modulesDir;
        } else {
            process.env.modulesDir = saved;
        }
        fs[RMDIR](root, {force: true, recursive: true});
    });

    it("takes code off the disk, not the rows", async function () {
        place("Alpha", "1.0.0");

        let out = await exported({
            module: row("Alpha", "1.0.0", "// stale row"),
            services: [{name: "doThing", script: ROW_SERVICE}]
        }, {includeDashboard: false});
        let code = codeIn(out);

        assert.equal(code.module, DISK_MODULE, "module.js, not the row");
        assert.equal(code.service, DISK_SERVICE, "the service, not the row");
    });

    /*
        The shape the bug actually took: a deployment leaves the schema
        in the database and the code on disk, so the row is empty and
        reading it shipped a zip with nothing in module.js.
    */
    it("never ships an empty module.js", async function () {
        place("Beta", "2.0.0");

        let out = await exported({
            module: row("Beta", "2.0.0", "")
        }, {includeDashboard: false});

        assert.notEqual(
            String(out.entries["module.js"]),
            "",
            "an export of a deployed module used to come back empty"
        );
        assert.equal(String(out.entries["module.js"]), DISK_MODULE);
    });

    it("falls back to the rows when there is no package", async function () {
        // Gamma is never placed on disk.
        let out = await exported({
            module: row("Gamma", "3.0.0", "// from the row\n"),
            services: [{name: "doThing", script: ROW_SERVICE}]
        }, {includeDashboard: false});
        let code = codeIn(out);

        assert.equal(code.module, "// from the row\n");
        assert.equal(code.service, ROW_SERVICE);
    });

    /*
        Two databases can be on different versions of one module. The
        export belongs to the version THIS database deployed, so holding
        a newer package is not a reason to ship its code.
    */
    it("will not ship a version this database never ran", async function () {
        place("Delta", "1.0.0");

        let out = await exported({
            module: row("Delta", "0.9.0", "// from the row\n")
        }, {includeDashboard: false});

        assert.equal(String(out.entries["module.js"]), "// from the row\n");
        assert.equal(out.manifest.version, "0.9.0");
    });
});
