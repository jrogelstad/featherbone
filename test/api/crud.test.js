/*
    Generic record lifecycle through the /data/<feather> API
    (server.js doRequest -> datasource.request -> crud.doInsert/doSelect/
    doUpdate/doDelete): POST answers with a JSON patch of server-side
    changes, GET by id, PATCH with JSON patch, soft DELETE, validation
    errors, read-only properties, relations, child arrays and natural keys.

    Uses core feathers that need no setup: Kind/Category (Category
    inherits Kind and its natural key), Location, Contact with its child
    arrays, and Terms (validated by a SupplyChain trigger).
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {signedIn} = require("../harness/http");
const {uniq, money} = require("../harness/fixtures");
const {expectError, patchValue} = require("./lib/data-api");

const SYSTEM_PATHS = [
    "/id", "/created", "/createdBy", "/updated", "/updatedBy",
    "/isDeleted", "/lock", "/objectType", "/owner", "/etag"
];
const ID = /^[0-9a-z]{8,16}$/;

function newId() {
    return (
        "rt" + Date.now().toString(36) +
        Math.random().toString(36).slice(2, 6)
    );
}

describe("data API record lifecycle", function () {
    let admin;

    before(async function () {
        admin = await signedIn();
    });

    describe("POST /data/<feather>", function () {
        it("answers 200 with a JSON patch filling system properties",
                async function () {
            let code = uniq("KND");
            let resp = await admin.raw("POST", "/data/kind", {
                code,
                description: "Created"
            });

            assert.equal(resp.status, 200);
            assert.ok(Array.isArray(resp.body), "body is a JSON patch");
            let paths = resp.body.map((o) => o.path);
            SYSTEM_PATHS.forEach(function (path) {
                assert.ok(paths.includes(path), "patch sets " + path);
            });
            // Only additions: nothing the client sent was changed
            assert.deepEqual(
                resp.body.filter((o) => o.op !== "add"),
                []
            );
            assert.match(patchValue(resp.body, "/id"), ID);
            assert.equal(
                patchValue(resp.body, "/createdBy"),
                settings.adminUser
            );
            assert.equal(
                patchValue(resp.body, "/updatedBy"),
                settings.adminUser
            );
            assert.equal(patchValue(resp.body, "/owner"), settings.adminUser);
            assert.equal(patchValue(resp.body, "/objectType"), "Kind");
            assert.equal(patchValue(resp.body, "/isDeleted"), false);
            assert.equal(patchValue(resp.body, "/lock"), null);
            assert.match(patchValue(resp.body, "/etag"), ID);
            assert.equal(
                patchValue(resp.body, "/created"),
                patchValue(resp.body, "/updated")
            );
            assert.ok(
                !Number.isNaN(Date.parse(patchValue(resp.body, "/created")))
            );
            // Unsent properties get their defaults
            assert.equal(patchValue(resp.body, "/note"), "");
            assert.equal(paths.includes("/code"), false);
        });

        it("fills feather defaults, format defaults and child arrays",
                async function () {
            let loc = await admin.create("Location", {name: uniq("LOC")});
            assert.equal(loc.type, "N"); // property default
            assert.equal(loc.description, ""); // string default

            let contact = await admin.create("Contact", {
                firstName: "Ada",
                lastName: uniq("Lovelace")
            });
            assert.equal(contact.phoneType, "M");
            assert.equal(contact.emailType, "P");
            assert.equal(contact.honorific, null);
            assert.equal(contact.address, null);
            assert.deepEqual(contact.phones, []);
            assert.deepEqual(contact.emails, []);
            assert.deepEqual(contact.addresses, []);
            assert.deepEqual(contact.social, []);
        });

        it("reports trigger-computed values and overrides read-only input",
                async function () {
            let last = uniq("Byron");
            let resp = await admin.raw("POST", "/data/contact", {
                firstName: "Ada",
                lastName: last,
                fullName: "Somebody Else"
            });
            assert.equal(resp.status, 200);
            assert.deepEqual(
                resp.body.find((o) => o.path === "/fullName"),
                {op: "replace", path: "/fullName", value: "Ada " + last}
            );
        });

        it("ignores system properties sent by the client", async function () {
            let resp = await admin.raw("POST", "/data/kind", {
                code: uniq("KND"),
                created: "2000-01-01T00:00:00.000Z",
                createdBy: "somebody",
                updatedBy: "somebody",
                isDeleted: true,
                objectType: "Category"
            });
            assert.equal(resp.status, 200);

            let replaced = {};
            resp.body.filter((o) => o.op === "replace").forEach(
                (o) => (replaced[o.path] = o.value)
            );
            assert.equal(replaced["/createdBy"], settings.adminUser);
            assert.equal(replaced["/updatedBy"], settings.adminUser);
            assert.equal(replaced["/isDeleted"], false);
            assert.equal(replaced["/objectType"], "Kind");
            assert.notEqual(replaced["/created"], "2000-01-01T00:00:00.000Z");
            assert.ok(Date.parse(replaced["/created"]) > Date.parse("2020-01-01"));

            let row = await db.query(
                "SELECT created_by, is_deleted, tableoid::regclass::text AS t " +
                "FROM object WHERE id = $1",
                [patchValue(resp.body, "/id")]
            );
            assert.deepEqual(row.rows[0], {
                created_by: settings.adminUser,
                is_deleted: false,
                t: "kind"
            });
        });

        it("creates a new record when the id sent already exists",
                async function () {
            let first = await admin.create("Kind", {code: uniq("KND")});
            let resp = await admin.raw("POST", "/data/kind", {
                id: first.id,
                code: uniq("KND")
            });
            assert.equal(resp.status, 200);
            let replaced = resp.body.find((o) => o.path === "/id");
            assert.equal(replaced.op, "replace");
            assert.notEqual(replaced.value, first.id);
            assert.equal((await admin.read("Kind", first.id)).code, first.code);
        });

        it("uses a client supplied id that is new", async function () {
            let id = newId();
            let resp = await admin.raw("POST", "/data/kind", {
                id,
                code: uniq("KND")
            });
            assert.equal(resp.status, 200);
            assert.equal(resp.body.find((o) => o.path === "/id"), undefined);
            assert.equal((await admin.read("Kind", id)).id, id);
        });

        it("rejects a property the feather does not have", async function () {
            expectError(
                await admin.raw("POST", "/data/kind", {
                    code: uniq("KND"),
                    bogus: 1
                }),
                500,
                "Feather \"Kind\" does not contain property \"bogus\""
            );
        });

        it("rejects a required property sent as null", async function () {
            expectError(
                await admin.raw("POST", "/data/location", {
                    name: uniq("LOC"),
                    description: null
                }),
                500,
                "\"description\" is required on Location."
            );
        });

        it("rejects a required natural key sent as null", async function () {
            expectError(
                await admin.raw("POST", "/data/kind", {code: null}),
                500,
                "\"code\" is required on Kind."
            );
        });

        it("rejects a required property that is omitted", async function () {
            let resp = await admin.raw("POST", "/data/kind", {
                description: "No code"
            });
            assert.ok(
                resp.status >= 400,
                "saved a Kind without its required code: " +
                JSON.stringify(resp.body).slice(0, 200)
            );
        });

        it("runs module trigger validation (Terms deposit)", async function () {
            expectError(
                await admin.raw("POST", "/data/terms", {code: uniq("NET")}),
                500,
                "Deposit money object is required on terms."
            );
            let terms = await admin.create("Terms", {
                code: uniq("NET"),
                policy: "N",
                net: 30,
                depositRequired: false,
                depositAmount: money(0)
            });
            assert.equal(terms.net, 30);
            assert.equal(terms.depositAmount.currency, "USD");
        });

        it("rejects a relation to an id that does not exist",
                async function () {
            expectError(
                await admin.raw("POST", "/data/category", {
                    code: uniq("CAT"),
                    parent: {id: "nosuchid"}
                }),
                500,
                "Relation not found in \"Kind\" for \"parent\" with id " +
                "\"nosuchid\""
            );
        });

        it("stores and returns a to-one relation", async function () {
            let kind = await admin.create("Kind", {
                code: uniq("KND"),
                description: "Parent kind"
            });
            let cat = await admin.create("Category", {
                code: uniq("CAT"),
                parent: {id: kind.id}
            });
            let read = await admin.read("Category", cat.id);
            // Relation comes back with the feather's relation properties
            assert.deepEqual(read.parent, {
                id: kind.id,
                code: kind.code,
                description: "Parent kind",
                objectType: "Kind"
            });
        });
    });

    describe("GET /data/<feather>/:id", function () {
        it("returns the full record, same as the merged POST result",
                async function () {
            let created = await admin.create("Kind", {
                code: uniq("KND"),
                description: "Read me"
            });
            let read = await admin.read("Kind", created.id);
            assert.deepEqual(read, created);
        });

        it("answers 204 with no body for an unknown id", async function () {
            let resp = await admin.raw("GET", "/data/kind/nosuchid");
            assert.equal(resp.status, 204);
            assert.equal(resp.body, undefined);
        });
    });

    describe("PATCH /data/<feather>/:id", function () {
        let kind;

        before(async function () {
            kind = await admin.create("Kind", {
                code: uniq("KND"),
                description: "Before"
            });
        });

        it("applies a JSON patch and answers with server changes",
                async function () {
            let resp = await admin.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "After"}
            ]);
            assert.equal(resp.status, 200);
            assert.deepEqual(
                resp.body.map((o) => o.op + " " + o.path).sort(),
                ["replace /etag", "replace /updated"]
            );
            let read = await admin.read("Kind", kind.id);
            assert.equal(read.description, "After");
            assert.equal(read.etag, patchValue(resp.body, "/etag"));
            assert.notEqual(read.etag, kind.etag);
            assert.ok(Date.parse(read.updated) > Date.parse(kind.updated));
            assert.equal(read.created, kind.created);
            kind = read;
        });

        it("records the updating user", async function () {
            let row = await db.query(
                "SELECT updated_by FROM kind WHERE id = $1",
                [kind.id]
            );
            assert.equal(row.rows[0].updated_by, settings.adminUser);
        });

        it("ignores patches to read-only system properties",
                async function () {
            let resp = await admin.raw("PATCH", "/data/kind/" + kind.id, [
                {
                    op: "replace",
                    path: "/created",
                    value: "2000-01-01T00:00:00.000Z"
                },
                {op: "replace", path: "/createdBy", value: "somebody"},
                {op: "replace", path: "/etag", value: "chosen-etag"}
            ]);
            assert.equal(resp.status, 200);
            // Server reverts them and tells the client
            assert.equal(patchValue(resp.body, "/created"), kind.created);
            assert.equal(patchValue(resp.body, "/createdBy"), settings.adminUser);
            assert.notEqual(patchValue(resp.body, "/etag"), "chosen-etag");

            let read = await admin.read("Kind", kind.id);
            assert.equal(read.created, kind.created);
            assert.equal(read.createdBy, settings.adminUser);
            assert.notEqual(read.etag, "chosen-etag");
            kind = read;
        });

        it("answers an empty patch with an empty array", async function () {
            let resp = await admin.raw("PATCH", "/data/kind/" + kind.id, []);
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, []);
            assert.equal((await admin.read("Kind", kind.id)).etag, kind.etag);
        });

        it("rejects setting a required property to null", async function () {
            expectError(
                await admin.raw("PATCH", "/data/kind/" + kind.id, [
                    {op: "replace", path: "/code", value: null}
                ]),
                500,
                "\"code\" is required."
            );
            assert.equal((await admin.read("Kind", kind.id)).code, kind.code);
        });

        // Used to crash the whole server: crud.js dropped the rejected
        // promise of afterGetRelKey (plan 0.2 / 6.1)
        it("rejects changing a relation to an unknown id", async function () {
            let cur = await admin.create("Currency", {
                code: uniq("RU").slice(0, 14),
                description: "Relation probe",
                symbol: "R",
                minorUnit: 2
            });
            expectError(
                await admin.raw("PATCH", "/data/currency/" + cur.id, [
                    {op: "add", path: "/displayUnit", value: {id: "nosuchid"}}
                ]),
                500,
                "Relation not found in \"CurrencyUnit\" for \"displayUnit\" " +
                "with id \"nosuchid\""
            );
            // And the server is still up
            assert.equal((await admin.read("Currency", cur.id)).id, cur.id);
        });

        it("answers a clear not-found error for an unknown id",
                async function () {
            let resp = await admin.raw("PATCH", "/data/kind/nosuchid", [
                {op: "replace", path: "/description", value: "x"}
            ]);
            assert.ok(resp.status >= 400);
            assert.match(String(resp.body), /not found/i);
        });
    });

    describe("DELETE /data/<feather>/:id", function () {
        let kind;

        before(async function () {
            kind = await admin.create("Kind", {code: uniq("KDEL")});
        });

        it("soft deletes and answers true", async function () {
            let resp = await admin.raw("DELETE", "/data/kind/" + kind.id);
            assert.equal(resp.status, 200);
            assert.equal(resp.body, true);

            let row = await db.query(
                "SELECT is_deleted, updated_by, lock FROM object WHERE id = $1",
                [kind.id]
            );
            assert.deepEqual(row.rows[0], {
                is_deleted: true,
                updated_by: settings.adminUser,
                lock: null
            });
        });

        it("hides the record from GET and from queries", async function () {
            let resp = await admin.raw("GET", "/data/kind/" + kind.id);
            assert.equal(resp.status, 204);
            let rows = await admin.findBy("Kinds", "code", kind.code);
            assert.deepEqual(rows, []);
        });

        it("returns it to queries with showDeleted", async function () {
            let rows = await admin.list("Kinds", {
                showDeleted: true,
                filter: {criteria: [{property: "code", value: kind.code}]}
            });
            assert.equal(rows.length, 1);
            assert.equal(rows[0].id, kind.id);
            assert.equal(rows[0].isDeleted, true);
        });

        it("rejects deleting twice", async function () {
            expectError(
                await admin.raw("DELETE", "/data/kind/" + kind.id),
                500,
                "Record " + kind.id + " already deleted."
            );
        });

        it("rejects an unknown id", async function () {
            expectError(
                await admin.raw("DELETE", "/data/kind/nosuchid"),
                500,
                "Record nosuchid not found."
            );
        });

        it("rejects a PATCH of the deleted record", async function () {
            let resp = await admin.raw("PATCH", "/data/kind/" + kind.id, [
                {op: "replace", path: "/description", value: "zombie"}
            ]);
            assert.ok(resp.status >= 400, "status " + resp.status);
            let row = await db.query(
                "SELECT description FROM kind WHERE id = $1",
                [kind.id]
            );
            assert.notEqual(row.rows[0].description, "zombie");
        });

        it("frees the natural key for a new record", async function () {
            let again = await admin.create("Kind", {code: kind.code});
            assert.notEqual(again.id, kind.id);
            assert.equal(again.code, kind.code);
        });
    });

    describe("child arrays (Contact emails and addresses)", function () {
        let contact;
        let addressId = newId();

        before(async function () {
            contact = await admin.create("Contact", {
                firstName: "Grace",
                lastName: uniq("Hopper"),
                emails: [
                    {type: "W", email: "work@example.com"},
                    {type: "H", email: "home@example.com"}
                ],
                addresses: [{
                    address: {
                        id: addressId,
                        street: "1 Navy Way",
                        city: "Arlington",
                        state: "VA",
                        postalCode: "22201",
                        country: "United States"
                    }
                }]
            });
        });

        async function emailRows() {
            let resp = await db.query(
                "SELECT e.id, e.email, e.is_deleted FROM contact_email e " +
                "JOIN contact c ON c._pk = e._parent_contact_pk " +
                "WHERE c.id = $1 ORDER BY e._pk",
                [contact.id]
            );
            return resp.rows;
        }

        it("creates children with the parent", async function () {
            assert.equal(contact.emails.length, 2);
            contact.emails.forEach(function (row) {
                assert.match(row.id, ID);
                assert.equal(row.objectType, "ContactEmail");
                assert.equal(row.createdBy, settings.adminUser);
                assert.equal(row.isDeleted, false);
            });
            assert.equal(contact.addresses.length, 1);
            assert.equal(contact.addresses[0].objectType, "ContactAddress");
            assert.equal(contact.addresses[0].address.id, addressId);
            assert.equal(contact.addresses[0].address.type, "W"); // default

            let read = await admin.read("Contact", contact.id);
            assert.deepEqual(
                read.emails.map((e) => e.email),
                ["work@example.com", "home@example.com"]
            );
            assert.equal(read.addresses[0].address.street, "1 Navy Way");
        });

        it("updates, inserts and removes children in one PATCH",
                async function () {
            let keep = contact.emails[0].id;
            let drop = contact.emails[1].id;
            let read = await admin.update("Contact", contact.id, function (r) {
                r.emails[0].email = "office@example.com";
                r.emails.splice(1, 1);
                r.emails.push({type: "O", email: "other@example.com"});
            });

            assert.deepEqual(
                read.emails.map((e) => e.email),
                ["office@example.com", "other@example.com"]
            );
            assert.equal(read.emails[0].id, keep);
            assert.match(read.emails[1].id, ID);

            let rows = await emailRows();
            assert.deepEqual(
                rows.map((r) => [r.email, r.is_deleted]),
                [
                    ["office@example.com", false],
                    ["home@example.com", true],
                    ["other@example.com", false]
                ]
            );
            assert.equal(rows[1].id, drop);
        });

        it("soft deletes a removed child row", async function () {
            let read = await admin.update("Contact", contact.id, function (r) {
                r.addresses = [];
            });
            assert.deepEqual(read.addresses, []);
            let rows = await db.query(
                "SELECT ca.is_deleted FROM contact_address ca " +
                "JOIN contact c ON c._pk = ca._parent_contact_pk " +
                "WHERE c.id = $1",
                [contact.id]
            );
            assert.deepEqual(rows.rows, [{is_deleted: true}]);
        });

        it("refuses to create a child row directly", async function () {
            expectError(
                await admin.raw("POST", "/data/contact-email", {
                    parent: {id: contact.id},
                    type: "W",
                    email: "direct@example.com"
                }),
                500,
                "Child records may only be created from the parent."
            );
        });

        it("creates an embedded child relation without a client id", {
            todo: "defect: isChild relation (ContactAddress.address) needs " +
                    "a client-generated id, else 'Relation not found ... " +
                    "with id \"undefined\"' (crud.js doInsert isChild branch)"
        }, async function () {
            let resp = await admin.raw("POST", "/data/contact", {
                firstName: "No",
                lastName: uniq("Id"),
                addresses: [{
                    address: {
                        street: "2 Main",
                        city: "Springfield",
                        state: "IL",
                        postalCode: "62701",
                        country: "United States"
                    }
                }]
            });
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("soft deletes children with the parent", async function () {
            await admin.remove("Contact", contact.id);
            let rows = await emailRows();
            assert.ok(rows.length >= 3);
            assert.ok(rows.every((r) => r.is_deleted), JSON.stringify(rows));
        });
    });

    describe("natural keys", function () {
        let kind;

        before(async function () {
            kind = await admin.create("Kind", {code: uniq("NK")});
        });

        it("rejects a duplicate on POST", async function () {
            expectError(
                await admin.raw("POST", "/data/kind", {code: kind.code}),
                500,
                "Value '" + kind.code + "' assigned to Code on Kind is not " +
                "unique to data type Kind."
            );
        });

        it("checks uniqueness across the inheritance tree", async function () {
            // Category inherits Kind's natural key
            expectError(
                await admin.raw("POST", "/data/category", {code: kind.code}),
                500,
                "Value '" + kind.code + "' assigned to Code on Category is " +
                "not unique to data type Kind."
            );
        });

        it("rejects a duplicate on PATCH", async function () {
            let other = await admin.create("Kind", {code: uniq("NK")});
            expectError(
                await admin.raw("PATCH", "/data/kind/" + other.id, [
                    {op: "replace", path: "/code", value: kind.code}
                ]),
                500,
                "Value '" + kind.code + "' assigned to Code on Kind is not " +
                "unique to data type Kind."
            );
        });

        it("is enforced by a unique index in the database", {
            todo: "plan 2.6: natural keys are only checked in crud.js; " +
                    "no unique index, so concurrent inserts can duplicate"
        }, async function () {
            let resp = await db.query(
                "SELECT count(*)::int AS n FROM pg_index i " +
                "JOIN pg_attribute a ON a.attrelid = i.indrelid " +
                "  AND a.attnum = i.indkey[0] " +
                "WHERE i.indrelid = 'kind'::regclass AND i.indisunique " +
                "  AND i.indnatts = 1 AND a.attname = 'code'"
            );
            assert.equal(resp.rows[0].n, 1, "unique index on kind(code)");
        });
    });
});
