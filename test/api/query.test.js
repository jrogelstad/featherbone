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
            terms[spec[i][0]] = await admin.create("FbtTerms", {
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
        cats.C1 = await admin.create("FbtCategory", {
            code: pre + "-C1",
            description: "gamma",
            parent: {id: kinds.K1.id}
        });
        cats.C2 = await admin.create("FbtCategory", {
            code: pre + "-C2",
            description: "delta",
            parent: {id: kinds.K2.id}
        });
        cats.C3 = await admin.create("FbtCategory", {
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
                await sorted("FbtTermsList", [{property: "net", value: 20}]),
                ["T4"]
            );
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: "=", value: 20}
                ]),
                ["T4"]
            );
        });

        it("!=", async function () {
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: "!=", value: 20}
                ]),
                ["T1", "T2", "T3", "T5"]
            );
        });

        it("<, <=, >, >=", async function () {
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: "<", value: 30}
                ]),
                ["T2", "T4"]
            );
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: "<=", value: 30}
                ]),
                ["T1", "T2", "T4"]
            );
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: ">", value: 30}
                ]),
                ["T3", "T5"]
            );
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: ">=", value: 30}
                ]),
                ["T1", "T3", "T5"]
            );
        });

        it("combines criteria with AND", async function () {
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: ">", value: 10},
                    {property: "discount", value: 2}
                ]),
                ["T4"]
            );
        });

        it("IN, and IN [] matches nothing", async function () {
            assert.deepEqual(
                await sorted("FbtTermsList", [
                    {property: "net", operator: "IN", value: [10, 50, 99]}
                ]),
                ["T2", "T3"]
            );
            assert.deepEqual(
                await sorted("FbtTermsList", [
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
                await admin.raw("POST", "/data/fbt-terms-list", {filter: {
                    criteria: [{property: "bogus", value: 1}]
                }}),
                500,
                /bogus/
            );
        });

        it("treats a null value as IS NULL", async function () {
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
                    {property: "objectType", value: "FbtCategory"}
                ]),
                ["C1", "C2", "C3"]
            );
            let rows = await admin.list("Kinds", {filter: {criteria: [
                mine,
                {property: "objectType", value: "FbtCategory"}
            ]}});
            assert.ok(rows.every((r) => r.objectType === "FbtCategory"));
        });
    });

    describe("relations", function () {
        it("filters through a dot path", async function () {
            assert.deepEqual(
                await sorted("FbtCategories", [
                    {property: "parent.code", value: pre + "-K2"}
                ]),
                ["C2"]
            );
            assert.deepEqual(
                await sorted("FbtCategories", [{
                    property: "parent.description",
                    operator: "~*",
                    value: "kind"
                }]),
                ["C1", "C2"]
            );
        });

        it("filters on a relation given as {id}", async function () {
            assert.deepEqual(
                await sorted("FbtCategories", [
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
                await sorted("FbtCategories", [
                    {property: "parent", value: {}}
                ]),
                ["C3"]
            );
        });

        it("sorts by a dot path", async function () {
            assert.deepEqual(
                await codes("FbtCategories", [{
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
                await codes("FbtCategories", [], {filter: {
                    sort: [{property: "parent", order: "desc"}]
                }}),
                ["C3", "C2", "C1"]
            );
            assert.deepEqual(
                await codes("FbtCategories", [], {filter: {
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
                await codes("FbtTermsList", [], {filter: {
                    sort: [{property: "net"}]
                }}),
                ["T2", "T4", "T1", "T5", "T3"]
            );
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {
                    sort: [{property: "net", order: "DESC"}]
                }}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
            // order is case insensitive
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {
                    sort: [{property: "net", order: "desc"}]
                }}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
        });

        it("sorts by several properties in order", async function () {
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {sort: [
                    {property: "discount"},
                    {property: "net", order: "desc"}
                ]}}),
                ["T3", "T5", "T1", "T4", "T2"]
            );
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {sort: [
                    {property: "discount", order: "desc"},
                    {property: "net"}
                ]}}),
                ["T2", "T4", "T1", "T5", "T3"]
            );
        });

        it("sorts by the amount of a money property", async function () {
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {sort: [
                    {property: "depositAmount.amount", order: "desc"}
                ]}}),
                ["T3", "T4", "T1", "T5", "T2"]
            );
        });

        it("filters on the amount of a money property", async function () {
            assert.deepEqual(
                await sorted("FbtTermsList", [{
                    property: "depositAmount.amount",
                    operator: ">",
                    value: 250
                }]),
                ["T1", "T3", "T4"]
            );
        });

        /*
            The amount of a related record's money (an inventory row's
            item cost). The criterion used to name a column the table
            listed has no such column of, and was found only through the
            view the list is selected from: it was then tested against the
            row being returned instead of choosing which to return. With
            a limit and a sort -- every list on screen -- "item cost > 10"
            asked whether a row was among the cheapest twenty AND dearer
            than 10, which is none (John, Oct 2026). Sorting by the same
            path failed outright.
        */
        describe("money on a related record", function () {
            // T1 300, T2 100, T3 500, T4 400, T5 200 -> D1..D5
            let deposit = {};

            before(async function () {
                let keys = Object.keys(terms);
                let i = 0;

                while (i < keys.length) {
                    deposit[keys[i]] = await admin.create("FbtDeposit", {
                        code: pre + "-D" + keys[i].slice(1),
                        description: "Deposit on " + keys[i],
                        terms: {id: terms[keys[i]].id}
                    });
                    i += 1;
                }
            });

            async function held(criteria, filter) {
                let rows = await admin.list("FbtDeposits", {
                    filter: Object.assign({
                        criteria: [mine].concat(criteria)
                    }, filter)
                });

                return rows.map((r) => r.code.slice(pre.length + 1));
            }

            it("filters on the amount", async function () {
                assert.deepEqual(
                    (await held([{
                        operator: ">",
                        property: "terms.depositAmount.amount",
                        value: 250
                    }])).sort(),
                    ["D1", "D3", "D4"]
                );
            });

            it("filters on the amount under a sort and a limit",
                    async function () {
                // The cheapest two cost less than 250: what the list
                // chooses from is the rows over 250, not the rows that
                // happen to come first.
                assert.deepEqual(
                    await held([{
                        operator: ">",
                        property: "terms.depositAmount.amount",
                        value: 250
                    }], {
                        limit: 2,
                        sort: [{
                            order: "ASC",
                            property: "terms.depositAmount"
                        }]
                    }),
                    ["D1", "D4"]
                );
                assert.deepEqual(
                    await held([{
                        operator: "<=",
                        property: "terms.depositAmount.amount",
                        value: 200
                    }], {
                        limit: 1,
                        sort: [{
                            order: "DESC",
                            property: "terms.depositAmount.amount"
                        }]
                    }),
                    ["D5"]
                );
            });

            it("filters on a list of amounts", async function () {
                assert.deepEqual(
                    (await held([{
                        operator: "IN",
                        property: "terms.depositAmount.amount",
                        value: [100, 500]
                    }], {limit: 5})).sort(),
                    ["D2", "D3"]
                );
            });

            it("sorts by the amount", async function () {
                assert.deepEqual(
                    await held([], {sort: [{
                        order: "DESC",
                        property: "terms.depositAmount.amount"
                    }]}),
                    ["D3", "D4", "D1", "D5", "D2"]
                );
            });

            // What clicking the column's header sorts by.
            it("sorts by the money itself", async function () {
                assert.deepEqual(
                    await held([], {sort: [{
                        order: "ASC",
                        property: "terms.depositAmount"
                    }]}),
                    ["D2", "D5", "D1", "D4", "D3"]
                );
            });
        });

        it("rejects an unknown sort order", async function () {
            expectError(
                await admin.raw("POST", "/data/fbt-terms-list", {filter: {
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
                await codes("FbtTermsList", [], {filter: {sort, limit: 2}}),
                ["T2", "T4"]
            );
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {
                    sort,
                    limit: 2,
                    offset: 2
                }}),
                ["T1", "T5"]
            );
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {sort, offset: 4}}),
                ["T3"]
            );
            // String values work too (query strings from the client)
            assert.deepEqual(
                await codes("FbtTermsList", [], {filter: {
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
            let rows = await admin.list("FbtTermsList", {
                properties: ["code", "net"],
                filter: {criteria: [mine], sort: [{property: "net"}]}
            });
            assert.equal(rows.length, 5);
            rows.forEach((r) => assert.deepEqual(Object.keys(r), ["code", "net"]));
            assert.deepEqual(rows[0], {code: pre + "-T2", net: 10});
        });

        it("returns the whole relation for a dot path property",
                async function () {
            let rows = await admin.list("FbtCategories", {
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

        // "rejects an unknown projected property" lived here as a todo
        // until improvement item 0.16 was fixed. The coverage moved to
        // crud.test.js, which does not need SupplyChain installed to run.

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
                name: "FbtTerms",
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

        /*
            A list footer under a money column used to add up each row's
            own-currency amount and label the sum as base. Totals are now
            of what each value is worth in base (money_base), so rows in
            different currencies add up to a number in one.
        */
        it("totals money in the base currency", async function () {
            let base = (await admin.raw("GET", "/currency/base")).body;
            let foreign = await admin.create("Currency", {
                code: uniq("FA").slice(0, 14),
                description: "Aggregate foreign",
                minorUnit: 2,
                symbol: "F"
            });
            let fx = uniq("QRYFX");
            let resp;
            let reverse = await admin.create("Currency", {
                code: uniq("FB").slice(0, 14),
                description: "Aggregate reverse",
                minorUnit: 2,
                symbol: "R"
            });

            // 1 foreign = 0.25 base; 1 base = 4 reverse (stored that way)
            await admin.create("CurrencyConversion", {
                fromCurrency: {id: foreign.id},
                ratio: 0.25,
                toCurrency: {id: base.id}
            });
            await admin.create("CurrencyConversion", {
                fromCurrency: {id: base.id},
                ratio: 4,
                toCurrency: {id: reverse.id}
            });
            await admin.create("FbtTerms", {
                code: fx + "-A",
                depositAmount: money(100, foreign.code),
                depositRequired: true,
                policy: "N"
            });
            await admin.create("FbtTerms", {
                code: fx + "-B",
                depositAmount: money(40, reverse.code),
                depositRequired: true,
                policy: "N"
            });
            await admin.create("FbtTerms", {
                code: fx + "-C",
                depositAmount: money(7, base.code),
                depositRequired: true,
                policy: "N"
            });

            resp = await admin.raw("POST", "/do/aggregate/", {
                aggregations: [
                    {method: "SUM", property: "depositAmount.amount"},
                    {method: "COUNT", property: "depositAmount.amount"}
                ],
                filter: {criteria: [{
                    operator: "~",
                    property: "code",
                    value: "^" + escapeRegExp(fx)
                }]},
                name: "FbtTerms"
            });
            assert.equal(resp.status, 200, JSON.stringify(resp.body));
            // 100 x 0.25 + 40 / 4 + 7, not 147
            assert.deepEqual(resp.body, {result: {f1: 42, f2: 3}});
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
