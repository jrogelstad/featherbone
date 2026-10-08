/*
    client/core.js helpers on `f`: formats (date, dateTime, money with
    currency display units, password, gantt...), f.money / baseCurrency /
    getCurrency, hashCode, resolveAlias / resolveProperty, getForm
    (auto-built form layout), and f.processEvent, which applies server
    sent events (create/update/delete/lock/unlock) to subscribed lists.
*/
/*jslint node*/
"use strict";

process.env.TZ = "America/Chicago";

const {describe, it, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const env = require("./lib/browser-env");
const testFeathers = require("./lib/test-feathers");
const {createServer} = require("./lib/fake-server");

let f;
let catalog;
let server;

function currency(code, minorUnit, extra) {
    let model = f.createModel("Currency", Object.assign({
        id: code,
        code,
        description: code,
        minorUnit,
        symbol: "$"
    }, extra));
    model.state().goto("/Ready/Fetched");
    return model;
}

describe("client/core.js helpers", function () {
    before(async function () {
        let loaded = await env.loadClient();
        f = loaded.f;
        catalog = loaded.catalog;
        testFeathers.registerSystem(env);
        testFeathers.registerAll(env);
        server = createServer();
        env.respond(server.handle);

        // Currencies as main.js loads them (isFetchOnStartup data)
        catalog.store().data().currencies().push(
            currency("USD", 2),
            currency("TST", 2, {
                hasDisplayUnit: true,
                displayUnit: {
                    id: "KTS",
                    code: "KTS",
                    description: "Kilo test",
                    minorUnit: 5,
                    symbol: "k"
                },
                conversions: [{
                    id: "conv1",
                    toUnit: {id: "KTS", code: "KTS"},
                    ratio: 0.001
                }]
            }),
            currency("CTS", 2, {
                hasDisplayUnit: true,
                displayUnit: {
                    id: "CNT",
                    code: "CNT",
                    description: "Cents",
                    minorUnit: 0,
                    symbol: "c"
                },
                conversions: [{
                    id: "conv2",
                    toUnit: {id: "CNT", code: "CNT"},
                    ratio: 100
                }]
            })
        );
        catalog.store().data().baseCurrencies().push(
            f.createModel("BaseCurrency", {
                id: "b1",
                currency: {id: "USD", code: "USD"},
                effective: "2020-01-01T00:00:00.000Z"
            })
        );
    });

    beforeEach(function () {
        env.clearRequests();
    });

    describe("money", function () {
        it("f.money defaults to the base currency", function () {
            assert.equal(f.baseCurrency().data.code(), "USD");
            assert.deepEqual(f.money(), {
                amount: 0,
                currency: "USD",
                effective: null,
                baseAmount: null
            });
            assert.deepEqual(f.money(5, "TST", "2026-01-01", 7), {
                amount: 5,
                currency: "TST",
                effective: "2026-01-01",
                baseAmount: 7
            });
        });

        it("getCurrency finds by code or display unit code", function () {
            assert.equal(f.getCurrency("USD").data.code(), "USD");
            assert.equal(f.getCurrency("KTS").data.code(), "TST");
            assert.equal(f.getCurrency("XXX"), undefined);
        });

        it("fromType formats the amount to the minor unit", function () {
            assert.deepEqual(f.formats().money.fromType({
                amount: 1234.5,
                currency: "USD",
                effective: null,
                baseAmount: null
            }), {
                amount: (1234.5).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }),
                currency: "USD",
                effective: null,
                baseAmount: null
            });
            let r = f.formats().money.fromType({
                amount: 5,
                currency: "USD",
                effective: "2026-01-02T03:04:00.000Z",
                baseAmount: 5
            });
            assert.equal(r.effective, "2026-01-01T21:04", "local time");
            assert.equal(r.baseAmount, "5");
        });

        it("fromType converts to the display unit", function () {
            assert.equal(f.formats().money.fromType({
                amount: 1500,
                currency: "TST",
                effective: null,
                baseAmount: null
            }).amount, (1.5).toLocaleString(undefined, {
                minimumFractionDigits: 5,
                maximumFractionDigits: 5
            }));
            let cents = f.formats().money.fromType({
                amount: 12.345,
                currency: "CTS",
                effective: null,
                baseAmount: null
            });
            assert.equal(cents.currency, "CNT");
            assert.equal(cents.amount, (1235).toLocaleString());
        });

        it("toType parses text amounts without rounding", function () {
            assert.deepEqual(f.formats().money.toType({
                amount: "1,234.567",
                currency: "USD",
                effective: null,
                baseAmount: null
            }), {
                amount: 1234.567,
                currency: "USD",
                effective: null,
                baseAmount: null
            });
            assert.deepEqual(f.formats().money.toType(), f.money());
        });

        it("toType converts display units back to the currency",
                function () {
            assert.deepEqual(f.formats().money.toType({
                amount: 1235,
                currency: "CNT",
                effective: null,
                baseAmount: null
            }), {
                amount: 12.35,
                currency: "CTS",
                effective: null,
                baseAmount: null
            });
        });

        it("toType handles a fractional display unit ratio", function () {
            assert.equal(f.formats().money.toType({
                amount: 1.5,
                currency: "KTS",
                effective: null,
                baseAmount: null
            }).amount, 1500);
        });

        it("isMoney recognizes money formats only", function () {
            assert.equal(f.isMoney("money"), true);
            assert.ok(!f.isMoney("date"));
            assert.ok(!f.isMoney(undefined));
        });
    });

    describe("formats", function () {
        it("registers the expected format names", function () {
            assert.deepEqual(Object.keys(f.formats()).sort(), [
                "autonumber", "color", "dataType", "date", "dateTime",
                "email", "enum", "gantt", "icon", "lock", "money",
                "overloadType", "password", "richText", "role", "script",
                "string", "tel", "textArea", "url", "userAccount"
            ]);
        });

        it("date converts Date objects and blanks", function () {
            const date = f.formats().date;
            assert.equal(date.toType(new Date(2026, 0, 2, 23, 30)),
                    "2026-01-02");
            assert.equal(date.toType(""), null);
            assert.equal(date.toType("2026-01-01"), "2026-01-01");
            assert.equal(date.default(), f.today());
        });

        it("dateTime stores ISO and displays local", function () {
            const dt = f.formats().dateTime;
            assert.equal(dt.toType(new Date(Date.UTC(2026, 0, 2, 3, 4))),
                    "2026-01-02T03:04:00.000Z");
            assert.equal(dt.toType("x"), "x");
            assert.equal(dt.fromType("2026-01-02T03:04:00.000Z"),
                    "2026-01-01T21:04");
            assert.equal(dt.fromType(null), null);
        });

        it("password masks, string/color have defaults", function () {
            assert.equal(f.formats().password.fromType("secret"), "*****");
            assert.equal(f.formats().color.default, "#000000");
            assert.equal(f.formats().string.toType(5), "5");
        });

        it("gantt converts date strings and Date objects", function () {
            const g = f.formats().gantt;
            let shown = g.fromType({data: [{
                id: 1,
                start: "2026-01-02",
                end: "2026-01-05"
            }]});
            assert.equal(shown.data[0].start.getDate(), 2);
            assert.equal(shown.data[0].end.getDate(), 5);
            assert.deepEqual(g.toType(shown), {data: [{
                id: 1,
                start: "2026-01-02",
                end: "2026-01-05"
            }]});
            assert.deepEqual(g.fromType(null), {data: []});
        });

        it("dataType tableData describes relations", function () {
            let obj = {
                value: {relation: "Contact", childOf: "lines"},
                options: {}
            };
            assert.equal(f.formats().dataType.tableData(obj),
                    "relation: Contact");
            assert.equal(obj.options.title,
                    "relation: Contact\nchild of: lines");
            obj = {value: "string", options: {}};
            assert.equal(f.formats().dataType.tableData(obj), "string");
        });

        it("model number properties round to scale and display locale",
                function () {
            let model = f.createModel("TestItem");
            model.data.qty("1,234.5678");
            assert.equal(model.data.qty.toJSON(), 1234.57);
            assert.equal(model.data.qty(), (1234.57).toLocaleString());
            model.data.price(1.123456789);
            assert.equal(model.data.price.toJSON(), 1.12345679,
                    "default scale 8");
        });
    });

    describe("misc helpers", function () {
        it("hashCode is stable and non-negative", function () {
            assert.equal(f.hashCode("abc"), 96354);
            assert.equal(f.hashCode(""), 0);
            assert.equal(f.hashCode("Featherbone"), 2016468537);
        });

        it("resolveAlias follows dot paths and overloads", function () {
            let feather = catalog.getFeather("TestItem");
            assert.equal(f.resolveAlias(feather, "category.code"), "Code");
            assert.equal(f.resolveAlias(feather, "nope"), "Nope");
            assert.equal(f.resolveAlias(feather, "isActive"), "Is Active");
            feather.overloads = {name: {alias: "Item name"}};
            assert.equal(f.resolveAlias(feather, "name"), "Item name");
        });

        it("resolveProperty traverses relations", function () {
            let model = f.createModel("TestItem");
            model.data.category({id: "c", code: "CAT", description: "d"});
            assert.equal(f.resolveProperty(model, "category.code")(), "CAT");
            assert.equal(f.resolveProperty(model, "name"), model.data.name);
            assert.equal(f.resolveProperty(model, "bogus")(),
                    "Unknown attribute 'bogus'");
            assert.equal(f.resolveProperty(null, "x")(), null);
        });

        it("findRoot walks up parents", function () {
            let model = f.createModel("TestItem");
            let line = model.data.lines().add({product: "p"});
            assert.equal(f.findRoot(line), model);
            assert.equal(f.findRoot(model), model);
        });

        it("getForm builds a layout from the feather", function () {
            assert.deepEqual(f.getForm({feather: "TestItem"}), {attrs: [
                {attr: "name"},
                {attr: "description"},
                {attr: "qty"},
                {attr: "price"},
                {attr: "count"},
                {attr: "isActive"},
                {attr: "category"},
                {
                    attr: "lines",
                    columns: [
                        {attr: "sequence"},
                        {attr: "product"},
                        {attr: "qty"}
                    ],
                    height: "200px"
                }
            ]});
        });

        it("getForm prefers an active registered form", function () {
            let forms = catalog.store().data().forms();
            forms.push({
                id: "form1",
                feather: "TestPlain",
                isActive: true,
                isDefault: true,
                attrs: [{attr: "note"}]
            });
            try {
                assert.equal(f.getForm({feather: "TestPlain"}).id, "form1");
                assert.equal(f.getForm({form: "form1"}).id, "form1");
            } finally {
                forms.length = 0;
            }
        });

        it("inputMap maps formats to input types", function () {
            assert.equal(f.inputMap.dateTime, "datetime-local");
            assert.equal(f.inputMap.money, "number");
            assert.equal(f.inputMap.boolean, "checkbox");
        });

        it("createModel by name throws for unknown feathers", function () {
            assert.throws(() => f.createModel("NoSuchThing"),
                    /Model NoSuchThing not registered/);
        });
    });

    describe("processEvent (server sent events)", function () {
        let ary;
        let sid;

        function send(change, data) {
            f.processEvent({event: {data: JSON.stringify({message: {
                subscription: {change, subscriptionid: sid},
                data
            }})}});
        }

        function item(id, extra) {
            return Object.assign({
                id,
                objectType: "testItem",
                etag: "etag-" + id,
                name: "Row " + id,
                description: "",
                qty: 1,
                price: 1,
                count: 0,
                isActive: true,
                category: null,
                lines: [],
                lock: null,
                isDeleted: false
            }, extra);
        }

        beforeEach(async function () {
            Object.keys(server.records).forEach(
                (k) => delete server.records[k]
            );
            server.put(item("r1"));
            server.put(item("r3"));
            server.list("test-items", () => Object.values(server.records));
            ary = f.createList("TestItem", {
                fetch: false,
                subscribe: true
            });
            await ary.fetch({sort: [{property: "name"}]});
            sid = ary.subscribe();
        });

        it("update with a new etag refreshes the row", function () {
            send("update", item("r1", {etag: "new", description: "srv"}));
            assert.equal(ary[0].data.description(), "srv");
            assert.equal(ary[0].state().current()[0],
                    "/Ready/Fetched/Clean");
        });

        it("update with the same etag is ignored (own change)", function () {
            send("update", item("r1", {description: "echo"}));
            assert.equal(ary[0].data.description(), "");
        });

        it("create inserts in sort order", function () {
            send("create", item("r2"));
            assert.deepEqual(ary.map((m) => m.id()), ["r1", "r2", "r3"]);
            assert.equal(ary[1].state().current()[0],
                    "/Ready/Fetched/Clean");
        });

        it("create outside the filter is not added", function () {
            ary.filter({criteria: [{
                property: "name",
                operator: "=",
                value: "Row r1"
            }]});
            send("create", item("r9"));
            assert.equal(ary.length, 2);
        });

        it("delete removes the row", function () {
            send("delete", "r1");
            assert.deepEqual(ary.map((m) => m.id()), ["r3"]);
        });

        it("lock and unlock drive the row statechart", function () {
            send("lock", {id: "r3", lock: {username: "eve"}});
            assert.equal(ary[1].state().current()[0], "/Locked");
            assert.deepEqual(ary[1].data.lock(), {username: "eve"});
            send("unlock", "r3");
            assert.equal(ary[1].state().current()[0],
                    "/Ready/Fetched/Clean");
        });

        it("events are held while processEvents(false)", function () {
            f.processEvents(false);
            try {
                send("delete", "r1");
                assert.equal(ary.length, 2);
            } finally {
                f.processEvents(true);
            }
            assert.equal(ary.length, 1);
        });

        it("ignores unknown subscriptions and bad payloads", function () {
            let log = console.log;
            console.log = () => undefined;
            try {
                f.processEvent({event: {data: "not json"}});
            } finally {
                console.log = log;
            }
            sid = "unknown";
            send("delete", "r1");
            assert.equal(ary.length, 2);
        });

        it("feather events register and unregister feathers", function () {
            sid = "any";
            send("feather", {
                name: "TestDynamic",
                plural: "TestDynamics",
                properties: {x: {type: "string"}}
            });
            assert.ok(catalog.getFeather("TestDynamic"));
            assert.equal(typeof catalog.store().models().testDynamic,
                    "function");
        });
    });
});
