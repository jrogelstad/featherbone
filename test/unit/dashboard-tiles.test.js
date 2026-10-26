/*
    Dashboard measure tiles (client/components/dashboard.js): how a tile
    formats the numbers it draws.

    Loaded here rather than in components.test.js, which pins the exact
    list of registered components and would fail with two more.

    The board is rendered once and then re-viewed, rather than rendered
    again: every render re-runs oninit, which starts the tiles loading
    afresh and leaves them saying "Loading...". Re-viewing one state is
    what a redraw actually does.
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

let catalog;
let comps;
// What the fake server answers with. One handler for the whole file:
// a test that installed its own would take the others' answers away.
let savedLayouts = [];

function money(n) {
    return "$" + Number(n).toLocaleString(undefined, {
        maximumFractionDigits: 0
    });
}

function plain(n) {
    return Number(n).toLocaleString(undefined, {maximumFractionDigits: 0});
}

// Where the board put each tile, read off the grid styles.
function boardSpans() {
    let vnode = {attrs: {}, tag: comps.dashboard};
    let state = Object.create(comps.dashboard);

    function draw() {
        return state.view.call(state, vnode);
    }

    function spanOf(value) {
        let parts = String(value).split(" / span ");

        return {at: Number(parts[0]), span: Number(parts[1])};
    }

    vnode.state = state;
    state.oninit(vnode);
    return env.flush(30).then(draw).then(function () {
        return env.flush(30);
    }).then(function () {
        let sections = R.findAll(draw(), R.byTag("section"));

        return sections.map(function (one) {
            let style = one.attrs.style || {};
            let col = spanOf(style["grid-column"]);
            let row = spanOf(style["grid-row"]);

            return {col: col.at, cols: col.span, row: row.at, rows: row.span};
        });
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

// The rows a tile drew that offer a drill-down.
function drillRows(tree) {
    return allNodes(tree).filter(function (one) {
        let attrs = one.attrs || {};
        // mithril moves `class` to `className` on the way through.
        let cls = String(attrs.class || attrs.className || "");

        return cls.includes("fb-dash-row-drill");
    });
}

// What the board says, with the functions stripped so it can be walked.
function boardText() {
    let vnode = {attrs: {}, tag: comps.dashboard};
    let state = Object.create(comps.dashboard);

    function draw() {
        return state.view.call(state, vnode);
    }

    vnode.state = state;
    state.oninit(vnode);
    // A newly registered source makes the first view recompose the board
    // and start it loading again, so settle, draw, and settle once more.
    return env.flush(30).then(draw).then(function () {
        return env.flush(30);
    }).then(function () {
        let tree = draw();

        return R.text(JSON.parse(JSON.stringify(tree, function (
            ignore,
            value
        ) {
            return (
                typeof value === "function"
                ? undefined
                : value
            );
        })));
    });
}

// One source, drawn as a plain table so the amounts appear as text.
function source(extra) {
    return Object.assign({
        defaultTile: {
            cols: 4,
            dimension: "item",
            display: "table",
            rows: 3
        },
        load: function () {
            return Promise.resolve({
                asOf: "2027-06-01",
                rows: [{
                    amount: 1234,
                    key: "a",
                    label: "Widget",
                    units: 7
                }],
                total: 1234
            });
        },
        module: "Test"
    }, extra);
}

describe("dashboard measure tiles", function () {
    before(async function () {
        let loaded = await env.loadClient({components: true, stableIds: true});

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
        env.respond(function (req) {
            let asked = String(req.path || req.url || "");

            // A list with a totals footer asks the server to add the
            // column up; answering with a list would leave the widget
            // reading `result` off nothing.
            if (asked.includes("aggregate")) {
                return {result: {f1: 0}};
            }
            if (asked.startsWith("/dashboards")) {
                return savedLayouts;
            }
            return [];
        });
    });

    /*
        The board was doubled so a tile moves and resizes by half what it
        used to (DASH_COLS). Everything stored is in the old units, so a
        saved layout has to come back the size it was left: a tile six
        columns wide of twelve is twelve of twenty-four, in the same
        place, not half a board narrower.
    */
    it("brings a layout from the old board back as it was", async function () {
        let saved = {
            config: {
                seen: [],
                tiles: [{
                    col: 1,
                    cols: 6,
                    id: "fbt-old",
                    kpis: [],
                    row: 3,
                    rows: 4,
                    type: "kpi"
                }]
            },
            isDefault: true,
            name: "FbtOld"
        };
        let spans;

        savedLayouts = [saved];
        spans = await boardSpans();
        assert.deepEqual(spans[0], {
            col: 1,
            cols: 12,
            row: 5,
            rows: 8
        }, "doubled in size and place: " + JSON.stringify(spans[0]));
    });


    it("draws amounts with the source's own formatters", async function () {
        catalog.store().global().dashboardSources.register(source({
            format: {amount: money, compact: money, units: plain},
            key: "fbtFlow",
            name: "Flow"
        }));

        let said = await boardText();

        assert.ok(said.includes(money(1234)), "money: " + said);
    });

    /*
        A source whose measures are not all the same kind of number --
        inventory value and inventory quantity, say -- formats per tile
        through formatFor, which wins over the static format. Without it
        a quantity tile draws its counts as money.
    */
    it("asks formatFor per tile, and it wins over format", async function () {
        catalog.store().global().dashboardSources.register(source({
            defaultTile: {
                cols: 4,
                dimension: "item",
                display: "table",
                measure: "quantity",
                rows: 3
            },
            format: {amount: money, compact: money, units: plain},
            formatFor: function (tile) {
                if (tile.measure === "quantity") {
                    return {amount: plain, compact: plain, units: plain};
                }
                return {};
            },
            key: "fbtStock",
            name: "Stock"
        }));

        let said = await boardText();

        assert.ok(
            said.includes(plain(1234)),
            "quantity drawn as a count: " + said
        );
        assert.ok(
            !said.includes("Stock " + money(1234)),
            "quantity not drawn as money: " + said
        );
    });

    /*
        Clicking a row opens the records behind it. The source says what
        those are and how to list them (drillFor); a source that answers
        nothing for a row leaves that row alone, with no pointer
        inviting a click that would do nothing.
    */
    describe("drilling into a row", function () {
        /*
            The dialog the row opens, caught as it is made: the board
            cannot be drawn again while one is open, since a dialog
            draws a list widget and that wants a DOM.
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

        function drillSource(extra) {
            return source(Object.assign({
                drillFor: function (ignore, row) {
                    if (row.key === "quiet") {
                        return null;
                    }
                    return {
                        config: {
                            aggregates: [{
                                method: "COUNT",
                                property: "id"
                            }],
                            columns: [{attr: "id"}],
                            filter: {criteria: [{
                                property: "item.id",
                                value: row.key
                            }]}
                        },
                        feather: "Object",
                        title: "Behind " + row.label
                    };
                },
                format: {amount: money, compact: money, units: plain},
                load: function () {
                    return Promise.resolve({
                        asOf: "2027-06-01",
                        rows: [{
                            amount: 1234,
                            key: "loud",
                            label: "Widget",
                            units: 7
                        }, {
                            amount: 56,
                            key: "quiet",
                            label: "Gadget",
                            units: 3
                        }],
                        total: 1290
                    });
                }
            }, extra));
        }

        it("offers the drill only where the source answers", async function () {
            let rows;

            catalog.store().global().dashboardSources.register(drillSource({
                key: "fbtDrill",
                name: "Drill"
            }));
            rows = drillRows(await boardTree());

            assert.equal(rows.length, 1, "one row of the two");
            assert.equal(
                rows[0].attrs.title,
                "Show the records behind this"
            );
            assert.equal(typeof rows[0].attrs.onclick, "function");
        });

        it("opens a list built from what the source said", async function () {
            let tree;
            let vm;

            catalog.store().global().dashboardSources.register(drillSource({
                key: "fbtDrill2",
                name: "Drill2"
            }));
            tree = await boardTree();
            vm = await opened(drillRows(tree)[0]);

            assert.ok(vm, "a drill-down is showing");
            assert.equal(vm.title(), "Behind Widget");
            assert.equal(vm.tableWidget().feather().name, "Object");
            assert.deepEqual(
                vm.tableWidget().filter().criteria,
                [{property: "item.id", value: "loud"}],
                "filtered to the row that was clicked"
            );
            assert.deepEqual(vm.tableWidget().aggregates(), [{
                method: "COUNT",
                property: "id"
            }], "and totalled the way the source asked");
        });

        /*
            A view onto figures rather than a place to work: no edit
            mode, and Import is not among the list's actions.
        */
        it("is read-only and offers no import", async function () {
            let tree;
            let vm;
            let actions;

            catalog.store().global().dashboardSources.register(drillSource({
                key: "fbtDrill3",
                name: "Drill3"
            }));
            tree = await boardTree();
            vm = await opened(drillRows(tree)[0]);
            actions = vm.tableWidget().actionItems().map(function (one) {
                return one.id;
            });

            assert.equal(vm.tableWidget().isEditModeEnabled(), false);
            assert.ok(actions.includes("export"), "export: " + actions);
            assert.ok(actions.includes("print-list"), "print: " + actions);
            assert.ok(!actions.includes("import"), "no import: " + actions);
        });
    });
});
