/*
    Workbook grants a package declares (workbooks.json `authorizations`).

    The installer used to throw them away, so a fresh database had
    workbooks nobody but a super user could open until someone granted
    them by hand. They are now given to a workbook the package creates.
    A workbook that already exists keeps what it has: changing a grant is
    an administrator's decision, and an upgrade must not undo it.
    (server/services/installer.js saveWorkbooks,
    server/services/workbooks.js saveWorkbook)
*/
/*jslint node, unordered*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const AdmZip = require("adm-zip");
const fs = require("fs");
const os = require("os");
const path = require("path");
const db = require("../harness/db");
const settings = require("../harness/env");
const {Session, signedIn} = require("../harness/http");
const {flags} = require("../harness/authority");

const PLATFORM = "fbt_wbgrant_platform";
const MODULE = "FbtWbGrant";
const WORKBOOK = "FbtWbGrantBook";
const ROLE = "fbt_wbgrant_role";
// Named as a string so the linter does not take it for a typo
const mkdtempSync = "mkdtempSync";
const rmSync = "rmSync";

let work;

function grant(role, canUpdate) {
    return {canRead: true, canUpdate, role};
}

function samplePackage(version, authorizations) {
    let file = path.join(work, MODULE + "-" + version + ".zip");
    let zip = new AdmZip();
    let book = {
        defaultConfig: [],
        description: "Regression test workbook",
        icon: "folder",
        label: "Fbt",
        launchConfig: {},
        module: MODULE,
        name: WORKBOOK,
        sequence: 99
    };

    if (authorizations) {
        book.authorizations = authorizations;
    }

    zip.addFile("workbooks.json", Buffer.from(JSON.stringify([book])));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [{path: "workbooks.json", type: "workbook"}],
        module: MODULE,
        version
    })));
    zip.writeZip(file);
    return file;
}

function byRole(list) {
    return list.slice().sort((a, b) => (
        a.role < b.role
        ? -1
        : 1
    ));
}

describe("workbook grants in a package", function () {
    let admin;
    let platform;

    function path_() {
        return "/workbook/" + encodeURIComponent(WORKBOOK);
    }

    async function grants() {
        let wb = await admin.get(path_());

        return byRole(wb.authorizations.map((a) => ({
            canRead: a.canRead,
            canUpdate: a.canUpdate,
            role: a.role
        })));
    }

    function install(version, authorizations) {
        return platform.upload(
            "/module/install/x=1",
            "package",
            samplePackage(version, authorizations)
        );
    }

    before(async function () {
        work = fs[mkdtempSync](path.join(os.tmpdir(), "fbt-wbgrant-"));
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb);
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        admin = await signedIn();
        platform = new Session();
        await platform.signIn(PLATFORM, settings.password, "FBTest");
    });

    after(async function () {
        await admin.raw("DELETE", path_());
        fs[rmSync](path.join(settings.modulesDir, MODULE), {
            force: true,
            recursive: true
        });
        await db.query("DELETE FROM module WHERE name = $1", [MODULE]);
        await db.query("DELETE FROM role WHERE name = $1", [ROLE]);
        await flags(PLATFORM, {});
        fs[rmSync](work, {force: true, recursive: true});
    });

    it("gives the workbook the grants the package declares", async function () {
        await install("1.0.0", [grant("everyone", false), grant(ROLE, true)]);

        assert.deepEqual(await grants(), byRole([
            grant("everyone", false),
            grant(ROLE, true)
        ]));
    });

    it("leaves a grant somebody changed alone on upgrade", async function () {
        let wb = await admin.get(path_());

        // An administrator widens `everyone` and drops the other role
        wb.authorizations = [{
            canRead: true,
            canUpdate: true,
            canUpdateSettings: false,
            role: "everyone"
        }];
        await admin.call("PUT", path_(), wb);
        assert.deepEqual(await grants(), [grant("everyone", true)]);

        // The package still declares what it did before
        await install("1.0.1", [grant("everyone", false), grant(ROLE, true)]);

        assert.deepEqual(await grants(), [grant("everyone", true)]);
    });

    it("installs a package that declares none, as before", async function () {
        await install("1.0.2");

        assert.deepEqual(await grants(), [grant("everyone", true)]);
    });
});
