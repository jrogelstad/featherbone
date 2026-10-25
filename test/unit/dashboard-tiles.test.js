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
        comps = catalog.store().components();
        env.respond(function () {
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

        env.respond(function (req) {
            if (String(req.path).indexOf("/dashboards") === 0) {
                return [saved];
            }
            return [];
        });

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
});
