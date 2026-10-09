/*
    Workbooks API: GET /workbooks, GET/PUT/DELETE /workbook/:name,
    GET /workbook/is-authorized/:name, launch/default/local config round
    trip, workbook authorizations for a non-super user, and a golden
    snapshot of the installed workbooks and the feathers they show.
    (server.js doGetWorkbooks/doSaveWorkbook/doDeleteWorkbook/
    doWorkbookIsAuthorized, server/services/workbooks.js)

    Workbooks created here are named "Fbt..." and deleted in after().
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const {matchGolden} = require("../harness/golden");
const access = require("./lib/access");

describe("workbooks", function () {
    let admin;
    let basicS;
    let created = [];

    function wbName(tag) {
        let name = "Fbt" + tag + access.uniq("x").slice(2);
        created.push(name);
        return name;
    }

    function spec(name) {
        return {
            name,
            description: "Regression test workbook",
            module: "Core",
            icon: "folder",
            label: "Fbt",
            sequence: 99,
            isTemplate: true,
            launchConfig: {sheet: "Contacts", filter: {limit: 5}},
            defaultConfig: [{
                name: "Contacts",
                feather: "Contact",
                list: {columns: [{attr: "fullName"}]}
            }],
            localConfig: [{
                name: "My contacts",
                feather: "Contact",
                list: {columns: [{attr: "email"}]}
            }],
            authorizations: [{
                role: "everyone",
                canRead: true,
                canUpdate: false,
                // Only has an effect when launchConfig names settings
                canUpdateSettings: false
            }]
        };
    }

    function path(name) {
        return "/workbook/" + encodeURIComponent(name);
    }

    function isAuthorized(session, name, action) {
        return session.raw(
            "GET",
            "/workbook/is-authorized/" + encodeURIComponent(name) +
            "?action=" + action
        );
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

    it("lists the installed workbooks and their feathers", async function () {
        let list = await admin.get("/workbooks");
        let summary = list.filter(
            (wb) => !wb.name.startsWith("Fbt")
        ).map(function (wb) {
            return {
                name: wb.name,
                module: wb.module,
                label: wb.label,
                icon: wb.icon,
                feathers: (wb.defaultConfig || []).map((c) => c.feather)
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        assert.ok(summary.length > 0);
        matchGolden("workbooks-catalog", summary);
    });

    it("GET /workbook/:name returns the same definition as the list",
            async function () {
        let list = await admin.get("/workbooks");
        let one = await admin.get(path(list[0].name));

        assert.deepEqual(one, list[0]);
        assert.deepEqual(Object.keys(one).sort(), [
            "actions", "authorizations", "defaultConfig", "description",
            "icon", "isTemplate", "label", "launchConfig", "localConfig",
            "module", "name", "sequence"
        ]);
    });

    it("answers 404 for an unknown workbook", async function () {
        let resp = await admin.raw("GET", path("FbtNoSuchWorkbook"));

        assert.equal(resp.status, 404);
        assert.equal(resp.body, "Workbook not found");
    });

    it("creates a workbook and returns it unchanged", async function () {
        let name = wbName("Create");
        let resp = await admin.raw("PUT", path(name), spec(name));

        assert.equal(resp.status, 204);
        let wb = await admin.get(path(name));
        let expected = spec(name);
        expected.actions = {};
        assert.deepEqual(wb, expected);
    });

    it("updates the launch config and keeps the other fields",
            async function () {
        let name = wbName("Launch");
        await admin.call("PUT", path(name), spec(name));

        let launchConfig = {sheet: "My contacts", filter: {limit: 10}};
        let upd = spec(name);
        upd.launchConfig = launchConfig;
        delete upd.authorizations;
        await admin.call("PUT", path(name), upd);

        let wb = await admin.get(path(name));
        assert.deepEqual(wb.launchConfig, launchConfig);
        assert.deepEqual(wb.defaultConfig, spec(name).defaultConfig);
        assert.deepEqual(wb.localConfig, spec(name).localConfig);
        assert.equal(wb.description, "Regression test workbook");
        assert.equal(wb.sequence, 99);
        // authorizations omitted -> old ones cleared, none added
        assert.deepEqual(wb.authorizations, []);
    });

    it("keeps module and isTemplate when an update omits them",
            async function () {
        let name = wbName("Partial");
        await admin.call("PUT", path(name), spec(name));
        await admin.call("PUT", path(name), {
            name,
            launchConfig: {sheet: "Contacts"}
        });

        let wb = await admin.get(path(name));
        assert.equal(wb.module, "Core");
        assert.equal(wb.isTemplate, true);
    });

    describe("non-super user", function () {
        let shared;
        let hidden;     // an installed workbook without any role grant

        before(async function () {
            shared = wbName("Shared");
            await admin.call("PUT", path(shared), spec(shared));
            hidden = (await admin.get("/workbooks")).find(
                (wb) => !wb.authorizations.length && !wb.name.startsWith("Fbt")
            );
        });

        it("sees only workbooks a role of theirs may read",
                async function () {
            let names = (await basicS.get("/workbooks")).map((w) => w.name);

            assert.ok(names.includes(shared), names.join());
            assert.equal((await basicS.get(path(shared))).name, shared);
            if (hidden) {
                assert.ok(!names.includes(hidden.name), names.join());
                let resp = await basicS.raw("GET", path(hidden.name));
                assert.equal(resp.status, 404);
            }
        });

        it("/workbook/is-authorized answers canRead and canUpdate",
                async function () {
            let resp = await isAuthorized(basicS, shared, "canRead");
            assert.equal(resp.status, 200);
            assert.equal(resp.body, true);

            resp = await isAuthorized(basicS, shared, "canUpdate");
            assert.equal(resp.body, false);

            if (hidden) {
                resp = await isAuthorized(basicS, hidden.name, "canRead");
                assert.equal(resp.body, false);
            }

            resp = await isAuthorized(admin, shared, "canUpdate");
            assert.equal(resp.body, true);
        });

        it("/workbook/is-authorized rejects other actions",
                async function () {
            let resp = await isAuthorized(basicS, shared, "canDelete");

            assert.ok(resp.status >= 400);
            assert.match(
                String(resp.body),
                /Only actions `canRead` and `canUpdate` supported/
            );
        });

        it("cannot create or delete workbooks", async function () {
            let name = wbName("Denied");
            let resp = await basicS.raw("PUT", path(name), spec(name));

            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Only super users may create/);
            assert.equal((await admin.raw("GET", path(name))).status, 404);

            resp = await basicS.raw("DELETE", path(shared));
            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Only super users may delete/);
            assert.equal((await admin.raw("GET", path(shared))).status, 200);
        });

        it("cannot overwrite a workbook it may only read",
                async function () {
            let name = wbName("Guarded");
            await admin.call("PUT", path(name), spec(name));
            let resp = await basicS.raw("PUT", path(name), {
                name,
                module: "Core",
                description: "overwritten",
                authorizations: [
                    {role: "everyone", canRead: true, canUpdate: true}
                ]
            });

            assert.ok(resp.status === 401 || resp.status === 403, "status " +
                    resp.status);
            let wb = await admin.get(path(name));
            assert.equal(wb.description, "Regression test workbook");
            assert.deepEqual(wb.authorizations, spec(name).authorizations);
        });
    });

    // The "Settings" box in a workbook's permissions grants a role the
    // right to change the settings the workbook opens. The grant belongs
    // to the settings row, not the workbook, so one settings row has one
    // answer however many workbooks open it.
    it("stores canUpdateSettings against the settings row",
            async function () {
        let sname = "fbtWbSettings" + access.uniq("x").slice(2);
        let name = wbName("Settings");
        let wb = spec(name);

        function auths(flag) {
            return [{
                role: "everyone",
                canRead: true,
                canUpdate: false,
                canUpdateSettings: flag
            }];
        }

        function granted() {
            return db.query((
                "SELECT auth.can_update " +
                "FROM \"$auth\" AS auth, \"$settings\" AS settings " +
                "WHERE settings.name = $1 " +
                "  AND settings._pk = auth.object_pk " +
                "  AND auth.role = 'everyone'"
            ), [sname]);
        }

        await admin.call("PUT", "/settings/" + sname, {data: {probe: true}});
        wb.launchConfig = {sheet: "Contacts", settings: sname};
        wb.authorizations = auths(true);

        try {
            await admin.call("PUT", path(name), wb);

            assert.deepEqual(
                (await admin.get(path(name))).authorizations,
                auths(true)
            );
            assert.deepEqual((await granted()).rows, [{can_update: true}]);

            // Clearing the box takes the grant away
            wb.authorizations = auths(false);
            await admin.call("PUT", path(name), wb);

            assert.deepEqual((await granted()).rows, []);
            assert.deepEqual(
                (await admin.get(path(name))).authorizations,
                auths(false)
            );
        } finally {
            await db.query((
                "DELETE FROM \"$auth\" WHERE object_pk IN (" +
                "  SELECT _pk FROM \"$settings\" WHERE name = $1)"
            ), [sname]);
            await db.query(
                "DELETE FROM \"$settings\" WHERE name = $1",
                [sname]
            );
        }
    });

    it("deletes a workbook", async function () {
        let name = wbName("Delete");
        await admin.call("PUT", path(name), spec(name));
        let resp = await admin.raw("DELETE", path(name));

        assert.equal(resp.status, 200);
        assert.equal(resp.body, true);
        assert.equal((await admin.raw("GET", path(name))).status, 404);

        // Deleting what is not there is not an error
        resp = await admin.raw("DELETE", path(name));
        assert.equal(resp.body, true);
    });

    it("removes the workbook's authorization rows on delete",
            async function () {
        let name = wbName("Orphan");
        await admin.call("PUT", path(name), spec(name));
        let pk = (await db.query(
            "SELECT _pk FROM \"$workbook\" WHERE name = $1",
            [name]
        )).rows[0]._pk;
        await admin.call("DELETE", path(name));

        let rows = await db.query(
            "SELECT count(*)::int AS n FROM \"$auth\" WHERE object_pk = $1",
            [pk]
        );
        assert.equal(rows.rows[0].n, 0);
    });

    it("requires a session", async function () {
        let anon = new Session();
        assert.equal((await anon.raw("GET", "/workbooks")).status, 401);
        assert.equal((await anon.raw("GET", path("Development"))).status, 401);
    });
});
