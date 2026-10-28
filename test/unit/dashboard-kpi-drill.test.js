/*
    Drilling down from a metric row of a KPI tile
    (client/components/dashboard.js).

    A file of its own because the board keeps the first layout it loads
    for the life of the process: a test that needs a particular tile on
    the board has to be the one that renders it first, and the other
    dashboard files already spend that first render on something else.
*/
/*jslint node*/
"use strict";

process.env.TZ = "America/Chicago";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");
const R = require("./lib/render");
const testFeathers = require("./lib/test-feathers");

const ROOT = path.resolve(__dirname, "..", "..");
const AS_OF = "2027-06-01";

let catalog;
let comps;
// What drillFor was handed, so the test can see the date it was given.
let asked;
// How many times the lazy descriptor was asked to get its records ready.
let readied = 0;
// What the second level was asked to drill from.
let drilledFrom;

// Every vnode in a raw (unexpanded) tree, components included.
function allNodes(node, found) {
    let out = found || [];

    if (Array.isArray(node)) {
        node.forEach(function (one) {
            allNodes(one, out);
        });
        return out;
    }
    if (!node || typeof node !== "object") {
        return out;
    }
    out.push(node);
    allNodes(node.children, out);
    return out;
}

// The rows the board drew that offer a drill-down.
function drillRows(tree) {
    return allNodes(tree).filter(function (one) {
        let attrs = one.attrs || {};
        // mithril moves `class` to `className` on the way through.
        let cls = String(attrs.class || attrs.className || "");

        return cls.includes("fb-dash-row-drill");
    });
}

// The board's vnode tree, settled.
function boardTree() {
    let vnode = {attrs: {}, tag: comps.dashboard};
    let state = Object.create(comps.dashboard);

    function draw() {
        return state.view.call(state, vnode);
    }

    vnode.state = state;
    state.oninit(vnode);
    return env.flush(30).then(draw).then(function () {
        return env.flush(30);
    }).then(draw);
}

/*
    The dialog a row opens, caught as it is made: the board cannot be
    drawn again while one is open, since a dialog draws a list widget
    and that wants a DOM.
*/
function opened(row) {
    let made;
    let models = catalog.store().viewModels();
    let original = models.drillDialog;

    models.drillDialog = function (options) {
        made = original(options);
        return made;
    };
    row.attrs.onclick();
    models.drillDialog = original;
    return env.flush(10).then(function () {
        return made;
    });
}

/*
    Every drill-down made while `act` runs and settles, in order: a lazy
    descriptor opens its list after a round trip, and a drill from a row
    closes one list and opens the next.
*/
function made(act) {
    let all = [];
    let models = catalog.store().viewModels();
    let original = models.drillDialog;

    models.drillDialog = function (options) {
        let vm = original(options);

        all.push(vm);
        return vm;
    };
    act();
    return env.flush(20).then(function () {
        models.drillDialog = original;
        return all;
    });
}

function metricRow(tree, name) {
    return drillRows(tree).filter(function (one) {
        return R.text(one).includes(name);
    })[0];
}

describe("drilling into a metric", function () {
    before(async function () {
        let loaded = await env.loadClient({components: true, stableIds: true});
        let globals;

        catalog = loaded.catalog;
        await import(pathToFileURL(
            ROOT + "/client/components/dashboard-draw.js"
        ).href);
        await import(pathToFileURL(
            ROOT + "/client/components/dashboard.js"
        ).href);
        await import(pathToFileURL(
            ROOT + "/client/components/drill-dialog.js"
        ).href);
        testFeathers.registerAll(env);
        comps = catalog.store().components();
        globals = catalog.store().global();

        // One metric that says what stands behind it and one that does
        // not, so the board shows both answers at once.
        globals.dashboardKpis.register({
            drillFor: function (tile) {
                asked = tile;
                return {
                    config: {
                        aggregates: [{method: "COUNT", property: "id"}],
                        columns: [{attr: "id"}],
                        filter: {criteria: [{
                            operator: "!=",
                            property: "status",
                            value: "C"
                        }]}
                    },
                    feather: "Object",
                    title: "Open orders at " + tile.asOf
                };
            },
            format: function (n) {
                return "$" + Number(n).toLocaleString();
            },
            isStandard: false,
            key: "fbtBacklog",
            load: function () {
                return Promise.resolve({value: 4321});
            },
            module: "Test",
            name: "Fbt Backlog"
        });
        globals.dashboardKpis.register({
            format: function (n) {
                return String(n);
            },
            isStandard: false,
            key: "fbtQuiet",
            load: function () {
                return Promise.resolve({value: 11});
            },
            module: "Test",
            name: "Fbt Quiet"
        });

        // One whose records have to be got ready first, so its
        // descriptor is a function the board calls on the click.
        globals.dashboardKpis.register({
            drillFor: function (tile) {
                return function () {
                    readied += 1;
                    return Promise.resolve({
                        config: {
                            columns: [{attr: "id"}],
                            filter: {criteria: [{
                                property: "id",
                                value: "ready-" + tile.asOf
                            }]}
                        },
                        feather: "Object",
                        title: "Balances at " + tile.asOf
                    });
                };
            },
            format: String,
            isStandard: false,
            key: "fbtLater",
            load: function () {
                return Promise.resolve({value: 7});
            },
            module: "Test",
            name: "Fbt Later"
        });

        // One that drills again: from a row of its list to another list.
        globals.dashboardKpis.register({
            drillFor: function () {
                return {
                    config: {columns: [{attr: "id"}]},
                    drillFor: function (record) {
                        drilledFrom = record;
                        return {
                            config: {
                                columns: [{attr: "id"}],
                                filter: {criteria: [{
                                    property: "id",
                                    value: record.id
                                }]}
                            },
                            feather: "Object",
                            title: "Behind " + record.id
                        };
                    },
                    drillLabel: "What changed",
                    feather: "Object",
                    title: "Top level"
                };
            },
            format: String,
            isStandard: false,
            key: "fbtDeeper",
            load: function () {
                return Promise.resolve({value: 3});
            },
            module: "Test",
            name: "Fbt Deeper"
        });

        env.respond(function (req) {
            let asking = String(req.path || req.url || "");

            // A list with a totals footer asks the server to add the
            // column up; answering with a list would leave the widget
            // reading `result` off nothing.
            if (asking.includes("aggregate")) {
                return {result: {f1: 0}};
            }
            if (asking.startsWith("/dashboards")) {
                return [{
                    config: {
                        asOf: AS_OF,
                        seen: [],
                        tiles: [{
                            col: 1,
                            cols: 12,
                            grid: 24,
                            id: "fbt-metrics",
                            kpis: [
                                "fbtBacklog",
                                "fbtQuiet",
                                "fbtLater",
                                "fbtDeeper"
                            ],
                            row: 1,
                            rows: 6,
                            type: "kpi"
                        }]
                    },
                    isDefault: true,
                    name: "FbtMetrics"
                }];
            }
            return [];
        });
    });

    /*
        A metric is a single figure, so its descriptor takes no row: what
        stands behind it depends only on the reporting date, which the
        framework hands it the way it does a measure source.
    */
    it("opens the records behind the figure", async function () {
        let tree = await boardTree();
        let row = metricRow(tree, "Fbt Backlog");
        let vm;

        assert.ok(row, "the metric row offers a drill");
        assert.equal(row.attrs.title, "Show the records behind this");
        vm = await opened(row);

        assert.ok(vm, "a drill-down is showing");
        assert.equal(vm.tableWidget().feather().name, "Object");
        assert.deepEqual(vm.tableWidget().filter().criteria, [{
            operator: "!=",
            property: "status",
            value: "C"
        }]);
        assert.deepEqual(vm.tableWidget().aggregates(), [{
            method: "COUNT",
            property: "id"
        }], "totalled the way the metric asked");
        assert.equal(
            asked.asOf,
            AS_OF,
            "and drawn at the date the board is showing"
        );
        assert.equal(vm.title(), "Open orders at " + AS_OF);
    });

    // A metric that says nothing is a row that does not respond, with no
    // pointer inviting a click that would do nothing.
    it("leaves a metric alone where it says nothing", async function () {
        let tree = await boardTree();

        assert.ok(metricRow(tree, "Fbt Backlog"), "the other one still does");
        assert.equal(metricRow(tree, "Fbt Quiet"), undefined);
    });

    /*
        Records that have to be got ready first -- a balance at a date,
        built from the ledger -- are got ready when the row is clicked,
        not every time the board is drawn.
    */
    it("gets a drill ready only when it is clicked", async function () {
        let tree = await boardTree();
        let row = metricRow(tree, "Fbt Later");
        let lists;

        assert.ok(row, "the metric row offers a drill");
        assert.equal(readied, 0, "drawing the board readied nothing");
        lists = await made(function () {
            row.attrs.onclick();
        });
        assert.equal(readied, 1, "the click readied the records");
        assert.equal(lists.length, 1);
        assert.equal(lists[0].title(), "Balances at " + AS_OF);
        assert.deepEqual(lists[0].tableWidget().filter().criteria, [{
            property: "id",
            value: "ready-" + AS_OF
        }]);
    });

    /*
        From a balance to the transactions that made it: a list can
        offer a further drill from the row selected, which opens in its
        place with a Back button to return.
    */
    it("drills again from a row, and Back returns", async function () {
        let tree = await boardTree();
        let row = metricRow(tree, "Fbt Deeper");
        let top;
        let next;
        let back;

        top = (await made(function () {
            row.attrs.onclick();
        }))[0];
        assert.equal(top.title(), "Top level");
        assert.equal(top.buttonBack(), undefined, "nowhere to go back to");

        // Nothing selected, nothing to drill from.
        assert.equal((await made(top.drillSelection)).length, 0);

        top.tableWidget().selection = function () {
            return {
                toJSON: function () {
                    return {id: "row-7"};
                }
            };
        };
        next = (await made(top.drillSelection))[0];
        assert.deepEqual(drilledFrom, {id: "row-7"});
        assert.equal(next.title(), "Behind row-7");
        assert.ok(next.buttonBack(), "the next list offers Back");

        back = (await made(function () {
            next.buttonBack().onclick()();
        }))[0];
        assert.equal(back.title(), "Top level", "Back reopens the first");
        assert.equal(back.buttonBack(), undefined);
    });

    /*
        A list of child rows filtered by their parent -- one snapshot's
        lines -- must not ask the server for the parent link, which the
        child's view has no column for.
    */
    it("lists child rows by their parent", async function () {
        let fields;
        let vm = catalog.store().viewModels().drillDialog({
            config: {
                columns: [{attr: "product"}, {attr: "qty"}],
                filter: {criteria: [{
                    property: "parent.id",
                    value: "p-1"
                }]}
            },
            feather: "TestItemLine",
            title: "Lines of p-1"
        });

        await env.flush(10);
        fields = vm.tableWidget().models().properties();
        assert.ok(fields.includes("product"), "the columns are asked for");
        assert.ok(!fields.includes("parent"), "the parent link is not");
    });

    /*
        A parent link that lists properties is a column of the child's
        view, and a list that shows or filters on it needs it: leaving it
        out emptied the purchase order line and receipt line drill-downs.
    */
    it("keeps a parent link that has columns", async function () {
        let fields;
        let vm;

        env.registerFeather({
            description: "Child whose link to its parent lists columns",
            name: "TestShownLine",
            plural: "TestShownLines",
            properties: {
                order: {
                    type: {
                        childOf: "shownLines",
                        properties: ["name"],
                        relation: "TestItem"
                    }
                },
                product: {type: "string"}
            }
        });
        vm = catalog.store().viewModels().drillDialog({
            config: {
                columns: [{attr: "product"}, {attr: "order.name"}],
                filter: {criteria: [{
                    operator: ">=",
                    property: "order.name",
                    value: "A"
                }]}
            },
            feather: "TestShownLine",
            title: "Shown lines"
        });

        await env.flush(10);
        fields = vm.tableWidget().models().properties();
        assert.ok(fields.includes("order"), "the parent link is asked for");
        assert.ok(fields.includes("product"));
    });
});
