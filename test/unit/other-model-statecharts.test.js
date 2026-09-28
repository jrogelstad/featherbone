/*
    Statecharts of the specialized client models that replace or patch
    the base model chart: settings (models/settings.js: Ready/New,
    Ready/Fetched/{Clean,Dirty}, Busy/{Fetching,Saving}, Error), workbook
    (models/workbook.js: PUT-based saving, ReadOnly until authorized),
    the catalog's own settings chart (models/catalog.js), DataListOption
    and child models that skip locking, plus model-level business rules
    of Currency / CurrencyConversion / Feather.
*/
/*jslint node*/
"use strict";

const {describe, it, before, beforeEach, after} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");
const testFeathers = require("./lib/test-feathers");

let f;
let catalog;
let settings;
let answers = {};
let unhandled = [];

function onUnhandled(e) {
    unhandled.push(e);
}

// Respond from `answers` keyed by "METHOD /path"; Error -> rejection
function answer(req) {
    let a = answers[req.method + " " + req.path];
    if (a instanceof Error) {
        return Promise.reject(a);
    }
    return a;
}

function settle(promise, ms) {
    return Promise.race([
        promise.then(
            (v) => ({status: "resolved", value: v}),
            (e) => ({status: "rejected", error: e})
        ),
        new Promise(
            (resolve) => setTimeout(() => resolve({status: "pending"}), ms || 50)
        )
    ]);
}

function current(model) {
    return model.state().current()[0];
}

function requests() {
    return env.requests().map((r) => [r.method, r.path, r.body]);
}

describe("specialized model statecharts", function () {
    before(async function () {
        let loaded = await env.loadClient();
        f = loaded.f;
        catalog = loaded.catalog;
        testFeathers.registerSystem(env);
        testFeathers.registerAll(env);
        settings = (await import(pathToFileURL(
            path.join(env.ROOT, "client", "models", "settings.js")
        ).href)).default;
        env.respond(answer);
        process.on("unhandledRejection", onUnhandled);
    });

    after(function () {
        process.removeListener("unhandledRejection", onUnhandled);
    });

    beforeEach(function () {
        env.clearRequests();
        answers = {};
        unhandled.length = 0;
    });

    describe("settings (models/settings.js)", function () {
        const definition = {
            name: "unitSettings",
            properties: {
                host: {type: "string"},
                port: {type: "integer", isRequired: true}
            }
        };

        it("is a per-name singleton that starts in /Ready/New", function () {
            let s = settings(definition);
            assert.equal(settings({name: "unitSettings"}), s);
            assert.equal(s.id(), "unitSettings");
            assert.equal(current(s), "/Ready/New");
            assert.equal(s.subscribe(true), false, "never subscribes");
            assert.throws(() => settings({}), /Settings name is required/);
        });

        it("fetch GETs /settings/<name> and keeps the etag", async function () {
            let s = settings(definition);
            answers["GET /settings/unitSettings"] = {
                etag: "et1",
                data: {host: "mail", port: 25}
            };
            let promise = s.fetch();
            assert.equal(current(s), "/Busy/Fetching");
            assert.equal(await promise, s.data);
            assert.equal(current(s), "/Ready/Fetched/Clean");
            assert.equal(s.etag(), "et1");
            assert.equal(s.data.host(), "mail");
            assert.equal(s.canSave(), false);
            assert.deepEqual(requests(), [["GET", "/settings/unitSettings",
                    undefined]]);
        });

        it("edits go straight to Dirty (no lock) and save PUTs data+etag",
                async function () {
            let s = settings(definition);
            s.data.port(26);
            assert.equal(current(s), "/Ready/Fetched/Dirty");
            assert.equal(s.canSave(), true);
            answers["PUT /settings/unitSettings"] = true;
            let promise = s.save();
            assert.equal(current(s), "/Busy/Saving");
            assert.equal(await promise, s.data);
            assert.equal(current(s), "/Ready/Fetched/Clean");
            assert.deepEqual(requests(), [["PUT", "/settings/unitSettings", {
                etag: "et1",
                data: {host: "mail", port: 26, objectType: ""}
            }]]);
        });

        it("a false PUT response rejects and parks the model in /Error",
                async function () {
            let s = settings({
                name: "unitSettingsErr",
                properties: {a: {type: "string"}}
            });
            answers["GET /settings/unitSettingsErr"] = {etag: "e", data: {}};
            await s.fetch();
            s.data.a("x");
            answers["PUT /settings/unitSettingsErr"] = false;
            let outcome = await settle(s.save());
            assert.equal(outcome.status, "rejected");
            assert.equal(outcome.error, "Settings failed to save");
            assert.equal(current(s), "/Error");
            // Error cannot be exited (canExit returns false)
            s.state().goto("/Ready");
            assert.equal(current(s), "/Error");
        });

        it("a rejected PUT rejects the save and leaves Busy",
                {todo: "defect: settings doPut has no catch; a failed " +
                "request is an unhandled rejection and the model stays in " +
                "/Busy/Saving with a never-settling promise"},
                async function () {
            let s = settings({
                name: "unitSettingsRej",
                properties: {a: {type: "string"}}
            });
            answers["GET /settings/unitSettingsRej"] = {etag: "e", data: {}};
            await s.fetch();
            s.data.a("x");
            answers["PUT /settings/unitSettingsRej"] = new Error("down");
            let outcome = await settle(s.save());
            assert.equal(outcome.status, "rejected");
            assert.notEqual(current(s), "/Busy/Saving");
        });
    });

    describe("workbook (models/workbook.js)", function () {
        function workbook(name) {
            let wb = f.createModel("Workbook", {
                name,
                defaultConfig: [{
                    name: "Orders",
                    feather: "TestItem",
                    list: {columns: []}
                }],
                localConfig: []
            });
            wb.state().goto("/Ready/Fetched");
            return wb;
        }

        it("uses the name as id and assigns sheet ids", function () {
            let wb = workbook("Sales");
            assert.equal(wb.id(), "Sales");
            assert.equal(wb.idProperty(), "name");
            assert.equal(wb.path("Workbook", "Sales"), "/workbook/Sales");
            let config = wb.getConfig();
            assert.equal(config[0].name, "Orders");
            assert.match(config[0].id, /^[0-9a-z]+$/);
            assert.equal(wb.data.name.isReadOnly(), true, "set on load");
        });

        it("edits go to Dirty without locking; save PUTs the workbook",
                async function () {
            let wb = workbook("Sales2");
            wb.data.label("Sales Two");
            assert.equal(current(wb), "/Ready/Fetched/Dirty");
            answers["PUT /workbook/Sales2"] = true;
            let promise = wb.save();
            assert.equal(current(wb), "/Busy/Saving");
            assert.equal(await promise, wb.data);
            assert.equal(current(wb), "/Ready/Fetched/Clean");
            assert.deepEqual(requests().map((r) => r[0] + " " + r[1]),
                    ["PUT /workbook/Sales2"]);
            assert.equal(env.requests()[0].body.label, "Sales Two");
        });

        it("a new workbook saves with PUT too", async function () {
            let wb = f.createModel("Workbook", {name: "Fresh"});
            answers["PUT /workbook/Fresh"] = true;
            await wb.save();
            assert.equal(current(wb), "/Ready/Fetched/Clean");
            assert.deepEqual(requests().map((r) => r[0] + " " + r[1]),
                    ["PUT /workbook/Fresh"]);
        });

        it("checkUpdate is ReadOnly until authorized", async function () {
            let wb = workbook("Auth");
            answers["GET /workbook/is-authorized/Auth?action=canUpdate"] =
                    true;
            wb.checkUpdate();
            assert.equal(current(wb), "/Ready/Fetched/ReadOnly");
            await env.flush();
            assert.equal(current(wb), "/Ready/Fetched/Clean");
            assert.equal(wb.canUpdate(), true);
        });

        it("checkUpdate stays ReadOnly when not authorized",
                async function () {
            let wb = workbook("NoAuth");
            answers["GET /workbook/is-authorized/NoAuth?action=canUpdate"] =
                    false;
            wb.checkUpdate();
            await env.flush();
            assert.equal(current(wb), "/Ready/Fetched/ReadOnly");
            assert.equal(wb.canUpdate(), false);
        });

        it("delete does not lock", function () {
            let wb = workbook("Del");
            wb.delete();
            assert.equal(current(wb), "/Delete");
            assert.deepEqual(requests(), []);
        });

        it("a failed PUT rejects the save and returns to Ready",
                {todo: "defect: workbook doPut uses .catch(model.error), " +
                "which is undefined; failures are unhandled rejections " +
                "and the model stays in /Busy/Saving"},
                async function () {
            let wb = workbook("Fail");
            wb.data.label("x");
            answers["PUT /workbook/Fail"] = new Error("nope");
            let outcome = await settle(wb.save());
            assert.equal(outcome.status, "rejected");
            assert.equal(current(wb), "/Ready/Fetched/Dirty");
        });
    });

    describe("catalog settings chart (models/catalog.js)", function () {
        it("fetch(true) merges /settings/catalog into feathers",
                async function () {
            answers["GET /settings/catalog"] = {data: {
                TestFromServer: {
                    name: "TestFromServer",
                    plural: "TestFromServers",
                    properties: {x: {type: "string"}}
                }
            }};
            let data = await catalog.fetch(true);
            assert.ok(data.TestItem, "existing feathers kept");
            assert.ok(catalog.getFeather("TestFromServer"));
            assert.deepEqual(requests(), [["GET", "/settings/catalog",
                    undefined]]);
        });

        it("getFeather merges inherited properties first", function () {
            let feather = catalog.getFeather("Currency");
            let keys = Object.keys(feather.properties);
            assert.deepEqual(keys.slice(0, 8), [
                "id", "created", "createdBy", "updated", "updatedBy",
                "isDeleted", "lock", "objectType"
            ]);
            assert.ok(keys.indexOf("owner") < keys.indexOf("code"));
            assert.ok(keys.indexOf("code") < keys.indexOf("symbol"));
            assert.equal(feather.properties.code.inheritedFrom, "Kind");
            assert.equal(feather.properties.owner.inheritedFrom, "Document");
            let own = catalog.getFeather("Currency", false);
            assert.equal(own.properties.code, undefined);
            assert.equal(own.inherits, undefined);
            assert.equal(catalog.getFeather("Nope"), false);
        });

        it("isAuthorized memoizes feather-level answers", async function () {
            answers["GET /do/is-authorized?feather=TestPlain&action=canRead"] =
                    true;
            assert.equal(await catalog.isAuthorized({
                feather: "TestPlain",
                action: "canRead"
            }), true);
            assert.equal(await catalog.isAuthorized({
                feather: "TestPlain",
                action: "canRead"
            }), true);
            assert.equal(env.requests().length, 1);
        });
    });

    describe("models that skip locking", function () {
        it("DataListOption goes Clean -> Dirty without a lock request",
                function () {
            let d = f.createModel("DataListOption", {value: "a", label: "A"});
            d.state().goto("/Ready/Fetched");
            d.data.label("B");
            assert.equal(current(d), "/Ready/Fetched/Dirty");
            assert.deepEqual(requests(), []);
        });
    });

    describe("form models (models/form.js)", function () {
        it("SystemPrintForm freezes to ReadOnly for non-super users",
                function () {
            let user = f.currentUser();
            try {
                f.currentUser({name: "clerk", isSuper: false, mode: "prod"});
                let pf = f.createModel("SystemPrintForm", {
                    id: "spf1",
                    name: "Invoice",
                    module: "Core"
                });
                pf.state().goto("/Ready/Fetched");
                assert.equal(current(pf), "/Ready/Fetched/ReadOnly");
                f.currentUser({name: "root", isSuper: true, mode: "prod"});
                let pf2 = f.createModel("SystemPrintForm", {id: "spf2"});
                pf2.state().goto("/Ready/Fetched");
                assert.equal(current(pf2), "/Ready/Fetched/Clean");
                assert.equal(pf2.data.module.isReadOnly(), false);
            } finally {
                f.currentUser(user);
            }
        });

        it("Form lists feather properties and requires active defaults",
                function () {
            let form = f.createModel("Form", {
                name: "Item form",
                description: "Item form",
                feather: "TestItem"
            });
            let props = form.data.properties().map((p) => p.value);
            assert.ok(props.includes("name"));
            // Only top-level keys are listed; relation sub-properties
            // ("category.code") are resolved by FormAttr, not here
            assert.ok(props.includes("category"));
            assert.ok(!props.includes("category.code"));
            form.data.isDefault(true);
            form.data.isActive(false);
            assert.equal(form.isValid(), false);
            assert.equal(form.lastError(), "Default form must be active");
            form.data.isActive(true);
            assert.equal(form.isValid(), true);
        });

        it("FormAttr rejects attributes not on the form feather",
                function () {
            let form = f.createModel("Form", {
                name: "Item form",
                feather: "TestItem",
                isActive: true
            });
            let attr = form.data.attrs().add({attr: "bogus"});
            assert.equal(attr.isValid(), false);
            assert.equal(attr.lastError(),
                    "Attribute 'bogus' not in feather 'TestItem'");
            attr.data.attr("name");
            assert.equal(attr.isValid(), true);
        });
    });

    describe("model business rules", function () {
        it("Currency requires a conversion for its display unit",
                function () {
            let c = f.createModel("Currency", {
                code: "ABC",
                description: "d"
            });
            assert.equal(c.isValid(), true);
            assert.equal(c.data.displayUnit.isReadOnly(), true);
            c.data.hasDisplayUnit(true);
            assert.equal(c.data.displayUnit.isReadOnly(), false);
            assert.equal(c.data.displayUnit.isRequired(), true);
            c.data.displayUnit({id: "u1", code: "U1"});
            assert.equal(c.isValid(), false);
            assert.equal(c.lastError(),
                    "A conversion must exist for the display unit.");
            c.data.conversions().add({toUnit: {id: "u1", code: "U1"},
                    ratio: 10});
            assert.equal(c.isValid(), true);
            c.data.hasDisplayUnit(false);
            assert.equal(c.data.displayUnit(), null,
                    "display unit cleared");
            c.data.code("TOOLONG");
            assert.equal(c.isValid(), false);
            assert.equal(c.lastError(),
                    "code may not be more than 4 characters");
        });

        it("CurrencyConversion rejects same currency and negative ratio",
                function () {
            let c = f.createModel("CurrencyConversion", {
                fromCurrency: {id: "a", code: "A"},
                toCurrency: {id: "a", code: "A"},
                ratio: 1
            });
            assert.equal(c.isValid(), false);
            assert.equal(c.lastError(),
                    "'From' currency cannot be the same as 'to' currency.");
            c.data.toCurrency({id: "b", code: "B"});
            c.data.ratio(-1);
            assert.equal(c.isValid(), false);
            assert.equal(c.lastError(),
                    "The conversion ratio nust be a positive number.");
        });

        it("Feather model strips spaces from names and lists feathers",
                function () {
            let feather = f.createModel("Feather");
            assert.equal(current(feather), "/Ready/New");
            assert.equal(feather.data.authorizations().length, 1,
                    "default everyone authorization");
            feather.data.name("my new feather");
            // Spaces removed and first letter capitalized; words are not
            // camel cased
            assert.equal(feather.data.name(), "Mynewfeather");
            let names = feather.data.feathers().map((o) => o.value);
            assert.ok(names.includes("TestItem"));
            assert.ok(!names.includes("Workbook"), "system feathers hidden");
        });

        it("Feather inherits lists parent properties as ReadOnly rows", {
            skip: "calculateInherited() moves each inherited property " +
                "to ReadOnly before setting its parent; in this unit " +
                "catalog the property's ReadOnly enter handler then " +
                "dereferences the missing parent. Covered end to end by " +
                "api/catalog.test.js"
        }, function () {
            let feather = f.createModel("Feather");
            feather.data.inherits("TestCategory");
            let inherited = feather.data.inheritedProperties();
            let names = inherited.map((p) => p.data.name());
            assert.ok(names.includes("code"));
            assert.ok(names.includes("id"));
            inherited.forEach(function (p) {
                assert.equal(current(p), "/Ready/Fetched/ReadOnly");
                assert.equal(p.parent(), feather);
            });
        });
    });
});
