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
    The dashboard board that fills the Home tab, the tiles that sit on it,
    and the Refresh action behind the Home ribbon's button. Draws with the
    marks in dashboard-draw.js.

    The board is a fixed grid mapped onto whatever space the page gives it:
    cell width is the area divided by DASH_COLS, cell height by DASH_ROWS, so
    tiles cannot be placed outside the viewport because there is nowhere
    outside it to go. That is how "no scrolling" is enforced here -- by
    construction rather than by policing drags. Below a narrow breakpoint the
    grid is abandoned and tiles stack in one column, which is the single
    sanctioned exception (see the CSS).

    **Three things a module contributes, all open-ended.**

    A *KPI* (`dashboardKpis`) is one number with an optional comparison and
    history, shown as a row in a KPI tile:

        {
            key:    unique string
            module: who contributed it
            name:   what the row is called
            format: (Number) -> String
            load:   () -> Promise of {value, comparison, comparisonLabel,
                    spark}
        }

    A *source* (`dashboardSources`) feeds a grouped measure tile -- a measure
    broken down by some dimension, which is figure 8-1's "Revenue YTD by
    region" and everything shaped like it:

        {
            key:         unique string
            module:      who contributed it
            name:        what the measure is called
            format:      {amount, compact, units} formatters, all optional
            headingFor:  (tile) -> String, optional, names a tile from its
                         own options
            defaultTile: a tile to put on the default layout, or omitted
            options:     what this source may be asked for, or omitted
            load:        (tile) -> Promise of {rows, total, asOf,
                         refreshedAt, comparison, comparisonLabel,
                         needsRefresh}
        }

    `options` is how a source tells the Add Tile dialog what questions to
    ask about it, so the framework can offer "Revenue YTD by region" or
    "Bookings MTD by customer" without knowing that revenue, bookings,
    regions or customers exist:

        [{
            key:     the tile property this sets, e.g. "dimension"
            label:   what to call it on the dialog
            choices: [{value, label}]
            default: the value to start on, optional
        }]

    A source with no `options` can still be put on the board; it simply
    arrives as its `defaultTile` with nothing to choose. Whatever the
    dialog collects is handed straight back to `load` as tile properties,
    so a source that invents a new option needs no change here.

    where each row is `{key, label, amount, units, comparison, target,
    pctOfTotal, spark}`. `target` is where the row should be and
    `comparison` is where it was: different questions, drawn as different
    marks, and a row may carry either, both or neither.

    `needsRefresh` is how a source says its aggregates have never been
    built, which is a different thing from an error and is shown as an
    instruction rather than a failure.

    A *refresher* (`dashboardRefreshers`) is a routine that rebuilds those
    aggregates, run by the ribbon's Refresh button:

        {
            key:      unique string
            module:   who contributed it
            label:    what Refresh says it is working on
            run:      () -> Promise of whatever the service returns
            describe: (outcome) -> String, optional, for the status line
        }

    `comparison` and `spark` are optional throughout, and absent means
    absent: a KPI with no comparison draws no marker rather than a zero, and
    if NO KPI in a tile has one the whole percentage column disappears and
    the tile falls back to name-and-number -- the plain badge John described
    as the standard form. The same degradation runs through the measure tile:
    no comparison anywhere means bullets become plain ranked bars. That is
    the point, not an edge case: targets and history are not to be a
    prerequisite for the dashboard being worth looking at.

    **The reporting date.** The board reports as of a date, which is today
    unless it has been pinned to a fixed one. Pinning is what makes a demo
    database worth looking at -- sample data sits in its own years, and a
    board stuck on the real today shows a year-to-date of nothing and no
    prior-year comparison to mark. It is a property of the layout, passed
    down to every tile, and a source is free to ignore it. Sources that
    honour it resolve the date server side, so what a tile shows does not
    depend on the clock of the browser asking.

    Layouts are held in code here for now, composed from whatever has
    registered. They become records (a feather, per-user, shareable,
    shippable in a package) in the next increment.
*/
const DASH_COLS = 12;
const DASH_ROWS = 8;
const DASH_SPARK_MONTHS = 12;

/*
    What this user has chosen about the board -- which layout, and what
    date it reports as of -- lives in their profile, beside their
    worksheet column widths. So it follows them to another machine, and
    one person pinning a date or picking a layout moves nobody else's
    board.

    The `$dashboard` table holds the layouts themselves, which are the
    instance's; this is the one line saying which of them is yours.
*/
const DASH_PROFILE_KEY = "dashboard";

// Percentage scale for a KPI tile's bullets, mirroring figure 8-1: a bar is
// the measure as a percentage of its own comparison, so measures in
// different units stay comparable on one scale, and the marker sits at 100
// where the middle band begins.
const DASH_PCT_MAX = 150;
const DASH_PCT_BANDS = [1 / 3, 2 / 3];

// Nothing legible is smaller than this, so a tile that cannot be given at
// least this much is left off the board rather than drawn unreadable.
const DASH_MIN_COLS = 3;
const DASH_MIN_ROWS = 2;

let kpiRegistry = {};
let sourceRegistry = {};
let refresherRegistry = {};
let tileState = {};
let loadToken = 0;

// Bumped by every registration, so a board already on screen when a module
// registers late recomposes rather than sitting there missing a tile.
let registryVersion = 0;

// What Refresh is doing, or last did: {status: "idle"|"running"|"done",
// label, at, results}. Read by the ribbon button as well as the board.
let refreshState = {status: "idle"};

// The arrangement on screen. Refresh is pressed on the ribbon, which is not
// inside the board's component, so the two meet here.
let currentLayout = null;

// Every saved layout the instance has, as last fetched. Held for whoever
// is offering to switch between them; the board itself only needs one.
let savedLayouts = [];

/**
    What this user has chosen about the board, as last loaded.
*/
function dashProfile() {
    let read = f.catalog().store().global().profileValue;

    if (!read) {
        return {};
    }
    return read(DASH_PROFILE_KEY) || {};
}

/**
    Records a choice about the board against this user.

    Never allowed to fail loudly: the board already shows what was asked
    for by the time this runs, and a preference that could not be written
    should cost the next session's convenience, not this one's work.
*/
function saveDashProfile(changes) {
    let write = f.catalog().store().global().profileSave;
    let next = Object.assign({}, dashProfile(), changes);

    if (!write) {
        return Promise.resolve();
    }
    return write(DASH_PROFILE_KEY, next).catch(function () {
        return;
    });
}

/**
    The pinned reporting date this user last chose, or null for "today".
*/
function storedAsOf() {
    return dashProfile().asOf || null;
}

/**
    Whether this user has said anything about the reporting date.

    Having chosen "Now" is a choice, and a different thing from never
    having been asked -- the first has to override a layout that carries
    a date of its own, and the second must not.
*/
function hasChosenAsOf() {
    return Object.prototype.hasOwnProperty.call(dashProfile(), "asOf");
}

/**
    The date a layout reports as of, as a Date: its own, or today.

    Parsed as local midnight rather than handed to `new Date("2027-05-31")`,
    which reads the string as UTC and so lands on the 30th for anyone west
    of Greenwich -- a reporting date that is off by one for half the world
    is worse than no reporting date at all.
*/
function asOfDate(layout) {
    let pinned = layout && layout.asOf;
    let when = (
        pinned
        ? new Date(String(pinned) + "T00:00:00")
        : new Date()
    );

    if (!Number.isFinite(when.getTime())) {
        return new Date();
    }
    return when;
}

/**
    A pinned reporting date, said the way the board says it.
*/
function asOfText(value) {
    let when = new Date(String(value) + "T00:00:00");

    if (!Number.isFinite(when.getTime())) {
        return String(value);
    }
    return when.toLocaleDateString([], {
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}

/**
    Registers a KPI descriptor. Later registrations of the same key win, so
    a module may override a framework KPI deliberately.
*/
function registerKpi(kpi) {
    if (kpi && kpi.key) {
        kpiRegistry[kpi.key] = kpi;
        registryVersion += 1;
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
    Registers a grouped measure source. See the file comment for its shape.
*/
function registerSource(source) {
    if (source && source.key) {
        sourceRegistry[source.key] = source;
        registryVersion += 1;
    }
}

function listSources() {
    let keys = Object.keys(sourceRegistry);
    let sorted = keys.sort();

    return sorted.map(function (key) {
        return sourceRegistry[key];
    });
}

/**
    Registers an aggregate refresh routine for the Refresh button to run.
*/
function registerRefresher(refresher) {
    if (refresher && refresher.key) {
        refresherRegistry[refresher.key] = refresher;
        registryVersion += 1;
    }
}

function listRefreshers() {
    let keys = Object.keys(refresherRegistry);
    let sorted = keys.sort();

    return sorted.map(function (key) {
        return refresherRegistry[key];
    });
}

/**
    Lays tiles out in the order given, each taking the first free space big
    enough for it, scanning left to right and top to bottom.

    A tile that will not fit at its asked-for size is shrunk rather than
    refused, down to the legibility floor above; one that will not fit even
    then is left off. Tiles therefore cannot overlap and cannot run off the
    board, which is the whole no-scrolling bargain, and a module that
    contributes an over-large tile costs itself space rather than breaking
    the board for everyone.
*/
function placeTiles(wanted) {
    let taken = {};
    let placed = [];

    function isFree(col, row, cols, rows) {
        let down = 0;

        if (col + cols - 1 > DASH_COLS || row + rows - 1 > DASH_ROWS) {
            return false;
        }
        while (down < rows) {
            let across = 0;

            while (across < cols) {
                if (taken[(row + down) + ":" + (col + across)]) {
                    return false;
                }
                across += 1;
            }
            down += 1;
        }
        return true;
    }

    function claim(col, row, cols, rows) {
        let down = 0;

        while (down < rows) {
            let across = 0;

            while (across < cols) {
                taken[(row + down) + ":" + (col + across)] = true;
                across += 1;
            }
            down += 1;
        }
    }

    function findSpot(cols, rows) {
        let row = 1;

        while (row <= DASH_ROWS) {
            let col = 1;

            while (col <= DASH_COLS) {
                if (isFree(col, row, cols, rows)) {
                    return {col, row};
                }
                col += 1;
            }
            row += 1;
        }
        return null;
    }

    wanted.forEach(function (tile) {
        let asked = Math.min(tile.rows || 3, DASH_ROWS);
        let cols = Math.min(tile.cols || 4, DASH_COLS);
        let rows = asked;
        // A saved layout says where its tiles go. Honoured when the spot
        // is free and on the board, and packed like any other tile when
        // it is not -- a layout saved on a wider board, or one whose
        // tiles have since grown, should come back arranged rather than
        // come back broken.
        let at = (
            (tile.col && tile.row && isFree(tile.col, tile.row, cols, rows))
            ? {col: tile.col, row: tile.row}
            : findSpot(cols, rows)
        );

        while (at === null && cols >= DASH_MIN_COLS) {
            if (rows > DASH_MIN_ROWS) {
                rows -= 1;
            } else {
                cols -= 1;
                rows = asked;
            }
            if (cols >= DASH_MIN_COLS) {
                at = findSpot(cols, rows);
            }
        }

        if (at !== null) {
            claim(at.col, at.row, cols, rows);
            placed.push(Object.assign({}, tile, {
                col: at.col,
                cols,
                row: at.row,
                rows
            }));
        }
    });

    return placed;
}

/**
    The arrangement composed from whatever has registered: the framework's
    own KPI tile, then the tile each registered source asks to put on a
    fresh board. This is what a board with no saved layout shows -- install
    SupplyChain and its sales tile is simply there, with nothing to set up.

    It is also the starting point a saved layout is made from, which is why
    it stays here now that layouts are records.
*/
function composeLayout() {
    let tiles = [{
        cols: 5,
        heading: "Key Metrics",
        id: "core-kpis",
        kpis: ["userCount"],
        rows: 3,
        type: "kpi"
    }];

    let offered = [];

    listSources().forEach(function (source) {
        if (source.defaultTile) {
            offered.push(Object.assign({
                id: "src-" + source.key,
                sequence: 0,
                source: source.key,
                type: "measure"
            }, source.defaultTile));
        }
    });

    // A module says where its tile belongs with `sequence`; ties fall back
    // to the source key, so the order is at least stable.
    offered.sort(function (a, b) {
        if (a.sequence !== b.sequence) {
            return a.sequence - b.sequence;
        }
        return a.source.localeCompare(b.source);
    });

    offered.forEach(function (tile) {
        tiles.push(tile);
    });

    return {
        asOf: storedAsOf(),
        name: null,
        tiles: placeTiles(tiles),
        title: null,
        version: registryVersion
    };
}

/**
    A layout built from a saved record.

    A record's tiles are taken as asked for and run through the same packer
    as a composed board, so the guarantee that nothing is drawn unreadably
    small and nothing falls off the viewport holds for saved layouts too.
    `version` is stamped with the registry as it stands, so a module
    registering afterwards still recomposes the board rather than leaving
    its tile missing.
*/
function layoutFromRecord(record) {
    let config = record.config || {};

    return withNewcomers({
        asOf: config.asOf || null,
        name: record.name,
        seen: config.seen || [],
        tiles: placeTiles(config.tiles || []),
        title: config.title || null,
        version: registryVersion
    });
}

/**
    What the board on screen would be saved as. Positions are included, so
    a layout comes back arranged the way it was left rather than repacked
    from scratch.
*/
function layoutSpec(layout) {
    return {
        asOf: layout.asOf || null,
        // Which sources existed when this was saved. A source missing
        // from a layout is ambiguous on its own -- it may be one somebody
        // took off their board, or one that did not exist yet -- and the
        // difference decides whether installing a package adds a tile or
        // silently does nothing. Recording what was on offer at the time
        // settles it without asking anybody.
        seen: listSources().map(function (source) {
            return source.key;
        }),
        tiles: layout.tiles.map(function (tile) {
            let out = Object.assign({}, tile);

            delete out.version;
            return out;
        }),
        title: layout.title || null
    };
}

/**
    A saved layout plus a tile for any source that has registered since it
    was saved.

    Install a package on an instance whose default layout predates it and
    its tile appears, in whatever room is left, rather than the package
    arriving invisible. A tile somebody deliberately took off their board
    stays off, because its source was on offer when they saved.
*/
function withNewcomers(layout) {
    let known = layout.seen || [];
    let extra = [];

    listSources().forEach(function (source) {
        if (source.defaultTile && known.indexOf(source.key) === -1) {
            extra.push(Object.assign({
                id: "src-" + source.key,
                source: source.key,
                type: "measure"
            }, source.defaultTile));
        }
    });

    if (!extra.length) {
        return Object.assign({}, layout, {version: registryVersion});
    }

    return Object.assign({}, layout, {
        seen: known.concat(extra.map(function (tile) {
            return tile.source;
        })),
        tiles: placeTiles(layout.tiles.concat(extra)),
        version: registryVersion
    });
}

/**
    The arrangement to show: the layout flagged as the instance's default
    if there is one, otherwise whatever the registrations compose to.

    A board that cannot reach the service still draws. Layouts are a
    convenience over a board that already works, so a failed fetch costs
    the saved arrangement and nothing else.
*/
function startingLayout() {
    return f.datasource().request({
        method: "GET",
        path: "/dashboards"
    }).then(function (rows) {
        let list = rows || [];
        let chosen = dashProfile().layout;
        // In order: the layout this user picked, the one the instance
        // calls its default, then what the registrations compose to.
        // A picked layout somebody has since deleted falls through to
        // the default rather than leaving the board empty.
        let preferred = (
            chosen
            ? list.find(function (row) {
                return row.name === chosen;
            })
            : null
        );

        savedLayouts = list;
        if (!preferred) {
            preferred = list.find(function (row) {
                return row.isDefault;
            });
        }
        if (preferred) {
            return withChosenAsOf(layoutFromRecord(preferred));
        }
        return composeLayout();
    }).catch(function () {
        return composeLayout();
    });
}

/**
    A layout reporting as of the date this user picked rather than the
    one the layout was saved with.

    A layout may carry a date -- a board built for a demo, pinned to when
    the sample data lives -- and that is the right starting point. But
    once somebody has said what date they want to see, that is what they
    want to see, whichever layout they are looking at.
*/
function withChosenAsOf(layout) {
    if (!hasChosenAsOf()) {
        return layout;
    }
    return Object.assign({}, layout, {asOf: storedAsOf()});
}

/**
    Switches this user to a saved layout, or back to the composed board
    when given nothing, and remembers the choice.

    Choosing is deliberately not the same as editing: it records which
    arrangement this person starts from, and leaves the arrangement
    itself alone for everyone else using it.
*/
function useLayout(name) {
    let record = savedLayouts.find(function (row) {
        return row.name === name;
    });
    let next = (
        record
        ? withChosenAsOf(layoutFromRecord(record))
        : composeLayout()
    );

    saveDashProfile({
        layout: (
            record
            ? name
            : null
        )
    });
    currentLayout = next;
    loadAll(next);
    m.redraw();
}

/**
    Puts a tile on the board and loads it.

    The board is rearranged rather than appended to, because a tile added
    to a full board has to come from somewhere: the packer shrinks or
    drops to fit, which is the same guarantee every other arrangement
    gets. Nothing is written anywhere until somebody saves the layout --
    trying a tile out should cost nothing.
*/
function addTile(tile) {
    let layout = currentLayout || composeLayout();
    let wanted = Object.assign({
        id: "tile-" + f.createId(),
        sequence: layout.tiles.length
    }, tile);
    let next = Object.assign({}, layout, {
        tiles: placeTiles(layout.tiles.concat([wanted]))
    });
    let placed = next.tiles.some(function (one) {
        return one.id === wanted.id;
    });

    currentLayout = next;
    loadAll(next);
    m.redraw();

    // The packer drops what it cannot draw legibly, and a tile that
    // silently fails to appear is worse than being told the board is
    // full.
    return placed;
}

/**
    Takes a tile off the board. Not saved until the layout is.
*/
function removeTile(id) {
    let layout = currentLayout || composeLayout();

    currentLayout = Object.assign({}, layout, {
        tiles: placeTiles(layout.tiles.filter(function (tile) {
            return tile.id !== id;
        }))
    });
    delete tileState[id];
    m.redraw();
}

/**
    What the Add Tile dialog needs to build itself: every source that can
    feed a measure tile, with the questions it accepts, and every KPI that
    can go in a metrics tile.
*/
function tileChoices() {
    return {
        kpis: listKpis().map(function (kpi) {
            return {
                key: kpi.key,
                label: kpi.name,
                module: kpi.module
            };
        }),
        sources: listSources().map(function (source) {
            return {
                key: source.key,
                label: source.name,
                module: source.module,
                options: source.options || []
            };
        })
    };
}

/**
    Saves the board as a named layout, and shows what was saved.

    Saving is what makes an arrangement somebody else's starting point, so
    it is the one place the board writes anything shared. The reply is
    reloaded rather than assumed: the service decides whether the save was
    allowed, and the board should show what is actually stored.
*/
function saveLayout(spec) {
    let asked = spec || {};
    let name = asked.name;
    let layout = currentLayout || composeLayout();

    if (!name) {
        return Promise.reject(new Error("A layout needs a name."));
    }

    return f.datasource().request({
        method: "PUT",
        path: "/dashboard/" + encodeURIComponent(name),
        body: {
            config: layoutSpec(layout),
            isDefault: Boolean(asked.isDefault),
            label: asked.label || name
        }
    }).then(function () {
        return startingLayout();
    }).then(function (next) {
        currentLayout = next;
        loadAll(next);
        m.redraw();
    });
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

    Counts as of the board's reporting date rather than as of now, so a
    pinned board is pinned throughout rather than in some tiles only.
*/
registerKpi({
    key: "userCount",
    module: "Core",
    name: "User Accounts",
    format: function (n) {
        return Number(n).toLocaleString();
    },
    load: function (context) {
        let payload = {
            method: "POST",
            path: "/data/user-accounts",
            body: {properties: ["id", "created"]}
        };
        let asOf = (context && context.asOf) || new Date();

        return f.datasource().request(payload).then(function (rows) {
            let list = rows || [];
            let ends = monthEnds(DASH_SPARK_MONTHS, asOf);
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
            let today = asOf.getTime();
            let counted = valid.filter(function (t) {
                return t <= today;
            });

            return {
                value: counted.length,
                comparison: spark[0],
                comparisonLabel: "a year ago",
                spark
            };
        });
    }
});

/**
    Loads one tile, whatever kind it is, and never rejects: a tile that
    could not load says so in its own square rather than taking the board
    down with it.
*/
function loadTile(tile, layout) {
    let source;
    // A tile may pin itself -- "last year's close" beside live figures is a
    // legitimate thing to want -- so its own date wins over the board's.
    let asOf = tile.asOf || (layout && layout.asOf) || null;

    if (tile.type === "kpi") {
        let keys = tile.kpis || [];
        let context = {asOf: asOfDate({asOf})};
        let wanted = keys.map(function (key) {
            return kpiRegistry[key];
        });
        let present = wanted.filter(Boolean);
        let loads = present.map(function (kpi) {
            return kpi.load(context).then(function (result) {
                return Object.assign({kpi}, result);
            }).catch(function (err) {
                return {kpi, error: err.message || String(err)};
            });
        });

        return Promise.all(loads).then(function (rows) {
            return {rows};
        });
    }

    if (tile.type === "measure") {
        source = sourceRegistry[tile.source];

        if (!source) {
            return Promise.resolve({
                error: "No such data source: " + String(tile.source)
            });
        }
        return source.load(Object.assign({}, tile, {asOf})).then(
            function (data) {
                return {data};
            }
        ).catch(function (err) {
            return {error: err.message || String(err)};
        });
    }

    return Promise.resolve({
        error: "Unknown tile type: " + String(tile.type)
    });
}

/**
    Loads every tile on the layout. A token guards against an earlier, slower
    load landing after a later one and overwriting fresher numbers.
*/
function loadAll(layout) {
    let token = loadToken + 1;

    loadToken = token;

    layout.tiles.forEach(function (tile) {
        tileState[tile.id] = {status: "loading"};
        loadTile(tile, layout).then(function (result) {
            if (token !== loadToken) {
                return;
            }
            tileState[tile.id] = Object.assign({status: "ready"}, result);
            m.redraw();
        });
    });
}

/**
    Runs every registered refresh routine, one after another, then reloads
    the board from the rebuilt aggregates.

    One at a time rather than together: these are table rebuilds, a slow
    instance should not have several running at once, and a failure then
    names the one routine that failed instead of arriving as an anonymous
    rejection. Whatever happens, every routine is attempted and the board is
    reloaded -- a refresh that half worked should still show what it managed.
*/
function runRefresh() {
    let jobs = listRefreshers();
    let layout = currentLayout || composeLayout();
    let results = [];
    let next;

    if (refreshState.status === "running") {
        return;
    }

    function finish() {
        refreshState = {
            at: new Date(),
            results,
            status: "done"
        };
        loadAll(layout);
        m.redraw();
    }

    next = function () {
        let job = jobs.shift();
        let name;

        if (!job) {
            finish();
            return;
        }
        name = job.label || job.key;
        refreshState = {label: name, status: "running"};
        m.redraw();

        job.run().then(function (outcome) {
            let note = "";

            if (job.describe) {
                note = job.describe(outcome) || "";
            }
            results.push({label: name, note, ok: true});
        }).catch(function (err) {
            results.push({
                label: name,
                note: err.message || String(err),
                ok: false
            });
        }).then(next);
    };

    next();
}

/**
    Pins the board to a reporting date, or hands it back to today when given
    nothing, and reloads what is on screen from that date.
*/
function setAsOf(value) {
    let next = value || null;

    saveDashProfile({asOf: next});
    if (currentLayout) {
        currentLayout.asOf = next;
        loadAll(currentLayout);
    }
    m.redraw();
}

/**
    The board's reporting date as stored, for whoever is offering to change
    it. Null means today.
*/
function getAsOf() {
    if (currentLayout) {
        return currentLayout.asOf || null;
    }
    return storedAsOf();
}

/**
    A time said the way someone glancing at a dashboard wants it: the clock
    for today, the date as well for anything older.
*/
function whenText(value) {
    let when = new Date(value);
    let now = new Date();
    let sameDay = (
        when.getFullYear() === now.getFullYear() &&
        when.getMonth() === now.getMonth() &&
        when.getDate() === now.getDate()
    );

    if (!Number.isFinite(when.getTime())) {
        return "";
    }
    if (sameDay) {
        return when.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit"
        });
    }
    return when.toLocaleString([], {
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        month: "short"
    });
}

/**
    The newest "last rebuilt" stamp any loaded tile reported, so the board
    can say how old the figures on it are. Server-side time, deliberately:
    the question is when the aggregates were last built for everyone, not
    when this browser last pressed a button.
*/
function dataRefreshedAt() {
    let newest = null;

    Object.keys(tileState).forEach(function (id) {
        let state = tileState[id];
        let data = state.data;
        let stamp;

        if (!data || !data.refreshedAt) {
            return;
        }
        stamp = new Date(data.refreshedAt).getTime();
        if (Number.isFinite(stamp) && (newest === null || stamp > newest)) {
            newest = stamp;
        }
    });

    return newest;
}

/**
    The line above the board saying what Refresh is doing, what it did, or
    how old the figures are. Silent when there is nothing to say.
*/
function refreshBar(layout) {
    let built = dataRefreshedAt();
    let parts = [];
    let state = refreshState;

    // Said first and said plainly. Figures that are not today's look like
    // wrong figures to anyone who does not know the board is pinned, and
    // the cost of missing it is someone acting on the wrong quarter.
    if (layout && layout.asOf) {
        parts.push(m("span", {class: "fb-dash-as-of"}, (
            "As of " + asOfText(layout.asOf)
        )));
    }

    if (state.status === "running") {
        parts.push(m("span", {class: "fb-dash-refresh-note"}, (
            "Refreshing " + state.label + "…"
        )));
    } else {
        if (built !== null) {
            parts.push(m("span", {class: "fb-dash-refresh-note"}, (
                "Figures rebuilt " + whenText(built)
            )));
        }
        if (state.status === "done") {
            let failed = state.results.filter(function (one) {
                return !one.ok;
            });
            let notes = state.results.filter(function (one) {
                return one.ok && one.note;
            });

            if (!state.results.length) {
                parts.push(m("span", {class: "fb-dash-refresh-note"}, (
                    "Nothing to rebuild; the board was reloaded " +
                    whenText(state.at)
                )));
            }
            notes.forEach(function (one) {
                parts.push(m("span", {class: "fb-dash-refresh-note"}, (
                    one.label + ": " + one.note
                )));
            });
            failed.forEach(function (one) {
                parts.push(m("span", {class: "fb-dash-refresh-fail"}, (
                    one.label + " failed: " + one.note
                )));
            });
        }
    }

    if (!parts.length) {
        return null;
    }
    return m("div", {class: "fb-dash-refresh-bar"}, parts);
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
        m("div", headingDrag(tile), [
            m("span", tile.heading),
            removeControl(tile)
        ]),
        body
    ];
}

/**
    Formatters for a measure tile, taken from the source where it supplies
    them. A source that says nothing gets plain localized numbers, which is
    wrong for money and right for everything else -- so money sources supply
    their own.
*/
function measureFormats(source) {
    let given = (source && source.format) || {};
    let plain = function (n) {
        return Number(n).toLocaleString();
    };

    return {
        amount: given.amount || plain,
        compact: given.compact || given.amount || plain,
        units: given.units || plain
    };
}

/**
    What the marks on a bullet tile mean, naming only the ones that are
    actually drawn.

    A legend for a mark the tile does not carry is worse than no legend:
    it sends somebody looking for something that is not there.
*/
function markerCaption(data, hasComparison, hasTarget) {
    let said = [];

    if (hasComparison) {
        said.push("short bar: " + (data.comparisonLabel || "prior year"));
    }
    if (hasTarget) {
        said.push("full line: target");
    }
    if (!said.length) {
        return "";
    }
    return said.join(" \u00b7 ");
}

/**
    One grouped measure tile: a measure broken down by a dimension, drawn as
    bullet rows against a comparison, as ranked bars, or as a plain numeric
    table.

    All three share one quantitative scale across the rows, with the axis
    stated once underneath -- the rows are being compared with each other, so
    a scale per row would make the comparison a lie. The bars are zero-based
    because a bar encodes by length.
*/
function measureTile(tile) {
    let state = tileState[tile.id] || {status: "loading"};
    let source = sourceRegistry[tile.source] || {};
    let draw = f.catalog().store().global().dashboardDraw;
    let fmt = measureFormats(source);
    let data = state.data;
    let display = tile.display || "bullets";
    // The tile may be titled outright; failing that a source gets to name
    // the tile from its own options, so a heading follows the dimension and
    // window rather than going stale when they change.
    let named = (
        source.headingFor
        ? source.headingFor(tile)
        : source.name
    );
    let heading = tile.heading || named || "Measure";
    // Wide enough for the axis beneath it to label five intervals without
    // the labels running into each other, which at 150 they do.
    let width = 220;
    let body;
    let total = null;

    if (state.status !== "ready") {
        body = m("div", {class: "fb-dash-tile-empty"}, "Loading…");
    } else if (state.error) {
        body = m("div", {class: "fb-dash-tile-error"}, state.error);
    } else if (data.needsRefresh) {
        body = m("div", {class: "fb-dash-tile-empty"}, (
            "No figures yet. Press Refresh on the Home tab to build them."
        ));
    } else if (!data.rows || !data.rows.length) {
        body = m("div", {class: "fb-dash-tile-empty"}, (
            "Nothing in this period"
        ));
    } else {
        let rows = data.rows;
        let hasComparison = rows.some(function (row) {
            return row.comparison !== undefined && row.comparison !== null;
        });
        let hasTarget = rows.some(function (row) {
            return row.target !== undefined && row.target !== null;
        });
        // Opt-in rather than opt-out: a sparkline beside a bar says
        // something the bar does not, but on every row of every tile it is
        // just ink.
        let hasSpark = tile.showSpark === true && rows.some(function (row) {
            return row.spark && row.spark.length > 1;
        });
        let showPct = tile.showPercent !== false;
        let top = 0;
        let lines;
        let max;
        let mode = display;

        rows.forEach(function (row) {
            let against = row.comparison || 0;
            let candidate = Math.max(Number(row.amount), Number(against));

            if (candidate > top) {
                top = candidate;
            }
        });
        max = draw.niceMax(top);
        total = data.total;

        // Absent means absent: with nothing to compare against and
        // nothing to aim at, bullets are just bars with marks that would
        // never be drawn, so say bars. A target alone is reason enough
        // to keep them -- it is the mark the bullet was designed for.
        if (mode === "bullets" && !hasComparison && !hasTarget) {
            mode = "bars";
        }

        lines = rows.map(function (row) {
            let amount = Number(row.amount);
            let label = row.label || row.key || "—";
            let history = row.spark || [];
            let points = history.map(function (point) {
                return Number(point.amount);
            });
            let against = (
                row.comparison === null
                ? undefined
                : row.comparison
            );
            let aim = (
                row.target === null
                ? undefined
                : row.target
            );
            let said = label + ": " + fmt.amount(amount);
            let graphic;
            let cells = [];

            if (against !== undefined) {
                said += (
                    " against " + fmt.amount(against) + " " +
                    (data.comparisonLabel || "prior year")
                );
            }
            if (aim !== undefined) {
                said += ", target " + fmt.amount(aim);
            }

            if (mode === "bullets") {
                graphic = draw.bullet({
                    comparison: against,
                    max,
                    ranges: [],
                    target: aim,
                    title: said,
                    value: amount,
                    width,
                    height: 14
                });
            } else if (mode === "bars") {
                graphic = draw.bar({
                    max,
                    title: said,
                    value: amount,
                    width,
                    height: 11
                });
            }

            if (hasSpark) {
                cells.push(m("td", {class: "fb-dash-cell-spark"}, (
                    points.length > 1
                    ? draw.sparkline({points, width: 76, height: 16})
                    : null
                )));
            }
            cells.push(m("td", {class: "fb-dash-cell-name"}, label));
            if (graphic) {
                cells.push(m("td", {class: "fb-dash-cell-graphic"}, graphic));
            }
            cells.push(m("td", {class: "fb-dash-cell-value"}, (
                fmt.amount(amount)
            )));
            if (showPct) {
                cells.push(m("td", {class: "fb-dash-cell-pct"}, (
                    Math.round(row.pctOfTotal || 0) + "%"
                )));
            }

            return m("tr", cells);
        });

        if (mode !== "table") {
            let lead = [];
            let trail = [m("td")];
            let index = 0;
            let span = (
                hasSpark
                ? 2
                : 1
            );

            while (index < span) {
                lead.push(m("td"));
                index += 1;
            }
            if (showPct) {
                trail.push(m("td"));
            }
            lines.push(m("tr", lead.concat([
                m("td", {class: "fb-dash-cell-graphic"}, draw.axis({
                    format: fmt.compact,
                    max,
                    width
                }))
            ]).concat(trail)));
        }

        body = [
            m("table", {class: "fb-dash-measure-table"}, lines),
            (
                mode === "bullets"
                ? m("div", {class: "fb-dash-caption"}, markerCaption(
                    data,
                    hasComparison,
                    hasTarget
                ))
                : null
            )
        ];
    }

    return [
        m("div", headingDrag(tile), [
            m("span", heading),
            (
                total === null
                ? null
                : m("span", {class: "fb-dash-tile-total"}, fmt.amount(total))
            ),
            removeControl(tile)
        ]),
        body
    ];
}

/*
    While a tile is being dragged: which tile, whether it is being moved
    or resized, where the pointer started, and where it would land.
    Null the rest of the time, which is also how the board knows not to
    draw the outline.
*/
let dragState = null;

/**
    The board's grid geometry, measured rather than assumed.

    Padding and gap are in the stylesheet, and a copy of them here would
    be a second place to change and a silent half-cell error the day
    somebody changed only one. Measured from the element, this follows
    the stylesheet and the app's scale without being told about either.
*/
function gridMetrics(board) {
    let box = board.getBoundingClientRect();
    let style = window.getComputedStyle(board);
    let padLeft = parseFloat(style.paddingLeft) || 0;
    let padTop = parseFloat(style.paddingTop) || 0;
    let padRight = parseFloat(style.paddingRight) || 0;
    let padBottom = parseFloat(style.paddingBottom) || 0;
    let gapX = parseFloat(style.columnGap) || 0;
    let gapY = parseFloat(style.rowGap) || 0;
    let usableW = box.width - padLeft - padRight - gapX * (DASH_COLS - 1);
    let usableH = box.height - padTop - padBottom - gapY * (DASH_ROWS - 1);

    return {
        box,
        gapX,
        gapY,
        padLeft,
        padTop,
        cellW: usableW / DASH_COLS,
        cellH: usableH / DASH_ROWS
    };
}

/**
    How many whole cells a pointer has travelled since the drag began.
*/
function cellDelta(metrics, fromX, fromY, toX, toY) {
    return {
        cols: Math.round((toX - fromX) / (metrics.cellW + metrics.gapX)),
        rows: Math.round((toY - fromY) / (metrics.cellH + metrics.gapY))
    };
}

function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

/**
    Follows the pointer, working out where the tile would land.

    Clamped to the board rather than allowed to run off it, because the
    board is a fixed grid with nowhere outside it to go -- which is the
    same reason the packer shrinks rather than overflows.
*/
function dragMove(event) {
    let state = dragState;
    let board;
    let metrics;
    let moved;

    if (!state) {
        return;
    }
    board = document.querySelector(".fb-dash-board");
    if (!board) {
        return;
    }
    metrics = gridMetrics(board);
    moved = cellDelta(
        metrics,
        state.startX,
        state.startY,
        event.clientX,
        event.clientY
    );

    if (state.mode === "move") {
        state.cols = state.fromCols;
        state.rows = state.fromRows;
        state.col = clamp(
            state.fromCol + moved.cols,
            1,
            DASH_COLS - state.cols + 1
        );
        state.row = clamp(
            state.fromRow + moved.rows,
            1,
            DASH_ROWS - state.rows + 1
        );
    } else {
        state.col = state.fromCol;
        state.row = state.fromRow;
        state.cols = clamp(
            state.fromCols + moved.cols,
            DASH_MIN_COLS,
            DASH_COLS - state.col + 1
        );
        state.rows = clamp(
            state.fromRows + moved.rows,
            DASH_MIN_ROWS,
            DASH_ROWS - state.row + 1
        );
    }
    m.redraw();
}

/**
    Drops the tile where the outline says.

    The dragged tile is placed first and the rest packed around it, so
    the tile somebody just moved always gets the spot they chose and the
    others tidy up -- rather than the move silently failing because
    something was already there.
*/
function dragEnd() {
    let state = dragState;
    let layout;
    let moved;
    let others;

    window.removeEventListener("pointermove", dragMove);
    window.removeEventListener("pointerup", dragEnd);
    window.removeEventListener("pointercancel", dragEnd);
    dragState = null;

    if (!state || !currentLayout) {
        m.redraw();
        return;
    }

    layout = currentLayout;
    moved = layout.tiles.find(function (tile) {
        return tile.id === state.id;
    });
    if (!moved) {
        m.redraw();
        return;
    }

    others = layout.tiles.filter(function (tile) {
        return tile.id !== state.id;
    });
    currentLayout = Object.assign({}, layout, {
        tiles: placeTiles([Object.assign({}, moved, {
            col: state.col,
            cols: state.cols,
            row: state.row,
            rows: state.rows
        })].concat(others.map(function (tile) {
            // Their own positions are a preference, not a claim: the
            // moved tile has first call on the space.
            return Object.assign({}, tile);
        })))
    });
    loadAll(currentLayout);
    m.redraw();
}

function dragBegin(event, tile, mode) {
    // Only the primary button, and never a drag that starts on the
    // control whose whole job is to be clicked.
    if (event.button !== 0) {
        return;
    }
    event.preventDefault();
    dragState = {
        col: tile.col,
        cols: tile.cols,
        fromCol: tile.col,
        fromCols: tile.cols,
        fromRow: tile.row,
        fromRows: tile.rows,
        id: tile.id,
        mode,
        row: tile.row,
        rows: tile.rows,
        startX: event.clientX,
        startY: event.clientY
    };
    window.addEventListener("pointermove", dragMove);
    window.addEventListener("pointerup", dragEnd);
    window.addEventListener("pointercancel", dragEnd);
}

/**
    The outline showing where a dragged tile would land, drawn in the
    grid itself so it cannot disagree with where the tile actually goes.
*/
function dropOutline() {
    if (!dragState) {
        return [];
    }
    // Keyed like the tiles it sits among: Mithril wants every child of
    // a list keyed or none of them, and an unkeyed hole here takes the
    // whole board down rather than just losing the outline.
    return [m("div", {
        class: "fb-dash-drop",
        key: "fb-dash-drop",
        style: {
            "grid-column": dragState.col + " / span " + dragState.cols,
            "grid-row": dragState.row + " / span " + dragState.rows
        }
    })];
}

/**
    The corner somebody drags to resize a tile.
*/
function resizeHandle(tile) {
    return m("div", {
        class: "fb-dash-tile-resize",
        title: "Drag to resize",
        onpointerdown: function (e) {
            dragBegin(e, tile, "resize");
        }
    });
}

/**
    The control that takes a tile off the board.

    Lives in the tile's own heading rather than in a mode somebody has to
    enter first: a board is arranged by trying things, and a tile you
    cannot get rid of makes trying things expensive. It is faint until the
    tile is hovered, so a board being read is not a board covered in
    buttons.
*/
/**
    The heading doubles as the handle a tile is dragged by.

    No separate grip: the heading is the only part of a tile that is not
    data, it is in the same place on every tile, and a board people are
    meant to arrange should not need a mode or a grip to be discovered
    first.
*/
function headingDrag(tile) {
    return {
        class: "fb-dash-tile-heading",
        onpointerdown: function (e) {
            if (e.target.closest(".fb-dash-tile-remove")) {
                return;
            }
            dragBegin(e, tile, "move");
        }
    };
}

function removeControl(tile) {
    return m("button", {
        class: "fb-dash-tile-remove",
        title: "Take this tile off the board",
        onclick: function () {
            removeTile(tile.id);
        }
    }, "\u00d7");
}

let dashboard = {
    oninit: function () {
        /*
            Coming back to the board, not arriving at it: whatever was
            being arranged is still there. The Home tab's buttons show on
            every page, so a tile can be added from a workbook and found
            waiting here, and a trip out to look something up should not
            cost an arrangement that was never saved.
        */
        if (currentLayout) {
            loadAll(currentLayout);
            return;
        }

        // Draws the composed board straight away and swaps in the saved
        // layout when it arrives: a dashboard that shows nothing until a
        // round trip finishes is a dashboard that looks broken on a slow
        // connection.
        currentLayout = composeLayout();
        loadAll(currentLayout);
        startingLayout().then(function (layout) {
            currentLayout = layout;
            loadAll(layout);
            m.redraw();
        });
    },
    view: function () {
        let layout = currentLayout || composeLayout();

        // A module that registered after this board was built gets its tile
        // without the page being reloaded. A saved layout keeps its own
        // arrangement and gains only what is new to it.
        if (layout.version !== registryVersion) {
            layout = (
                layout.name
                ? withNewcomers(layout)
                : composeLayout()
            );
            currentLayout = layout;
            loadAll(layout);
        }

        return m("div", {class: "fb-dash-frame"}, [
            refreshBar(layout),
            m("div", {
                class: "fb-dash-board",
                style: {
                    "grid-template-columns": "repeat(" + DASH_COLS + ", 1fr)",
                    "grid-template-rows": "repeat(" + DASH_ROWS + ", 1fr)"
                }
            }, layout.tiles.map(function (tile) {
                let dragging = (
                    dragState !== null && dragState.id === tile.id
                );

                return m("section", {
                    class: (
                        dragging
                        ? "fb-dash-tile fb-dash-tile-dragging"
                        : "fb-dash-tile"
                    ),
                    key: tile.id,
                    style: {
                        "grid-column": tile.col + " / span " + tile.cols,
                        "grid-row": tile.row + " / span " + tile.rows
                    }
                }, [
                    (
                        tile.type === "kpi"
                        ? kpiTile(tile)
                        : measureTile(tile)
                    ),
                    resizeHandle(tile)
                ]);
            }).concat(dropOutline()))
        ]);
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
f.catalog().register("global", "dashboardSources", {
    list: listSources,
    register: registerSource
});
f.catalog().register("global", "dashboardRefreshers", {
    list: listRefreshers,
    register: registerRefresher
});
f.catalog().register("global", "dashboardRefresh", runRefresh);
f.catalog().register("global", "dashboardRefreshStatus", function () {
    return refreshState.status;
});
f.catalog().register("global", "dashboardAsOf", getAsOf);
f.catalog().register("global", "dashboardLayouts", function () {
    return savedLayouts;
});
f.catalog().register("global", "dashboardLayoutName", function () {
    return (
        currentLayout
        ? currentLayout.name
        : null
    );
});
f.catalog().register("global", "dashboardSaveLayout", saveLayout);
f.catalog().register("global", "dashboardUseLayout", useLayout);
f.catalog().register("global", "dashboardAddTile", addTile);
f.catalog().register("global", "dashboardRemoveTile", removeTile);
f.catalog().register("global", "dashboardTileChoices", tileChoices);
f.catalog().register("global", "dashboardSetAsOf", setAsOf);
f.catalog().register("global", "dashboardTitle", dashboardTitle);
f.catalog().register("components", "dashboard", dashboard);
