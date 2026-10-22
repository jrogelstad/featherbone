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

function samplePackage(version, withCode) {
    let file = path.join(work, MODULE + "-" + version + ".zip");
    let zip = new AdmZip();
    let files = [];

    if (withCode) {
        files = [{
            name: "fbt-webinstall-service",
            path: "service.js",
            type: "service"
        }, {
            path: "client.js",
            type: "module"
        }];
        zip.addFile("service.js", Buffer.from(
            "// service " + version + "\n"
        ));
        zip.addFile("client.js", Buffer.from(
            "// client " + version + "\n"
        ));
    }

    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files,
        module: MODULE,
        version
    })));
    zip.writeZip(file);
    return file;
}

function brokenPackage() {
    let file = path.join(work, MODULE + "-broken.zip");
    let zip = new AdmZip();

    // A relation to a feather no module defines: the shape of a
    // package whose dependencies are out of order
    zip.addFile("feathers.json", Buffer.from(JSON.stringify([{
        description: "Points at nothing",
        name: "FbtNoSuchRelation",
        properties: {
            thing: {
                description: "A relation that cannot resolve",
                type: {properties: ["name"], relation: "FbtNoSuchFeather"}
            }
        }
    }])));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [{path: "feathers.json", type: "feather"}],
        module: MODULE,
        version: "9.9.9"
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

    /*
        What the page is told. A success used to answer a bare `true`,
        so the page could only refresh; a failure answered with the
        installer's own words and nothing about the instance it left
        held, so the next thing anyone saw was an application that
        refused them (John, Oct 2026: "UI should tell us success or
        failure").
    */
    it("answers what it installed and where", async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("1.1.0")
        );

        assert.equal(resp.module, MODULE, JSON.stringify(resp));
        assert.equal(resp.version, "1.1.0");
        assert.equal(resp.database, settings.testDb);
    });

    it("says what failed, and that the instance is held, when the " +
            "deployment fails", async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.upload(
            "/module/install/x=1",
            "package",
            brokenPackage()
        ).catch((err) => err);

        // Let go of the hold first: the assertions below must not
        // leave the suite's instance refusing everyone if one fails
        await db.withClient(
            settings.managerDb,
            (client) => client.query(
                "UPDATE tenant SET is_maintenance = false " +
                "WHERE pg_database = $1",
                [settings.testDb]
            )
        );

        assert.equal(resp.status, 500, "a failure, not silence");
        assert.match(
            String(resp.body),
            /FbtNoSuchFeather/,
            "the installer's reason"
        );
        assert.match(
            String(resp.body),
            new RegExp(MODULE + " 9.9.9 was not deployed to "),
            "which package, and where"
        );
        assert.match(
            String(resp.body),
            /held in maintenance/,
            "what state it left the instance in"
        );
        assert.equal(await deployed(), "1.1.0", "nothing half applied");
    });

    /*
        A package's code is served from its files, so the database is
        given the module's record -- name and version, which is what
        dispatch and the fleet view read -- and not a second copy of the
        code in a table, where anyone with write access could change
        what runs.
    */
    it("keeps the package's code out of the database's rows",
            async function () {
        let session = await signedIn(PLATFORM);

        await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("2.0.0", true)
        );

        assert.equal(onDisk("2.0.0"), true);
        assert.equal(await deployed(), "2.0.0");

        let services = await db.query(
            "SELECT count(*)::int AS n FROM data_service WHERE module = $1",
            [MODULE]
        );
        let client = await db.query(
            "SELECT script FROM module WHERE name = $1",
            [MODULE]
        );

        assert.equal(services.rows[0].n, 0, "no service rows");
        assert.equal(client.rows[0].script, "", "no client script");
    });

    /*
        The defect John's `tracker` hit, and the reason a web install
        on a server that had been up a while would hang: whether an
        install writes to another database was module-level state that
        the first deployment set and nothing ever cleared, so this
        install -- which writes through the caller's own connection --
        finished as though it had one of its own and died on it, with
        the request left unanswered and the instance held.

        A deployment from a screen first, because that is what set the
        flag; then the page's install, which has to answer.
    */
    it("installs after a deployment that was watched from a screen",
            async function () {
        let session = await signedIn(PLATFORM);
        let instance = await db.withClient(
            settings.managerDb,
            async function (client) {
                let found = await client.query(
                    (
                        "SELECT id FROM tenant " +
                        "WHERE pg_database = $1 AND NOT is_deleted"
                    ),
                    [settings.testDb]
                );

                return found.rows[0].id;
            }
        );
        let watched = await session.raw("POST", "/admin/instance/deploy", {
            id: instance,
            module: MODULE,
            processId: "fbt-webinst-watched",
            version: "1.0.0"
        });

        assert.equal(watched.status, 200, JSON.stringify(watched.body));
        assert.equal(await deployed(), "1.0.0");

        await session.upload(
            "/module/install/x=1",
            "package",
            samplePackage("2.1.0", true),
            30000
        );

        assert.equal(await deployed(), "2.1.0", "the page's install answered");
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
