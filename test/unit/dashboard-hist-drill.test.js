/*
    Drilling down from a bar of the due-date histogram
    (client/components/dashboard.js, dashboard-draw.js).

    A file of its own because the board keeps the first layout it loads
    for the life of the process: a test that needs a particular tile on
    the board has to be the one that renders it first.
*/
/*jslint node*/
"use strict";

process.env.TZ = "America/Chicago";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");

const ROOT = path.resolve(__dirname, "..", "..");
// A Tuesday: its week (from Monday 2027-05-31) straddles the date, so it
// is drawn as two bars, the late part and the rest.
const AS_OF = "2027-06-01";

let catalog;
let comps;
// What each drillFor was handed, by bar.
let asked = [];

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

function classOf(node) {
    let attrs = node.attrs || {};

    return String(attrs.class || attrs.className || "");
}

function boardTree() {
    let vnode = {attrs: {}, tag: comps.dashboard};
    let state = Object.create(comps.dashboard);

    function draw() {
        return state.view.call(state, vnode);
    }

    vnode.state = state;
    state.oninit(vnode);
    return env.flush(30).then(draw).then(function (tree) {
        /*
            The plot draws once it knows its size, which it measures on
            creation; there is no layout here, so say what it measured.
        */
        allNodes(tree).filter(function (one) {
            return classOf(one).includes("fb-dash-hist-plot");
        }).forEach(function (plot) {
            plot.attrs.oncreate({dom: {clientHeight: 200, clientWidth: 600}});
        });
        return env.flush(30);
    }).then(draw);
}

function bars(tree) {
    return allNodes(tree).filter(function (one) {
        return one.tag === "rect";
    });
}

// The drill-downs opened while `act` runs and settles.
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

describe("drilling into a due-date bar", function () {
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

        globals.dashboardSchedules.register({
            drillFor: function (bar) {
                asked.push(bar);
                return {
                    config: {
                        columns: [{attr: "id"}],
                        filter: {criteria: [{
                            operator: ">=",
                            property: "id",
                            value: bar.from
                        }]}
                    },
                    feather: "Object",
                    title: "Due " + bar.from + " to " + bar.to
                };
            },
            key: "fbtDue",
            load: function () {
                return Promise.resolve({
                    asOf: AS_OF,
                    rows: [{
                        amount: 100,
                        late: true,
                        period: "2027-05-24",
                        units: 1
                    }, {
                        amount: 50,
                        late: true,
                        period: "2027-05-31",
                        units: 1
                    }, {
                        amount: 70,
                        late: false,
                        period: "2027-05-31",
                        units: 1
                    }, {
                        amount: 30,
                        late: false,
                        period: "2027-06-07",
                        units: 1
                    }]
                });
            },
            module: "Test",
            name: "Fbt Orders"
        });
        // One that says nothing, so its bars stay plain.
        globals.dashboardSchedules.register({
            key: "fbtQuietDue",
            load: function () {
                return Promise.resolve({
                    asOf: AS_OF,
                    rows: [{
                        amount: 10,
                        late: false,
                        period: "2027-06-07",
                        units: 1
                    }]
                });
            },
            module: "Test",
            name: "Fbt Quiet"
        });

        env.respond(function (req) {
            let asking = String(req.path || req.url || "");

            if (asking.includes("aggregate")) {
                return {result: {f1: 0}};
            }
            if (asking.startsWith("/dashboards")) {
                return [{
                    config: {
                        asOf: AS_OF,
                        seen: [],
                        tiles: [{
                            bucket: "week",
                            col: 1,
                            cols: 12,
                            grid: 24,
                            id: "fbt-due",
                            row: 1,
                            rows: 8,
                            schedules: ["fbtDue", "fbtQuietDue"],
                            type: "histogram"
                        }]
                    },
                    isDefault: true,
                    name: "FbtDue"
                }];
            }
            return [];
        });
    });

    /*
        Each bar lists the orders due in exactly its dates: a whole week,
        or for the week the reporting date falls in, the part due before
        it (late) and the part from it on.
    */
    it("opens the orders due in the bar's dates", async function () {
        let tree = await boardTree();
        let mine = bars(tree).filter(function (one) {
            return classOf(one).includes("fb-dash-row-drill");
        });
        let opened = [];
        let index = 0;

        assert.equal(mine.length, 4, "every bar of the schedule drills");
        while (index < mine.length) {
            opened = opened.concat(await made(mine[index].attrs.onclick));
            index += 1;
        }
        assert.deepEqual(asked.map(function (bar) {
            return [bar.from, bar.to, bar.late, bar.bucket, bar.asOf];
        }), [
            ["2027-05-24", "2027-05-30", true, "week", AS_OF],
            ["2027-05-31", "2027-05-31", true, "week", AS_OF],
            ["2027-06-01", "2027-06-06", false, "week", AS_OF],
            ["2027-06-07", "2027-06-13", false, "week", AS_OF]
        ]);
        assert.equal(opened.length, 4);
        assert.equal(opened[2].title(), "Due 2027-06-01 to 2027-06-06");
    });

    // A schedule that says nothing draws bars that do not respond.
    it("leaves bars alone where a schedule says nothing", async function () {
        let tree = await boardTree();
        let plain = bars(tree).filter(function (one) {
            return !classOf(one).includes("fb-dash-row-drill");
        });

        assert.equal(plain.length, 1, "the quiet schedule's one bar");
        assert.equal(plain[0].attrs.onclick, undefined);
    });
});
