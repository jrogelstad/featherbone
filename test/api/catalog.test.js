/*
    Catalog and session-level endpoints (server.js core routes):
    GET /feather/:name (inheritance merged), GET /settings-definition,
    GET /workbooks, GET /workbook/:name, GET/PUT/PATCH /profile,
    GET /currency/base, GET /currency/convert, GET /do/is-authorized,
    GET /sessions, and the module route list (POST /data/routes).

    Large structures are compared with golden files (test/golden/
    catalog-*.json) so a refactor that changes the catalog is detected.
    Only metadata that came with the cloned database is included:
    feathers, workbooks and routes created after the run started (by
    other test files) are left out.
*/
/*jslint node*/
"use strict";

const {describe, it, before, after} = require("node:test");
const assert = require("node:assert/strict");
const settings = require("../harness/env");
const db = require("../harness/db");
const {Session, signedIn} = require("../harness/http");
const {uniq} = require("../harness/fixtures");
const {matchGolden} = require("../harness/golden");
const {
    dropUser,
    expectError,
    runStarted,
    signedInAs
} = require("./lib/data-api");

const KEEP_ALL = {drop: new Set()};

function toSnake(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

// One line per property so golden diffs stay readable. owner is the
// feather the property is read from: an inheritedFrom naming it is
// dropped because getFeather sets that inconsistently (see todo below).
function propertySignature(p, owner) {
    let sig;
    let t = p.type;

    if (t && typeof t === "object") {
        sig = "relation(" + t.relation + ")";
        if (t.childOf) {
            sig += " childOf:" + t.childOf;
        }
        if (t.parentOf) {
            sig += " parentOf:" + t.parentOf;
        }
        if (t.isChild) {
            sig += " isChild";
        }
        if (Array.isArray(t.properties)) {
            sig += " [" + t.properties.join(",") + "]";
        }
    } else {
        sig = String(t);
    }
    if (p.format) {
        sig += ":" + p.format;
    }
    [
        ["isRequired", "required"],
        ["isNaturalKey", "naturalKey"],
        ["isReadOnly", "readOnly"],
        ["isLabelKey", "labelKey"],
        ["isIndexed", "indexed"],
        ["isEncrypted", "encrypted"],
        ["isAlwaysLoad", "alwaysLoad"]
    ].forEach(function (pair) {
        if (p[pair[0]]) {
            sig += " " + pair[1];
        }
    });
    if (p.default !== undefined && p.default !== null && p.default !== "") {
        sig += " default=" + JSON.stringify(p.default);
    }
    // The feather editor (client/models/feather.js, type change) writes
    // precision/scale -1 and min/max 0 on non-numeric properties to mean
    // "not applicable"; installed feathers leave them out. Treat both the
    // same so a feather saved through the UI matches a fresh install.
    // On number and integer properties min and max are real settings
    // (min 0 rejects negatives, see model.js validation, and
    // UserAccount.signInAttempts really does declare max 0), so keep them.
    let numeric = (t === "number" || t === "integer");
    let notApplicable = function (key, value) {
        return !numeric && p[key] === value;
    };
    // Precision and scale are the exception: -1 is the sentinel whatever
    // the type. Nothing in the framework or in SupplyChain declares -1,
    // and a number with no declared precision carries it too, so rendering
    // it produced "numeric(-1,-1)" on every undeclared numeric property.
    if (p.precision !== undefined && p.precision !== -1) {
        sig += " numeric(" + p.precision + "," + p.scale + ")";
    }
    if (p.min !== undefined && !notApplicable("min", 0)) {
        sig += " min=" + p.min;
    }
    if (p.max !== undefined && !notApplicable("max", 0)) {
        sig += " max=" + p.max;
    }
    if (p.autonumber) {
        // Key order depends on how the catalog was stored (json vs jsonb)
        sig += " autonumber=" + JSON.stringify(
            p.autonumber,
            Object.keys(p.autonumber).sort()
        );
    }
    if (Array.isArray(p.dataList)) {
        sig += " list=" + p.dataList.map(
            (d) => (
                typeof d === "object"
                ? d.value
                : d
            )
        ).join("|");
    }
    if (p.inheritedFrom && p.inheritedFrom !== owner) {
        sig += " <" + p.inheritedFrom;
    }
    return sig;
}

// Strip generated ids out of overload data lists
function overloadSignature(overloads) {
    let out = {};
    Object.keys(overloads || {}).forEach(function (key) {
        out[key] = propertySignature(Object.assign(
            {type: "(overload)"},
            overloads[key]
        ));
    });
    return out;
}

describe("catalog endpoints", function () {
    let admin;
    let started;
    let catalog;
    let newFeathers;

    before(async function () {
        admin = await signedIn();
        started = await runStarted();
        catalog = (await admin.get("/settings/catalog")).data;
        let resp = await db.query(
            "SELECT id FROM \"$feather\" WHERE created >= $1",
            [started]
        );
        newFeathers = new Set(resp.rows.map((r) => r.id));
    });

    function installedFeathers() {
        return Object.keys(catalog).filter(
            (name) => !newFeathers.has(toSnake(name))
        ).sort();
    }

    describe("GET /feather/:name", function () {
        let merged = {};

        before(async function () {
            let names = installedFeathers();
            let i = 0;
            while (i < names.length) {
                merged[names[i]] = await admin.feather(names[i]);
                i += 1;
            }
        });

        it("accepts spinal and camel case names", async function () {
            let a = await admin.get("/feather/sales-order");
            let b = await admin.get("/feather/SalesOrder");
            assert.equal(a.name, "SalesOrder");
            assert.deepEqual(a, b);
        });

        it("answers false for an unknown feather", async function () {
            let resp = await admin.raw("GET", "/feather/no-such-feather");
            assert.equal(resp.status, 200);
            assert.equal(resp.body, false);
        });

        it("merges inherited properties (Category <- Kind <- Document)",
                async function () {
            let cat = merged.Category;
            assert.equal(cat.inherits, "Kind");
            assert.equal(cat.module, "Common");
            assert.equal(cat.plural, "Categories");
            assert.equal(cat.properties.id.inheritedFrom, "Object");
            assert.equal(cat.properties.owner.inheritedFrom, "Document");
            assert.equal(cat.properties.code.inheritedFrom, "Kind");
            assert.equal(cat.properties.code.isNaturalKey, true);
            assert.equal(cat.properties.parent.inheritedFrom, "Category");
            // isChild: false is written by some install paths and left
            // out by others; both mean the same thing.
            assert.deepEqual(
                Object.assign({isChild: false}, cat.properties.parent.type),
                {
                    relation: "Kind",
                    properties: ["code", "description"],
                    isChild: false
                }
            );
        });

        it("merges SupplyChain feathers (Product <- Item)", async function () {
            let product = merged.Product;
            assert.equal(product.inherits, "Item");
            assert.equal(product.module, "Design");
            assert.equal(product.properties.number.inheritedFrom, "Item");
            assert.equal(product.properties.number.isNaturalKey, true);
            assert.equal(product.properties.materialCost.format, "unitCost");
            assert.equal(product.properties.price.format, "salesPrice");
            assert.deepEqual(
                product.overloads.type.dataList.map((d) => d.value),
                ["I", "E", "K"]
            );
        });

        it("gives every feather the Object properties and its parent's",
                async function () {
            let objectProps = Object.keys(merged.Object.properties);
            let problems = [];
            Object.keys(merged).forEach(function (name) {
                let f = merged[name];
                let parent = merged[f.inherits || "Object"];
                if (name === "Object") {
                    return;
                }
                if (!parent) {
                    problems.push(name + ": parent " + f.inherits + " missing");
                    return;
                }
                objectProps.forEach(function (key) {
                    if (!f.properties[key]) {
                        problems.push(name + " lacks " + key);
                    }
                });
                Object.keys(parent.properties).forEach(function (key) {
                    if (!f.properties[key]) {
                        problems.push(name + " lacks inherited " + key);
                    }
                });
                Object.keys(parent.properties).forEach(function (key) {
                    let from = f.properties[key] && f.properties[key].inheritedFrom;
                    if (from && from === name) {
                        problems.push(name + "." + key + " not marked inherited");
                    }
                });
            });
            assert.deepEqual(problems, []);
        });

        it("does not leak inheritedFrom into the cached catalog", {
            todo: "defect: getFeather appendParent (feathers.js:840) " +
                    "assigns the cached parent property object and sets " +
                    "inheritedFrom on it, so /settings/catalog and own " +
                    "properties carry inheritedFrom depending on history"
        }, async function () {
            let raw = (await admin.get("/settings/catalog")).data;
            let leaked = [];
            Object.keys(raw).forEach(function (name) {
                Object.keys(raw[name].properties || {}).forEach(function (k) {
                    if (raw[name].properties[k].inheritedFrom) {
                        leaked.push(name + "." + k);
                    }
                });
            });
            assert.deepEqual(leaked, []);
        });

        it("matches the golden catalog (every feather and property)",
                async function () {
            let out = {};
            Object.keys(merged).forEach(function (name) {
                let f = merged[name];
                let props = {};
                Object.keys(f.properties).forEach(function (key) {
                    props[key] = propertySignature(f.properties[key], name);
                });
                out[name] = {
                    inherits: f.inherits || null,
                    module: f.module,
                    plural: f.plural,
                    isChild: Boolean(f.isChild),
                    isReadOnly: Boolean(f.isReadOnly),
                    isSystem: Boolean(f.isSystem),
                    isFetchOnStartup: Boolean(f.isFetchOnStartup),
                    overloads: overloadSignature(f.overloads),
                    properties: props
                };
            });
            matchGolden("catalog-feathers", out, KEEP_ALL);
        });
    });

    describe("settings, workbooks and routes", function () {
        it("GET /settings-definition matches golden", async function () {
            let defs = await admin.get("/settings-definition");
            assert.ok(Array.isArray(defs));
            let names = defs.map((d) => d.name);
            assert.ok(names.includes("globalSettings"));
            assert.ok(names.includes("buySettings"));
            matchGolden(
                "catalog-settings-definition",
                defs.slice().sort((a, b) => a.name.localeCompare(b.name)),
                KEEP_ALL
            );
        });

        it("GET /workbooks lists installed workbooks (golden)",
                async function () {
            let resp = await db.query(
                "SELECT name FROM \"$workbook\" WHERE created < $1",
                [started]
            );
            let installed = new Set(resp.rows.map((r) => r.name));
            let list = await admin.get("/workbooks");
            let out = list.filter((w) => installed.has(w.name)).map(
                (w) => ({
                    name: w.name,
                    module: w.module,
                    label: w.label,
                    icon: w.icon,
                    sequence: w.sequence,
                    isTemplate: Boolean(w.isTemplate),
                    sheets: (w.defaultConfig || []).map(
                        (c) => c.name + ":" + c.feather
                    )
                })
            ).sort((a, b) => a.name.localeCompare(b.name));
            assert.equal(out.length, installed.size);
            matchGolden("catalog-workbooks", out, KEEP_ALL);
        });

        it("GET /workbook/:name returns one workbook", async function () {
            let wb = await admin.get("/workbook/Development");
            assert.equal(wb.name, "Development");
            assert.equal(wb.module, "Core");
            let fromList = (await admin.get("/workbooks")).find(
                (w) => w.name === "Development"
            );
            assert.deepEqual(wb, fromList);
        });

        it("GET /workbook/:name is case sensitive and 404s", async function () {
            expectError(
                await admin.raw("GET", "/workbook/development"),
                404,
                "Workbook not found"
            );
            expectError(
                await admin.raw("GET", "/workbook/NoSuchWorkbook"),
                404,
                "Workbook not found"
            );
        });

        it("POST /data/routes lists module routes (golden)", async function () {
            let routes = await admin.list("Routes");
            let out = routes.filter(
                (r) => new Date(r.created) < started
            ).map(
                (r) => "/" + r.module.replace(
                    /([a-z0-9])([A-Z])/g,
                    "$1-$2"
                ).toLowerCase() + r.path + " -> " + r.function
            ).sort();
            assert.ok(out.includes(
                "/buy/post-purchase-order-receipts -> " +
                "doPostPurchaseOrderReceipts"
            ), "known SupplyChain route present");
            matchGolden("catalog-routes", out, KEEP_ALL);
        });
    });

    describe("profile", function () {
        let user;

        before(async function () {
            user = await signedInAs("profile");
        });

        after(async function () {
            await dropUser(user);
        });

        it("GET answers false before a profile exists", async function () {
            let resp = await user.raw("GET", "/profile");
            assert.equal(resp.status, 200);
            assert.equal(resp.body, false);
        });

        it("PATCH fails when there is no profile", async function () {
            expectError(
                await user.raw("PATCH", "/profile", {etag: "x", patch: []}),
                500,
                "Profile does not exist for " + user.userName
            );
        });

        it("PUT creates the profile and answers its etag", async function () {
            let resp = await user.raw("PUT", "/profile", {
                workbooks: {Buy: {sheet: 1}}
            });
            assert.equal(resp.status, 200);
            assert.equal(typeof resp.body, "string");
            let profile = await user.get("/profile");
            assert.deepEqual(profile, {
                etag: resp.body,
                data: {workbooks: {Buy: {sheet: 1}}}
            });
        });

        it("PUT refuses to replace an existing profile", async function () {
            expectError(
                await user.raw("PUT", "/profile", {workbooks: {}}),
                409,
                "Profile has been changed by another instance. Changes " +
                "will not save until the browser is refereshed."
            );
        });

        it("PUT with the current etag replaces the profile",
                async function () {
            let current = await user.get("/profile");
            let resp = await user.raw("PUT", "/profile", {
                etag: current.etag,
                data: {workbooks: {}}
            });
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.deepEqual((await user.get("/profile")).data, {workbooks: {}});
        });

        it("PATCH applies a JSON patch when the etag matches",
                async function () {
            let current = await user.get("/profile");
            let resp = await user.raw("PATCH", "/profile", {
                etag: current.etag,
                patch: [{op: "add", path: "/workbooks/Sell", value: {x: 2}}]
            });
            assert.equal(resp.status, 200);
            assert.notEqual(resp.body, current.etag);
            assert.deepEqual(await user.get("/profile"), {
                etag: resp.body,
                data: {workbooks: {Sell: {x: 2}}}
            });
        });

        it("PATCH with a stale etag answers 409", async function () {
            expectError(
                await user.raw("PATCH", "/profile", {
                    etag: "stale",
                    patch: [{op: "remove", path: "/workbooks/Sell"}]
                }),
                409,
                /changed by another instance/
            );
            assert.ok((await user.get("/profile")).data.workbooks.Sell);
        });

        it("keeps profiles per user", async function () {
            let mine = await admin.get("/profile");
            let theirs = await user.get("/profile");
            assert.notDeepEqual(mine, theirs);
        });
    });

    describe("currency", function () {
        let base;

        it("GET /currency/base works on the first call after start",
                async function () {
            let resp = await admin.raw("GET", "/currency/base");
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("GET /currency/base returns the base Currency record",
                async function () {
            let resp = await admin.raw("GET", "/currency/base");
            assert.equal(resp.status, 200);
            base = resp.body;
            assert.equal(base.objectType, "Currency");
            assert.equal(base.isBase, true);
            assert.equal(typeof base.minorUnit, "number");
            let flagged = await admin.list("Currencies", {filter: {
                criteria: [{property: "isBase", value: true}]
            }});
            assert.deepEqual(flagged.map((c) => c.code), [base.code]);
        });

        it("GET /currency/base?effective= falls back to the oldest",
                async function () {
            let resp = await admin.raw(
                "GET",
                "/currency/base?effective=1990-01-01"
            );
            assert.equal(resp.status, 200);
            assert.equal(resp.body.objectType, "Currency");
        });

        it("converts the base currency to itself", async function () {
            let resp = await admin.raw(
                "GET",
                "/currency/convert?fromCurrency=" + base.code + "&amount=10"
            );
            assert.equal(resp.status, 200);
            assert.equal(resp.body.currency, base.code);
            assert.equal(Number(resp.body.amount), 10);
        });

        it("returns the converted amount as a number", async function () {
            let resp = await admin.get(
                "/currency/convert?fromCurrency=" + base.code + "&amount=10"
            );
            assert.deepEqual(resp, {currency: base.code, amount: 10});
        });

        it("refuses a target currency with 501", async function () {
            expectError(
                await admin.raw(
                    "GET",
                    "/currency/convert?fromCurrency=" + base.code +
                    "&amount=10&toCurrency=" + base.code
                ),
                501,
                "Conversion to a specific currency is notimplemented yet."
            );
        });

        describe("with conversion rates", function () {
            let foreign;
            let reverse;

            before(async function () {
                foreign = await admin.create("Currency", {
                    code: uniq("FX").slice(0, 14),
                    description: "Regression foreign",
                    symbol: "F",
                    minorUnit: 2
                });
                reverse = await admin.create("Currency", {
                    code: uniq("RX").slice(0, 14),
                    description: "Regression reverse",
                    symbol: "R",
                    minorUnit: 2
                });
                // 1 foreign = 0.25 base
                await admin.create("CurrencyConversion", {
                    fromCurrency: {id: foreign.id},
                    toCurrency: {id: base.id},
                    ratio: 0.25
                });
                // 1 base = 4 reverse, stored the other way round
                await admin.create("CurrencyConversion", {
                    fromCurrency: {id: base.id},
                    toCurrency: {id: reverse.id},
                    ratio: 4
                });
            });

            it("404s when no conversion exists for the date",
                    async function () {
                expectError(
                    await admin.raw(
                        "GET",
                        "/currency/convert?fromCurrency=" + foreign.code +
                        "&amount=10&effective=2000-01-01"
                    ),
                    404,
                    new RegExp(
                        "^Conversion not found for " + foreign.code +
                        " to " + base.code + " on "
                    )
                );
            });

            it("multiplies by a foreign->base ratio", async function () {
                let resp = await admin.get(
                    "/currency/convert?fromCurrency=" + foreign.code +
                    "&amount=10"
                );
                assert.deepEqual(resp, {currency: base.code, amount: 2.5});
            });

            it("divides by a base->foreign ratio", async function () {
                let resp = await admin.get(
                    "/currency/convert?fromCurrency=" + reverse.code +
                    "&amount=10"
                );
                assert.deepEqual(resp, {currency: base.code, amount: 2.5});
            });
        });
    });

    describe("GET /do/is-authorized", function () {
        it("answers true for a super user by feather or id",
                async function () {
            assert.equal(
                await admin.get("/do/is-authorized?action=canCreate&feather=Kind"),
                true
            );
            let kind = await admin.create("Kind", {code: uniq("AUTH")});
            assert.equal(
                await admin.get(
                    "/do/is-authorized?action=canDelete&id=" + kind.id
                ),
                true
            );
        });

        it("requires a feather or an id", async function () {
            expectError(
                await admin.raw("GET", "/do/is-authorized?action=canRead"),
                500,
                "Authorization check requires feather or id"
            );
        });
    });

    describe("GET /sessions", function () {
        it("lists signed in sessions with user and expiry",
                async function () {
            let extra = await signedIn();
            let listed = await admin.get("/sessions");
            listed.forEach(function (s) {
                assert.deepEqual(Object.keys(s).sort(), ["expires", "id", "user"]);
                assert.ok(Date.parse(s.expires) > Date.now());
            });
            assert.ok(listed.some((s) => s.user === settings.adminUser));

            await extra.signOut();
            let after = await admin.get("/sessions");
            assert.equal(after.length, listed.length - 1);
        });

        it("refuses callers without a session", {
            todo: "defect: /sessions is not in server.js check list " +
                    "(server.js:76) - anyone can list session ids and users"
        }, async function () {
            let resp = await new Session().raw("GET", "/sessions");
            assert.equal(resp.status, 401);
        });

        it("refuses currency requests without a session", {
            todo: "defect: /currency is not in the check list; without a " +
                    "session doGetBaseCurrency throws (server.js:577) and " +
                    "express answers a 500 HTML stack trace"
        }, async function () {
            let resp = await new Session().raw("GET", "/currency/base");
            assert.equal(resp.status, 401);
        });
    });
});
