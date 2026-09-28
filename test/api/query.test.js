/*
    Query requests: POST /data/<plural> (server.js doQueryRequest ->
    crud.doSelect/buildWhere/appendWhere) and POST /do/aggregate/
    (crud.doAggregate).

    Covers every filter operator in f.operators (=, !=, <, >, <=, >=, ~,
    !~, ~*, !~*, IN, IS), OR across properties (property array), dot paths
    through relations, objectType, sort (asc/desc/multiple/money/relation),
    limit/offset, property projection and showDeleted. Every query is
    narrowed to records this file creates with a unique code prefix.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("../harness/http");
const {uniq, money} = require("../harness/fixtures");
const {expectError, escapeRegExp} = require("./lib/data-api");

describe("data API queries", function () {
    let admin;
    let pre;
    let mine;
    let terms = {};
    let kinds = {};
    let cats = {};

    // Codes of the records returned, with this file's prefix stripped
    async function codes(plural, criteria, extra) {
        let payload = Object.assign({}, extra);
        payload.filter = Object.assign({
            criteria: [mine].concat(criteria || [])
        }, payload.filter);
        let rows = await admin.list(plural, payload);
        return rows.map((r) => r.code.slice(pre.length + 1));
    }

    async function sorted(plural, criteria, extra) {
        return (await codes(plural, criteria, extra)).sort();
    }

    before(async function () {
        admin = await signedIn();
        pre = uniq("QRY");
        mine = {property: "code", operator: "~", value: "^" + escapeRegExp(pre)};

        // net, discount and deposit are distinct or tied on purpose
        let spec = [
            ["T1", 30, 1, 300],
            ["T2", 10, 2, 100],
            ["T3", 50, 1, 500],
            ["T4", 20, 2, 400],
            ["T5", 40, 1, 200]
        ];
        let i = 0;
        while (i < spec.length) {
            terms[spec[i][0]] = await admin.create("Terms", {
                code: pre + "-" + spec[i][0],
                policy: "N",
                net: spec[i][1],
                discount: spec[i][2],
                depositRequired: true,
                depositAmount: money(spec[i][3])
            });
            i += 1;
        }

        kinds.K1 = await admin.create("Kind", {
            code: pre + "-K1",
            description: "Alpha kind"
        });
        kinds.K2 = await admin.create("Kind", {
            code: pre + "-K2",
            description: "beta kind"
        });
        cats.C1 = await admin.create("Category", {
            code: pre + "-C1",
            description: "gamma",
            parent: {id: kinds.K1.id}
        });
        cats.C2 = await admin.create("Category", {
            code: pre + "-C2",
            description: "delta",
            parent: {id: kinds.K2.id}
        });
        cats.C3 = await admin.create("Category", {
            code: pre + "-C3",
            description: "orphan"
        });
    });

    describe("filter criteria operators", function () {
        it("created the fixture values the queries rely on",
                async function () {
            assert.deepEqual(
                Object.keys(terms).map((k) => [
                    k, terms[k].net, terms[k].discount,
                    terms[k].depositAmount.amount
                ]),
                [
                    ["T1", 30, 1, 300],
                    ["T2", 10, 2, 100],
                    ["T3", 50, 1, 500],
                    ["T4", 20, 2, 400],
                    ["T5", 40, 1, 200]
                ]
            );
        });

        it("= is the default operator", async function () {
            assert.deepEqual(
                await sorted("TermsList", [{property: "net", value: 20}]),
                ["T4"]
            );
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "=", value: 20}
                ]),
                ["T4"]
            );
        });

        it("!=", async function () {
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "!=", value: 20}
                ]),
                ["T1", "T2", "T3", "T5"]
            );
        });

        it("<, <=, >, >=", async function () {
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "<", value: 30}
                ]),
                ["T2", "T4"]
            );
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "<=", value: 30}
                ]),
                ["T1", "T2", "T4"]
            );
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: ">", value: 30}
                ]),
                ["T3", "T5"]
            );
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: ">=", value: 30}
                ]),
                ["T1", "T3", "T5"]
            );
        });

        it("combines criteria with AND", async function () {
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: ">", value: 10},
                    {property: "discount", value: 2}
                ]),
                ["T4"]
            );
        });

        it("IN, and IN [] matches nothing", async function () {
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "IN", value: [10, 50, 99]}
                ]),
                ["T2", "T3"]
            );
            assert.deepEqual(
                await sorted("TermsList", [
                    {property: "net", operator: "IN", value: []}
                ]),
                []
            );
        });

        it("~ and !~ match regular expressions case sensitively",
                async function () {
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "description", operator: "~", value: "^Alpha"}
                ]),
                ["K1"]
            );
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "description", operator: "~", value: "^alpha"}
                ]),
                []
            );
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "description", operator: "!~", value: "^Alpha"}
                ]),
                ["C1", "C2", "C3", "K2"]
            );
        });

        it("~* and !~* match case insensitively", async function () {
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "description", operator: "~*", value: "^ALPHA"}
                ]),
                ["K1"]
            );
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "description", operator: "!~*", value: "KIND$"}
                ]),
                ["C1", "C2", "C3"]
            );
        });

        it("IS compares dates to named periods", async function () {
            assert.deepEqual(
                await sorted("Kinds", [{
                    property: "created",
                    operator: "IS",
                    value: "ON_OR_AFTER_TODAY"
                }]),
                ["C1", "C2", "C3", "K1", "K2"]
            );
            assert.deepEqual(
                await sorted("Kinds", [{
                    property: "created",
                    operator: "IS",
                    value: "BEFORE_TODAY"
                }]),
                []
            );
            expectError(
                await admin.raw("POST", "/data/kinds", {filter: {criteria: [{
                    property: "created",
                    operator: "IS",
                    value: "SOMEDAY"
                }]}}),
                500,
                "Value SOMEDAY for date operator 'IS' unknown"
            );
        });

        it("rejects an unknown operator", async function () {
            expectError(
                await admin.raw("POST", "/data/kinds", {filter: {criteria: [
                    {property: "code", operator: "LIKE", value: "x"}
                ]}}),
                500,
                "Unknown operator \"LIKE\""
            );
        });

        it("fails on an unknown property with a database error",
                async function () {
            expectError(
                await admin.raw("POST", "/data/terms-list", {filter: {
                    criteria: [{property: "bogus", value: 1}]
                }}),
                500,
                /bogus/
            );
        });

        it("treats a null value as IS NULL", {
            todo: "defect: null criteria value -> TypeError 'Cannot read " +
                    "properties of null' (crud.js:48 transformObj)"
        }, async function () {
            let resp = await admin.raw("POST", "/data/kinds", {filter: {
                criteria: [mine, {property: "note", value: null}]
            }});
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
        });

        it("ORs a value across a property array", async function () {
            assert.deepEqual(
                await sorted("Kinds", [{
                    property: ["code", "description"],
                    operator: "~*",
                    value: "K1$|^beta"
                }]),
                ["K1", "K2"]
            );
        });

        it("includes descendant feathers and filters on objectType",
                async function () {
            assert.deepEqual(
                await sorted("Kinds", []),
                ["C1", "C2", "C3", "K1", "K2"]
            );
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "objectType", value: "Category"}
                ]),
                ["C1", "C2", "C3"]
            );
            let rows = await admin.list("Kinds", {filter: {criteria: [
                mine,
                {property: "objectType", value: "Category"}
            ]}});
            assert.ok(rows.every((r) => r.objectType === "Category"));
        });
    });

    describe("relations", function () {
        it("filters through a dot path", async function () {
            assert.deepEqual(
                await sorted("Categories", [
                    {property: "parent.code", value: pre + "-K2"}
                ]),
                ["C2"]
            );
            assert.deepEqual(
                await sorted("Categories", [{
                    property: "parent.description",
                    operator: "~*",
                    value: "kind"
                }]),
                ["C1", "C2"]
            );
        });

        it("filters on a relation given as {id}", async function () {
            assert.deepEqual(
                await sorted("Categories", [
                    {property: "parent", value: {id: kinds.K1.id}}
                ]),
                ["C1"]
            );
        });

        it("filters for an empty relation with {}", {
            todo: "defect: the IS NULL branch in appendWhere (crud.js:276) " +
                    "is unreachable; transformObj turns {} into " +
                    "parent.id = undefined so nothing matches"
        }, async function () {
            assert.deepEqual(
                await sorted("Categories", [{property: "parent", value: {}}]),
                ["C3"]
            );
        });

        it("sorts by a dot path", async function () {
            assert.deepEqual(
                await codes("Categories", [{
                    property: "parent.description",
                    operator: "~*",
                    value: "kind"
                }], {filter: {sort: [{property: "parent.code", order: "desc"}]}}),
                ["C2", "C1"]
            );
        });

        it("sorts by a relation on its first relation property",
                async function () {
            // parent -> parent.code; NULL sorts first descending
            assert.deepEqual(
                await codes("Categories", [], {filter: {
                    sort: [{property: "parent", order: "desc"}]
                }}),
                ["C3", "C2", "C1"]
            );
            assert.deepEqual(
                await codes("Categories", [], {filter: {
                    sort: [{property: "parent"}]
                }}),
                ["C1", "C2", "C3"]
            );
        });
    });

    describe("sort and paging", function () {
        it("sorts ascending by default and descending on request",
                async function () {
            assert.deepEqual(
                await codes("TermsList", [], {filter: {
                    sort: [{property: "net"}]
                }}),
                ["T2", "T4", "T1", "T5", "T3"]
            );
            assert.deepEqual(
                await codes("TermsList", [], {filter: {
                    sort: [{property: "net", order: "DESC"}]
                }}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
            // order is case insensitive
            assert.deepEqual(
                await codes("TermsList", [], {filter: {
                    sort: [{property: "net", order: "desc"}]
                }}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
        });

        it("sorts by several properties in order", async function () {
            assert.deepEqual(
                await codes("TermsList", [], {filter: {sort: [
                    {property: "discount"},
                    {property: "net", order: "desc"}
                ]}}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
            assert.deepEqual(
                await codes("TermsList", [], {filter: {sort: [
                    {property: "discount", order: "desc"},
                    {property: "net"}
                ]}}),
                ["T2", "T4", "T1", "T5", "T3"]
            );
        });

        it("sorts by the amount of a money property", async function () {
            assert.deepEqual(
                await codes("TermsList", [], {filter: {sort: [
                    {property: "depositAmount.amount", order: "desc"}
                ]}}),
                ["T3", "T4", "T1", "T5", "T2"]
            );
        });

        it("filters on the amount of a money property", async function () {
            assert.deepEqual(
                await sorted("TermsList", [{
                    property: "depositAmount.amount",
                    operator: ">",
                    value: 250
                }]),
                ["T1", "T3", "T4"]
            );
        });

        it("rejects an unknown sort order", async function () {
            expectError(
                await admin.raw("POST", "/data/terms-list", {filter: {
                    criteria: [mine],
                    sort: [{property: "net", order: "UP"}]
                }}),
                500,
                "Unknown operator \"UP\""
            );
        });

        it("pages with limit and offset", async function () {
            let sort = [{property: "net"}];
            assert.deepEqual(
                await codes("TermsList", [], {filter: {sort, limit: 2}}),
                ["T2", "T4"]
            );
            assert.deepEqual(
                await codes("TermsList", [], {filter: {
                    sort,
                    limit: 2,
                    offset: 2
                }}),
                ["T1", "T5"]
            );
            assert.deepEqual(
                await codes("TermsList", [], {filter: {sort, offset: 4}}),
                ["T3"]
            );
            // String values work too (query strings from the client)
            assert.deepEqual(
                await codes("TermsList", [], {filter: {
                    sort,
                    limit: "1",
                    offset: "1"
                }}),
                ["T4"]
            );
        });
    });

    describe("projection and deleted records", function () {
        it("returns only the requested properties", async function () {
            let rows = await admin.list("TermsList", {
                properties: ["code", "net"],
                filter: {criteria: [mine], sort: [{property: "net"}]}
            });
            assert.equal(rows.length, 5);
            rows.forEach((r) => assert.deepEqual(Object.keys(r), ["code", "net"]));
            assert.deepEqual(rows[0], {code: pre + "-T2", net: 10});
        });

        it("returns the whole relation for a dot path property",
                async function () {
            let rows = await admin.list("Categories", {
                properties: ["code", "parent.code"],
                filter: {criteria: [{property: "code", value: pre + "-C1"}]}
            });
            assert.deepEqual(rows, [{
                code: pre + "-C1",
                parent: {
                    id: kinds.K1.id,
                    code: pre + "-K1",
                    description: "Alpha kind",
                    objectType: "Kind"
                }
            }]);
        });

        it("rejects an unknown projected property with a clear error", {
            todo: "defect: unknown property in 'properties' -> TypeError " +
                    "'reading isEncrypted' (crud.js doSelect keys.forEach)"
        }, async function () {
            let resp = await admin.raw("POST", "/data/terms-list", {
                properties: ["code", "bogus"],
                filter: {criteria: [mine]}
            });
            assert.match(String(resp.body), /bogus/);
        });

        it("hides deleted records unless showDeleted is set",
                async function () {
            let doomed = await admin.create("Kind", {code: pre + "-KX"});
            await admin.remove("Kind", doomed.id);

            assert.deepEqual(
                await sorted("Kinds", [{property: "objectType", value: "Kind"}]),
                ["K1", "K2"]
            );
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "objectType", value: "Kind"}
                ], {showDeleted: true}),
                ["K1", "K2", "KX"]
            );
            // The client sends it as a string too
            assert.deepEqual(
                await sorted("Kinds", [
                    {property: "objectType", value: "Kind"}
                ], {showDeleted: "true"}),
                ["K1", "K2", "KX"]
            );
        });
    });

    describe("POST /do/aggregate/", function () {
        function aggregate(aggregations, criteria) {
            return admin.raw("POST", "/do/aggregate/", {
                name: "Terms",
                filter: {criteria: [mine].concat(criteria || [])},
                aggregations
            });
        }

        it("returns a single aggregation as a scalar result",
                async function () {
            let resp = await aggregate([{method: "COUNT", property: "id"}]);
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, {result: 5});
        });

        it("returns several aggregations as f1..fn", async function () {
            let resp = await aggregate([
                {method: "SUM", property: "net"},
                {method: "COUNT", property: "id"},
                {method: "MAX", property: "discount"}
            ]);
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, {result: {f1: 150, f2: 5, f3: 2}});
        });

        it("supports MIN and AVG", async function () {
            assert.deepEqual(
                (await aggregate([{method: "MIN", property: "net"}])).body,
                {result: 10}
            );
            assert.deepEqual(
                (await aggregate([{method: "AVG", property: "discount"}])).body,
                {result: 1.4}
            );
        });

        it("aggregates money amounts", async function () {
            let resp = await aggregate([
                {method: "SUM", property: "depositAmount.amount"},
                {method: "MAX", property: "depositAmount.amount"}
            ]);
            assert.equal(resp.status, 200);
            assert.deepEqual(resp.body, {result: {f1: 1500, f2: 500}});
        });

        it("honors the filter", async function () {
            assert.deepEqual(
                (await aggregate(
                    [{method: "SUM", property: "net"}],
                    [{property: "discount", value: 2}]
                )).body,
                {result: 30}
            );
            assert.deepEqual(
                (await aggregate(
                    [{method: "COUNT", property: "id"}],
                    [{property: "net", value: 999}]
                )).body,
                {result: 0}
            );
        });

        it("rejects unsupported (and lower case) methods", async function () {
            expectError(
                await aggregate([{method: "MEDIAN", property: "net"}]),
                500,
                "Aggregation method MEDIAN is unsupported"
            );
            expectError(
                await aggregate([{method: "sum", property: "net"}]),
                500,
                "Aggregation method sum is unsupported"
            );
        });

        it("names the unknown feather in the error", {
            todo: "defect: message says Feather \"doAggregate\" not found " +
                    "(crud.js:912 uses obj.name, not obj.data.name)"
        }, async function () {
            let resp = await admin.raw("POST", "/do/aggregate/", {
                name: "NoSuchFeather",
                aggregations: [{method: "COUNT", property: "id"}]
            });
            expectError(resp, 500, /NoSuchFeather/);
        });

        it("allows two aggregations of the same property", {
            todo: "defect: SUM(net) + AVG(net) -> 'column reference \"net\" " +
                    "is ambiguous' (crud.js doAggregate toCols repeats the " +
                    "column in the sub-select)"
        }, async function () {
            let resp = await aggregate([
                {method: "SUM", property: "net"},
                {method: "AVG", property: "net"}
            ]);
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            assert.deepEqual(resp.body, {result: {f1: 150, f2: 30}});
        });
    });
});
