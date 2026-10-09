/*
    Feather and record authorization for a non-super user versus a super
    user: feather-level canCreate/canRead/canUpdate/canDelete on the
    /data API, /do/is-authorized, row-level authorization with
    /do/save-authorization, and super user bypass.
    (server.js doIsAuthorized/doSaveAuthorization, feathers.js
    isAuthorized/saveAuthorization, tools.js buildAuthSql, crud.js)

    Builds two throwaway feathers and a role; all removed in after().
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const db = require("../harness/db");
const {signedIn} = require("../harness/http");
const access = require("./lib/access");

const {toSpinal} = access;

describe("authorization", function () {
    let admin;
    let clerkRole;
    let basic;          // member of everyone only
    let clerk;          // everyone + clerkRole
    let other;          // everyone only
    let basicS;
    let clerkS;
    let otherS;
    let guarded;        // feather: only clerkRole may create/read
    let rowFeather;     // feather with row authorization
    let guardedRec;

    function isAuthorized(session, query) {
        return session.get("/do/is-authorized?" + new URLSearchParams(query));
    }

    async function auths(id) {
        let resp = await db.query(
            "SELECT a.role, a.can_create, a.can_read, a.can_update, " +
            "  a.can_delete " +
            "FROM \"$auth\" a JOIN object o ON o._pk = a.object_pk " +
            "WHERE o.id = $1 ORDER BY a.role",
            [id]
        );
        return resp.rows;
    }

    before(async function () {
        admin = await signedIn();
        clerkRole = access.track(access.uniq("fbt_clerk"));
        await admin.create("Role", {name: clerkRole, membership: []});

        basic = await access.createUser(admin);
        clerk = await access.createUser(admin);
        other = await access.createUser(admin);
        await admin.patch("UserAccount", clerk.id, [{
            op: "add",
            path: "/membership/1",
            value: {role: clerkRole}
        }]);

        let name = access.featherName("FbtGuarded");
        guarded = await access.createFeather(admin, {
            name,
            plural: name + "s",
            properties: [{name: "code", type: "string", description: "Code"}],
            authorizations: [{
                role: clerkRole,
                canCreate: true,
                canRead: true,
                canUpdate: false,
                canDelete: false
            }]
        });

        name = access.featherName("FbtRowAuth");
        rowFeather = await access.createFeather(admin, {
            name,
            plural: name + "s",
            enableRowAuthorization: true,
            properties: [{name: "code", type: "string", description: "Code"}],
            authorizations: [{
                role: "everyone",
                canCreate: true,
                canRead: false,
                canUpdate: false,
                canDelete: false
            }, {
                role: clerkRole,
                canCreate: false,
                canRead: true,
                canUpdate: false,
                canDelete: false
            }]
        });

        guardedRec = await admin.create(guarded.name, {code: "ADMIN"});
        basicS = await signedIn(basic.name, basic.password);
        clerkS = await signedIn(clerk.name, clerk.password);
        otherS = await signedIn(other.name, other.password);
    });

    after(async function () {
        await access.deleteFeather(admin, guarded);
        await access.deleteFeather(admin, rowFeather);
        await access.dropAll();
    });

    describe("feather level", function () {
        it("stores the feather authorizations per role", async function () {
            let rows = await db.query(
                "SELECT a.role, a.can_create, a.can_read, a.can_update, " +
                "  a.can_delete " +
                "FROM \"$auth\" a JOIN \"$feather\" f " +
                "  ON f._pk = a.object_pk " +
                "WHERE f.id = $1",
                [toSpinal(guarded.name).replace(/-/g, "_")]
            );
            assert.deepEqual(rows.rows, [{
                role: clerkRole,
                can_create: true,
                can_read: true,
                can_update: false,
                can_delete: false
            }]);
        });

        it("/do/is-authorized reports the grants of the signed-in user",
                async function () {
            let actions = ["canCreate", "canRead", "canUpdate", "canDelete"];
            let result = {};
            let sessions = {basic: basicS, clerk: clerkS, admin};
            let keys = Object.keys(sessions);
            let i = 0;
            let j;

            while (i < keys.length) {
                result[keys[i]] = {};
                j = 0;
                while (j < actions.length) {
                    result[keys[i]][actions[j]] = await isAuthorized(
                        sessions[keys[i]],
                        {feather: guarded.name, action: actions[j]}
                    );
                    j += 1;
                }
                i += 1;
            }

            assert.deepEqual(result, {
                basic: {
                    canCreate: false,
                    canRead: false,
                    canUpdate: false,
                    canDelete: false
                },
                clerk: {
                    canCreate: true,
                    canRead: true,
                    canUpdate: false,
                    canDelete: false
                },
                admin: {
                    canCreate: true,
                    canRead: true,
                    canUpdate: true,
                    canDelete: true
                }
            });
        });

        it("/do/is-authorized requires a feather or an id",
                async function () {
            let resp = await basicS.raw(
                "GET",
                "/do/is-authorized?action=canRead"
            );
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /requires feather or id/);
        });

        it("enforces canCreate", async function () {
            let path = "/data/" + toSpinal(guarded.name);
            let resp = await basicS.raw("POST", path, {code: "BASIC"});

            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Not authorized to create/);

            resp = await clerkS.raw("POST", path, {code: "CLERK"});
            assert.equal(resp.status, 200);
        });

        it("enforces canRead on queries and reads", async function () {
            let plural = "/data/" + toSpinal(guarded.plural);
            let one = "/data/" + toSpinal(guarded.name) + "/" + guardedRec.id;

            assert.deepEqual(await basicS.post(plural, {}), []);
            let resp = await basicS.raw("GET", one);
            assert.equal(resp.status, 204);
            assert.equal(resp.body, undefined);

            let codes = (await clerkS.post(plural, {})).map((r) => r.code);
            assert.ok(codes.includes("ADMIN"), codes.join());
            assert.equal((await clerkS.get(one)).code, "ADMIN");
        });

        it("refuses updates and deletes without canUpdate/canDelete",
                async function () {
            let one = "/data/" + toSpinal(guarded.name) + "/" + guardedRec.id;
            let resp = await clerkS.raw("PATCH", one, [{
                op: "replace",
                path: "/code",
                value: "CHANGED"
            }]);

            assert.ok(resp.status >= 400, "status " + resp.status);
            assert.match(String(resp.body), /Not authorized to update/);

            resp = await clerkS.raw("DELETE", one);
            assert.ok(resp.status >= 400, "status " + resp.status);
            assert.match(String(resp.body), /Not authorized to delete/);

            let rec = await admin.read(guarded.name, guardedRec.id);
            assert.equal(rec.code, "ADMIN");
            assert.equal(rec.isDeleted, false);
        });

        it("answers update and delete denials with 401 like create",
                async function () {
            let one = "/data/" + toSpinal(guarded.name) + "/" + guardedRec.id;
            let patch = await clerkS.raw("PATCH", one, [{
                op: "replace",
                path: "/code",
                value: "CHANGED"
            }]);
            let del = await clerkS.raw("DELETE", one);

            assert.equal(patch.status, 401);
            assert.equal(del.status, 401);
        });

        it("lets a super user bypass feather authorization",
                async function () {
            let rec = await admin.create(guarded.name, {code: "SUPER"});
            let updated = await admin.update(guarded.name, rec.id, function (r) {
                r.code = "SUPER2";
            });
            assert.equal(updated.code, "SUPER2");

            await admin.remove(guarded.name, rec.id);
            let codes = (
                await admin.list(guarded.plural, {})
            ).map((r) => r.code);
            assert.ok(!codes.includes("SUPER2"));
            assert.ok(codes.includes("ADMIN"));
        });
    });

    describe("row level", function () {
        let rec;

        before(async function () {
            rec = await admin.create(rowFeather.name, {code: "ROW"});
        });

        function listCodes(session) {
            return session.list(rowFeather.plural, {}).then(
                (rows) => rows.map((r) => r.code).sort()
            );
        }

        it("hides records without a feather or row grant",
                async function () {
            assert.deepEqual(await listCodes(basicS), []);
            let resp = await basicS.raw(
                "GET",
                "/data/" + toSpinal(rowFeather.name) + "/" + rec.id
            );
            assert.equal(resp.status, 204);
        });

        it("does not grant the owner read access to a record it created",
                async function () {
            // Current behavior: ownership alone gives no row access; the
            // feather grants everyone canCreate but not canRead.
            let own = await basicS.create(rowFeather.name, {code: "MINE"});

            assert.equal(own.owner, basic.name);
            assert.deepEqual(await listCodes(basicS), []);
            assert.deepEqual(await auths(own.id), []);
        });

        it("refuses /do/save-authorization from a user who does not own " +
                "the record", async function () {
            let resp = await basicS.raw("POST", "/do/save-authorization", {
                id: rec.id,
                role: basic.name,
                actions: {canRead: true}
            });

            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /Must be super user or owner/);
            assert.deepEqual(await auths(rec.id), []);
        });

        it("validates role and object in /do/save-authorization",
                async function () {
            let resp = await admin.raw("POST", "/do/save-authorization", {
                id: rec.id,
                role: "fbt_no_such_role",
                actions: {canRead: true}
            });
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /Role "fbt_no_such_role" not found/);

            resp = await admin.raw("POST", "/do/save-authorization", {
                id: "fbt-no-such-object",
                role: basic.name,
                actions: {canRead: true}
            });
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /not found/);
        });

        it("grants and revokes record access for a user", async function () {
            let one = "/data/" + toSpinal(rowFeather.name) + "/" + rec.id;
            let resp = await admin.post("/do/save-authorization", {
                id: rec.id,
                role: basic.name,
                actions: {
                    canCreate: null,
                    canRead: true,
                    canUpdate: true,
                    canDelete: null
                }
            });

            assert.equal(resp, true);
            assert.deepEqual(await auths(rec.id), [{
                role: basic.name,
                can_create: null,
                can_read: true,
                can_update: true,
                can_delete: null
            }]);
            assert.deepEqual(await listCodes(basicS), ["ROW"]);
            assert.equal((await basicS.get(one)).code, "ROW");
            assert.equal(
                await isAuthorized(basicS, {id: rec.id, action: "canRead"}),
                true
            );
            assert.equal(
                await isAuthorized(basicS, {id: rec.id, action: "canDelete"}),
                false
            );

            // Update allowed, delete not
            let patched = await basicS.patch(rowFeather.name, rec.id, [{
                op: "replace",
                path: "/code",
                value: "ROW2"
            }]);
            assert.ok(Array.isArray(patched));
            assert.equal((await admin.read(rowFeather.name, rec.id)).code, "ROW2");
            resp = await basicS.raw("DELETE", one);
            assert.ok(resp.status >= 400);

            // Other users still see nothing
            assert.deepEqual(await listCodes(otherS), []);

            // Revoking everything removes the grant row
            resp = await admin.post("/do/save-authorization", {
                id: rec.id,
                role: basic.name,
                actions: {
                    canCreate: false,
                    canRead: false,
                    canUpdate: false,
                    canDelete: false
                }
            });
            assert.equal(resp, true);
            assert.deepEqual(await auths(rec.id), []);
            assert.deepEqual(await listCodes(basicS), []);
        });

        it("lets the owner share its record", async function () {
            let own = await basicS.create(rowFeather.name, {code: "SHARED"});
            let resp = await basicS.post("/do/save-authorization", {
                id: own.id,
                role: other.name,
                actions: {canRead: true}
            });

            assert.equal(resp, true);
            assert.deepEqual(await listCodes(otherS), ["SHARED"]);
        });

        it("an explicit row denial overrides a feather grant",
                async function () {
            let hidden = await admin.create(rowFeather.name, {code: "DENY"});
            let codes = await listCodes(clerkS);
            assert.ok(codes.includes("DENY"), codes.join());

            await admin.post("/do/save-authorization", {
                id: hidden.id,
                role: clerk.name,
                actions: {canRead: false}
            });
            codes = await listCodes(clerkS);
            assert.ok(!codes.includes("DENY"), codes.join());
        });

        it("lets a super user see every record", async function () {
            let codes = await listCodes(admin);
            ["DENY", "MINE", "ROW2", "SHARED"].forEach(
                (c) => assert.ok(codes.includes(c), c)
            );
            assert.equal(
                await isAuthorized(admin, {id: rec.id, action: "canDelete"}),
                true
            );
        });

        /*
            The Core manifest installs scripts/feathers-bootstrap.json
            once before populate.js creates the `everyone` role and again
            after, so on a new database the first pass cannot resolve the
            role a feather declares. Failing there stopped
            `node install.js` on any new database; the grant is skipped
            and the second pass applies it.
        */
        it("saves a feather whose role does not exist yet",
                async function () {
            let name = access.featherName("FbtNoRole");
            let feather = await access.createFeather(admin, {
                name,
                plural: name + "s",
                properties: [{
                    name: "code",
                    type: "string",
                    description: "Code"
                }],
                authorizations: [{
                    role: "fbt_role_that_is_not_there",
                    canCreate: true,
                    canRead: true,
                    canUpdate: true,
                    canDelete: true
                }]
            });

            try {
                assert.ok(feather, "feather was not saved");
                let granted = await db.query((
                    "SELECT auth.role FROM \"$auth\" AS auth, " +
                    "  \"$feather\" AS feather " +
                    "WHERE feather.id = $1 " +
                    "  AND feather._pk = auth.object_pk"
                ), [access.toSpinal(name).replace(/-/g, "_")]);
                assert.deepEqual(granted.rows, []);
            } finally {
                await access.deleteFeather(admin, name);
            }
        });

        it("/do/is-authorized answers for an unknown id", async function () {
            let resp = await access.rawTimeout(
                basicS,
                "GET",
                "/do/is-authorized?id=fbt-no-such-id&action=canRead",
                undefined,
                3000
            );

            assert.ok(!resp.timeout, "request timed out");
            assert.equal(resp.body, false);
        });
    });
});
