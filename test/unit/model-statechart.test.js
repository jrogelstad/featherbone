/*
    client/models/model.js statechart process flows.

    Drives real client models (f.createModel) against an in-memory API
    (lib/fake-server.js) and pins, after each event: the state path, the
    requests sent (method, path, body), and data / etag / frozen / dirty
    behavior. States: Ready/New, Ready/Fetched/{Clean, ReadOnly, Locking,
    Unlocking, Dirty}, Busy/{Fetching, Saving/{Posting, Patching},
    Deleting}, Locked, Delete, Deleted. Events: fetch, save, delete,
    changed, lock, unlock, undo, copy, clear, error.
*/
/*jslint node*/
"use strict";

const {describe, it, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const env = require("./lib/browser-env");
const testFeathers = require("./lib/test-feathers");
const {createServer} = require("./lib/fake-server");
const {matchGolden} = require("../harness/golden");

let f;
let server;

// Resolve a promise's outcome, or "pending" if it has not settled
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

function requests() {
    return env.requests().map((r) => [r.method, r.path, r.body]);
}

function current(model) {
    return model.state().current()[0];
}

function stored(id, extra) {
    return server.put(Object.assign({
        id,
        created: "2026-01-01T00:00:00.000Z",
        createdBy: "admin",
        updated: "2026-01-02T00:00:00.000Z",
        updatedBy: "admin",
        isDeleted: false,
        lock: null,
        objectType: "testItem",
        etag: "etag-0",
        name: "Item " + id,
        description: "stored",
        qty: 1.234,
        price: 5,
        count: 3,
        isActive: true,
        category: null,
        lines: []
    }, extra));
}

async function fetched(id, extra) {
    let model;
    stored(id, extra);
    model = f.createModel("TestItem", {id});
    await model.fetch();
    env.clearRequests();
    return model;
}

async function saved(name, lines) {
    let model = f.createModel("TestItem");
    model.data.name(name);
    (lines || []).forEach((l) => model.data.lines().add(l));
    await model.save();
    env.clearRequests();
    return model;
}

// Edit a fetched model and let the lock request complete
async function dirty(model, value) {
    model.data.description(value);
    await env.flush();
}

describe("client model statechart (models/model.js)", function () {
    before(async function () {
        f = (await env.loadClient()).f;
        testFeathers.registerAll(env);
        server = createServer();
        env.respond(server.handle);
    });

    beforeEach(function () {
        env.clearRequests();
    });

    describe("Ready/New", function () {
        it("starts in /Ready/New with feather defaults", function () {
            let model = f.createModel("TestItem");
            let json = model.toJSON();
            assert.equal(current(model), "/Ready/New");
            assert.match(json.id, /^[0-9a-z]+$/);
            assert.deepEqual(
                [json.name, json.description, json.qty, json.count,
                        json.isActive, json.category, json.lines,
                        json.isDeleted, json.etag],
                ["", "", 0, 0, true, null, [], false, ""]
            );
            assert.equal(model.name, "TestItem");
            assert.equal(model.plural, "TestItems");
            assert.equal(model.naturalKey(true), "name");
            assert.deepEqual(requests(), [], "no requests on creation");
        });

        it("reports capabilities for a new record", function () {
            let model = f.createModel("TestItem");
            assert.equal(model.canSave(), false, "name is required");
            model.data.name("Valid");
            assert.equal(model.canSave(), true);
            assert.equal(model.canUndo(), false);
            assert.equal(model.canCopy(), false);
            assert.equal(model.canDelete(), true);
            assert.equal(model.isReadyClean(), false);
        });

        it("edits stay in /Ready/New and send no lock request", async function () {
            let model = f.createModel("TestItem");
            model.data.name("Edited");
            model.data.qty(2);
            await env.flush();
            assert.equal(current(model), "/Ready/New");
            assert.deepEqual(requests(), []);
        });

        it("save posts the whole record and lands in Fetched/Clean",
                async function () {
            let model = f.createModel("TestItem");
            let states = [];
            let promise;
            let result;
            model.data.name("Posted");
            model.data.qty(3.456);
            model.state().resolve("/Busy/Saving/Posting").enter(
                () => states.push(current(model))
            );
            promise = model.save();
            assert.equal(current(model), "/Busy/Saving/Posting");
            result = await promise;
            assert.equal(result, model.data, "resolves with model.data");
            assert.deepEqual(states, ["/Busy/Saving/Posting"]);
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests().map((r) => r.slice(0, 2)), [
                ["POST", "/data/test-item"]
            ]);
            let body = env.requests()[0].body;
            assert.equal(body.id, model.id());
            assert.equal(body.qty, 3.46, "rounded to the property scale");
            matchGolden("unit-model-post-body", body);
            // Server-set values applied from the returned patch
            assert.match(model.data.etag(), /^e-/);
            assert.equal(model.data.createdBy(), "tester");
            assert.equal(model.isReadyClean(), true);
        });

        it("post trims to-one relations to {id}", async function () {
            let model = f.createModel("TestItem");
            model.data.name("With category");
            model.data.category({
                id: "cat1",
                code: "C1",
                description: "Category one"
            });
            assert.equal(model.data.category().data.code(), "C1");
            await model.save();
            assert.deepEqual(env.requests()[0].body.category, {id: "cat1"});
        });

        it("a failed post rejects, returns to /Ready/New and keeps data",
                async function () {
            let model = f.createModel("TestItem");
            let errors = [];
            model.onError((e) => errors.push(e.message));
            model.data.name("Keep me");
            server.failNext("POST", "/data/test-item",
                    new Error("\"Duplicate key\""));
            let outcome = await settle(model.save());
            assert.equal(outcome.status, "rejected");
            assert.equal(outcome.error.message, "Duplicate key",
                    "surrounding quotes stripped");
            assert.equal(current(model), "/Ready/New");
            assert.equal(model.data.name(), "Keep me");
            assert.deepEqual(errors, ["Duplicate key"]);
            assert.equal(model.lastError().message, "Duplicate key");
            // It can be saved again
            await model.save();
            assert.equal(current(model), "/Ready/Fetched/Clean");
        });

        it("an invalid save sends nothing and stays in /Ready/New",
                async function () {
            let model = f.createModel("TestItem");
            let errors = [];
            model.onError((e) => errors.push(e));
            model.save().catch(() => undefined);
            await env.flush();
            assert.equal(current(model), "/Ready/New");
            assert.deepEqual(requests(), []);
            assert.deepEqual(errors, ["\"Name\" is required"]);
            assert.equal(model.lastError(), "\"Name\" is required");
        });

        it("an invalid save rejects its promise",
                async function () {
            let model = f.createModel("TestItem");
            let outcome = await settle(model.save());
            assert.equal(outcome.status, "rejected");
        });

        it("delete of a new record goes straight to /Deleted",
                async function () {
            let model = f.createModel("TestItem");
            let oldId = model.id();
            assert.equal(await model.delete(), true);
            assert.equal(current(model), "/Deleted");
            assert.deepEqual(requests(), []);
            model.clear();
            assert.equal(current(model), "/Ready/New");
            assert.notEqual(model.id(), oldId, "clear assigns a new id");
        });

        it("clear resets data to defaults with a new id", function () {
            let model = f.createModel("TestPlain");
            let oldId = model.id();
            model.data.note("x");
            model.clear();
            assert.equal(current(model), "/Ready/New");
            assert.equal(model.data.note(), "");
            assert.notEqual(model.id(), oldId);
        });

        it("clear works on a new record with child arrays",
                function () {
            let model = f.createModel("TestItem");
            let oldId = model.id();
            model.data.name("x");
            model.data.isActive(false);
            model.clear();
            assert.equal(current(model), "/Ready/New");
            assert.equal(model.data.name(), "");
            assert.equal(model.data.isActive(), true);
            assert.notEqual(model.id(), oldId);
        });

        it("initial data is kept on the first entry to /Ready/New",
                function () {
            let model = f.createModel("TestItem", {name: "Init", qty: 2});
            assert.equal(model.data.name(), "Init");
            assert.equal(model.data.qty(), "2", "numbers read as locale text");
            assert.equal(model.data.qty.toJSON(), 2);
        });

        it("runs onSave and onSaved hooks around the request with the vm",
                async function () {
            let model = f.createModel("TestItem");
            let log = [];
            let vm = {name: "vm"};
            model.data.name("Hooks");
            model.onSave(async function (v) {
                log.push(["onSave", v, env.requests().length]);
            });
            model.onSave(function (v) {
                log.push(["first", v.name]);
            }, true);
            model.onSaved(function (v) {
                log.push(["onSaved", v, env.requests().length,
                        current(model)]);
            });
            assert.ok(model.hasExtraProcessing());
            await model.save(vm);
            await env.flush();
            assert.deepEqual(log, [
                ["first", "vm"],
                ["onSave", vm, 0],
                ["onSaved", vm, 1, "/Ready/Fetched/Clean"]
            ]);
        });
    });

    describe("Busy/Fetching", function () {
        it("fetch GETs the record and lands in /Ready/Fetched/Clean",
                async function () {
            let model;
            let loads = 0;
            stored("f1");
            model = f.createModel("TestItem", {id: "f1"});
            model.onLoad(() => (loads += 1));
            let promise = model.fetch();
            assert.equal(current(model), "/Busy/Fetching");
            let result = await promise;
            assert.equal(result, model.data);
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests(), [["GET", "/data/test-item/f1",
                    undefined]]);
            assert.equal(model.data.name(), "Item f1");
            assert.equal(model.data.qty(), "1.23", "scale 2, locale string");
            assert.equal(model.data.qty.toJSON(), 1.23);
            assert.equal(model.data.etag(), "etag-0");
            assert.equal(loads, 1);
            assert.equal(model.canCopy(), false, "not authorized yet");
            assert.equal(model.canSave(), false);
            assert.equal(model.canUndo(), false);
            assert.equal(model.canDelete(), true);
        });

        it("a failed fetch rejects and returns to /Ready/New",
                async function () {
            let model = f.createModel("TestItem", {id: "missing"});
            let outcome = await settle(model.fetch());
            assert.equal(outcome.status, "rejected");
            assert.equal(outcome.error.message, "Record not found");
            assert.equal(current(model), "/Ready/New");
            assert.equal(model.id(), "missing", "data not cleared");
        });

        it("a record locked by another user is fetched into /Locked",
                async function () {
            let lock = {
                username: "bob",
                created: "2026-01-01T00:00:00Z",
                eventKey: "other"
            };
            let model = await fetched("f2", {lock});
            assert.equal(current(model), "/Locked");
            assert.equal(model.isFrozen(), true);
            assert.deepEqual(model.data.lock(), lock);
            assert.deepEqual(model.data.name.state().current(),
                    ["/Disabled"]);
            model.data.name("ignored");
            assert.equal(model.data.name(), "Item f2");
            assert.equal(model.canSave(), false);
            assert.equal(model.canDelete(), false);
            assert.equal(model.canCopy(), false, "no canCreate yet");
        });

        it("a read only model is fetched into /Ready/Fetched/ReadOnly",
                async function () {
            let model;
            stored("f3");
            model = f.createModel("TestItem", {id: "f3"});
            model.isReadOnly(true);
            await model.fetch();
            assert.equal(current(model), "/Ready/Fetched/ReadOnly");
            assert.equal(model.isFrozen(), true);
            model.data.description("nope");
            assert.equal(model.data.description(), "stored");
            assert.equal(model.canDelete(), false);
        });

        it("refetching a clean record goes through Busy/Fetching again",
                async function () {
            let model = await fetched("f4");
            server.records.f4.description = "changed on server";
            await model.fetch();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.equal(model.data.description(), "changed on server");
        });
    });

    describe("Ready/Fetched editing", function () {
        it("a change locks the record then goes to Dirty", async function () {
            let model = await fetched("e1");
            model.data.description("edit");
            assert.equal(current(model), "/Ready/Fetched/Locking");
            assert.equal(model.canUndo(), true);
            assert.equal(model.canSave(), false, "not while locking");
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Dirty");
            assert.deepEqual(requests(), [["POST", "/do/lock", {
                id: "e1",
                eventKey: "test-event-key"
            }]]);
            assert.equal(model.canSave(), true);
            assert.equal(model.canUndo(), true);
            assert.equal(model.canCopy(), false);
            assert.equal(model.canDelete(), false);
        });

        it("save patches only the changes and applies the new etag",
                async function () {
            let model = await fetched("e2");
            await dirty(model, "patched");
            model.data.qty(9);
            env.clearRequests();
            let promise = model.save();
            assert.equal(current(model), "/Busy/Saving/Patching");
            assert.equal(await promise, model.data);
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests(), [[
                "PATCH",
                "/data/test-item/e2?eventKey=test-event-key",
                [
                    {op: "replace", path: "/qty", value: 9},
                    {op: "replace", path: "/description", value: "patched"}
                ]
            ]]);
            assert.match(model.data.etag(), /^e-/);
            assert.notEqual(model.data.etag(), "etag-0");
            assert.equal(model.data.serverOnly, undefined,
                    "unknown server properties are ignored");
            // A second edit diffs against the saved values
            await dirty(model, "patched twice");
            env.clearRequests();
            await model.save();
            assert.deepEqual(env.requests()[0].body, [
                {op: "replace", path: "/description", value: "patched twice"}
            ]);
        });

        it("a failed patch rejects and returns to Dirty with edits kept",
                async function () {
            let model = await fetched("e3");
            await dirty(model, "unsaved");
            server.failNext("PATCH", "/data/test-item/e3",
                    new Error("conflict"));
            let outcome = await settle(model.save());
            assert.equal(outcome.status, "rejected");
            assert.equal(current(model), "/Ready/Fetched/Dirty");
            assert.equal(model.data.description(), "unsaved");
            await model.save();
            assert.equal(current(model), "/Ready/Fetched/Clean");
        });

        it("undo reverts data, unlocks and returns to Clean",
                async function () {
            let model = await fetched("e4");
            await dirty(model, "oops");
            model.data.qty(7);
            env.clearRequests();
            model.undo();
            assert.equal(current(model), "/Ready/Fetched/Unlocking");
            assert.equal(model.data.description(), "stored");
            assert.equal(model.data.qty(), "1.23");
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests(), [["POST", "/do/unlock", {
                id: "e4",
                eventKey: "test-event-key"
            }]]);
        });

        it("save while Locking waits for the lock, then patches",
                async function () {
            let model = await fetched("e5");
            let hold = server.hold("POST", "/do/lock");
            model.data.description("fast save");
            assert.equal(current(model), "/Ready/Fetched/Locking");
            let promise = model.save();
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Locking");
            hold.release();
            await promise;
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests().map((r) => r[0] + " " + r[1]), [
                "POST /do/lock",
                "PATCH /data/test-item/e5?eventKey=test-event-key"
            ]);
        });

        it("saving with no net change unlocks instead of patching",
                async function () {
            let model = await fetched("e6");
            await dirty(model, "temp");
            model.data.description("stored");
            env.clearRequests();
            await model.save();
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests().map((r) => r[0] + " " + r[1]), [
                "POST /do/unlock"
            ]);
        });

        it("a failed lock reports the error", async function () {
            let model = await fetched("e7");
            let errors = [];
            model.onError((e) => errors.push(e.message));
            server.failNext("POST", "/do/lock",
                    new Error("Record is locked by bob"));
            model.data.description("conflict");
            await env.flush();
            assert.deepEqual(errors, ["Record is locked by bob"]);
            assert.deepEqual(requests().map((r) => r[1]), ["/do/lock"]);
        });

        it("a failed lock returns the model to Clean",
                async function () {
            let model = await fetched("e8");
            server.failNext("POST", "/do/lock",
                    new Error("Record is locked by bob"));
            model.data.description("conflict");
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Clean");
        });

        it("save in Clean sends nothing", async function () {
            let model = await fetched("e9");
            model.save();
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.deepEqual(requests(), []);
        });

        it("save in Clean settles its promise",
                async function () {
            let model = await fetched("e10");
            let outcome = await settle(model.save());
            assert.notEqual(outcome.status, "pending");
        });
    });

    describe("Locked (server lock events)", function () {
        it("lock() in Clean freezes the model until unlock()",
                async function () {
            let model = await fetched("l1");
            let lock = {username: "carol", created: "now"};
            model.lock(lock);
            assert.equal(current(model), "/Locked");
            assert.deepEqual(model.data.lock(), lock);
            assert.equal(model.isFrozen(), true);
            model.data.description("blocked");
            assert.equal(model.data.description(), "stored");
            model.unlock();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.equal(model.isFrozen(), false);
            assert.equal(model.data.lock(), null);
            model.data.description("allowed");
            assert.equal(current(model), "/Ready/Fetched/Locking");
            assert.deepEqual(requests().map((r) => r[1]), ["/do/lock"]);
        });

        it("lock() is ignored while Dirty", async function () {
            let model = await fetched("l2");
            await dirty(model, "mine");
            model.lock({username: "dave"});
            assert.equal(current(model), "/Ready/Fetched/Dirty");
        });
    });

    describe("Delete / Busy/Deleting / Deleted", function () {
        it("delete locks and freezes; save sends DELETE and ends Deleted",
                async function () {
            let model = await fetched("d1");
            await model.delete();
            assert.equal(current(model), "/Delete");
            assert.equal(model.isFrozen(), true);
            assert.equal(model.canUndo(), true);
            assert.equal(model.canSave(), false);
            await env.flush();
            let promise = model.save();
            assert.equal(current(model), "/Busy/Deleting");
            assert.equal(await promise, true);
            assert.equal(current(model), "/Deleted");
            assert.deepEqual(requests().map((r) => r[0] + " " + r[1]), [
                "POST /do/lock",
                "DELETE /data/test-item/d1?eventKey=test-event-key"
            ]);
            assert.equal(model.data.isDeleted(), true);
            assert.equal(server.records.d1, undefined);
            model.clear();
            assert.equal(current(model), "/Ready/New");
        });

        it("delete(true) deletes immediately", async function () {
            let model = await fetched("d2");
            assert.equal(await model.delete(true), true);
            assert.equal(current(model), "/Deleted");
        });

        it("undo from Delete unlocks and restores Clean", async function () {
            let model = await fetched("d3");
            await model.delete();
            await env.flush();
            env.clearRequests();
            model.undo();
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Clean");
            assert.equal(model.isFrozen(), false);
            assert.deepEqual(requests().map((r) => r[1]), ["/do/unlock"]);
            model.data.description("editable again");
            assert.equal(current(model), "/Ready/Fetched/Locking");
        });

        it("a failed delete rejects and returns to Clean",
                async function () {
            let model = await fetched("d4");
            await model.delete();
            await env.flush();
            server.failNext("DELETE", "/data/test-item/d4",
                    new Error("in use"));
            let outcome = await settle(model.save());
            assert.equal(outcome.status, "rejected");
            assert.equal(outcome.error.message, "in use");
            assert.equal(current(model), "/Ready/Fetched/Clean");
        });

        it("a failed delete leaves the model editable",
                async function () {
            let model = await fetched("d5");
            await model.delete();
            await env.flush();
            server.failNext("DELETE", "/data/test-item/d5",
                    new Error("in use"));
            await settle(model.save());
            assert.equal(model.isFrozen(), false);
            assert.deepEqual(model.data.description.state().current(),
                    ["/Ready"]);
        });
    });

    describe("copy", function () {
        it("copy from Clean makes a new record with ' (copy)' key",
                async function () {
            let model = await fetched("c1");
            let originals = [];
            model.onCopy((orig) => originals.push(orig.name));
            await env.flush();
            model.copy();
            assert.equal(current(model), "/Ready/New");
            assert.notEqual(model.id(), "c1");
            assert.equal(model.data.name(), "Item c1 (copy)");
            assert.equal(model.data.description(), "stored");
            assert.equal(model.data.createdBy(), "");
            assert.equal(model.data.updatedBy(), "");
            assert.deepEqual(originals, ["Item c1"]);
            assert.deepEqual(requests(), []);
            await model.save();
            assert.equal(env.requests()[0].method, "POST");
        });

        it("copy of an autonumber record blanks the natural key",
                async function () {
            let model = f.createModel("TestAuto", {id: "a1"});
            server.put({id: "a1", number: "A001", note: "n",
                    objectType: "testAuto"});
            await model.fetch();
            assert.equal(model.data.number.isReadOnly(), true);
            model.copy();
            assert.equal(current(model), "/Ready/New");
            assert.equal(model.data.number(), "");
            assert.equal(model.data.note(), "n");
        });

        it("canCopy needs a natural key and canCreate authorization",
                async function () {
            let model = await fetched("c2");
            assert.equal(model.canCopy(), false);
            model.checkCreate();
            await env.flush();
            assert.deepEqual(requests().map((r) => r[1]), [
                "/do/is-authorized?feather=TestItem&action=canCreate"
            ]);
            assert.equal(model.canCopy(), true);
            await dirty(model, "x");
            assert.equal(model.canCopy(), false, "not while Dirty");
            let plain = f.createModel("TestPlain");
            plain.checkCreate();
            await env.flush();
            assert.equal(plain.naturalKey(), "");
            assert.equal(plain.canCopy(), false, "no natural key");
        });

        it("copy is ignored while Dirty", async function () {
            let model = await fetched("c3");
            await dirty(model, "d");
            model.copy();
            assert.equal(current(model), "/Ready/Fetched/Dirty");
            assert.equal(model.id(), "c3");
        });
    });

    describe("child arrays", function () {
        it("new lines are posted with the parent and become Clean",
                async function () {
            let model = f.createModel("TestItem");
            model.data.name("Parent");
            let line = model.data.lines().add({product: "P1", qty: 2});
            model.data.lines().add({product: "P2", qty: 1});
            assert.equal(current(line), "/Ready/New");
            assert.equal(line.parent(), model);
            assert.equal(line.isChild, true);
            await model.save();
            let body = env.requests()[0].body;
            assert.deepEqual(body.lines.map((l) => [l.product, l.qty]),
                    [["P1", 2], ["P2", 1]]);
            assert.equal(body.lines[0].parent, undefined,
                    "childOf property is not sent");
            assert.deepEqual(
                model.data.lines().map(current),
                ["/Ready/Fetched/Clean", "/Ready/Fetched/Clean"]
            );
        });

        it("editing a line dirties the line and the parent",
                async function () {
            let model = await saved("Edit line", [{product: "A"}]);
            let line = model.data.lines()[0];
            line.data.qty(5);
            assert.equal(current(line), "/Ready/Fetched/Dirty",
                    "children skip Locking");
            assert.equal(current(model), "/Ready/Fetched/Locking");
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Dirty");
            await model.save();
            assert.deepEqual(env.requests().map((r) => r.body), [
                {id: model.id(), eventKey: "test-event-key"},
                [{op: "replace", path: "/lines/0/qty", value: 5}]
            ]);
            // Saving reloads the array: rows are new, clean instances
            assert.notEqual(model.data.lines()[0], line);
            assert.equal(current(model.data.lines()[0]),
                    "/Ready/Fetched/Clean");
            assert.equal(model.data.lines()[0].data.qty.toJSON(), 5);
        });

        it("child lines cannot be saved on their own", async function () {
            let model = await saved("Child save", [{product: "A"}]);
            let line = model.data.lines()[0];
            line.data.qty(1);
            await env.flush();
            env.clearRequests();
            line.save();
            await env.flush();
            assert.deepEqual(requests().filter((r) => r[0] === "PATCH"), []);
        });

        it("removing a line patches it to null and drops it on save",
                async function () {
            let model = await saved("Remove", [{product: "A"},
                    {product: "B"}]);
            let lines = model.data.lines();
            lines.remove(lines[0]);
            await env.flush();
            assert.equal(current(model), "/Ready/Fetched/Dirty");
            assert.equal(lines.length, 1);
            assert.equal(model.toJSON().lines.length, 2,
                    "fetched rows leave a placeholder");
            assert.equal(model.toJSON().lines[0], undefined);
            await model.save();
            assert.deepEqual(env.requests()[1].body, [
                {op: "replace", path: "/lines/0", value: null}
            ]);
            assert.deepEqual(model.data.lines().map((l) => l.data.product()),
                    ["B"]);
            assert.equal(current(model), "/Ready/Fetched/Clean");
        });

        it("removing a line from a new parent drops it entirely",
                function () {
            let model = f.createModel("TestItem");
            let a = model.data.lines().add({product: "A"});
            model.data.lines().add({product: "B"});
            model.data.lines().remove(a);
            assert.deepEqual(model.toJSON().lines.map((l) => l.product),
                    ["B"]);
        });

        it("moveUp and moveDown swap row data but keep ids in place",
                function () {
            let model = f.createModel("TestItem");
            let a = model.data.lines().add({product: "A"});
            let b = model.data.lines().add({product: "B"});
            let ids = [a.id(), b.id()];
            model.data.lines().moveUp(b);
            assert.deepEqual(model.toJSON().lines.map((l) => l.product),
                    ["B", "A"]);
            assert.deepEqual(model.toJSON().lines.map((l) => l.id), ids);
            model.data.lines().moveDown(a);
            assert.deepEqual(model.toJSON().lines.map((l) => l.product),
                    ["A", "B"]);
        });

        it("a line without a parent is read only", function () {
            let line = f.createModel("TestItemLine");
            assert.equal(line.isReadOnly(), true);
        });

        it("child validation errors block the parent save",
                async function () {
            let model = f.createModel("TestItem");
            model.data.name("Bad child");
            model.data.lines().add({qty: 1});
            assert.equal(model.isValid(), false);
            assert.equal(model.lastError(), "\"Product\" is required");
            model.save().catch(() => undefined);
            await env.flush();
            assert.deepEqual(requests(), []);
        });

        it("assigning a non-array to a to-many property throws", function () {
            let model = f.createModel("TestItem");
            assert.throws(
                () => model.data.lines("x"),
                /Value assignment for lines must be an array/
            );
        });
    });

    describe("validation and events", function () {
        it("validates required, min and max", function () {
            let model = f.createModel("TestItem");
            model.data.name("ok");
            assert.equal(model.isValid(), true);
            assert.equal(model.lastError(), "");
            model.data.qty(-1);
            assert.equal(model.isValid(), false);
            assert.equal(model.lastError(), "Minimum value for \"Qty\" is 0");
            model.data.qty(1);
            model.data.count(101);
            assert.equal(model.isValid(), false);
            assert.equal(model.lastError(),
                    "Maximum value for \"Count\" is 100");
            model.data.count(100);
            model.onValidate(function () {
                throw new Error("custom");
            });
            assert.equal(model.isValid(), false);
            assert.equal(model.lastError().message, "custom");
        });

        it("onChange sees old/new values; onChanged sees the result",
                function () {
            let model = f.createModel("TestItem");
            let log = [];
            model.onChange("name", function (p) {
                log.push(["change", p.oldValue(), p.newValue(), p()]);
            });
            model.onChanged("name", function (p) {
                log.push(["changed", p()]);
            });
            model.data.name("A");
            assert.deepEqual(log, [["change", "", "A", ""], ["changed", "A"]]);
        });

        it("onChange can rewrite the proposed value", function () {
            let model = f.createModel("TestItem");
            model.onChange("name", function (p) {
                p.newValue(p.newValue().trim());
            });
            model.data.name("  padded  ");
            assert.equal(model.data.name(), "padded");
        });

        it("dot notation binds change events on child rows", function () {
            let model = f.createModel("TestItem");
            let seen = [];
            model.onChanged("lines.qty", (p) => seen.push(p()));
            let line = model.data.lines().add({product: "A"});
            line.data.qty(4);
            assert.deepEqual(seen, ["4"]);
        });

        it("set(data, silent) does not fire change events", function () {
            let model = f.createModel("TestItem");
            let events = 0;
            model.onChanged("name", () => (events += 1));
            model.set({name: "quiet"}, true);
            assert.equal(model.data.name(), "quiet");
            assert.equal(events, 0);
            model.set({name: "loud"});
            assert.equal(events, 1);
        });

        it("addCalculated adds a read only computed property", function () {
            let model = f.createModel("TestItem");
            model.addCalculated({
                name: "total",
                type: "number",
                function: () => 42
            });
            assert.equal(model.data.total(), 42);
            assert.equal(model.data.total.isReadOnly(), true);
            assert.equal(model.data.total.isCalculated, true);
            assert.equal(model.data.total.alias(), "Total");
            assert.equal(model.toJSON().total, undefined,
                    "calculated values are not serialized");
        });

        it("path builds the REST path from the feather name", function () {
            let model = f.createModel("TestItem");
            assert.equal(model.path("SalesOrderLine"),
                    "/data/sales-order-line");
            assert.equal(model.path("TestItem", "x1"), "/data/test-item/x1");
        });
    });

    describe("subscriptions and authorization", function () {
        it("subscribe(true/false) registers and notifies the server",
                function () {
            let model = f.createModel("TestItem", {id: "s1"});
            assert.equal(model.subscribe(), false);
            model.subscribe(true);
            let sid = model.subscribe();
            assert.match(sid, /^[0-9a-z]+$/);
            assert.equal(
                f.catalog().store().subscriptions()[sid][0],
                model
            );
            model.subscribe(false);
            assert.equal(model.subscribe(), false);
            let paths = env.requests().map((r) => decodeURIComponent(r.path));
            assert.deepEqual(paths, [
                "/do/subscribe/id=s1&subscription[id]=" + sid +
                        "&subscription[eventKey]=test-event-key",
                "/do/unsubscribe/subscription[id]=" + sid
            ]);
            assert.equal(f.catalog().store().subscriptions()[sid],
                    undefined);
        });

        it("checkUpdate freezes until canUpdate is confirmed",
                async function () {
            let model = await fetched("u1");
            let hold = server.hold("GET", "/do/is-authorized");
            model.checkUpdate();
            assert.equal(model.isFrozen(), true);
            hold.release();
            await env.flush();
            assert.equal(model.isFrozen(), false);
            assert.equal(model.canUpdate(), true);
            assert.deepEqual(requests().map((r) => r[1]), [
                "/do/is-authorized?id=u1&action=canUpdate"
            ]);
        });

        it("checkDelete adds an authorization check to canDelete",
                async function () {
            let model = await fetched("u2");
            env.respond(function (req) {
                if (req.path.startsWith("/do/is-authorized")) {
                    return false;
                }
                return server.handle(req);
            });
            try {
                model.checkDelete();
                assert.equal(model.canDelete(), false, "until answered");
                await env.flush();
                assert.equal(model.canDelete(), false);
            } finally {
                env.respond(server.handle);
            }
        });
    });
});
