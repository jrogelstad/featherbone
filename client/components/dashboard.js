/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint browser, unordered*/
/*global f, m*/
/**
    The dashboard board that fills the Home tab, and the KPI tile that sits
    on it. Draws with the marks in dashboard-draw.js.

    The board is a fixed grid mapped onto whatever space the page gives it:
    cell width is the area divided by DASH_COLS, cell height by DASH_ROWS, so
    tiles cannot be placed outside the viewport because there is nowhere
    outside it to go. That is how "no scrolling" is enforced here -- by
    construction rather than by policing drags. Below a narrow breakpoint the
    grid is abandoned and tiles stack in one column, which is the single
    sanctioned exception (see the CSS).

    **KPIs are open-ended.** A KPI is a descriptor any module can contribute
    through `dashboardKpis`, registered globally the way sseState and
    connectionMonitor are, so purchasing and work-order KPIs later join the
    same list without this file changing. A descriptor is:

        {
            key:    unique string
            module: who contributed it
            name:   what the row is called
            format: (Number) -> String
            load:   () -> Promise of {value, comparison, comparisonLabel,
                    spark}
        }

    `comparison` and `spark` are both optional, and absent means absent: a
    KPI with no comparison draws no marker rather than a zero, and if NO KPI
    in a tile has one the whole percentage column disappears and the tile
    falls back to name-and-number -- the plain badge John described as the
    standard form. That degradation is the point, not an edge case: targets
    are not to be a prerequisite for the dashboard being worth looking at.

    Layouts are held in code here for now. They become records (a feather,
    per-user, shareable, shippable in a package) in the next increment; this
    file is deliberately client-only so the board can be seen with a browser
    reload and no install.
*/
const DASH_COLS = 12;
const DASH_ROWS = 8;
const DASH_SPARK_MONTHS = 12;

// Percentage scale for a KPI tile's bullets, mirroring figure 8-1: a bar is
// the measure as a percentage of its own comparison, so measures in
// different units stay comparable on one scale, and the marker sits at 100
// where the middle band begins.
const DASH_PCT_MAX = 150;
const DASH_PCT_BANDS = [1 / 3, 2 / 3];

let kpiRegistry = {};
let tileState = {};
let loadToken = 0;

/**
    Registers a KPI descriptor. Later registrations of the same key win, so
    a module may override a framework KPI deliberately.
*/
function registerKpi(kpi) {
    if (kpi && kpi.key) {
        kpiRegistry[kpi.key] = kpi;
    }
}

function listKpis() {
    let keys = Object.keys(kpiRegistry);
    let sorted = keys.sort();

    return sorted.map(function (key) {
        return kpiRegistry[key];
    });
}

/**
    The default arrangement. One tile until there is a persisted layout to
    read; its shape is already the shape a layout record will have.
*/
function defaultLayout() {
    return {
        title: null,
        tiles: [{
            cols: 5,
            heading: "Key Metrics",
            id: "core-kpis",
            kpis: ["userCount"],
            col: 1,
            row: 1,
            rows: 3,
            type: "kpi"
        }]
    };
}

/**
    The last day of each of `count` months ending with `end`'s month.
*/
function monthEnds(count, end) {
    let out = [];
    let index = count - 1;

    while (index >= 0) {
        out.push(new Date(end.getFullYear(), end.getMonth() - index + 1, 0));
        index -= 1;
    }
    return out;
}

/**
    A framework KPI: how many user accounts this instance has.

    Deliberately built from data the framework already holds rather than
    invented, so it is a real measure on every installation. Its history is
    the cumulative count derived from each account's `created` stamp, and its
    comparison is that same count a year ago -- both genuine, which also
    means a young instance will show a nearly flat sparkline. That is the
    honest picture, and it exercises the near-flat path.
*/
registerKpi({
    key: "userCount",
    module: "Core",
    name: "User Accounts",
    format: function (n) {
        return Number(n).toLocaleString();
    },
    load: function () {
        let payload = {
            method: "POST",
            path: "/data/user-accounts",
            body: {properties: ["id", "created"]}
        };

        return f.datasource().request(payload).then(function (rows) {
            let list = rows || [];
            let now = new Date();
            let ends = monthEnds(DASH_SPARK_MONTHS, now);
            let stamps = list.map(function (row) {
                return new Date(row.created).getTime();
            });
            let valid = stamps.filter(Number.isFinite);
            let spark = ends.map(function (end) {
                let cutoff = end.getTime();
                let upTo = valid.filter(function (t) {
                    return t <= cutoff;
                });

                return upTo.length;
            });

            return {
                value: list.length,
                comparison: spark[0],
                comparisonLabel: "a year ago",
                spark
            };
        });
    }
});

/**
    Loads every tile on the layout. A token guards against an earlier, slower
    load landing after a later one and overwriting fresher numbers.
*/
function loadAll(layout) {
    let token = loadToken + 1;

    loadToken = token;

    layout.tiles.forEach(function (tile) {
        let keys = tile.kpis || [];
        let wanted = keys.map(function (key) {
            return kpiRegistry[key];
        });
        let present = wanted.filter(Boolean);
        let loads = present.map(function (kpi) {
            return kpi.load().then(function (result) {
                return Object.assign({kpi}, result);
            }).catch(function (err) {
                return {kpi, error: err.message || String(err)};
            });
        });

        tileState[tile.id] = {status: "loading"};
        Promise.all(loads).then(function (rows) {
            if (token !== loadToken) {
                return;
            }
            tileState[tile.id] = {rows, status: "ready"};
            m.redraw();
        });
    });
}

/**
    One KPI tile: a row per metric, sharing one percentage scale with the
    axis stated once beneath them rather than repeated per row.
*/
function kpiTile(tile) {
    let state = tileState[tile.id] || {status: "loading"};
    let draw = f.catalog().store().global().dashboardDraw;
    let rows = state.rows || [];
    let anyComparison = rows.some(function (row) {
        return row.comparison !== undefined && row.comparison !== null;
    });
    let body;

    if (state.status !== "ready") {
        body = m("div", {class: "fb-dash-tile-empty"}, "Loading…");
    } else if (!rows.length) {
        body = m("div", {class: "fb-dash-tile-empty"}, "No metrics selected");
    } else {
        let lines = rows.map(function (row) {
            let pct = (
                row.comparison
                ? (row.value / row.comparison) * 100
                : null
            );

            return m("tr", [
                m("td", {class: "fb-dash-cell-spark"}, (
                    (row.spark && row.spark.length > 1)
                    ? draw.sparkline({points: row.spark, width: 76, height: 16})
                    : null
                )),
                m("td", {class: "fb-dash-cell-name"}, row.kpi.name),
                (
                    anyComparison
                    ? m("td", {class: "fb-dash-cell-graphic"}, (
                        pct === null
                        ? null
                        : draw.bullet({
                            comparison: 100,
                            max: DASH_PCT_MAX,
                            ranges: DASH_PCT_BANDS,
                            title: (
                                row.kpi.name + ": " +
                                Math.round(pct) + "% of " +
                                (row.comparisonLabel || "comparison")
                            ),
                            value: pct,
                            width: 150,
                            height: 14
                        })
                    ))
                    : null
                ),
                m("td", {class: "fb-dash-cell-value"}, (
                    row.error
                    ? "—"
                    : row.kpi.format(row.value)
                ))
            ]);
        });

        if (anyComparison) {
            lines.push(m("tr", [
                m("td"),
                m("td"),
                m("td", {class: "fb-dash-cell-graphic"}, draw.axis({
                    format: function (n) {
                        return Math.round(n) + "%";
                    },
                    max: DASH_PCT_MAX,
                    ticks: 3,
                    width: 150
                })),
                m("td")
            ]));
        }

        body = m("table", {class: "fb-dash-kpi-table"}, lines);
    }

    return [
        m("div", {class: "fb-dash-tile-heading"}, tile.heading),
        body
    ];
}

let dashboard = {
    oninit: function (vnode) {
        vnode.state.layout = defaultLayout();
        loadAll(vnode.state.layout);
    },
    view: function (vnode) {
        let layout = vnode.state.layout;

        return m("div", {
            class: "fb-dash-board",
            style: {
                "grid-template-columns": "repeat(" + DASH_COLS + ", 1fr)",
                "grid-template-rows": "repeat(" + DASH_ROWS + ", 1fr)"
            }
        }, layout.tiles.map(function (tile) {
            return m("section", {
                class: "fb-dash-tile",
                key: tile.id,
                style: {
                    "grid-column": tile.col + " / span " + tile.cols,
                    "grid-row": tile.row + " / span " + tile.rows
                }
            }, (
                tile.type === "kpi"
                ? kpiTile(tile)
                : m("div", {class: "fb-dash-tile-empty"}, (
                    "Unknown tile type: " + tile.type
                ))
            ));
        }));
    }
};

/**
    The company name for the dashboard's title, read from the instance's own
    global settings -- no manager round trip. A layout may override it, which
    is why this is only the default.
*/
function dashboardTitle(layout) {
    let models = f.catalog().store().models();
    let settings = (
        models.globalSettings
        ? models.globalSettings()
        : null
    );
    let company = "";

    if (layout && layout.title) {
        return layout.title;
    }
    if (settings && settings.data && settings.data.name) {
        company = settings.data.name() || "";
    }
    return (
        company
        ? company + " Dashboard"
        : "Dashboard"
    );
}

f.catalog().register("global", "dashboardKpis", {
    list: listKpis,
    register: registerKpi
});
f.catalog().register("global", "dashboardRefresh", function () {
    loadAll(defaultLayout());
});
f.catalog().register("global", "dashboardTitle", dashboardTitle);
f.catalog().register("components", "dashboard", dashboard);
