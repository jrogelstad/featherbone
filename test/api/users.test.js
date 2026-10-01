/*
    User accounts and roles: creating accounts and roles, sign-in profile,
    password changes (/do/change-password/, /do/change-role-password/,
    admin reset through PATCH), /do/change-user-info/, account lockout,
    deactivation, role membership, and who may see or change accounts.
    (server.js doPostUserAccount/doPatchUserAccount/doChangePassword...,
    server/services/role.js, scripts/services.js Role/UserAccount triggers,
    server/database.js authenticate)

    Postgres roles are cluster-wide: every role created here is dropped in
    after().
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const access = require("./lib/access");

async function memberships(name) {
    let resp = await db.query(
        "SELECT r.rolname FROM pg_auth_members m " +
        "JOIN pg_roles r ON r.oid = m.roleid " +
        "JOIN pg_roles u ON u.oid = m.member " +
        "WHERE u.rolname = $1 ORDER BY 1",
        [name]
    );
    return resp.rows.map((row) => row.rolname);
}

describe("user accounts", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    after(async function () {
        await access.dropAll();
    });

    it("creates a user account through POST /data/user-account", {
        todo: (
            "defect: createUserAccount (scripts/services.js:1357) loops " +
            "past the end of pg_roles and throws TypeError, so every " +
            "create fails with 500"
        )
    }, async function () {
        let name = access.track(access.uniq("fbt_new"));
        let emp = await admin.create("Employee", {
            firstName: "New",
            lastName: "User",
            email: name + "@example.com"
        });
        let resp = await admin.raw("POST", "/data/user-account", {
            name,
            password: "Created-Pw-1",
            contact: {id: emp.id},
            membership: [{role: "everyone"}]
        });

        assert.equal(resp.status, 200, JSON.stringify(resp.body));
        let role = await access.roleInfo(name);
        assert.equal(role.rolcanlogin, true);
        assert.equal(role.rolcreatedb, false);
        assert.deepEqual(await memberships(name), ["everyone"]);
        assert.equal(await access.pgLogin(name, "Created-Pw-1"), true);
        // Password never stored in the table
        assert.equal((await access.account(name)).password, "");
        let s = new Session();
        assert.equal((await s.signIn(name, "Created-Pw-1")).status, 200);
    });

    it("rejects a user account named after a NOLOGIN role", async function () {
        let emp = await admin.create("Employee", {
            firstName: "Reserved",
            lastName: "Name",
            email: "reserved@example.com"
        });
        let resp = await admin.raw("POST", "/data/user-account", {
            name: "everyone",
            password: "Whatever-1",
            contact: {id: emp.id}
        });

        assert.ok(resp.status >= 400, "status " + resp.status);
        assert.match(String(resp.body), /reserved role name/);
        assert.equal((await access.roleInfo("everyone")).rolcanlogin, false);
    });

    // Plan 1.1: tenants share one cluster, so an account name that
    // matches another tenant's login role must not take that role over.
    it("does not reset the password of an existing login role when " +
            "creating a user account with its name", {
        todo: (
            "plan 1.1: createRole (role.js:230) ALTERs an existing role's " +
            "password; currently masked by the createUserAccount TypeError"
        )
    }, async function () {
        let name = access.uniq("fbt_tenant");
        await access.sqlRole(name, "Other-Tenant-Pw1");
        let emp = await admin.create("Employee", {
            firstName: "Tenant",
            lastName: "Clash",
            email: name + "@example.com"
        });
        let resp = await admin.raw("POST", "/data/user-account", {
            name,
            password: "Hijacked-Pw-2",
            contact: {id: emp.id},
            membership: [{role: "everyone"}]
        });

        assert.ok(
            resp.status >= 400,
            "creating an account over an existing login role should fail"
        );
        assert.equal(await access.pgLogin(name, "Other-Tenant-Pw1"), true);
        assert.equal(await access.pgLogin(name, "Hijacked-Pw-2"), false);
    });

    it("signs in a user and returns the profile", async function () {
        let u = await access.createUser(admin);
        let s = new Session();
        let resp = await s.signIn(u.name, u.password);

        assert.equal(resp.status, 200);
        assert.equal(resp.body.name, u.name);
        assert.equal(resp.body.id, u.id);
        assert.equal(resp.body.isSuper, false);
        assert.equal(resp.body.isAdmin, false);
        assert.equal(resp.body.changePassword, false);
        assert.equal(resp.body.email, u.email);
        assert.equal(resp.body.firstName, "Test");
        assert.equal(resp.body.lastName, u.name);
        assert.equal(resp.body.mode, "prod");

        let row = await access.account(u.name);
        assert.ok(row.last_sign_in, "last_sign_in recorded");
        assert.equal(row.sign_in_attempts, 0);
    });

    describe("changing passwords", function () {
        it("validates /do/change-password/ input", async function () {
            let u = await access.createUser(admin);
            let s = await signedIn(u.name, u.password);
            let resp;

            resp = await s.raw("POST", "/do/change-password/", {
                oldPassword: u.password,
                newPassword: u.password
            });
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /can not be the same/);

            resp = await s.raw("POST", "/do/change-password/", {
                oldPassword: u.password,
                newPassword: ""
            });
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /can not be blank/);

            assert.equal(await access.pgLogin(u.name, u.password), true);
        });

        it("rejects a wrong old password and counts it as a failed " +
                "sign-in attempt", async function () {
            let u = await access.createUser(admin);
            let s = await signedIn(u.name, u.password);
            let resp = await s.raw("POST", "/do/change-password/", {
                oldPassword: "not-my-password",
                newPassword: "Never-Set-1"
            });

            assert.ok(resp.status >= 400, "status " + resp.status);
            assert.equal(await access.pgLogin(u.name, u.password), true);
            assert.equal(await access.pgLogin(u.name, "Never-Set-1"), false);
            assert.equal((await access.account(u.name)).sign_in_attempts, 1);
        });

        it("answers a wrong old password with a client error and no " +
                "database error text", {
            todo: (
                "defect: 500 with the raw Postgres message " +
                "'password authentication failed for user ...'"
            )
        }, async function () {
            let u = await access.createUser(admin);
            let s = await signedIn(u.name, u.password);
            let resp = await s.raw("POST", "/do/change-password/", {
                oldPassword: "not-my-password",
                newPassword: "Never-Set-1"
            });

            assert.ok(
                resp.status >= 400 && resp.status < 500,
                "status " + resp.status
            );
            assert.doesNotMatch(
                String(resp.body),
                /password authentication failed/
            );
        });

        it("changes the own password with /do/change-password/",
                async function () {
            let u = await access.createUser(admin, {changePassword: true});
            let s = await signedIn(u.name, u.password);
            let resp = await s.raw("POST", "/do/change-password/", {
                oldPassword: u.password,
                newPassword: "Changed-Pw-2"
            });

            assert.equal(resp.status, 200);
            assert.equal(resp.body, true);
            assert.equal(await access.pgLogin(u.name, u.password), false);
            assert.equal(await access.pgLogin(u.name, "Changed-Pw-2"), true);
            assert.equal((await access.account(u.name)).change_password, false);

            // Session stays valid
            resp = await s.raw("POST", "/data/contacts", {filter: {limit: 1}});
            assert.equal(resp.status, 200);
        });

        it("records when the password was last changed", {
            todo: "defect: user_account.last_password_change is never set"
        }, async function () {
            let u = await access.createUser(admin);
            let s = await signedIn(u.name, u.password);
            await s.post("/do/change-password/", {
                oldPassword: u.password,
                newPassword: "Changed-Pw-3"
            });

            assert.ok((await access.account(u.name)).last_password_change);
        });

        it("sets the password with /do/change-role-password/ and signs " +
                "the session out", async function () {
            let u = await access.createUser(admin, {changePassword: true});
            let s = await signedIn(u.name, u.password);
            let resp = await s.raw("POST", "/do/change-role-password/", {
                password: "Role-Pw-4"
            });

            assert.equal(resp.status, 200);
            assert.equal(await access.pgLogin(u.name, u.password), false);
            assert.equal(await access.pgLogin(u.name, "Role-Pw-4"), true);
            assert.equal((await access.account(u.name)).change_password, false);

            resp = await s.raw("POST", "/data/contacts", {filter: {limit: 1}});
            assert.equal(resp.status, 401);
            assert.equal(
                (await new Session().signIn(u.name, "Role-Pw-4")).status,
                200
            );
        });

        it("forces a password change after an admin sets the password " +
                "through PATCH", async function () {
            let u = await access.createUser(admin);
            let resp = await admin.raw(
                "PATCH",
                "/data/user-account/" + u.id,
                [{op: "replace", path: "/password", value: "Admin-Set-5"}]
            );

            assert.equal(resp.status, 200);
            // Server answers with a patch: password blanked, flag raised
            assert.deepEqual(
                resp.body.find((op) => op.path === "/password"),
                {op: "replace", path: "/password", value: ""}
            );
            assert.deepEqual(
                resp.body.find((op) => op.path === "/changePassword"),
                {op: "replace", path: "/changePassword", value: true}
            );
            assert.equal(await access.pgLogin(u.name, u.password), false);
            assert.equal(await access.pgLogin(u.name, "Admin-Set-5"), true);

            let s = new Session();
            resp = await s.signIn(u.name, "Admin-Set-5");
            assert.equal(resp.status, 200);
            assert.equal(resp.body.changePassword, true);

            await s.post("/do/change-password/", {
                oldPassword: "Admin-Set-5",
                newPassword: "User-Set-6"
            });
            resp = await new Session().signIn(u.name, "User-Set-6");
            assert.equal(resp.body.changePassword, false);
        });
    });

    it("updates the linked contact with /do/change-user-info/",
            async function () {
        let u = await access.createUser(admin);
        let s = await signedIn(u.name, u.password);
        let email = "changed-" + u.email;
        let resp = await s.raw("POST", "/do/change-user-info/", {
            firstName: "Changed",
            lastName: "Person",
            email,
            phone: "555-0100"
        });

        assert.equal(resp.status, 204);
        let contact = await admin.read("Employee", u.contactId);
        assert.equal(contact.firstName, "Changed");
        assert.equal(contact.lastName, "Person");
        assert.equal(contact.email, email);
        assert.equal(contact.phone, "555-0100");

        resp = await new Session().signIn(u.name, u.password);
        assert.equal(resp.body.firstName, "Changed");
        assert.equal(resp.body.email, email);
    });

    it("locks the account after more than three failed sign-ins",
            async function () {
        let u = await access.createUser(admin);
        let bodies = [];
        let i = 0;
        let resp;

        while (i < 4) {
            resp = await new Session().signIn(u.name, "wrong-password");
            assert.equal(resp.status, 401);
            bodies.push(String(resp.body));
            i += 1;
        }
        assert.match(bodies[2], /One more attempt before account is locked/);
        assert.match(bodies[3], /Too many sign in attempts\. Account is locked/);

        let row = await access.account(u.name);
        assert.equal(row.sign_in_attempts, 4);
        assert.equal(row.is_locked, true);

        // The right password no longer helps
        resp = await new Session().signIn(u.name, u.password);
        assert.equal(resp.status, 401);
        assert.match(String(resp.body), /User account is locked/);

        // Unlocking resets the counter
        resp = await admin.raw(
            "PATCH",
            "/data/user-account/" + u.id,
            [{op: "replace", path: "/isLocked", value: false}]
        );
        assert.equal(resp.status, 200);
        row = await access.account(u.name);
        assert.equal(row.is_locked, false);
        assert.equal(row.sign_in_attempts, 0);
        assert.equal((await new Session().signIn(u.name, u.password)).status, 200);
    });

    it("resets the failed attempt counter on a good sign-in",
            async function () {
        let u = await access.createUser(admin);
        await new Session().signIn(u.name, "wrong-password");
        assert.equal((await access.account(u.name)).sign_in_attempts, 1);

        assert.equal((await new Session().signIn(u.name, u.password)).status, 200);
        assert.equal((await access.account(u.name)).sign_in_attempts, 0);
    });

    it("deactivating a user removes the login and blocks sign-in",
            async function () {
        let u = await access.createUser(admin);
        let resp = await admin.raw(
            "PATCH",
            "/data/user-account/" + u.id,
            [{op: "replace", path: "/isActive", value: false}]
        );

        assert.equal(resp.status, 200);
        assert.equal((await access.roleInfo(u.name)).rolcanlogin, false);
        resp = await new Session().signIn(u.name, u.password);
        assert.equal(resp.status, 401);
        assert.match(String(resp.body), /No active user account/);

        resp = await admin.raw(
            "PATCH",
            "/data/user-account/" + u.id,
            [{op: "replace", path: "/isActive", value: true}]
        );
        assert.equal(resp.status, 200);
        assert.equal((await access.roleInfo(u.name)).rolcanlogin, true);
        assert.equal((await new Session().signIn(u.name, u.password)).status, 200);
    });

    it("ends existing sessions of a deactivated user", {
        todo: "defect: a deactivated user's open session keeps working"
    }, async function () {
        let u = await access.createUser(admin);
        let s = await signedIn(u.name, u.password);
        await admin.patch(
            "UserAccount",
            u.id,
            [{op: "replace", path: "/isActive", value: false}]
        );

        let resp = await s.raw("POST", "/data/contacts", {filter: {limit: 1}});
        assert.equal(resp.status, 401);
    });

    describe("what a non-super user may do", function () {
        let user;
        let other;
        let session;
        let savedGrants = [];

        // These tests check the code's authorization, so they need the
        // grants a fresh install gives "everyone" on Role (read only) and
        // UserAccount (none). A database whose administrators widened
        // those grants would otherwise fail them for a data reason. Only
        // the throwaway copy is changed, and it is put back afterwards.
        const GRANT_FEATHERS = ["role", "user_account"];

        before(async function () {
            let resp = await db.query(
                "SELECT a.object_pk, a.role, a.can_create, a.can_read, " +
                "  a.can_update, a.can_delete " +
                "FROM \"$auth\" a JOIN \"$feather\" f ON f._pk = a.object_pk " +
                "WHERE f.id = ANY($1) AND a.role = 'everyone'",
                [GRANT_FEATHERS]
            );
            savedGrants = resp.rows;
            await db.query(
                "DELETE FROM \"$auth\" a USING \"$feather\" f " +
                "WHERE f._pk = a.object_pk AND f.id = ANY($1) " +
                "  AND a.role = 'everyone'",
                [GRANT_FEATHERS]
            );
            await db.query(
                "INSERT INTO \"$auth\" (object_pk, role, can_create, " +
                "  can_read, can_update, can_delete) " +
                "SELECT _pk, 'everyone', false, true, false, false " +
                "FROM \"$feather\" WHERE id = 'role'"
            );
            user = await access.createUser(admin);
            other = await access.createUser(admin);
            session = await signedIn(user.name, user.password);
        });

        after(async function () {
            await db.query(
                "DELETE FROM \"$auth\" a USING \"$feather\" f " +
                "WHERE f._pk = a.object_pk AND f.id = ANY($1) " +
                "  AND a.role = 'everyone'",
                [GRANT_FEATHERS]
            );
            await Promise.all(savedGrants.map((g) => db.query(
                "INSERT INTO \"$auth\" (object_pk, role, can_create, " +
                "  can_read, can_update, can_delete) " +
                "VALUES ($1, $2, $3, $4, $5, $6)",
                [g.object_pk, g.role, g.can_create, g.can_read,
                        g.can_update, g.can_delete]
            )));
        });

        it("cannot make themselves a super user", async function () {
            let resp = await session.raw(
                "PATCH",
                "/data/user-account/" + user.id,
                [{op: "replace", path: "/isSuper", value: true}]
            );

            assert.ok(resp.status >= 400);
            assert.equal((await access.account(user.name)).is_super, false);
            assert.equal((await access.roleInfo(user.name)).rolcreatedb, false);
        });

        it("cannot set another user's password", async function () {
            let resp = await session.raw(
                "PATCH",
                "/data/user-account/" + other.id,
                [{op: "replace", path: "/password", value: "Hijack-7"}]
            );

            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /Not authorized to update/);
            assert.equal(await access.pgLogin(other.name, "Hijack-7"), false);
            assert.equal(await access.pgLogin(other.name, other.password), true);
        });

        it("gets no record reading another account by id", async function () {
            let resp = await session.raw(
                "GET",
                "/data/user-account/" + other.id
            );

            assert.equal(resp.status, 204);
            assert.equal(resp.body, undefined);
        });

        it("cannot create roles", async function () {
            let name = access.track(access.uniq("fbt_denied"));
            let resp = await session.raw("POST", "/data/role", {
                name,
                membership: []
            });

            assert.equal(resp.status, 401);
            assert.match(String(resp.body), /Not authorized to create "Role"/);
            assert.equal(await access.roleInfo(name), undefined);
        });

        // server.js doQueryRequest forces isSuper for Form, Module, Role
        // and UserAccount queries
        it("cannot list all user accounts", {
            todo: (
                "defect: POST /data/user-accounts runs as super user for " +
                "any signed-in user (server.js doQueryRequest)"
            )
        }, async function () {
            let rows = await session.list("UserAccounts", {
                properties: ["name"]
            });
            let names = rows.map((row) => row.name);

            assert.ok(!names.includes(settings.adminUser), names.join());
            assert.ok(!names.includes(other.name), names.join());
        });
    });
});

describe("roles", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    after(async function () {
        await access.dropAll();
    });

    it("POST /data/role creates a NOLOGIN Postgres role", async function () {
        let name = access.track(access.uniq("fbt_role"));
        let role = await admin.create("Role", {name, membership: []});

        assert.equal(role.name, name);
        assert.deepEqual(await access.roleInfo(name), {
            rolname: name,
            rolcanlogin: false,
            rolcreatedb: false,
            rolsuper: false
        });
    });

    it("derives the Postgres role name lower case with underscores",
            async function () {
        let tail = access.uniq("x").slice(2);
        let name = "Fbt Mixed " + tail;
        let pgName = access.track("fbt_mixed_" + tail);
        let role = await admin.create("Role", {name, membership: []});

        assert.equal(role.name, name);
        assert.ok(await access.roleInfo(pgName), "role " + pgName);
    });

    it("grants and revokes Postgres membership through " +
            "UserAccount.membership", async function () {
        let clerk = access.track(access.uniq("fbt_clerk"));
        let u = await access.createUser(admin);
        await admin.create("Role", {name: clerk, membership: []});

        await admin.patch("UserAccount", u.id, [{
            op: "add",
            path: "/membership/1",
            value: {role: clerk}
        }]);
        assert.deepEqual(await memberships(u.name), [clerk, "everyone"].sort());
        let rec = await admin.read("UserAccount", u.id);
        assert.deepEqual(
            rec.membership.map((m) => m.role).sort(),
            [clerk, "everyone"].sort()
        );

        await admin.patch("UserAccount", u.id, [{
            op: "remove",
            path: "/membership/1"
        }]);
        assert.deepEqual(await memberships(u.name), ["everyone"]);
    });

    it("DELETE /data/role drops the Postgres role", async function () {
        let name = access.track(access.uniq("fbt_gone"));
        let role = await admin.create("Role", {name, membership: []});

        await admin.remove("Role", role.id);
        assert.equal(await access.roleInfo(name), undefined);
    });

    it("leaves an existing login role alone when a Role of the same " +
            "name is created", {
        todo: (
            "plan 1.1: createRole (role.js:230) makes the existing login " +
            "role NOLOGIN and blanks its password"
        )
    }, async function () {
        let name = access.uniq("fbt_tenant");
        await access.sqlRole(name, "Other-Tenant-Pw1");
        await admin.raw("POST", "/data/role", {name, membership: []});

        assert.equal((await access.roleInfo(name)).rolcanlogin, true);
        assert.equal(await access.pgLogin(name, "Other-Tenant-Pw1"), true);
    });
});
