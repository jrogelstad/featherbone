/*
    A person with no contact, given one (an administrator saving their
    details, an invitation, "Forgot password", "Edit my contact
    information"), becomes an Employee where the installation has one.

    SupplyChain's Common module keeps a trigger on UserAccount that
    patches the account's contact as an Employee, assuming every user
    account is backed by one. A plain Contact linked to an account made
    that trigger fail with "Cannot read properties of undefined
    (reading 'type')", so on such an installation no one provisioned at
    first sign-in could have details saved and no invitation could go.
    The test installation has no Employee, so the claims build the
    feather the way Common defines it (number is the required natural
    key, isActive defaults true).
    (server/datasource.js changeUserInfo)
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const access = require("./lib/access");

describe("a new contact is an Employee where there is an Employee",
        function () {
    let admin;
    let employee;

    function employees(name) {
        return db.withClient(settings.testDb, (client) => client.query(
            (
                "SELECT e.number, e.is_active, e.email, e.user_account " +
                "FROM user_account u JOIN employee e " +
                "  ON e._pk = u._contact_contact_pk " +
                "WHERE u.name = $1"
            ),
            [name]
        ));
    }

    async function person(prefix, password) {
        let name = access.track(access.uniq(prefix));
        let made = await admin.raw("POST", "/admin/identity", {
            email: name + "@example.com",
            fullName: "Fbt " + prefix,
            password,
            username: name
        });

        assert.ok(made.status < 300, JSON.stringify(made.body));

        // First sign-in makes the profile, with no contact (B.7)
        assert.equal((await new Session().signIn(name, password)).status, 200);

        let overview = await admin.get("/admin/overview");

        return {
            id: overview.identities.find((one) => one.username === name).id,
            name
        };
    }

    before(async function () {
        admin = await signedIn();

        /*
            An installation with SupplyChain's Common module deployed
            already has Employee, and that is the definition this is
            about, so it is used where it is there. Only an
            installation without one builds the feather, the way Common
            defines it, and only that one takes it away again.
        */
        if (await admin.get("/feather/Employee")) {
            return;
        }

        employee = await access.createFeather(admin, {
            inherits: "Contact",
            name: "Employee",
            plural: "Employees",
            properties: [{
                description: "Number",
                isNaturalKey: true,
                isRequired: true,
                name: "number",
                type: "string"
            }, {
                default: true,
                description: "Active",
                isRequired: true,
                name: "isActive",
                type: "boolean"
            }, {
                description: "User account",
                name: "userAccount",
                type: "string"
            }]
        });
    });

    after(async function () {
        await access.dropAll();
        if (employee) {
            await access.deleteFeather(admin, employee);
        }
    });

    it("saves an administrator's edit as an Employee", async function () {
        let one = await person("fbt_emp", "Emp-Pw-1");
        let resp = await admin.raw("POST", "/admin/identity/info", {
            email: "emp@example.com",
            firstName: "Eve",
            id: one.id,
            lastName: "Employee",
            phone: "555-0101"
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));

        let rows = (await employees(one.name)).rows;

        assert.equal(rows.length, 1, "the account's contact is an Employee");
        assert.equal(rows[0].number, one.name.toUpperCase());
        assert.equal(rows[0].is_active, true);
        assert.equal(rows[0].email, "emp@example.com");
    });

    it("does not take a number another employee already has",
            async function () {
        let one = await person("fbt_dup", "Emp-Pw-2");

        await admin.create("Employee", {
            email: "held@example.com",
            isActive: true,
            lastName: "Holder",
            number: one.name.toUpperCase()
        });

        let resp = await admin.raw("POST", "/admin/identity/info", {
            email: "a@example.com",
            firstName: "A",
            id: one.id,
            lastName: "One"
        });

        assert.ok(resp.status < 300, JSON.stringify(resp.body));
        assert.equal(
            (await employees(one.name)).rows[0].number,
            one.name.toUpperCase() + "-2"
        );
    });
});
