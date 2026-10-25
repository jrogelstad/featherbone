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
            better: "higher" (default) or "lower"
            unit:   "money", "count" or "percent"; optional
            format: (Number) -> String
            load:   () -> Promise of {value, comparison, comparisonLabel,
                    spark, pending, pendingLabel}
        }

    `pending` is expected but not yet landed (open orders), drawn as a
    paler extension of the bar.

    Stored targets (`$dashboard_target`) are a number or a signed percent
    of the comparison. Key Metrics tiles use them, else the comparison.

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
            betterFor:   (tile) -> "higher" | "lower", optional
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

    where each row is `{key, label, amount, units, comparison,
    unitsComparison, target, pctOfTotal, spark}`. `target` is where the
    row should be and `comparison` is where it was: different questions,
    drawn as different marks, and a row may carry either, both or
    neither.

    `needsRefresh` is how a source says its aggregates have never been
    built, which is a different thing from an error and is shown as an
    instruction rather than a failure.

    A *schedule* (`dashboardSchedules`) feeds the due-date histogram: open
    orders by the date they are due, as of the reporting date.

        {
            key:    unique string
            module: who contributed it
            name:   what the orders are, e.g. "Sales"
            sequence: order among schedules, optional
            format: {amount, compact, units} formatters, all optional
            load:   ({asOf, bucket}) -> Promise of {asOf, rows: [{period,
                    late, amount, units}]}
        }

    `bucket` is "day", "week" (Monday) or "month"; `period` is the
    bucket's first day as YYYY-MM-DD; `late` means due before the
    reporting date. The tile does the bucketing, so schedules side by side
    always line up.

    A KPI may say `better: "neither"` (no alert either way),
    `isStandard: false` (not on the composed board, only by choice) and
    `group` (its heading in the Add Tile picker, else its module).

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
    What a tile is judged against.

    A bar on its own says how big something is; it takes a reference to
    say whether that is good. Where that reference comes from is a
    property of the TILE rather than of the data, because the same
    measure is judged differently on different boards -- so the framework
    works it out from the tile's own options and every source gets it
    without having to know anything about targets.

        "auto"     each metric's stored target, else "history"
        "none"     nothing to judge against; just the figure
        "history"  the comparison the source returned -- prior year,
                   prior period, whatever that source was asked for
        "fixed"    a number somebody typed
        "growth"   a signed percentage of that comparison

    A source that returns a real stored target per row wins over all of
    this: it knows something the tile does not.
*/
const DASH_TARGET_MODES = ["auto", "none", "history", "fixed", "growth"];

// Shortfall, as a fraction of the reference, for a pale and a strong dot.
const DASH_ALERT_LEVELS = [0.02, 0.1];

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
let scheduleRegistry = {};
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

// How long to wait after an edit before writing the working arrangement
// back to the profile, so dragging a tile across the board does not fire
// a request on every pointer move -- only once things settle.
const DASH_DRAFT_DEBOUNCE = 600;

// Pending write-back of the working arrangement; reset on every edit so
// only the last one in a burst actually goes out.
let draftTimer = null;

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
    Remembers the arrangement on screen a moment after the last change, so
    a refresh midway through rearranging the board does not throw the
    arrangement away.

    This is not what `saveLayout` means by saved -- nobody has named this
    arrangement or chosen to keep it -- it is only the working copy this
    person is looking at, written to their own profile so it survives a
    reload the same way the rest of what is remembered about the board
    does. `name` ties it to the layout it is an edit of (or to nothing,
    for the composed board), so it is only ever offered back in place of
    that same starting point.
*/
function saveDraft(layout) {
    let spec = Object.assign(layoutSpec(layout), {
        name: layout.name || null
    });

    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(function () {
        saveDashProfile({draft: spec});
    }, DASH_DRAFT_DEBOUNCE);
}

/**
    The number a row is judged against, or null where there is nothing to
    judge it against.

    Zero is a reference like any other and is not treated as absent --
    which it was, and which is why a metric standing at 1 against 0 a
    year ago drew no bar at all. Zero is useless as a DENOMINATOR, but
    that is the caller's problem to state, not a reason to pretend the
    reference is missing.
*/
function percentFrom(reference, percent) {
    // Of the reference's size, so 10% better than -100 is -90.
    let pct = (
        Number.isFinite(percent)
        ? percent
        : 0
    );

    return reference + Math.abs(reference) * pct / 100;
}

function targetFor(tile, reference) {
    let mode = tile.targetMode || "history";
    let given = Number(tile.targetValue);
    let from = Number(reference);
    let hasReference = (
        reference !== null &&
        reference !== undefined &&
        Number.isFinite(from)
    );

    if (DASH_TARGET_MODES.indexOf(mode) === -1 || mode === "none") {
        return null;
    }
    if (mode === "auto") {
        mode = "history";
    }

    if (mode === "fixed") {
        return (
            Number.isFinite(given)
            ? given
            : null
        );
    }

    if (!hasReference) {
        return null;
    }

    if (mode === "growth") {
        return percentFrom(from, given);
    }

    return from;
}

/**
    The target a measure tile should DRAW, as against the one it is
    judged by.

    "history" means the reference is the comparison, and a measure tile
    already draws that as its marker -- so drawing a target line there
    too would put two marks in the same place and call them different
    things. Only a target that says something the marker does not is
    worth its own mark.

    A KPI tile has no such marker: its bar is the ratio to the reference,
    so it uses targetFor directly and "history" means exactly what it
    says.
*/
function drawnTarget(tile, row) {
    let mode = tile.targetMode || "history";

    if (row.target !== null && row.target !== undefined) {
        return Number(row.target);
    }
    if (mode === "fixed" || mode === "growth") {
        return targetFor(tile, row.comparison);
    }
    return null;
}

/**
    What a tile's target should be called, so a legend says where the
    mark came from rather than always claiming "prior year".
*/
function targetLabel(tile, fallback) {
    let mode = tile.targetMode || "history";
    let given = Number(tile.targetValue);
    let said = fallback || "prior year";

    if (mode === "fixed") {
        return "target";
    }
    if (mode === "growth" && Number.isFinite(given)) {
        return percentText(given, said);
    }
    return said;
}

function percentText(given, said) {
    if (given < 0) {
        return Math.abs(given) + "% below " + said;
    }
    return given + "% above " + said;
}

// Stored targets by metric key, as last fetched.
let storedTargets = {};

/**
    Fetches stored targets. A failure keeps the last set.
*/
function loadTargets() {
    return f.datasource().request({
        method: "GET",
        path: "/dashboard-targets"
    }).then(function (rows) {
        let next = {};
        let list = rows || [];

        list.forEach(function (row) {
            next[row.metric] = row;
        });
        storedTargets = next;
        m.redraw();
    }).catch(function () {
        return;
    });
}

/**
    Applies Targets dialog changes; an entry with no basis removes the
    target. Reloads afterwards either way.
*/
function saveTargets(changes) {
    let given = changes || [];
    let list = given.slice();
    let failed = [];

    function next() {
        let one = list.shift();
        let request;

        if (!one) {
            return Promise.resolve();
        }
        request = (
            one.basis
            ? {
                method: "PUT",
                path: "/dashboard-target/" + encodeURIComponent(one.metric),
                body: {
                    amount: one.amount,
                    basis: one.basis,
                    better: one.better || null
                }
            }
            : {
                method: "DELETE",
                path: "/dashboard-target/" + encodeURIComponent(one.metric)
            }
        );
        return f.datasource().request(request).catch(function (err) {
            failed.push(one.metric + ": " + (err.message || String(err)));
        }).then(next);
    }

    return next().then(loadTargets).then(function () {
        if (failed.length) {
            return Promise.reject(new Error(failed.join("\n")));
        }
    });
}

// Which way is good: the stored target's say, the metric's, else higher.
function betterFor(kpi) {
    let stored = storedTargets[kpi.key];

    return (stored && stored.better) || kpi.better || "higher";
}

/**
    What a Key Metrics row is judged against, and its label. "auto" (the
    default) uses the stored target, else the comparison.
*/
function kpiReference(tile, row) {
    let mode = tile.targetMode || "auto";
    let stored = storedTargets[row.kpi.key];
    let said = row.comparisonLabel || "prior year";
    let from = Number(row.comparison);
    let hasReference = (
        row.comparison !== null &&
        row.comparison !== undefined &&
        Number.isFinite(from)
    );

    if (mode === "auto" && stored) {
        if (stored.basis === "fixed") {
            return {aim: Number(stored.amount), label: "target"};
        }
        return {
            aim: (
                hasReference
                ? percentFrom(from, Number(stored.amount))
                : null
            ),
            label: "target, " + percentText(Number(stored.amount), said)
        };
    }

    return {
        aim: targetFor(tile, row.comparison),
        label: targetLabel(tile, said)
    };
}

// Alert level 0-2 for how far short of aim, honouring lower-is-better.
function alertLevel(value, aim, better) {
    let n = Number(value);
    let gap;

    if (
        better === "neither" ||
        aim === null ||
        aim === undefined ||
        aim === 0 ||
        !Number.isFinite(n) ||
        !Number.isFinite(Number(aim))
    ) {
        return 0;
    }
    gap = (n - aim) / Math.abs(aim);
    if (better === "lower") {
        gap = -gap;
    }
    if (-gap >= DASH_ALERT_LEVELS[1]) {
        return 2;
    }
    if (-gap >= DASH_ALERT_LEVELS[0]) {
        return 1;
    }
    return 0;
}

function alertTitle(level, better, against) {
    let said = (
        better === "lower"
        ? "above "
        : "below "
    ) + against;

    if (level === 2) {
        return "Well " + said;
    }
    return "A little " + said;
}

/**
    Puts every row's history on the same months, zero-filling gaps, so a
    row missing a month isn't drawn shifted.
*/
function alignedHistory(rows) {
    let months = [];

    rows.forEach(function (row) {
        let history = row.spark || [];

        history.forEach(function (point) {
            if (point.month && months.indexOf(point.month) === -1) {
                months.push(point.month);
            }
        });
    });
    months.sort();

    return rows.map(function (row) {
        let by = {};
        let history = row.spark || [];

        history.forEach(function (point) {
            by[point.month] = Number(point.amount);
        });
        if (!months.length) {
            return history.map(function (point) {
                return Number(point.amount);
            });
        }
        return months.map(function (month) {
            return by[month] || 0;
        });
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
    Registers a due-date schedule. See the file comment for its shape.
*/
function registerSchedule(schedule) {
    if (schedule && schedule.key) {
        scheduleRegistry[schedule.key] = schedule;
        registryVersion += 1;
    }
}

// By `sequence` where given, then key, so side-by-side order is stable.
function listSchedules() {
    let all = Object.keys(scheduleRegistry).map(function (key) {
        return scheduleRegistry[key];
    });

    return all.sort(function (a, b) {
        let x = a.sequence || 0;
        let y = b.sequence || 0;

        return (
            x === y
            ? a.key.localeCompare(b.key)
            : x - y
        );
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
    /*
        Every registered metric, not a hard-coded list. A module that
        contributes a KPI gets it on the standard board for the same
        reason a module that contributes a source gets its tile: an
        installed package should arrive showing something, not waiting
        to be found in a dialog.
    */
    let metrics = listKpis().filter(function (kpi) {
        return kpi.isStandard !== false;
    }).map(function (kpi) {
        return kpi.key;
    });
    let tiles = [{
        cols: 5,
        heading: "Key Metrics",
        id: "core-kpis",
        kpis: metrics,
        // A row per metric, so a tile holding several is not one that
        // silently clips the last of them.
        rows: Math.min(DASH_ROWS, Math.max(3, metrics.length + 1)),
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
    if there is one, otherwise whatever the registrations compose to --
    or, if this person left that same starting point mid-edit, the
    working copy `saveDraft` last wrote rather than its clean original.

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
        let profile = dashProfile();
        let chosen = profile.layout;
        let draft = profile.draft;
        let baseName;
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
        baseName = (
            preferred
            ? preferred.name
            : null
        );
        // The draft only ever replaces the starting point it was an
        // edit of -- a draft left over from a layout this person has
        // since switched away from (or that was deleted) is not offered
        // in place of whatever they are looking at now.
        if (draft && draft.name === baseName) {
            return withChosenAsOf(withNewcomers({
                asOf: draft.asOf || null,
                name: baseName,
                seen: draft.seen || [],
                tiles: placeTiles(draft.tiles || []),
                title: draft.title || null,
                version: registryVersion
            }));
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
    Removes a saved layout.

    The service decides whether it is allowed -- a layout belongs to
    whoever saved it -- so the answer is not assumed. If the layout
    being removed is the one on screen, the choice is cleared first,
    or the board would come back asking for a layout that is gone and
    fall through to the default without saying why.
*/
function deleteLayout(name) {
    let wasShowing = currentLayout && currentLayout.name === name;

    return f.datasource().request({
        method: "DELETE",
        path: "/dashboard/" + encodeURIComponent(name)
    }).then(function () {
        if (wasShowing) {
            return saveDashProfile({draft: null, layout: null});
        }
    }).then(
        startingLayout
    ).then(function (next) {
        currentLayout = next;
        loadAll(next);
        m.redraw();
    });
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
        draft: null,
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
    gets. Nothing is named or shared until somebody saves the layout --
    trying a tile out should cost nothing -- but the arrangement is still
    remembered for this person, via `saveDraft`, so trying it out and
    then reloading the page does not undo it.
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
    saveDraft(next);
    m.redraw();

    // The packer drops what it cannot draw legibly, and a tile that
    // silently fails to appear is worse than being told the board is
    // full.
    return placed;
}

/**
    Replaces one tile in place -- what the Add Tile dialog builds, for a
    tile that already exists -- instead of the delete-and-re-add this
    exists to avoid. Keeps the old spot as preferred; placeTiles repacks
    around it if a new size no longer fits there. Only this tile reloads,
    so editing one tile does not flicker every other one on the board.
*/
function updateTile(id, patch) {
    let layout = currentLayout || composeLayout();
    let index = layout.tiles.findIndex(function (one) {
        return one.id === id;
    });
    let tiles;
    let next;
    let placed;

    if (index === -1) {
        return false;
    }

    tiles = layout.tiles.slice();
    tiles[index] = Object.assign({}, patch, {
        id: tiles[index].id,
        col: tiles[index].col,
        row: tiles[index].row
    });
    next = Object.assign({}, layout, {tiles: placeTiles(tiles)});
    placed = next.tiles.find(function (one) {
        return one.id === id;
    });

    currentLayout = next;
    if (placed) {
        tileState[id] = {status: "loading"};
        loadTile(placed, next).then(function (result) {
            tileState[id] = Object.assign({status: "ready"}, result);
            m.redraw();
        });
    }
    saveDraft(next);
    m.redraw();
    // Same guarantee as addTile: a resize the packer cannot fit is a
    // dropped tile, not a silently clipped one.
    return Boolean(placed);
}

/**
    Takes a tile off the board. Not saved as a layout until somebody saves
    the layout, but kept as this person's working arrangement either way.
*/
function removeTile(id) {
    let layout = currentLayout || composeLayout();

    currentLayout = Object.assign({}, layout, {
        tiles: placeTiles(layout.tiles.filter(function (tile) {
            return tile.id !== id;
        }))
    });
    delete tileState[id];
    saveDraft(currentLayout);
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
                group: kpi.group,
                key: kpi.key,
                label: kpi.name,
                module: kpi.module
            };
        }),
        schedules: listSchedules().map(function (schedule) {
            return {
                key: schedule.key,
                label: schedule.name,
                module: schedule.module
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
        // Named and saved for real now, so the working copy standing in
        // for it is spent.
        return saveDashProfile({draft: null});
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

    if (tile.type === "histogram") {
        let chosen = tile.schedules || [];
        let picked = chosen.map(function (key) {
            return scheduleRegistry[key];
        }).filter(Boolean);

        if (!picked.length) {
            return Promise.resolve({error: "No schedule chosen"});
        }
        return Promise.all(picked.map(function (schedule) {
            return schedule.load({
                asOf,
                bucket: tile.bucket || "week"
            }).then(function (data) {
                return {data, schedule};
            });
        })).then(function (series) {
            return {series};
        }).catch(function (err) {
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
        saveDraft(currentLayout);
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
    // Each metric as a percentage of its reference. Zero can't divide,
    // so that row shows a dash.
    let scaled = rows.map(function (row) {
        let ref = kpiReference(tile, row);
        let better = betterFor(row.kpi);
        let pct = null;
        let pending = null;
        let level = 0;

        if (ref.aim !== null && ref.aim !== 0 && !row.error) {
            pct = (row.value / ref.aim) * 100;
            if (row.pending) {
                pending = (row.pending / ref.aim) * 100;
            }
            level = alertLevel(row.value, ref.aim, better);
        }
        return {
            aim: ref.aim,
            better,
            label: ref.label,
            level,
            pct,
            pending,
            row
        };
    });
    let anyScale = scaled.some(function (one) {
        return one.pct !== null;
    });
    let anyReference = scaled.some(function (one) {
        return one.aim !== null;
    });
    let anyAlert = scaled.some(function (one) {
        return one.level > 0;
    });
    let pendingSaid = rows.reduce(function (found, row) {
        if (found || !row.pending) {
            return found;
        }
        return row.pendingLabel || "still to come";
    }, "");
    let labels = [];
    let body;

    scaled.forEach(function (one) {
        if (one.pct !== null && labels.indexOf(one.label) === -1) {
            labels.push(one.label);
        }
    });

    if (state.status !== "ready") {
        body = m("div", {class: "fb-dash-tile-empty"}, "Loading…");
    } else if (!rows.length) {
        body = m("div", {class: "fb-dash-tile-empty"}, "No metrics selected");
    } else {
        let lines = scaled.map(function (one) {
            let row = one.row;
            let said = row.kpi.name + ": " + (
                one.pct === null
                ? ""
                : Math.round(one.pct) + "% of " + one.label
            );
            let cells = [];

            if (one.pending !== null) {
                said += (
                    ", plus " + row.kpi.format(row.pending) + " " +
                    (row.pendingLabel || "still to come")
                );
            }

            cells.push(m("td", {class: "fb-dash-cell-spark"}, (
                (row.spark && row.spark.length > 1)
                ? draw.sparkline({points: row.spark, width: 76, height: 16})
                : null
            )));
            // Between the spark and the name, not the row's leading edge
            // (John, Oct 2026).
            if (anyAlert) {
                cells.push(m("td", {class: "fb-dash-cell-alert"}, draw.alert({
                    level: one.level,
                    title: alertTitle(one.level, one.better, one.label)
                })));
            }
            cells.push(m("td", {class: "fb-dash-cell-name"}, row.kpi.name));
            if (anyReference) {
                cells.push(m("td", {class: "fb-dash-cell-graphic"}, (
                    one.pct === null
                    ? m("span", {class: "fb-dash-cell-nil"}, "—")
                    : draw.bullet({
                        comparison: 100,
                        max: DASH_PCT_MAX,
                        pending: (
                            one.pending === null
                            ? undefined
                            : one.pending
                        ),
                        ranges: DASH_PCT_BANDS,
                        reverse: one.better === "lower",
                        title: said,
                        value: one.pct,
                        width: 150,
                        height: 14
                    })
                )));
            }
            cells.push(m("td", {
                class: "fb-dash-cell-value",
                title: (
                    one.pending === null
                    ? undefined
                    : said
                )
            }, (
                (row.error || row.value === null || row.value === undefined)
                ? "—"
                : row.kpi.format(row.value)
            )));

            return m("tr", cells);
        });

        if (anyScale) {
            let lead = [m("td"), m("td")];

            if (anyAlert) {
                lead.push(m("td"));
            }
            lines.push(m("tr", lead.concat([
                m("td", {class: "fb-dash-cell-graphic"}, draw.axis({
                    format: function (n) {
                        return Math.round(n) + "%";
                    },
                    max: DASH_PCT_MAX,
                    ticks: 3,
                    width: 150
                })),
                m("td")
            ])));
        }

        body = [
            m("table", {class: "fb-dash-kpi-table"}, lines),
            (
                anyScale
                ? m("div", {class: "fb-dash-caption"}, [
                    (
                        labels.length === 1
                        ? "100% = " + labels[0]
                        : (
                            "100% = each metric's own target, or its " +
                            "comparison where it has none"
                        )
                    ),
                    (
                        pendingSaid
                        ? " \u00b7 paler: " + pendingSaid
                        : ""
                    )
                ])
                : null
            )
        ];
    }

    return [
        m("div", headingDrag(tile), m("span", tile.heading || "Key Metrics")),
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
function markerCaption(data, hasComparison, hasTarget, targetName) {
    let said = [];

    if (hasComparison) {
        said.push("short bar: " + (data.comparisonLabel || "prior year"));
    }
    if (hasTarget) {
        said.push("full line: " + targetName);
    }
    if (!said.length) {
        return "";
    }
    return said.join(" \u00b7 ");
}

// Select-backed tile options arrive as "true" or "".
function isOn(value) {
    return value === true || value === "true";
}

/**
    Small multiples: a sparkline per row on one shared zero-based scale,
    stated once in the caption.
*/
function multiplesBody(tile, data, fmt, draw) {
    let rows = data.rows;
    let history = alignedHistory(rows);
    let high = 0;
    let source = sourceRegistry[tile.source] || {};
    let better = (
        source.betterFor
        ? source.betterFor(tile)
        : "higher"
    );

    history.forEach(function (points) {
        points.forEach(function (n) {
            if (n > high) {
                high = n;
            }
        });
    });
    high = draw.niceMax(high);

    return [
        m("div", {class: "fb-dash-multiples"}, rows.map(function (row, i) {
            let aim = drawnTarget(tile, row);
            let level = alertLevel(
                row.amount,
                (
                    aim === null
                    ? row.comparison
                    : aim
                ),
                better
            );

            return m("div", {class: "fb-dash-multiple"}, [
                m("div", {class: "fb-dash-multiple-head"}, [
                    (
                        level > 0
                        ? draw.alert({
                            level,
                            size: 8,
                            title: alertTitle(
                                level,
                                better,
                                data.comparisonLabel || "prior year"
                            )
                        })
                        : null
                    ),
                    m("span", {class: "fb-dash-multiple-label"}, (
                        row.label || row.key || "—"
                    ))
                ]),
                (
                    history[i].length > 1
                    ? draw.sparkline({
                        height: 28,
                        high,
                        low: 0,
                        points: history[i],
                        title: (row.label || row.key) + ", by month",
                        width: 110
                    })
                    : m("div", {class: "fb-dash-cell-nil"}, "—")
                ),
                m("div", {class: "fb-dash-multiple-value"}, (
                    fmt.amount(row.amount)
                ))
            ]);
        })),
        m("div", {class: "fb-dash-caption"}, (
            (history.length && history[0].length)
            ? (
                "Each: the last " + history[0].length + " months, on " +
                "one scale from 0 to " + fmt.compact(high)
            )
            : "No monthly history to draw"
        ))
    ];
}

/**
    One grouped measure tile: a measure broken down by a dimension, drawn as
    bullet rows against a comparison, as ranked bars, as a plain numeric
    table, or as small multiples. One zero-based scale across rows, axis
    stated once. Units may ride alongside on their own scale.
*/
function measureTile(tile) {
    let state = tileState[tile.id] || {status: "loading"};
    let source = sourceRegistry[tile.source] || {};
    let draw = f.catalog().store().global().dashboardDraw;
    let fmt = measureFormats(source);
    let data = state.data;
    let display = tile.display || "bullets";
    let better = (
        source.betterFor
        ? source.betterFor(tile)
        : "higher"
    );
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
    let unitsWidth = 120;
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
    } else if (display === "multiples") {
        total = data.total;
        body = multiplesBody(tile, data, fmt, draw);
    } else {
        let rows = data.rows;
        let history = alignedHistory(rows);
        let hasComparison = rows.some(function (row) {
            return row.comparison !== undefined && row.comparison !== null;
        });
        let hasTarget = rows.some(function (row) {
            return drawnTarget(tile, row) !== null;
        });
        // Opt-in rather than opt-out: a sparkline beside a bar says
        // something the bar does not, but on every row of every tile it is
        // just ink.
        let hasSpark = tile.showSpark === true && history.some(function (h) {
            return h.length > 1;
        });
        let showPct = tile.showPercent !== false;
        // Hidden for a tile read across from a neighbour sorted by name.
        let showNames = !isOn(tile.hideLabels);
        let showUnits = isOn(tile.showUnits) && rows.some(function (row) {
            return row.units !== undefined && row.units !== null;
        });
        let levels = rows.map(function (row) {
            let aim = drawnTarget(tile, row);

            return alertLevel(
                row.amount,
                (
                    aim === null
                    ? row.comparison
                    : aim
                ),
                better
            );
        });
        let anyAlert = levels.some(function (level) {
            return level > 0;
        });
        let top = 0;
        let unitsTop = 0;
        let lines;
        let max;
        let unitsMax;
        let mode = display;

        rows.forEach(function (row) {
            let against = row.comparison || 0;
            // A target beyond the longest bar still has to fit, or the
            // mark that says "this is where we should be" sits off the
            // end of the chart.
            let aim = drawnTarget(tile, row);
            let candidate = Math.max(
                Number(row.amount),
                Number(against),
                Number(aim) || 0
            );
            let units = Math.max(
                Number(row.units) || 0,
                Number(row.unitsComparison) || 0
            );

            if (candidate > top) {
                top = candidate;
            }
            if (units > unitsTop) {
                unitsTop = units;
            }
        });
        max = draw.niceMax(top);
        unitsMax = draw.niceMax(unitsTop);
        total = data.total;

        // Absent means absent: with nothing to compare against and
        // nothing to aim at, bullets are just bars with marks that would
        // never be drawn, so say bars. A target alone is reason enough
        // to keep them -- it is the mark the bullet was designed for.
        if (mode === "bullets" && !hasComparison && !hasTarget) {
            mode = "bars";
        }

        lines = rows.map(function (row, index) {
            let amount = Number(row.amount);
            let label = row.label || row.key || "—";
            let points = history[index];
            let against = (
                row.comparison === null
                ? undefined
                : row.comparison
            );
            let aim = drawnTarget(tile, row);
            let said = label + ": " + fmt.amount(amount);
            let graphic;
            let cells = [];

            if (against !== undefined) {
                said += (
                    " against " + fmt.amount(against) + " " +
                    (data.comparisonLabel || "prior year")
                );
            }
            if (aim !== null) {
                said += ", target " + fmt.amount(aim);
            }

            if (mode === "bullets") {
                graphic = draw.bullet({
                    comparison: against,
                    max,
                    ranges: [],
                    target: (
                        aim === null
                        ? undefined
                        : aim
                    ),
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
            // Between the spark and the name, not the row's leading edge
            // (John, Oct 2026).
            if (anyAlert) {
                cells.push(m("td", {class: "fb-dash-cell-alert"}, draw.alert({
                    level: levels[index],
                    title: alertTitle(
                        levels[index],
                        better,
                        (
                            aim === null
                            ? data.comparisonLabel || "prior year"
                            : "target"
                        )
                    )
                })));
            }
            if (showNames) {
                cells.push(m("td", {class: "fb-dash-cell-name"}, label));
            }
            if (graphic) {
                cells.push(m("td", {class: "fb-dash-cell-graphic"}, graphic));
            }
            cells.push(m("td", {
                class: "fb-dash-cell-value",
                title: (
                    showNames
                    ? undefined
                    : label
                )
            }, fmt.amount(amount)));
            if (showPct) {
                cells.push(m("td", {class: "fb-dash-cell-pct"}, (
                    Math.round(row.pctOfTotal || 0) + "%"
                )));
            }
            if (showUnits) {
                let unitsAgainst = (
                    (
                        row.unitsComparison === null ||
                        row.unitsComparison === undefined
                    )
                    ? undefined
                    : row.unitsComparison
                );

                if (mode !== "table") {
                    cells.push(m("td", {
                        class: "fb-dash-cell-graphic fb-dash-cell-units"
                    }, draw.bullet({
                        comparison: (
                            mode === "bullets"
                            ? unitsAgainst
                            : undefined
                        ),
                        max: unitsMax,
                        ranges: [],
                        title: (
                            label + ": " + fmt.units(row.units) + " units" + (
                                unitsAgainst === undefined
                                ? ""
                                : (
                                    " against " + fmt.units(unitsAgainst) +
                                    " " + (data.comparisonLabel || "prior year")
                                )
                            )
                        ),
                        value: Number(row.units) || 0,
                        width: unitsWidth,
                        height: 14
                    })));
                }
                cells.push(m("td", {class: "fb-dash-cell-value"}, (
                    fmt.units(row.units || 0)
                )));
            }

            return m("tr", cells);
        });

        if (mode !== "table") {
            let lead = [];
            let trail = [m("td")];
            let index = 0;
            let before = [hasSpark, showNames, anyAlert];
            let span = before.filter(Boolean).length;

            while (index < span) {
                lead.push(m("td"));
                index += 1;
            }
            if (showPct) {
                trail.push(m("td"));
            }
            if (showUnits) {
                trail.push(m("td", {class: "fb-dash-cell-graphic"}, draw.axis({
                    format: fmt.units,
                    max: unitsMax,
                    ticks: 2,
                    width: unitsWidth
                })));
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
                    hasTarget,
                    targetLabel(tile, data.comparisonLabel)
                ) + (
                    showUnits
                    ? " \u00b7 right: units sold"
                    : ""
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
            )
        ]),
        body
    ];
}

/*
    Due-date histogram: open orders by when they are due, in day, week or
    month buckets around the reporting date. Past buckets sit left of the
    "now" line in red. The current week or month straddles the line, so it
    appears twice: its overdue part on the left, the rest on the right.
    Several schedules are drawn side by side in each bucket on one scale
    (Few's comparison), told apart by intensity; red keeps that intensity.
*/
const DASH_HIST_SPAN = {
    day: {after: 21, before: 7},
    month: {after: 12, before: 4},
    week: {after: 13, before: 6}
};
const DASH_HIST_NOUNS = {
    day: "day",
    month: "month",
    week: "week"
};
const DASH_HIST_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// Measured plot sizes by tile id, so the chart fills whatever it is given.
let histSizes = {};

function utcDay(text) {
    return new Date(text + "T00:00:00Z");
}

function dayText(date) {
    return date.toISOString().slice(0, 10);
}

function periodStart(date, bucket) {
    let out = new Date(date.getTime());

    if (bucket === "month") {
        out.setUTCDate(1);
    } else if (bucket === "week") {
        // Monday, as Postgres date_trunc has it
        out.setUTCDate(out.getUTCDate() - ((out.getUTCDay() + 6) % 7));
    }
    return out;
}

function addPeriods(date, bucket, count) {
    let out = new Date(date.getTime());

    if (bucket === "month") {
        out.setUTCMonth(out.getUTCMonth() + count);
    } else {
        out.setUTCDate(out.getUTCDate() + count * (
            bucket === "week"
            ? 7
            : 1
        ));
    }
    return out;
}

function periodLabel(date, bucket) {
    let month = DASH_HIST_MONTHS[date.getUTCMonth()];

    if (bucket === "month") {
        return (
            date.getUTCMonth() === 0
            ? month + " " + String(date.getUTCFullYear()).slice(2)
            : month
        );
    }
    return month + " " + date.getUTCDate();
}

/**
    The buckets around a reporting date, oldest first, and a function
    placing a schedule row into one of them (or "earlier"/"later").
*/
function histBuckets(asOf, bucket) {
    let span = DASH_HIST_SPAN[bucket] || DASH_HIST_SPAN.week;
    let at = utcDay(asOf);
    let first = periodStart(at, bucket);
    let split = bucket !== "day";
    let buckets = [];
    let index = span.before;
    let oldest;
    let newest;

    while (index > 0) {
        let back = addPeriods(first, bucket, -index);

        buckets.push({key: dayText(back), late: true, start: back});
        index -= 1;
    }
    if (split) {
        buckets.push({
            key: dayText(first) + ":late",
            late: true,
            partial: true,
            start: first
        });
    }
    index = 0;
    while (index < span.after) {
        let ahead = addPeriods(first, bucket, index);

        buckets.push({
            key: dayText(ahead),
            late: false,
            partial: split && index === 0,
            start: ahead
        });
        index += 1;
    }
    oldest = buckets[0].key;
    newest = buckets[buckets.length - 1].key;

    return {
        buckets,
        place: function (row) {
            if (row.late) {
                if (split && row.period === dayText(first)) {
                    return row.period + ":late";
                }
                return (
                    row.period < oldest
                    ? "earlier"
                    : row.period
                );
            }
            return (
                row.period > newest
                ? "later"
                : row.period
            );
        }
    };
}

function histFormats(series) {
    let first = series[0] || {};

    return measureFormats(first.schedule);
}

// Keeps the plot sized to its box; redraws only when the box changed.
function histMeasure(id) {
    function measure(vnode) {
        let width = vnode.dom.clientWidth;
        let height = vnode.dom.clientHeight;
        let was = histSizes[id] || {};

        if (
            Math.abs((was.width || 0) - width) > 1 ||
            Math.abs((was.height || 0) - height) > 1
        ) {
            histSizes[id] = {height, width};
            window.requestAnimationFrame(m.redraw);
        }
    }
    return {oncreate: measure, onupdate: measure};
}

function histogramTile(tile) {
    let state = tileState[tile.id] || {status: "loading"};
    let draw = f.catalog().store().global().dashboardDraw;
    let value = (
        tile.value === "units"
        ? "units"
        : "amount"
    );
    let bucket = tile.bucket || "week";
    let keys = tile.schedules || [];
    let wanted = keys.map(function (key) {
        return scheduleRegistry[key];
    }).filter(Boolean);
    let named = wanted.map(function (one) {
        return one.name;
    }).join(", ");
    let heading = tile.heading || (
        (named || "Orders") + " due by " + DASH_HIST_NOUNS[bucket]
    );
    let body;
    let total = null;
    let fmt = histFormats(wanted.map(function (schedule) {
        return {schedule};
    }));

    if (state.status !== "ready") {
        body = m("div", {class: "fb-dash-tile-empty"}, "Loading…");
    } else if (state.error) {
        body = m("div", {class: "fb-dash-tile-error"}, state.error);
    } else {
        let series = state.series;
        let asOf = series[0].data.asOf;
        let grid = histBuckets(asOf, bucket);
        let edges = {earlier: [], later: []};
        let sums = series.map(function (one, which) {
            let by = {};

            edges.earlier[which] = 0;
            edges.later[which] = 0;
            let rows = one.data.rows || [];

            rows.forEach(function (row) {
                let key = grid.place(row);
                let n = Number(row[value]) || 0;

                total += n;
                if (key === "earlier" || key === "later") {
                    edges[key][which] += n;
                } else {
                    by[key] = (by[key] || 0) + n;
                }
            });
            return by;
        });
        let size = histSizes[tile.id];
        let notes = [];
        let earlier = edges.earlier.reduce((a, b) => a + b, 0);
        let later = edges.later.reduce((a, b) => a + b, 0);
        let lastDay = grid.buckets[grid.buckets.length - 1].start;

        total = total || 0;
        if (value === "units") {
            fmt = Object.assign({}, fmt, {
                amount: fmt.units,
                compact: fmt.units
            });
        }
        if (series.length > 1) {
            series.forEach(function (one, which) {
                notes.push(m("span", {class: "fb-dash-hist-key"}, [
                    m("span", {
                        class: "fb-dash-hist-swatch fb-dash-hist-s" + which
                    }),
                    one.schedule.name
                ]));
            });
            // A past-due bar is drawn in the alert hue at its series' own
            // intensity (see dashColumns), so the key needs one swatch per
            // series too -- a single generic "past due" entry cannot say
            // which series a dimmer red bar belongs to.
            series.forEach(function (one, which) {
                notes.push(m("span", {class: "fb-dash-hist-key"}, [
                    m("span", {
                        class: (
                            "fb-dash-hist-swatch fb-dash-hist-late " +
                            "fb-dash-hist-s" + which
                        )
                    }),
                    one.schedule.name + " past due"
                ]));
            });
        } else {
            notes.push(m("span", {class: "fb-dash-hist-key"}, [
                m("span", {class: "fb-dash-hist-swatch fb-dash-hist-late"}),
                "past due"
            ]));
        }
        if (earlier > 0) {
            notes.push(m("span", {class: "fb-dash-hist-earlier"}, (
                "Due before " + periodLabel(grid.buckets[0].start, bucket) +
                ": " + fmt.amount(earlier)
            )));
        }
        if (later > 0) {
            notes.push(m("span", {class: "fb-dash-hist-key"}, (
                "After " + periodLabel(lastDay, bucket) + ": " +
                fmt.amount(later)
            )));
        }

        body = [
            m("div", Object.assign({
                class: "fb-dash-hist-plot"
            }, histMeasure(tile.id)), (
                size
                ? draw.columns({
                    asOfLabel: (
                        asOf === dayText(new Date())
                        ? "Today"
                        : asOfText(asOf)
                    ),
                    buckets: grid.buckets.map(function (one) {
                        let label = periodLabel(one.start, bucket);

                        // The current period's overdue half is unlabelled;
                        // its other half carries the name.
                        return {
                            label: (
                                (one.late && one.partial)
                                ? ""
                                : label
                            ),
                            name: label,
                            late: one.late,
                            values: sums.map(function (by) {
                                return by[one.key] || 0;
                            })
                        };
                    }),
                    format: fmt.compact,
                    height: size.height,
                    names: series.map(function (one) {
                        return one.schedule.name;
                    }),
                    titleFormat: fmt.amount,
                    width: size.width
                })
                : null
            )),
            m("div", {class: "fb-dash-caption fb-dash-hist-notes"}, notes)
        ];
    }

    return [
        m("div", headingDrag(tile), [
            m("span", heading),
            (
                total === null
                ? null
                : m("span", {class: "fb-dash-tile-total"}, fmt.amount(total))
            )
        ]),
        body
    ];
}

function tileBody(tile) {
    if (tile.type === "kpi") {
        return kpiTile(tile);
    }
    if (tile.type === "histogram") {
        return histogramTile(tile);
    }
    return measureTile(tile);
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
    saveDraft(currentLayout);
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

    In the tile's own top corner, opposite the resize grip, rather than
    in a mode somebody has to enter first: a board is arranged by trying
    things, and a tile you cannot get rid of makes trying things
    expensive. It sat beside the heading while a tile had no boundary and
    nothing but adjacency said which tile a control belonged to; now that
    a tile is a card with an edge, the corner says it (John, Oct 2026).

    Faint until the tile is hovered, so a board being read is not a board
    covered in buttons.
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

/**
    Opens the tile in the same dialog it was added from, settings
    already filled in -- what used to take a delete and a re-add.
    main.js owns that dialog, so this only asks for it to open.
*/
function editControl(tile) {
    return m("button", {
        class: "fb-dash-tile-edit",
        title: "Edit this tile",
        onclick: function () {
            let open = f.catalog().store().global().dashboardEditTile;

            if (open) {
                open(tile);
            }
        }
    }, "\u270e");
}

/**
    The board's wallpaper, from whichever package's manifest last
    carried a sibling "dashboard" image (brandingSettings, set by
    installer.js's saveBranding -- see scripts/branding-settings.json).
    `""` when none is set, which leaves `style.background-image` unset.

    Filling the full height and centering is John's call (Oct 2026):
    scale to the board's height, never stretch, and let an image wider
    than the board run off both edges rather than shrink to fit --
    a panorama crops at the sides, which reads as "wallpaper" the way
    shrinking it to fit would not. An image narrower than the board at
    full height leaves bare margins instead; nothing here tiles or
    stretches to close that gap.

    @method wallpaperStyle
    @return {Object}
*/
function wallpaperStyle() {
    let models = f.catalog().store().models();
    let settings = (
        models.brandingSettings
        ? models.brandingSettings()
        : null
    );
    let value = (
        (settings && settings.data && settings.data.dashboardImage)
        ? settings.data.dashboardImage()
        : ""
    );
    let src;

    if (!value) {
        return {};
    }

    src = (
        value.startsWith("http")
        ? value
        : "/files/upload/" + value
    );

    return {
        "background-image": "url(\"" + src + "\")",
        "background-position": "center center",
        "background-repeat": "no-repeat",
        "background-size": "auto 100%"
    };
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
        // Every visit, so a changed target shows next time.
        loadTargets();

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
                style: Object.assign(wallpaperStyle(), {
                    "grid-template-columns": "repeat(" + DASH_COLS + ", 1fr)",
                    "grid-template-rows": "repeat(" + DASH_ROWS + ", 1fr)"
                })
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
                    tileBody(tile),
                    editControl(tile),
                    removeControl(tile),
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
f.catalog().register("global", "dashboardSchedules", {
    list: listSchedules,
    register: registerSchedule
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
f.catalog().register("global", "dashboardDeleteLayout", deleteLayout);
f.catalog().register("global", "dashboardAddTile", addTile);
f.catalog().register("global", "dashboardUpdateTile", updateTile);
f.catalog().register("global", "dashboardRemoveTile", removeTile);
f.catalog().register("global", "dashboardTileChoices", tileChoices);
f.catalog().register("global", "dashboardSetAsOf", setAsOf);
f.catalog().register("global", "dashboardTitle", dashboardTitle);
f.catalog().register("global", "dashboardTargets", function () {
    return storedTargets;
});
f.catalog().register("global", "dashboardLoadTargets", loadTargets);
f.catalog().register("global", "dashboardSaveTargets", saveTargets);
f.catalog().register("components", "dashboard", dashboard);
