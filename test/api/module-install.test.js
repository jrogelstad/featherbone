/*
    The Modules page's Install button (POST /:db/module/install).

    It used to unpack the zip into a temporary folder, write the
    module's code into the database's rows and delete the folder, so
    the server never held the package: the code that ran was a table
    row. It now does what the Admin Console does in two steps -- Install
    the package on this server, Deploy it into this database -- as one
    action, and by the same rules: a platform administrator, and the
    version recorded as deployed.
    (server.js doInstall, server/services/admin.js installAndDeploy)
*/
/*jslint node*/
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

const PLATFORM = "fbt_webinst_platform";
const PLAIN = "fbt_webinst_plain";
const MODULE = "FbtWebInstall";

let work;

function flags(username, data) {
    return db.withClient(settings.managerDb, (client) => client.query(
        (
            "UPDATE identity SET is_org_admin = $2, " +
            "  is_platform_admin = $3, updated = now(), " +
            "  updated_by = 'fbtest' " +
            "WHERE lower(username) = lower($1)"
        ),
        [
            username,
            data.isOrgAdmin === true,
            data.isPlatformAdmin === true
        ]
    ));
}

function samplePackage(version) {
    let file = path.join(work, MODULE + "-" + version + ".zip");
    let zip = new AdmZip();

    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [],
        module: MODULE,
        version
    })));
    zip.writeZip(file);
    return file;
}

function onDisk(version) {
    return fs.existsSync(path.join(settings.modulesDir, MODULE, version));
}

function deployed() {
    return db.withClient(settings.testDb, async function (client) {
        let resp = await client.query(
            "SELECT version FROM module WHERE name = $1",
            [MODULE]
        );

        return (
            resp.rows.length
            ? resp.rows[0].version
            : undefined
        );
    });
}

async function signedIn(username) {
    let session = new Session();
    let resp = await session.signIn(username, settings.password, "FBTest");

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

describe("Install on the Modules page", function () {
    before(async function () {
        work = fs.mkdtempSync(path.join(os.tmpdir(), "fbt-webinst-"));
        await db.ensureIdentity(PLATFORM, settings.password, settings.testDb);
        await db.ensureIdentity(PLAIN, settings.password, settings.testDb);
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        await flags(PLAIN, {isOrgAdmin: true});
    });

    after(async function () {
        fs.rmSync(path.join(settings.modulesDir, MODULE), {
            force: true,
            recursive: true
        });
        await db.query("DELETE FROM module WHERE name = $1", [MODULE]);
        await flags(PLATFORM, {});
        await flags(PLAIN, {});
        fs.rmSync(work, {force: true, recursive: true});
    });

    it("refuses someone who is not a platform administrator",
            async function () {
        let session = await signedIn(PLAIN);

        await assert.rejects(
            session.upload(
                "/module/install/x=1",
                "package",
                samplePackage("1.0.0")
            ),
            /platform administrator/
        );
        assert.equal(onDisk("1.0.0"), false, "nothing reached the disk");
        assert.equal(await deployed(), undefined, "nor the database");
    });

    it("puts the package on the server and deploys it here",
            async function () {
        let session = await signedIn(PLATFORM);

        await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("1.0.0")
        );

        assert.equal(onDisk("1.0.0"), true, "the server holds the package");
        assert.equal(await deployed(), "1.0.0", "this database runs it");
    });

    it("moves to a newer version the same way", async function () {
        let session = await signedIn(PLATFORM);

        await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("1.1.0")
        );

        assert.equal(onDisk("1.0.0"), true, "the old version stays");
        assert.equal(onDisk("1.1.0"), true);
        assert.equal(await deployed(), "1.1.0");
    });

    it("installs the same version again, as a package in development is",
            async function () {
        let session = await signedIn(PLATFORM);

        await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("1.1.0")
        );

        assert.equal(await deployed(), "1.1.0");
    });

    it("says what is wrong with an archive that is not a package",
            async function () {
        let session = await signedIn(PLATFORM);
        let file = path.join(work, "empty.zip");
        let zip = new AdmZip();

        zip.addFile("readme.txt", Buffer.from("no manifest"));
        zip.writeZip(file);

        await assert.rejects(
            session.upload("/module/install/x=1", "package", file),
            /manifest/
        );
    });
});
