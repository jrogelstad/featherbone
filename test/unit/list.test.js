/*
    client/models/list.js: model lists (f.createList) and their statechart
    (Unitialized, Busy/{Fetching, Saving}, Fetched/{Clean, Dirty}).
    Pins the fetch request body (filter, limit, properties, subscription,
    showDeleted), how member model state changes roll up to the list,
    batch save of dirty/new/deleted rows, cancellation of superseded
    fetches, reset, index maintenance, tree indentation and the client
    side inFilter used for subscription events.
*/
/*jslint node*/
"use strict";

const {describe, it, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const env = require("./lib/browser-env");
const testFeathers = require("./lib/test-feathers");
const {createServer} = require("./lib/fake-server");

let f;
let server;

function rec(id, extra) {
    return Object.assign({
        id,
        created: "c",
        createdBy: "u",
        updated: "u",
        updatedBy: "u",
        isDeleted: false,
        lock: null,
        objectType: "testItem",
        etag: "e",
        name: "Name " + id,
        description: "",
        qty: 1,
        price: 2,
        count: 0,
        isActive: true,
        category: null,
        lines: []
    }, extra);
}

function current(obj) {
    return obj.state().current()[0];
}

function paths() {
    return env.requests().map((r) => r.method + " " + r.path);
}

async function loaded(options) {
    let ary = f.createList("TestItem", Object.assign({fetch: false},
            options));
    await ary.fetch();
    await env.flush();
    env.clearRequests();
    return ary;
}

describe("client list statechart (models/list.js)", function () {
    before(async function () {
        f = (await env.loadClient()).f;
        testFeathers.registerAll(env);
        server = createServer();
        env.respond(server.handle);
        server.list("test-items", function () {
            return Object.values(server.records).filter(
                (r) => r.objectType === "testItem"
            );
        });
    });

    beforeEach(function () {
        Object.keys(server.records).forEach((k) => delete server.records[k]);
        ["a", "b", "c"].forEach((id) => server.put(rec(id)));
        env.clearRequests();
    });

    it("createList without fetch starts Unitialized", function () {
        let ary = f.createList("TestItem", {fetch: false});
        assert.ok(Array.isArray(ary));
        assert.equal(current(ary), "/Unitialized");
        assert.equal(ary.path(), "/data/test-items");
        assert.equal(ary.length, 0);
        assert.equal(ary.subscribe(), false);
        assert.equal(ary.isEditable(), true);
        assert.equal(ary.showDeleted(), false);
        assert.equal(ary.defaultLimit(), 20);
        assert.deepEqual(env.requests(), []);
    });

    it("fetch posts the query and loads clean models", async function () {
        let ary = f.createList("TestItem", {fetch: false});
        let redraws = env.redraws();
        let promise = ary.fetch({
            criteria: [{property: "name", value: "x"}],
            sort: [{property: "name"}]
        });
        assert.equal(current(ary), "/Busy/Fetching");
        assert.equal(await promise, ary);
        assert.equal(current(ary), "/Fetched/Clean");
        assert.deepEqual(env.requests().map((r) => [
            r.method, r.url, r.body, r.background
        ]), [[
            "POST",
            "/demo/data/test-items",
            {
                filter: {
                    criteria: [{property: "name", value: "x"}],
                    sort: [{property: "name"}],
                    limit: 20
                },
                showDeleted: false
            },
            true
        ]]);
        assert.deepEqual(ary.map((m) => m.id()), ["a", "b", "c"]);
        assert.deepEqual(ary.map(current), [
            "/Ready/Fetched/Clean", "/Ready/Fetched/Clean",
            "/Ready/Fetched/Clean"
        ]);
        assert.deepEqual(ary.index(), {a: 0, b: 1, c: 2});
        assert.equal(env.redraws(), redraws + 1, "redraws after fetch");
    });

    it("createList fetches immediately by default", async function () {
        let ary = f.createList("TestItem", {
            filter: {criteria: [], limit: 5, showDeleted: true}
        });
        assert.equal(current(ary), "/Busy/Fetching");
        await env.flush();
        assert.equal(current(ary), "/Fetched/Clean");
        assert.deepEqual(env.requests()[0].body, {
            filter: {criteria: [], limit: 5},
            showDeleted: true
        });
        assert.equal(ary.showDeleted(), true);
    });

    it("subscribed lists send a subscription with the query",
            async function () {
        let ary = f.createList("TestItem", {fetch: false, subscribe: true});
        let sid = ary.subscribe();
        assert.match(sid, /^[0-9a-z]+$/);
        assert.equal(f.catalog().store().subscriptions()[sid], ary);
        await ary.fetch({}, false);
        assert.deepEqual(env.requests()[0].body.subscription, {
            id: sid,
            eventKey: "test-event-key",
            merge: false
        });
        env.clearRequests();
        await ary.subscribe(false);
        assert.deepEqual(env.requests().map(
            (r) => decodeURIComponent(r.url)
        ), ["/demo/do/unsubscribe/subscription[id]=" + sid]);
        assert.equal(f.catalog().store().subscriptions()[sid], undefined);
    });

    it("subscribe(false) clears the subscribed flag",
            {todo: "defect: list.subscribe(false) returns the unsubscribe " +
            "request before resetting isSubscribed, so subscribe() still " +
            "returns the id and later fetches re-subscribe"},
            async function () {
        let ary = f.createList("TestItem", {fetch: false, subscribe: true});
        await ary.subscribe(false);
        assert.equal(ary.subscribe(), false);
    });

    it("a property subset adds always-load properties", async function () {
        let ary = f.createList("TestItem", {fetch: false});
        ary.properties(["name"]);
        await ary.fetch();
        assert.deepEqual(env.requests()[0].body.properties, [
            "name", "id", "isDeleted", "lock", "objectType"
        ]);
    });

    it("non-editable lists build models with only the fetched properties",
            async function () {
        let ary = f.createList("TestItem", {
            fetch: false,
            isEditable: false
        });
        ary.properties(["name", "category.code"]);
        await ary.fetch();
        assert.deepEqual(env.requests()[0].body.properties, [
            "name", "category", "id", "isDeleted", "lock", "objectType"
        ]);
        assert.deepEqual(Object.keys(ary[0].data).sort(), [
            "category", "id", "isDeleted", "lock", "name", "objectType"
        ]);
        assert.equal(current(ary[0]), "/Ready/Fetched/Clean");
    });

    it("an edited member makes the list Dirty; save patches it",
            async function () {
        let ary = await loaded();
        ary[0].data.description("edited");
        await env.flush();
        assert.equal(current(ary), "/Fetched/Dirty");
        env.clearRequests();
        let promise = ary.save();
        assert.equal(current(ary), "/Busy/Saving");
        let result = await promise;
        assert.equal(result.length, 1);
        assert.equal(result[0], ary[0].data);
        assert.equal(current(ary), "/Fetched/Clean");
        assert.deepEqual(env.requests().map((r) => [r.method, r.path,
                r.body]), [[
            "PATCH",
            "/data/test-item/a?eventKey=test-event-key",
            [{op: "replace", path: "/description", value: "edited"}]
        ]]);
    });

    it("undo of the only dirty member makes the list Clean",
            async function () {
        let ary = await loaded();
        ary[1].data.description("oops");
        await env.flush();
        assert.equal(current(ary), "/Fetched/Dirty");
        ary[1].undo();
        await env.flush();
        assert.equal(current(ary), "/Fetched/Clean");
    });

    it("saves new, edited and deleted members together", async function () {
        let ary = await loaded();
        let added = f.createModel("TestItem");
        added.data.name("Added");
        ary.add(added);
        assert.equal(current(ary), "/Fetched/Dirty");
        assert.equal(ary.length, 4);
        assert.equal(ary.index()[added.id()], 3);
        ary[0].data.description("changed");
        await ary[1].delete();
        await env.flush();
        env.clearRequests();
        await ary.save();
        await env.flush();
        assert.equal(current(ary), "/Fetched/Clean");
        assert.deepEqual(paths().sort(), [
            "DELETE /data/test-item/b?eventKey=test-event-key",
            "PATCH /data/test-item/a?eventKey=test-event-key",
            "POST /data/test-item"
        ]);
        assert.deepEqual(ary.map((m) => m.data.name()),
                ["Name a", "Name c", "Added"]);
        assert.deepEqual(ary.index(), {a: 0, c: 1, [added.id()]: 2});
    });

    it("saves one by one when members have onSave processing",
            async function () {
        let ary = await loaded();
        let order = [];
        ary.forEach(function (m) {
            m.onSave(() => order.push("pre " + m.id()));
        });
        ary.onSave(() => order.push("list pre"));
        ary.onSaved(() => order.push("list post"));
        ary[0].data.description("1");
        ary[2].data.description("3");
        await env.flush();
        await ary.save({vm: true});
        await env.flush();
        assert.deepEqual(order, ["list pre", "pre a", "pre c", "list post"]);
        assert.equal(current(ary), "/Fetched/Clean");
    });

    it("a newer fetch cancels the pending one", async function () {
        let ary = f.createList("TestItem", {fetch: false});
        let first = server.hold("POST", "/data/test-items");
        let p1 = ary.fetch({criteria: [{property: "name", value: "1"}]});
        let p2 = ary.fetch({criteria: [{property: "name", value: "2"}]});
        await p2;
        assert.equal(current(ary), "/Fetched/Clean");
        assert.equal(ary.length, 3);
        first.release();
        assert.equal(await p1, ary, "superseded fetch still resolves");
        assert.equal(ary.length, 3, "and does not add rows");
        assert.equal(env.requests().length, 2);
    });

    it("merge fetch keeps rows; non-merge replaces them", async function () {
        let ary = await loaded();
        delete server.records.c;
        await ary.fetch({}, true);
        assert.deepEqual(ary.map((m) => m.id()), ["a", "b", "c"],
                "merge only adds/replaces");
        await ary.fetch({}, false);
        assert.deepEqual(ary.map((m) => m.id()), ["a", "b"]);
    });

    it("a refetch undoes unsaved edits", async function () {
        let ary = await loaded();
        let model = ary[0];
        model.data.description("unsaved");
        await env.flush();
        await ary.fetch();
        assert.equal(model.data.description(), "");
        assert.equal(current(ary), "/Fetched/Clean");
    });

    it("reset empties the list and returns to Unitialized",
            async function () {
        let ary = await loaded();
        ary.reset();
        assert.equal(current(ary), "/Unitialized");
        assert.equal(ary.length, 0);
        assert.deepEqual(ary.index(), {});
    });

    it("add replaces a model with the same id and can insert at a position",
            async function () {
        let ary = await loaded();
        let replacement = f.createModel("TestItem", rec("b",
                {name: "Replaced"}));
        replacement.state().goto("/Ready/Fetched");
        ary.add(replacement);
        assert.equal(ary.length, 3);
        assert.equal(ary[1], replacement);
        let top = f.createModel("TestItem", rec("top"));
        top.state().goto("/Ready/Fetched");
        ary.add(top, false, true);
        assert.deepEqual(ary.map((m) => m.id()), ["top", "a", "b", "c"]);
        assert.deepEqual(ary.index(), {top: 0, a: 1, b: 2, c: 3});
        ary.remove(ary[1]);
        assert.deepEqual(ary.index(), {top: 0, b: 1, c: 2});
    });

    it("indentOn builds a collapsible tree", function () {
        let ary = f.createList("TestItem", {fetch: false, indentOn: "count"});
        [["p", 0], ["c1", 1], ["g1", 2], ["c2", 1], ["p2", 0]].forEach(
            function (row) {
                let m = f.createModel("TestItem", rec(row[0],
                        {count: row[1]}));
                m.state().goto("/Ready/Fetched");
                ary.add(m);
            }
        );
        let byId = {};
        ary.forEach((m) => (byId[m.id()] = m));
        assert.equal(byId.p.isTreeParent(), true);
        assert.equal(byId.c1.isTreeParent(), true);
        assert.equal(byId.g1.treeParent(), byId.c1);
        assert.equal(byId.c2.treeParent(), byId.p);
        assert.equal(byId.p2.treeParent(), false);
        ary.collapseAll();
        assert.deepEqual(ary.map((m) => m.hide()),
                [false, true, true, true, false]);
        ary.expandAll();
        assert.deepEqual(ary.map((m) => m.hide()),
                [false, false, false, false, false]);
    });

    describe("inFilter", function () {
        let model;

        before(function () {
            model = f.createModel("TestItem", rec("z", {
                name: "Widget",
                qty: 5
            }));
        });

        function test(criteria) {
            let ary = f.createList("TestItem", {fetch: false});
            ary.filter({criteria});
            return Boolean(ary.inFilter(model));
        }

        it("evaluates comparison operators", function () {
            assert.equal(test([]), true);
            assert.equal(test([{property: "name", operator: "=",
                    value: "Widget"}]), true);
            assert.equal(test([{property: "name", operator: "=",
                    value: "x"}]), false);
            assert.equal(test([{property: "name", operator: "!=",
                    value: "x"}]), true);
            assert.equal(test([{property: "name", operator: "~",
                    value: "^Wid"}]), true);
            assert.equal(test([{property: "name", operator: "~",
                    value: "^wid"}]), false);
            assert.equal(test([{property: "name", operator: "~*",
                    value: "^wid"}]), true);
            assert.equal(test([{property: "name", operator: "!~*",
                    value: "^wid"}]), false);
            assert.equal(test([{property: "name", operator: "IN",
                    value: ["Widget", "Gadget"]}]), true);
            assert.equal(test([{property: "name", operator: ">",
                    value: "A"}]), true);
            assert.equal(test([{property: "name", operator: "<=",
                    value: "A"}]), false);
        });

        it("treats a missing operator as a pass", function () {
            // No operator given: the switch falls through to true
            assert.equal(test([{property: "name", value: "nomatch"}]), true);
        });

        it("text search on property arrays matches substrings",
                {todo: "defect: list.inFilter returns val.search(rg), " +
                "so a match at position 0 is falsy and no match (-1) " +
                "is truthy"}, function () {
            assert.equal(test([{property: ["name"], value: "wid"}]), true);
            assert.equal(test([{property: ["name"], value: "zzz"}]), false);
        });
    });
});
