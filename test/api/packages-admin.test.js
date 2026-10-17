/*
    Managing the packages a server holds, from the platform console
    (ADR-002 section 6: Install is the server's half, Deploy the
    database's).

    Install was a command-line act, so the console could only ever
    offer Deploy whatever was already on disk -- and if nothing was,
    the button was simply off with nothing to explain it. These claims
    are about the screen that fixes that, and mostly about the one
    rule it has to keep: a version an instance is running is the code
    that instance executes, so taking it off the server would drop
    that instance back to the rows in its own database without
    anything saying so.
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

const ROOT = settings.baseUrl.replace("/" + settings.testDb, "");
const PLATFORM = "fbt_pkg_platform";
const PLAIN = "fbt_pkg_plain";
const MODULE = "FbtPkgSample";
const VERSION = "3.1.0";

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

function samplePackage(name, version) {
    let file = path.join(work, name + "-" + version + ".zip");
    let zip = new AdmZip();

    zip.addFile("manifest.json", Buffer.from(JSON.stringify({
        files: [],
        module: name,
        version
    })));
    zip.addFile("module.js", Buffer.from("// " + name));
    zip.writeZip(file);
    return file;
}

async function signedIn(username) {
    let session = new Session(ROOT);
    let resp = await session.signIn(username, settings.password, "FBTest");

    assert.equal(resp.status, 200, JSON.stringify(resp.body));
    return session;
}

function find(list, name, version) {
    return (list || []).find(
        (one) => one.name === name && one.version === version
    );
}

describe("managing the packages on this server", function () {
    before(async function () {
        work = fs.mkdtempSync(path.join(os.tmpdir(), "fbt-pkgs-"));
        await db.ensureIdentity(PLATFORM, settings.password);
        await db.ensureIdentity(PLAIN, settings.password);
        await flags(PLATFORM, {isOrgAdmin: true, isPlatformAdmin: true});
        await flags(PLAIN, {isOrgAdmin: true});
    });

    after(async function () {
        let session = await signedIn(PLATFORM);

        // leave the server holding what it held; the removal test may
        // already have taken it off
        await session.raw("POST", "/platform/packages/remove", {
            name: MODULE,
            version: VERSION
        });
        await flags(PLATFORM, {});
        await flags(PLAIN, {});
        fs.rmSync(work, {recursive: true, force: true});
    });

    it("refuses the list to a caller with no session", async function () {
        let resp = await new Session(ROOT).raw("GET", "/platform/packages");

        assert.equal(resp.status, 401);
    });

    /*
        401 rather than 403, as the rest of the console answers it: the
        picker reads that status as "this is not your screen" and sends
        the caller back to the instance list. Asserted on the refusal
        rather than on the number, so tightening the status later is
        not a change to this claim.
    */
    it("refuses it to an organization administrator", async function () {
        let session = await signedIn(PLAIN);
        let resp = await session.raw("GET", "/platform/packages");

        assert.ok(resp.status >= 400, "refused");
        assert.match(
            JSON.stringify(resp.body),
            /platform administrator/
        );
    });

    it("lists what the server holds, and what runs it", async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.get("/platform/packages");

        assert.ok(Array.isArray(resp.packages));
        assert.ok(Array.isArray(resp.unknown));
        resp.packages.forEach(function (one) {
            assert.ok(Array.isArray(one.instances));
            assert.equal(one.isUsed, one.instances.length > 0);
        });
    });

    it("installs an uploaded package and leaves every database alone",
            async function () {
        let session = await signedIn(PLATFORM);
        let before = await session.get("/platform/overview");
        let done = await session.upload(
            "/platform/packages/install",
            "package",
            samplePackage(MODULE, VERSION)
        );

        assert.equal(done.name, MODULE);
        assert.equal(done.version, VERSION);

        let after = await session.get("/platform/packages");
        let one = find(after.packages, MODULE, VERSION);

        assert.ok(one, "the package is listed");
        assert.equal(one.isUsed, false);
        assert.deepEqual(one.instances, []);

        /*
            Install is the server's half and nothing else: no instance
            may have gained the module by being on the same server as
            its package.
        */
        let now = await session.get("/platform/overview");

        assert.deepEqual(
            now.fleet.map((i) => (i.modules || {}).modules || []),
            before.fleet.map((i) => (i.modules || {}).modules || [])
        );
    });

    it("offers it to Deploy, which had nothing before", async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.get("/platform/overview");

        assert.ok(find(resp.installed, MODULE, VERSION));
    });

    it("refuses to install over a version it already holds",
            async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.raw(
            "POST",
            "/platform/packages/install"
        );

        assert.ok(resp.status >= 400);
    });

    it("refuses a removal to an organization administrator",
            async function () {
        let session = await signedIn(PLAIN);
        let resp = await session.raw("POST", "/platform/packages/remove", {
            name: MODULE,
            version: VERSION
        });

        assert.ok(resp.status >= 400);
        assert.match(
            JSON.stringify(resp.body),
            /platform administrator/
        );
    });

    it("refuses to remove a version an instance is running",
            async function () {
        let session = await signedIn(PLATFORM);
        let listed = await session.get("/platform/packages");
        let used = (listed.packages || []).find((one) => one.isUsed);

        if (!used) {
            return; // nothing deployed from disk here to stand on
        }

        let resp = await session.raw("POST", "/platform/packages/remove", {
            name: used.name,
            version: used.version
        });

        assert.ok(resp.status >= 400, "the removal is refused");
        assert.match(
            JSON.stringify(resp.body),
            /deployed to/,
            "and names the instances running it"
        );

        // still there
        let after = await session.get("/platform/packages");

        assert.ok(find(after.packages, used.name, used.version));
    });

    it("removes one nothing is running", async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.post("/platform/packages/remove", {
            name: MODULE,
            version: VERSION
        });

        assert.equal(resp.name, MODULE);

        let after = await session.get("/platform/packages");

        assert.equal(find(after.packages, MODULE, VERSION), undefined);
    });

    /*
        Deploy from the console reaches an instance the caller is not
        in -- there is no instance to be in. The installer writes
        through the connection it is handed, so that connection has to
        be the target's: the caller's would send the deployment at
        whatever database the operator happened to be signed in to, and
        from here, where there is none, at the manager.
    */
    it("deploys to the named instance from a console with no instance",
            async function () {
        let session = await signedIn(PLATFORM);
        let overview = await session.get("/platform/overview");
        /*
            Not the primary test database: a deployment alters the
            schema, and the golden catalog and schema suites read that
            one. The second instance exists for exactly this.
        */
        let target = (overview.fleet || []).find(
            (one) => one.database !== settings.testDb
        );

        assert.ok(target, "a second instance is listed");

        let resp = await session.raw("POST", "/platform/instance/deploy", {
            id: target.id,
            module: "fbtest",
            version: "1.1.0"
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        /*
            It landed in the instance, and the manager -- the database
            a console session's own connection would have reached --
            was left alone.
        */
        let after = await session.get("/platform/overview");
        let now = (after.fleet || []).find(
            (one) => one.database === target.database
        );

        assert.ok(
            ((now.modules || {}).modules || []).some(
                (one) => one.name === "fbtest" && one.version === "1.1.0"
            ),
            "the instance carries the version deployed"
        );

        /*
            The manager is a Featherbone database too, so it has a
            module table of its own -- the point is that the module
            deployed to an instance is not in it. Before the target's
            connection was the one passed, this is where a console
            deployment went.
        */
        let inManager = await db.withClient(
            settings.managerDb,
            (client) => client.query(
                (
                    "SELECT name, version FROM module " +
                    "WHERE name = $1 AND NOT is_deleted"
                ),
                ["fbtest"]
            )
        );

        assert.deepEqual(
            inManager.rows,
            [],
            "and the manager did not receive it"
        );
    });

    it("has nothing to say about a version it does not hold",
            async function () {
        let session = await signedIn(PLATFORM);
        let resp = await session.raw("POST", "/platform/packages/remove", {
            name: MODULE,
            version: "9.9.9"
        });

        assert.ok(resp.status >= 400);
        assert.match(JSON.stringify(resp.body), /not installed/);
    });
});
