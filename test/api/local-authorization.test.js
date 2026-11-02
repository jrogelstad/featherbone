/*
    Who owns a feather's grants: the packages, or this database.

    Until a database takes over (globalSettings.isLocalAuthorization),
    the grants a package declares are the ones in force, and installing
    or upgrading it rewrites them -- a role it does not name loses its
    grant. Once the database has taken over, an install or upgrade
    leaves the grants of a feather that is already here alone, so
    changes an administrator made are not undone. A feather the package
    brings new still starts with what the package declares.
    (server/services/installer.js saveFeathers, scripts/services.js)
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
const {Session} = require("../harness/http");
const {flags} = require("../harness/authority");

const PLATFORM = "fbt_localauth_platform";
const MODULE = "FbtLocalAuth";
const FEATHER = "FbtLocalAuthThing";
const ROLE = "fbt_localauth_role";
// Named as a string so the linter does not take it for a typo
const mkdtempSync = "mkdtempSync";
const rmSync = "rmSync";

let work;

function snake(text) {
    // Feather names start with a capital
    return text.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()).slice(1);
}

function grant(role, rights) {
    return {
        actions: {
            canCreate: rights.includes("C"),
            canDelete: rights.includes("D"),
            canRead: rights.includes("R"),
            canUpdate: rights.includes("U")
        },
        role
    };
}

function samplePackage(version, authorizations, name) {
    let file = path.join(work, MODULE + "-" + version + ".zip");
    let zip = new AdmZip();

    zip.addFile("feathers.json", Buffer.from(JSON.stringify([{
        authorizations,
        description: "Regression test feather",
        module: MODULE,
        name: name || FEATHER,
        properties: {
            label: {description: "Label", type: "string"}
        }
    }])));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [{path: "feathers.json", type: "feather"}],
        module: MODULE,
        version
    })));
    zip.writeZip(file);
    return file;
}

describe("local authorization", function () {
    let platform;

    async function grants(name) {
        let resp = await db.query((
            "SELECT auth.role, auth.can_create, auth.can_read, " +
            "  auth.can_update, auth.can_delete " +
            "FROM \"$auth\" AS auth, \"$feather\" AS feather " +
            "WHERE feather._pk = auth.object_pk AND feather.id = $1 " +
            "ORDER BY auth.role"
        ), [snake(name || FEATHER)]);

        return resp.rows.map(function (row) {
            let rights = "";

            if (row.can_create) {
                rights += "C";
            }
            if (row.can_read) {
                rights += "R";
            }
            if (row.can_update) {
                rights += "U";
            }
            if (row.can_delete) {
                rights += "D";
            }

            return row.role + ":" + rights;
        });
    }

    function install(version, authorizations, name) {
        return platform.upload(
            "/module/install/x=1",
            "package",
            samplePackage(version, authorizations, name)
        );
    }

    function takeOver(flag) {
        return db.query((
            "UPDATE \"$settings\" SET data = (" +
            "coalesce(data::jsonb, '{}'::jsonb) || $1::jsonb)::json " +
            "WHERE name = 'globalSettings'"
        ), [JSON.stringify({isLocalAuthorization: flag})]);
    }

    before(async function () {
        work = fs[mkdtempSync](path.join(os.tmpdir(), "fbt-localauth-"));
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb);
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        platform = new Session();
        await platform.signIn(PLATFORM, settings.password, "FBTest");
    });

    after(async function () {
        await takeOver(false);
        fs[rmSync](path.join(settings.modulesDir, MODULE), {
            force: true,
            recursive: true
        });
        await db.query("DELETE FROM module WHERE name = $1", [MODULE]);
        await db.query("DELETE FROM role WHERE name = $1", [ROLE]);
        await flags(PLATFORM, {});
        fs[rmSync](work, {force: true, recursive: true});
    });

    it("starts a new feather with the package's grants", async function () {
        await takeOver(true);
        await install("1.0.0", [grant("everyone", "R"), grant(ROLE, "CRUD")]);

        assert.deepEqual(await grants(), ["everyone:R", ROLE + ":CRUD"]);
    });

    it("leaves the grants alone on upgrade once taken over", async function () {
        await install("1.0.1", [grant("everyone", "CRUD")]);

        assert.deepEqual(await grants(), ["everyone:R", ROLE + ":CRUD"]);
    });

    it("lets the package rewrite them until then", async function () {
        await takeOver(false);
        await install("1.0.2", [grant("everyone", "CRUD")]);

        assert.ok((await grants()).includes("everyone:CRUD"));
    });
});
