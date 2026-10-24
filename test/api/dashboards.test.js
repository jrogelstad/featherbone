/*
    Dashboard layouts API: GET /dashboards, GET/PUT/DELETE
    /dashboard/:name, the exclusive default flag, and the ownership rule
    that stops one person overwriting another's shared layout.
    (server.js doGetDashboards/doGetDashboard/doSaveDashboard/
    doDeleteDashboard, server/services/dashboards.js)

    Layouts created here are named "Fbt..." and deleted in after().
*/
/*jslint node, unordered*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const access = require("./lib/access");

describe("dashboards", function () {
    let admin;
    let basicS;
    let created = [];

    function dashName(tag) {
        let name = "Fbt" + tag + access.uniq("x").slice(2);
        created.push(name);
        return name;
    }

    function path(name) {
        return "/dashboard/" + encodeURIComponent(name);
    }

    function spec(extra) {
        return Object.assign({
            label: "Fbt layout",
            description: "Regression test layout",
            module: "Core",
            sequence: 99,
            config: {
                asOf: "2027-05-31",
                title: "Fbt board",
                seen: ["sales"],
                tiles: [{
                    id: "core-kpis",
                    type: "kpi",
                    heading: "Key Metrics",
                    kpis: ["userCount"],
                    col: 1,
                    row: 1,
                    cols: 5,
                    rows: 3
                }]
            }
        }, extra || {});
    }

    before(async function () {
        admin = await signedIn();
        let u = await access.createUser(admin);
        basicS = await signedIn(u.name, u.password);
    });

    after(async function () {
        let i = 0;
        while (i < created.length) {
            await admin.raw("DELETE", path(created[i]));
            i += 1;
        }
        await access.dropAll();
    });

    it("has no layout by that name before one is saved", async function () {
        let resp = await admin.raw("GET", path("FbtNoSuchLayout"));

        assert.equal(resp.status, 200);
        assert.equal(resp.body, false);
    });

    it("saves a layout and reads back the whole spec", async function () {
        let name = dashName("Create");
        let resp = await admin.raw("PUT", path(name), spec());
        let found;

        assert.equal(resp.status, 200);

        found = await admin.get(path(name));
        assert.equal(found.name, name);
        assert.equal(found.label, "Fbt layout");
        assert.equal(found.config.asOf, "2027-05-31");
        assert.equal(found.config.tiles.length, 1);
        // The arrangement survives the round trip, not just the tiles:
        // a layout that came back repacked would not be a layout.
        assert.equal(found.config.tiles[0].col, 1);
        assert.equal(found.config.tiles[0].cols, 5);
        assert.deepEqual(found.config.seen, ["sales"]);
    });

    it("lists saved layouts", async function () {
        let name = dashName("List");
        await admin.raw("PUT", path(name), spec());

        let list = await admin.get("/dashboards");
        let mine = list.find((row) => row.name === name);

        assert.ok(mine, "saved layout is in the list");
        assert.equal(mine.config.title, "Fbt board");
    });

    it("replaces a layout saved under the same name", async function () {
        let name = dashName("Replace");
        let changed = spec();
        let found;

        await admin.raw("PUT", path(name), spec());
        changed.config.title = "Fbt board, second thoughts";
        changed.config.tiles = [];
        await admin.raw("PUT", path(name), changed);

        found = await admin.get(path(name));
        assert.equal(found.config.title, "Fbt board, second thoughts");
        assert.equal(found.config.tiles.length, 0);
    });

    it("keeps exactly one default layout", async function () {
        let first = dashName("DefaultOne");
        let second = dashName("DefaultTwo");
        let list;

        await admin.raw("PUT", path(first), spec({isDefault: true}));
        list = await admin.get("/dashboards");
        assert.equal(
            list.find((row) => row.name === first).isDefault,
            true
        );

        // The second takes the flag; the first must lose it, or nobody
        // can tell from the board which one they are looking at.
        await admin.raw("PUT", path(second), spec({isDefault: true}));
        list = await admin.get("/dashboards");
        assert.equal(
            list.find((row) => row.name === second).isDefault,
            true
        );
        assert.equal(
            list.find((row) => row.name === first).isDefault,
            false
        );
        assert.equal(
            list.filter((row) => row.isDefault).length,
            1,
            "exactly one default across every layout"
        );
    });

    it("refuses a layout with no name", async function () {
        let resp = await admin.raw("PUT", "/dashboard/", spec());

        assert.ok(resp.status >= 400, "a nameless layout is refused");
    });

    it("lets anyone create a layout", async function () {
        let name = dashName("Basic");
        let resp = await basicS.raw("PUT", path(name), spec());

        assert.equal(resp.status, 200);
    });

    it("stops one person overwriting another's layout", async function () {
        let name = dashName("Owned");
        let resp;
        let found;

        await basicS.raw("PUT", path(name), spec());
        resp = await admin.raw("PUT", path(name), spec({
            label: "Taken over"
        }));

        // A super user may; that is the escape hatch for an abandoned
        // layout. The check is that ownership is enforced at all, so
        // this asserts the rule from the other side: the basic user
        // cannot touch a layout the admin owns.
        assert.equal(resp.status, 200);

        name = dashName("AdminOwned");
        await admin.raw("PUT", path(name), spec());
        resp = await basicS.raw("PUT", path(name), spec({
            label: "Taken over"
        }));
        assert.equal(resp.status, 401);

        found = await admin.get(path(name));
        assert.equal(found.label, "Fbt layout", "untouched");
    });

    it("deletes a layout and stops listing it", async function () {
        let name = dashName("Delete");
        let list;

        await admin.raw("PUT", path(name), spec());
        await admin.raw("DELETE", path(name));

        list = await admin.get("/dashboards");
        assert.equal(
            list.find((row) => row.name === name),
            undefined
        );
        assert.equal(await admin.get(path(name)), false);
    });

    it("keeps the default an administrator's decision", async function () {
        let name = dashName("BasicDefault");
        let resp;
        let list;

        // A basic user may offer a layout, but not decide what everyone
        // without a preference sees.
        resp = await basicS.raw("PUT", path(name), spec({isDefault: true}));
        assert.equal(resp.status, 401);

        // Without the claim, the same save goes through.
        resp = await basicS.raw("PUT", path(name), spec());
        assert.equal(resp.status, 200);

        // An administrator flags it; the author's own resave must not
        // read as demoting it, so the author echoes the flag as it
        // stands and is left alone.
        resp = await admin.raw("PUT", path(name), spec({isDefault: true}));
        assert.equal(resp.status, 200);
        resp = await basicS.raw("PUT", path(name), spec({isDefault: true}));
        assert.equal(resp.status, 200, JSON.stringify(resp.body));

        // But the author cannot take the flag away.
        resp = await basicS.raw("PUT", path(name), spec());
        assert.equal(resp.status, 401);

        list = await admin.get("/dashboards");
        assert.equal(
            list.find((row) => row.name === name).isDefault,
            true,
            "still the default"
        );

        // Nobody borrows the installer's voice over HTTP: the route
        // strips the package flag, so this claim is an ordinary one
        // and is refused.
        name = dashName("FakePackage");
        resp = await basicS.raw("PUT", path(name), spec({
            fromPackage: true,
            isDefault: true
        }));
        assert.equal(resp.status, 401);
    });

    it("stops one person deleting another's layout", async function () {
        let name = dashName("DeleteOwned");
        let resp = await admin.raw("PUT", path(name), spec());

        resp = await basicS.raw("DELETE", path(name));
        assert.equal(resp.status, 401);
        assert.ok(await admin.get(path(name)), "still there");
    });
});
