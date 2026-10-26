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

const ROOT = path.resolve(__dirname, "..", "..");
const AS_OF = "2027-06-01";

let catalog;
let comps;
// What drillFor was handed, so the test can see the date it was given.
let asked;

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
                            kpis: ["fbtBacklog", "fbtQuiet"],
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
});
