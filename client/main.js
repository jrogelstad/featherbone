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
/*jslint this, browser, eval, devel, unordered*/
/*global f, WebSocket, jsonpatch, m*/
import model from "./models/model.js";
import settings from "./models/settings.js";

const datasource = f.datasource();
const State = f.State;
const catalog = f.catalog();
const components = catalog.store().components();
const viewModels = catalog.store().viewModels();
const connectionMonitor = catalog.store().global().connectionMonitor;

/**
    The browser tab's title, in place of "Featherbone" once a package's
    manifest has carried a "title" (brandingSettings, set by
    installer.js's saveBranding). Same lookup as ribbon.js's own
    brandTitle -- kept local here rather than shared, since the two
    files have no import relationship.

    @method brandTitle
    @return {String}
*/
function brandTitle() {
    let models = catalog.store().models();
    let theSettings = (
        models.brandingSettings
        ? models.brandingSettings()
        : null
    );
    let title = (
        (theSettings && theSettings.data && theSettings.data.title)
        ? theSettings.data.title()
        : ""
    );

    return title || "Featherbone";
}

/**
    The browser tab's icon, in place of the Featherbone quill once a
    package's manifest has carried a sibling "icon" image
    (brandingSettings, set by installer.js's saveBranding). `""` when
    none is set, so the caller can fall back to the default favicon.
    Same lookup as ribbon.js's own brandIcon -- kept local here rather
    than shared, since the two files have no import relationship.

    @method brandIcon
    @return {String}
*/
function brandIcon() {
    let models = catalog.store().models();
    let theSettings = (
        models.brandingSettings
        ? models.brandingSettings()
        : null
    );
    let value = (
        (theSettings && theSettings.data && theSettings.data.icon)
        ? theSettings.data.icon()
        : ""
    );

    if (!value) {
        return "";
    }

    return (
        value.startsWith("http")
        ? value
        : "/files/upload/" + value
    );
}

/*
    A sign-in link from an email that no longer works (two days old, the
    server restarted) is sent here by the server with whose it was, as
    "#link-failed=<name>". Read it before the route is worked out, and
    take it out of the address so that it is not mistaken for one, and
    is not still there after a refresh.
*/
(function () {
    let marker = "#link-failed=";
    let found = window.location.hash;

    if (!found.startsWith(marker)) {
        return;
    }

    try {
        window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search
        );
    } catch (ignore) {
        // The marker stays in the address; nothing else depends on it
    }

    f.signInHint(
        decodeURIComponent(found.slice(marker.length)),
        "That sign-in link has expired or can no longer be used. " +
        "Enter your password, or choose Forgot password to be sent a " +
        "new link."
    );
}());

let hash = window.location.hash.slice(window.location.hash.indexOf("/"));
let feathers;
let formsSid = f.createId();
let loadForms;
let loadCatalog;
let loadModules;
let loadProfile;
let moduleData;
let moduleSid = f.createId();
let workbookData;
let loadWorkbooks;
let loadNavigationCategories;
let menu;
let workbooks = catalog.register("workbooks");
let addWorkbookViewModel;
let addWbFromTemplateDlg;
let deleteWbTemplateDlg;
let navCategoryDlg;
let navCategoryErrDlg;
let asOfDlg;
let saveLayoutDlg;
let saveLayoutErrDlg;
let addTileDlg;
let addTileErrDlg;
let targetsDlg;
let targetsErrDlg;
let deleteLayoutDlg;
let deleteLayoutErrDlg;
let acctMenu;
let models = catalog.store().models();
let initialized = false;
let starting = Promise.resolve();
let isAdmin = false;
// Whether to open the screens that belong to whoever administers the
// organization: Settings, Users, Instances (see main.js start-up)
let canAdminister = false;

/*
    The user's profile is one JSON document per user, already carrying
    their worksheet column widths. Anything else that is theirs rather
    than the instance's goes in it under its own key, so a preference
    follows them to another machine instead of living in one browser's
    storage.

    Reads are from the copy loaded at sign-in; writes go as a patch, so
    two settings saved from two tabs do not overwrite each other
    wholesale.
*/
/*
    The profile is registered in the catalog's data store while the app
    loads, so anything that runs earlier finds no store at all -- not an
    empty one. Asked before then, these say "nothing yet" rather than
    throwing, because a preference that cannot be read is never a reason
    for the app not to start.
*/
function heldProfile() {
    let store = catalog.store();

    if (typeof store.data !== "function" || !store.data().profile) {
        return null;
    }
    return store.data().profile();
}

function profileValue(key) {
    let held = heldProfile();

    if (!held || !held.data) {
        return undefined;
    }
    return held.data[key];
}

function profileSave(key, value) {
    let held = heldProfile();
    let next;
    let patch;

    if (typeof catalog.store().data !== "function") {
        return Promise.resolve();
    }

    function kept(etag) {
        next.etag = etag;
        catalog.store().data().profile(next);
    }

    // No profile yet: the first thing anybody saves creates one.
    if (!held) {
        next = {data: {}};
        next.data[key] = f.copy(value);
        return f.datasource().request({
            method: "PUT",
            path: "/profile",
            body: next.data
        }).then(kept);
    }

    next = f.copy(held);
    next.data = next.data || {};
    if (value === undefined) {
        delete next.data[key];
    } else {
        next.data[key] = f.copy(value);
    }

    patch = jsonpatch.compare(held.data, next.data);
    if (!patch || !patch.length) {
        return Promise.resolve();
    }
    return f.datasource().request({
        method: "PATCH",
        path: "/profile",
        body: {
            etag: held.etag,
            patch
        }
    }).then(kept);
}

/*
    How large the whole interface is drawn, as a percentage.

    The stylesheet carries the default (--fb-ui-scale); this overrides it
    at the root when somebody moves the control. It is the whole app
    rather than one worksheet: the old per-sheet zoom was never saved
    anywhere, so nobody could have been relying on it, and wanting one
    sheet bigger almost always means wanting everything bigger (John,
    Oct 2026).

    Kept per browser for now, next to the dashboard's reporting date.
    Both belong in the user's profile, and go there together.
*/
const APP_ZOOM_KEY = "fb-app-zoom";
const APP_ZOOM_DEFAULT = 100;
const APP_ZOOM_MIN = 50;
const APP_ZOOM_MAX = 200;
// The control shows zoom relative to the default, so the default reads
// 100%; steps and limits are in those shown units. The default is the
// stylesheet's --fb-ui-scale (1 = 100); keep the two together.
const ZOOM_SHOWN_STEP = 5;
const ZOOM_SHOWN_MIN = 50;
const ZOOM_SHOWN_MAX = 175;
// What is being typed into the zoom field, until Enter or blur.
const zoomDraft = f.prop(null);

/*
    The scale is also kept in browser storage, not instead of the profile
    but ahead of it: it has to be applied before the first paint, and the
    profile has not arrived that early. The profile is what carries it to
    another machine; storage is what stops this one flashing.

    Storage is switched off in some browsers and throws rather than
    returning nothing, and a preference that cannot be remembered is no
    reason for the app not to run.
*/
function rememberZoom(pct) {
    try {
        window.localStorage.setItem(APP_ZOOM_KEY, String(pct));
    } catch (ignore) {
        return;
    }
}

function recallZoom() {
    try {
        return window.localStorage.getItem(APP_ZOOM_KEY);
    } catch (ignore) {
        return null;
    }
}

/*
    Drawing the app at a scale, and CHOOSING that scale, are two
    different acts and only the second is worth recording.

    Applying one that was already remembered -- at start-up, or when the
    profile arrives -- must write nothing: there is nothing new to save,
    and at start-up the attempt ran before the catalog's data store
    existed and took the whole app down with it.
*/
function applyZoom(value) {
    let wanted = Math.round(Number(value));

    if (
        !Number.isFinite(wanted) ||
        wanted < APP_ZOOM_MIN ||
        wanted > APP_ZOOM_MAX
    ) {
        return false;
    }
    document.documentElement.style.setProperty(
        "--fb-ui-scale",
        wanted / 100
    );
    /*
        A zoom change IS a resize: the window holds the same device
        pixels but a different number of CSS ones, which is the number
        everything that measures itself against the viewport cares
        about. Saying so lets the ribbon re-fit its stages -- and
        anything else listening -- without each of them having to know
        the zoom exists.
    */
    window.dispatchEvent(new Event("resize"));
    return wanted;
}

function appZoom(value) {
    let held;
    let wanted;

    if (value !== undefined) {
        wanted = applyZoom(value);
        if (wanted !== false) {
            rememberZoom(wanted);
            profileSave("appZoom", wanted).catch(function () {
                // Kept in this browser regardless; a profile that would
                // not save is not a reason to refuse to resize.
                return;
            });
        }
    }

    held = document.documentElement.style.getPropertyValue("--fb-ui-scale");
    if (held) {
        return Math.round(Number(held) * 100);
    }
    return APP_ZOOM_DEFAULT;
}

function shownZoom(actual) {
    return Math.round(actual * 100 / APP_ZOOM_DEFAULT);
}

// Sets zoom from a shown percent, clamped and snapped to whole percent.
function setShownZoom(shown) {
    let n = Math.round(Number(shown));

    if (!Number.isFinite(n)) {
        return;
    }
    n = Math.max(ZOOM_SHOWN_MIN, Math.min(ZOOM_SHOWN_MAX, n));
    appZoom(n * APP_ZOOM_DEFAULT / 100);
}

// One step from the current shown percent, landing on a multiple of it.
function stepZoom(direction) {
    let now = shownZoom(appZoom());
    let next = (
        direction > 0
        ? Math.floor(now / ZOOM_SHOWN_STEP + 1) * ZOOM_SHOWN_STEP
        : Math.ceil(now / ZOOM_SHOWN_STEP - 1) * ZOOM_SHOWN_STEP
    );

    setShownZoom(next);
}

/*
    Applied before the first render rather than after: the app appearing
    at one size and jumping to another is worse than either size. This
    runs before anything else is loaded, so it must touch nothing but
    the stylesheet.
*/
function applyStoredZoom() {
    let held = recallZoom();

    if (held) {
        applyZoom(held);
    }
}

/*
    Run once the profile is in: what this machine remembered may be
    stale, or there may be nothing remembered here at all because this
    is a machine the user has not signed in on before.
*/
function applyProfileZoom() {
    let held = profileValue("appZoom");

    if (held) {
        // Already what the profile says, so applied and not saved back.
        applyZoom(held);
        rememberZoom(held);
    }
}

// For workbook management
const template = f.prop("");
const newname = f.prop("");

// The dashboard's reporting date while its dialog is open; empty means
// today. Only written back to the board when the dialog is accepted.
const asOfPending = f.prop("");
const asOfId = f.createId();

/*
    For the Add Tile dialog. `addTileWhat` is either a source key or the
    sentinel below, meaning a tile of chosen metrics rather than one
    source's measure. `addTileOpts` collects whatever questions the
    chosen source said it accepts, keyed by the tile property each sets,
    so nothing here knows what a dimension or a measure is.
*/
const ADD_TILE_KPIS = "__kpis";
const ADD_TILE_HIST = "__histogram";
const ADD_TILE_BUCKETS = [
    {value: "day", label: "Daily"},
    {value: "week", label: "Weekly"},
    {value: "month", label: "Monthly"}
];
// Names the max-horizon field's unit after whichever bucket is picked --
// matches dashboard.js's own DASH_HIST_NOUNS, pluralized for this prompt.
const ADD_TILE_HORIZON_NOUNS = {
    day: "days",
    week: "weeks",
    month: "months"
};
// In board cells, which are half the size they were: the board was
// doubled so a tile can be nudged by half of what used to be the
// smallest possible step (see DASH_COLS in dashboard.js). The sizes
// themselves are unchanged -- Medium is the same Medium.
const ADD_TILE_SIZES = [
    {value: "small", label: "Small", cols: 8, rows: 4},
    {value: "medium", label: "Medium", cols: 10, rows: 6},
    {value: "large", label: "Large", cols: 14, rows: 8},
    {value: "wide", label: "Wide", cols: 18, rows: 6},
    {value: "tall", label: "Tall", cols: 8, rows: 10}
];
/*
    How a tile is judged. These are the framework's own options rather
    than a source's: the framework works the target out from them, so
    they apply to any source and to a metrics tile alike.
*/
const ADD_TILE_TARGETS = [
    {value: "auto", label: "Each metric's own target, else prior period"},
    {value: "history", label: "Against prior period"},
    {value: "growth", label: "A percentage above prior period"},
    {value: "fixed", label: "A number I set"},
    {value: "none", label: "Nothing"}
];
const addTileTarget = f.prop("auto");
const addTileTargetValue = f.prop("");
const addTileFilter = f.prop("");
const addTileWhat = f.prop(ADD_TILE_KPIS);
const addTileOpts = f.prop({});
const addTileKpis = f.prop([]);
/*
    The Add Tile metrics picker's two lists: which rows are highlighted
    in each, and the row a shift click measures its run from. The drag
    state says which list a drag started in and where it would land, so
    the row under the pointer can show the insertion line.
*/
const addTileAvailSel = f.prop([]);
const addTileChosenSel = f.prop([]);
const addTileAvailAnchor = f.prop(null);
const addTileChosenAnchor = f.prop(null);
const addTileDragFrom = f.prop(null);
const addTileDrop = f.prop(null);

/**
    Forgets what was highlighted in the Add Tile metrics picker. The
    chosen metrics themselves are the caller's business -- editing a
    tile keeps them, adding one does not.
*/
function clearMetricsPicker() {
    addTileAvailSel([]);
    addTileChosenSel([]);
    addTileAvailAnchor(null);
    addTileChosenAnchor(null);
    addTileDragFrom(null);
    addTileDrop(null);
}
const addTileSize = f.prop("medium");
const addTileDisplay = f.prop("bullets");
const addTileSpark = f.prop(false);
const addTileHideNames = f.prop(false);
// Blank means the tile names itself from its settings.
const addTileHeading = f.prop("");
const addTileSchedules = f.prop([]);
const addTileBucket = f.prop("week");
const addTileValue = f.prop("amount");
// Blank means the default forward window for the bucket (DASH_HIST_SPAN);
// a number caps how many buckets ahead of "now" the histogram draws.
const addTileMaxHorizon = f.prop("");
const addTileId = f.createId();
// The tile being edited, or null when the dialog is adding a new one.
const addTileEditingId = f.prop(null);

/**
    Opens the Add Tile dialog with an existing tile's settings already in
    it, aimed at replacing that tile rather than appending a new one --
    the reverse of what addTileDlg.onOk reads back out. Called from the
    dashboard's own edit control (dashboard.js has no way to reach this
    file directly, hence the indirection through a registered global).
*/
function openTileEditor(tile) {
    let choices = catalog.store().global().dashboardTileChoices;
    let offer = (
        choices
        ? choices()
        : {kpis: [], sources: []}
    );
    let picked = offer.sources.find((one) => one.key === tile.source);
    let size = ADD_TILE_SIZES.find(
        (one) => one.cols === tile.cols && one.rows === tile.rows
    );
    let kpis = tile.kpis || [];
    let opts = {};

    let schedules = tile.schedules || [];

    addTileEditingId(tile.id);
    addTileFilter("");
    clearMetricsPicker();
    if (tile.type === "kpi") {
        addTileWhat(ADD_TILE_KPIS);
    } else if (tile.type === "histogram") {
        addTileWhat(ADD_TILE_HIST);
    } else {
        addTileWhat(tile.source);
    }
    addTileHeading(
        (tile.heading && tile.heading !== "Key Metrics")
        ? tile.heading
        : ""
    );
    addTileSchedules(schedules.slice());
    addTileBucket(tile.bucket || "week");
    addTileValue(tile.value || "amount");
    addTileMaxHorizon(
        tile.maxHorizon
        ? String(tile.maxHorizon)
        : ""
    );
    addTileKpis(kpis.slice());
    // Falls back to Medium when the tile was resized by dragging rather
    // than picked from this list -- there is no "custom" entry to show.
    addTileSize(
        size
        ? size.value
        : "medium"
    );
    addTileDisplay(tile.display || "bullets");
    addTileSpark(tile.showSpark === true);
    addTileHideNames(tile.hideLabels === true);
    addTileTarget(tile.targetMode || "auto");
    addTileTargetValue(
        (tile.targetValue === undefined || tile.targetValue === null)
        ? ""
        : String(tile.targetValue)
    );
    if (picked) {
        picked.options.forEach(function (option) {
            opts[option.key] = (
                tile[option.key] === undefined
                ? option.default
                : tile[option.key]
            );
        });
    }
    addTileOpts(opts);
    addTileDlg.title("Edit tile");
    addTileDlg.buttonOk().label("Save");
    addTileDlg.show();
}

// Targets dialog draft by metric key: {basis, amount, better}; "" basis
// means no target.
const targetsDraft = f.prop({});
const targetsFilter = f.prop("");

// For saving the board's arrangement as a layout everyone can start from
const layoutName = f.prop("");
const layoutToDelete = f.prop("");
const layoutDeleteId = f.createId();
const layoutIsDefault = f.prop(false);
const layoutNameId = f.createId();
const layoutDefaultId = f.createId();
function templates() {
    return Object.keys(workbooks).filter(
        (k) => workbooks[k].data.isTemplate()
    ).sort().map(function (t) {
        return m("option", {
            value: workbooks[t].id()
        }, workbooks[t].data.name());
    });
}

/*
    For navigation category management -- the ribbon's category tabs,
    which are rows in "$navigation_category" rather than the table
    that used to be hard-coded in ribbon.js (John, Oct 2026).

    The dialog edits a working COPY of the list, so Cancel genuinely
    discards and Ok sends the whole thing in one request, which the
    server applies as one transaction (see
    services/navigation-categories.js). A category a workbook is
    filed under can be renamed -- workbooks point at ids, not names --
    but not removed; its row shows the count instead of a Remove
    button, and the server refuses it regardless.
*/
const navCategories = f.prop([]);
const lastCategoryError = f.prop("");

/*
    The list arrives from the server already in presentation order
    (it sorts by sequence, then name), and the dialog treats that
    order as the thing being edited: rows move up and down, and the
    save renumbers `sequence` from their final positions. So the
    stored sequence is an implementation detail the user never types
    (John, Oct 2026).
*/
function editCategories(categories) {
    navCategories(categories.map(function (cat) {
        return {
            id: cat.id,
            name: cat.name,
            icon: cat.icon || "",
            workbookCount: cat.workbookCount
        };
    }));
    lastCategoryError("");
}

function setCategory(idx, attr, value) {
    let rows = navCategories().slice();

    rows[idx][attr] = value;
    navCategories(rows);
}

function addCategory() {
    let rows = navCategories().slice();

    rows.push({
        name: "",
        icon: "",
        workbookCount: 0
    });
    navCategories(rows);
}

/**
    Swap a category with its neighbour, which is how tab order is
    changed -- the save turns the list's final order into `sequence`
    values.
    @method moveCategory
    @param {Integer} idx Row to move
    @param {Integer} delta -1 to move up, 1 to move down
*/
function moveCategory(idx, delta) {
    let rows = navCategories().slice();
    let target = idx + delta;
    let moved;

    if (target < 0 || target >= rows.length) {
        return;
    }

    moved = rows[idx];
    rows[idx] = rows[target];
    rows[target] = moved;
    navCategories(rows);
}

function removeCategory(idx) {
    let rows = navCategories().slice();

    rows.splice(idx, 1);
    navCategories(rows);
}

function isCategoryListValid() {
    let rows = navCategories();
    let names;

    if (rows.some((cat) => !cat.name.trim())) {
        lastCategoryError("Every category needs a name");
        return false;
    }

    names = rows.map((cat) => cat.name.trim().toLowerCase());

    if (names.some((name, idx) => names.indexOf(name) !== idx)) {
        lastCategoryError("Category names must be unique");
        return false;
    }

    lastCategoryError("");
    return true;
}

/**
    One row per category: name, icon, presentation order, and either a
    Remove button or -- when workbooks are filed under it -- how many,
    which is why it can't be removed.
    @method categoryRows
    @return {Object} vnode(s)
*/
function categoryRows() {
    let rows = navCategories();

    if (!rows.length) {
        return m("div", {
            class: "fb-category-empty"
        }, (
            "No categories yet. Every workbook shows under \"Other\" " +
            "until there are some to file them under."
        ));
    }

    return rows.map(function (cat, idx) {
        let count = cat.workbookCount || 0;

        return m("div", {
            class: "fb-category-row"
        }, [
            m("input", {
                value: cat.name,
                autocomplete: "off",
                oninput: (e) => setCategory(idx, "name", e.target.value)
            }),
            m("div", {
                class: "fb-category-icon-cell"
            }, [
                f.icon(cat.icon || "folder-close", "fb-category-icon", {
                    title: "Preview"
                }),
                m("input", {
                    value: (
                        cat.icon
                        ? f.iconLabel(cat.icon)
                        : ""
                    ),
                    list: "fb-category-icon-list",
                    autocomplete: "off",
                    placeholder: "Folder Close",
                    onchange: (e) => setCategory(
                        idx,
                        "icon",
                        f.iconValue(e.target.value)
                    )
                })
            ]),
            m("div", {
                class: "fb-category-move"
            }, [
                m("button[type=button]", {
                    class: "pure-button fb-icon-only",
                    title: "Move up",
                    disabled: idx === 0,
                    onclick: () => moveCategory(idx, -1)
                }, f.icon("arrow_upward", "fb-button-icon")),
                m("button[type=button]", {
                    class: "pure-button fb-icon-only",
                    title: "Move down",
                    disabled: idx === rows.length - 1,
                    onclick: () => moveCategory(idx, 1)
                }, f.icon("arrow_downward", "fb-button-icon"))
            ]),
            (
                count
                ? m("span", {
                    class: "fb-category-usage",
                    title: (
                        "In use by " + count + " workbook" + (
                            count === 1
                            ? ""
                            : "s"
                        ) + ". Change their category first to remove this."
                    )
                }, count + " in use")
                : m("button[type=button]", {
                    class: "pure-button fb-icon-only",
                    title: "Remove this category",
                    onclick: () => removeCategory(idx)
                }, f.icon("delete", "fb-button-icon"))
            )
        ]);
    });
}

const preFetch = [];
const fetchRequests = [];

/**
    Open the global settings form. Was the "Global settings" button at
    the top right of the old home toolbar; now one of the Workbooks
    group's buttons on the ribbon's Home tab (see home.view) (John,
    Oct 2026).
    @method goGlobalSettings
*/
function goGlobalSettings() {
    if (!canAdminister) {
        return;
    }
    m.route.set("/settings/:settings", {
        settings: "globalSettings"
    }, {
        state: {
            form: {
                "name": "globalSettings",
                "description": (
                    "Global settings"
                ),
                "tabs": [{
                    name: "Address"
                }, {
                    name: "Logo"
                }, {
                    name: "SMTP Credentials"
                }],
                "attrs": [
                    {
                        "attr": "name",
                        "grid": 1
                    },
                    {
                        "attr": "street",
                        "grid": 1
                    },
                    {
                        "attr": "unit",
                        "grid": 1
                    },
                    {
                        "attr": "city",
                        "grid": 1
                    },
                    {
                        "attr": "state",
                        "grid": 1
                    },
                    {
                        "attr": "postalCode",
                        "grid": 1
                    },
                    {
                        "attr": "country",
                        "grid": 1
                    },
                    {
                        "attr": "phone",
                        "grid": 1
                    },
                    {
                        "attr": "logo",
                        "grid": 2,
                        "showLabel": false,
                        "fallbackSrc": "/files/logo.jpg"
                    },
                    {
                        "attr": "smtpType",
                        "grid": 3,
                        "label": "Type"
                    },
                    {
                        "attr": "smtpHost",
                        "grid": 3,
                        "label": "Host"
                    },
                    {
                        "attr": "smtpUser",
                        "grid": 3,
                        "label": "Email"
                    },
                    {
                        "attr": "smtpPassword",
                        "grid": 3,
                        "label": "Password"
                    },
                    {
                        "attr": "smtpSecure",
                        "grid": 3,
                        "label": "Secure"
                    },
                    {
                        "attr": "smtpPort",
                        "grid": 3,
                        "label": "Port"
                    }
                ]
            }
        }
    });
}

/**
    The ribbon's Home-tab groups (Accounts, Workbooks) -- hard-coded,
    not reflective of the database, unlike the workbook-category tabs
    (see ribbon.js's HOME_TAB). A function, not a plain array, and
    registered globally below (same as sseState/connectionMonitor)
    rather than kept main.js-private: clicking the Home tab doesn't
    navigate away from an open workbook (ribbon.js's tabs only change
    which buttons show), so workbook-page.js needs to build this same
    Home-tab body too, and this codebase doesn't import between
    component files (John, Oct 2026).
    @method homeRibbonGroups
    @return {Array}
*/
function homeRibbonGroups() {
    let dashStatus = catalog.store().global().dashboardRefreshStatus;
    let getAsOf = catalog.store().global().dashboardAsOf;
    let isRefreshing = (
        dashStatus
        ? dashStatus() === "running"
        : false
    );
    let getLayoutName = catalog.store().global().dashboardLayoutName;
    let dashAsOf = (
        getAsOf
        ? getAsOf()
        : null
    );
    let dashLayout = (
        getLayoutName
        ? getLayoutName()
        : null
    );
    let dashZoom = appZoom();

    return [{
        label: "Dashboard",
        buttons: [{
            label: "Dashboard",
            icon: "dashboard",
            /*
                The board is the Home route, and until now the only way
                back to it from a workbook was the root URL. These
                buttons show on every page's Home tab, so this is the
                way back from wherever you are (John, Oct 2026).
            */
            title: "Open the dashboard",
            onclick: () => m.route.set("/home")
        }, {
            label: "Add Tile",
            icon: "add_chart",
            title: "Put another tile on the dashboard",
            onclick: function () {
                addTileEditingId(null);
                addTileFilter("");
                addTileHeading("");
                // Without this a fresh tile opens carrying whatever
                // the last edited tile showed -- invisible when the
                // metrics were checkboxes somewhere down a scrolling
                // list, obvious now they sit in a list of their own.
                addTileKpis([]);
                clearMetricsPicker();
                addTileDlg.title("Add tile");
                addTileDlg.buttonOk().label("Add");
                addTileDlg.show();
            }
        }, {
            label: "Targets",
            icon: "flag",
            // Anyone may look; only an administrator may change.
            title: (
                isAdmin
                ? "Set what each metric is aiming for"
                : "See what each metric is aiming for"
            ),
            onclick: function () {
                let stored = catalog.store().global().dashboardTargets;
                let held = (
                    stored
                    ? stored()
                    : {}
                );
                let draft = {};

                Object.keys(held).forEach(function (key) {
                    draft[key] = {
                        amount: String(held[key].amount),
                        basis: held[key].basis,
                        better: held[key].better || ""
                    };
                });
                targetsDraft(draft);
                targetsFilter("");
                targetsDlg.show();
            }
        }, {
            label: "Refresh",
            icon: "refresh",
            /*
                A rebuild can take a while, so the button says it is busy
                rather than quietly accepting a second press. What it is
                working on, and how it went, are on the board itself.
            */
            title: (
                isRefreshing
                ? "Rebuilding the figures now"
                : "Rebuild the figures the dashboard shows"
            ),
            disabled: isRefreshing,
            onclick: function () {
                let refresh = catalog.store().global().dashboardRefresh;

                if (refresh) {
                    refresh();
                }
            }
        }, {
            label: "Save Layout",
            icon: "bookmark_add",
            /*
                The board is composed from whatever has registered until
                somebody saves an arrangement. Saving one is what turns it
                into something the instance keeps and others can start
                from -- which is why this is the only button here that
                writes anything shared.
            */
            title: (
                dashLayout
                ? "Showing the \"" + dashLayout + "\" layout. Save it " +
                "again, or under another name."
                : "Save this arrangement as a layout"
            ),
            onclick: function () {
                let listed = catalog.store().global().dashboardLayouts;
                let rows = (
                    listed
                    ? listed()
                    : []
                );
                let existing = rows.find(
                    (row) => row.name === dashLayout
                );

                layoutName(dashLayout || "");
                layoutIsDefault(Boolean(existing && existing.isDefault));
                saveLayoutDlg.show();
            }
        }, {
            label: "Delete Layout",
            icon: "playlist_remove",
            title: "Remove a saved layout",
            onclick: function () {
                layoutToDelete("");
                deleteLayoutDlg.show();
            }
        }, {
            label: "As Of",
            icon: "event",
            /*
                Says the date it is set to rather than "Set reporting
                date", so the board's state can be read off the ribbon
                without opening anything.
            */
            title: (
                dashAsOf
                ? "Reporting as of " + dashAsOf + ". Press to change."
                : "Reporting as of today. Press to pick a fixed date."
            ),
            onclick: function () {
                asOfPending(dashAsOf || "");
                asOfDlg.show();
            }
        }]
    }, {
        label: "Accounts",
        buttons: acctMenu.actionButtons()
    }, {
        label: "Workbooks",
        buttons: [{
            label: "Add Workbook",
            icon: "add",
            title: "Add a new workbook",
            disabled: !isAdmin,
            onclick: (
                isAdmin
                ? function () {
                    addWorkbookViewModel.show();
                }
                : undefined
            )
        }, {
            label: "Copy Template",
            icon: "copy",
            title: "Add workbook from template",
            disabled: !isAdmin,
            onclick: (
                isAdmin
                ? function () {
                    template("");
                    newname("");
                    addWbFromTemplateDlg.show();
                }
                : undefined
            )
        }, {
            label: "Delete Template",
            icon: "playlist_remove",
            title: "Delete workbook template",
            disabled: !isAdmin,
            onclick: (
                isAdmin
                ? function () {
                    template("");
                    deleteWbTemplateDlg.show();
                }
                : undefined
            )
        }, {
            label: "Categories",
            icon: "dashboard_customize",
            title: "Maintain navigation categories",
            disabled: !isAdmin,
            onclick: (
                isAdmin
                ? function () {
                    editCategories(
                        catalog.store().data().navigationCategories()
                    );
                    navCategoryDlg.show();
                }
                : undefined
            )
        }]
    }, {
        label: "Global",
        buttons: [{
            label: "Settings",
            icon: "public",
            title: (
                canAdminister
                ? "Global settings"
                : "Must be an administrator to change global settings"
            ),
            disabled: !canAdminister,
            onclick: (
                canAdminister
                ? goGlobalSettings
                : undefined
            )
        }, {
            label: "Users",
            icon: "manage_accounts",
            title: (
                canAdminister
                ? (
                    "Who may sign in, and to which instances. The " +
                    "manager holds these records and is not routable, " +
                    "so they are administered from here."
                )
                : "Must be an administrator to manage users"
            ),
            disabled: !canAdminister,
            onclick: (
                canAdminister
                ? () => m.route.set("/admin")
                : undefined
            )
        }, {
            label: "Instances",
            icon: "storage",
            title: (
                canAdminister
                ? (
                    "Which databases this installation serves, and " +
                    "which organization they belong to. The other half " +
                    "of Administration, next to Users."
                )
                : "Must be an administrator to manage instances"
            ),
            disabled: !canAdminister,
            onclick: (
                canAdminister
                ? () => m.route.set("/instances")
                : undefined
            )
        }]
    }, {
        /*
            The window's own controls, not the work's -- which is why
            this group sits apart on the far side, the way Office keeps
            view controls away from the commands (John, Oct 2026).
        */
        atEnd: true,
        label: "View",
        small: true,
        buttons: [{
            label: "Zoom In",
            icon: "zoom_in",
            title: "Draw everything larger",
            disabled: shownZoom(dashZoom) >= ZOOM_SHOWN_MAX,
            onclick: () => stepZoom(1)
        }, {
            label: "Zoom Out",
            icon: "zoom_out",
            title: "Draw everything smaller",
            disabled: shownZoom(dashZoom) <= ZOOM_SHOWN_MIN,
            onclick: () => stepZoom(-1)
        }, {
            /*
                Typed into a draft, applied on Enter or blur: bound
                straight to the zoom, every redraw put the old number
                back mid-typing. Escape abandons the draft.
            */
            render: function () {
                let draft = zoomDraft();

                function commit(e) {
                    if (zoomDraft() !== null) {
                        setShownZoom(e.target.value);
                        zoomDraft(null);
                    }
                }

                return m("label", {class: "fb-rb-field fb-rb-field-sm"}, [
                    m("input", {
                        class: "fb-rb-field-input",
                        type: "text",
                        inputmode: "numeric",
                        "aria-label": "Zoom percent",
                        title: "Zoom percent; type one and press Enter",
                        value: (
                            draft === null
                            ? shownZoom(dashZoom)
                            : draft
                        ),
                        oninput: (e) => zoomDraft(e.target.value),
                        onblur: commit,
                        onkeydown: function (e) {
                            if (e.key === "Enter") {
                                commit(e);
                            } else if (e.key === "Escape") {
                                zoomDraft(null);
                            } else {
                                e.redraw = false;
                            }
                        }
                    }),
                    m("span", {class: "fb-rb-field-label"}, "%")
                ]);
            }
        }, {
            // Help sits last in the toolbar of whatever it is about;
            // on Home that is the whole app, so the Contents.
            label: "Help",
            icon: "help",
            title: (
                "How workbooks, worksheets, filters and settings work, " +
                "and every module's own help"
            ),
            onclick: () => f.openHelp({contents: true})
        }]
    }];
}

/**
    Mounts the Home tab's own dialogs -- the account dialogs (Info /
    Password / error, from account-menu.js) and the three workbook
    admin dialogs (Add Workbook, From Template, Delete Template) --
    nothing visible of its own. Needed from any page that can show the
    ribbon's Home-tab groups, not just this module's own home page, for
    the same reason homeRibbonGroups is a shared function rather than
    inline here: workbook-page.js shows these same buttons when its
    ribbon's Home tab is picked, and they need somewhere to open their
    dialogs too (John, Oct 2026).
    @class HomeDialogs
    @static
    @namespace Components
*/
const homeDialogs = {
    view: function () {
        let g = catalog.store().global();

        return [
            m(components.accountMenu, {
                viewModel: g.acctMenu
            }),
            m(components.dialog, {
                viewModel: g.addWorkbookViewModel
            }),
            m(components.dialog, {
                viewModel: g.addWbFromTemplateDlg
            }),
            m(components.dialog, {
                viewModel: g.deleteWbTemplateDlg
            }),
            m(components.dialog, {
                viewModel: g.navCategoryDlg
            }),
            m(components.dialog, {
                viewModel: g.navCategoryErrDlg
            }),
            m(components.dialog, {
                viewModel: g.asOfDlg
            }),
            m(components.dialog, {
                viewModel: g.saveLayoutDlg
            }),
            m(components.dialog, {
                viewModel: g.saveLayoutErrDlg
            }),
            m(components.dialog, {
                viewModel: g.addTileDlg
            }),
            m(components.dialog, {
                viewModel: g.addTileErrDlg
            }),
            m(components.dialog, {
                viewModel: g.deleteLayoutDlg
            }),
            m(components.dialog, {
                viewModel: g.deleteLayoutErrDlg
            }),
            m(components.dialog, {
                viewModel: g.targetsDlg
            }),
            m(components.dialog, {
                viewModel: g.targetsErrDlg
            })
        ];
    }
};
catalog.register("components", "homeDialogs", homeDialogs);
catalog.register("global", "homeRibbonGroups", homeRibbonGroups);

const home = {
    oninit: function (vnode) {
        Object.keys(workbooks).forEach(function (key) {
            let workbook = workbooks[key];
            let config = workbook.getConfig();

            if (workbook.data.isTemplate()) {
                return;
            }

            vnode["go" + workbook.data.name()] = function () {
                m.route.set("/workbook/:workbook/:key", {
                    workbook: workbook.data.name().toSpinalCase(),
                    key: config[0].name.toSpinalCase()
                });
            };
        });

        // The route can load before sign-in finishes (a #!/home in the
        // address bar), when start() has not built the menu yet.
        if (menu) {
            menu.selected("home");
        }
    },
    oncreate: function () {
        let title = document.getElementById("fb-title");
        let favicon = document.getElementById("fb-favicon");
        let icon = brandIcon();

        if (title) {
            title.text = brandTitle();
        }
        if (favicon && icon) {
            favicon.href = icon;
        }
    },
    onupdate: function () {
        if (menu) {
            menu.selected("home");
        }
    },
    view: function () {
        if (!menu) {
            return [];
        }

        let toolbarClass = "fb-toolbar";
        let homeGroups = homeRibbonGroups();
        let globals = catalog.store().global();
        let dashTitle = (
            globals.dashboardTitle
            ? globals.dashboardTitle()
            : f.currentUser().splashTitle
        );
        let listedLayouts = (
            globals.dashboardLayouts
            ? globals.dashboardLayouts()
            : []
        );
        let pickedLayout = (
            globals.dashboardLayoutName
            ? globals.dashboardLayoutName()
            : null
        );
        // Read once here rather than inside dashboard.js's own view, so
        // the one image paints as a single backdrop behind the title/
        // picker row below AND the dashboard frame, instead of two
        // separate fills that would restart (and misalign) at the
        // board's own edge -- see wallpaperStyle's doc comment.
        let wallStyle = (
            globals.dashboardWallpaperStyle
            ? globals.dashboardWallpaperStyle()
            : {}
        );
        let pageClass = (
            wallStyle["background-image"]
            ? "fb-dash-page fb-dash-page-wallpaper"
            : "fb-dash-page"
        );

        return [
            m(components.envBanner),
            m("div", {
                class: "fb-ribbon-layout"
            }, [
                m(components.ribbon, {
                    viewModel: menu,
                    homeGroups
                }), [
                    m(components.connectionBanner),
                    m(components.homeDialogs),
                    m("div", {
                        class: "fb-ribbon-page",
                        style: {width: "100%"}
                    }, [
                        m("div", {
                            class: pageClass,
                            style: wallStyle
                        }, [
                            m("div", {
                                class: toolbarClass + " fb-toolbar-home"
                            }, [
                                m("div", {
                                    class: "fb-header-home"
                                }, dashTitle),
                                m("div", {
                                    class: "fb-toolbar-fill"
                                }),
                                m("select", {
                                    class: "fb-layout-picker",
                                    title: (
                                        "Switch which saved layout you see"
                                    ),
                                    onchange: function (e) {
                                        let use = globals.dashboardUseLayout;

                                        if (use) {
                                            use(e.target.value || null);
                                        }
                                    },
                                    value: pickedLayout || ""
                                }, [
                                    m("option", {
                                        value: ""
                                    }, "Standard arrangement")
                                ].concat(listedLayouts.map(function (row) {
                                    return m("option", {
                                        value: row.name
                                    }, (
                                        row.isDefault
                                        ? row.label + " (default)"
                                        : row.label
                                    ));
                                })))
                            ]),
                            m(components.dashboard)
                        ])
                    ])
                ]
            ])
        ];
    }
};
let routes = {
    "/home": home,
    "/workbook/:workbook/:page": components.workbookPage,
    "/edit/:feather/:key": components.formPage,
    "/traverse/:feather/:key": components.childFormPage,
    "/search/:feather": components.searchPage,
    "/settings/:settings": components.settingsPage,
    "/admin": components.adminPage,
    "/instances": components.adminInstancesPage,
    "/sign-in": components.signInPage,
    "/change-password": components.changePasswordPage,
    "/check-email": components.checkEmailPage,
    "/confirm-sign-in": components.confirmCodePage,
    "/resend-code": components.resendCodePage,
    "/send-mail/:key": components.sendMailPage
};

// Global sse state handler, allows any page
// to observe when we've got a sse connection problem,
// presumably a disconnect
const sseState = State.define(function () {
    this.state("Ok", function () {
        this.event("error", function (error) {
            this.goto("/Error", {
                context: error
            });
        });
        this.event("close", function () {
            this.goto("/Closed");
        });
    });
    this.state("Closed");
    this.state("Error");
});
sseState.goto(); // Initialze
catalog.register("global", "sseState", sseState);

const workbookSpec = {
    name: "Workbook",
    description: "System workbook definition",
    properties: {
        id: {
            description: "Id",
            type: "string",
            default: "createId()"
        },
        name: {
            description: "Workbook name",
            type: "string",
            isRequired: true
        },
        description: {
            description: "Description",
            type: "string"
        },
        module: {
            description: "Module",
            type: "string"
        },
        icon: {
            description: "Menu icon",
            type: "string",
            format: "icon",
            default: "folder",
            isRequired: true
        },
        feather: {
            description: "Feather",
            type: "string",
            isRequired: true
        }
    }
};

const addWorkbookConfig = {
    attrs: [{
        attr: "name"
    }, {
        attr: "description"
    }, {
        attr: "icon"
    }, {
        attr: "feather",
        dataList: "feathers"
    }, {
        attr: "module",
        dataList: "modules"
    }]
};

function registerWorkbook(workbook) {
    let name = workbook.name.toSpinalCase().toCamelCase();
    let wmodel = models.workbook(workbook);
    wmodel.state().goto("/Ready/Fetched/Clean");
    wmodel.checkUpdate();
    workbooks[name] = wmodel;
    catalog.register("workbooks", name, wmodel);
}

function addWorkbookModel() {
    let that = model(undefined, workbookSpec);
    let modules = f.prop(catalog.store().data().modules());

    function theFeathers() {
        let allFeathers = catalog.store().feathers();
        let result;
        let blank = ({
            value: "",
            label: ""
        });

        result = Object.keys(allFeathers).filter(function (name) {
            return (!allFeathers[name].isChild && !allFeathers[name].isSystem);
        }).sort().map(function (key) {
            return {
                value: key,
                label: key
            };
        });

        result.unshift(blank);

        return result;
    }

    function addWorkbook(promise) {
        let d = that.data;
        let workbook = models.workbook();
        let feather = catalog.getFeather(d.feather());
        let naturalKey;
        let labelKey;
        let data = {
            name: d.name(),
            description: d.description(),
            icon: d.icon(),
            module: d.module(),
            defaultConfig: [{
                name: d.feather(),
                feather: d.feather(),
                list: {
                    columns: []
                }
            }],
            localConfig: []
        };
        let dlist = data.defaultConfig[0].list;

        function callback() {
            registerWorkbook(data);
            m.route.set("/workbook/:workbook/:key", {
                workbook: d.name().toSpinalCase(),
                key: d.feather().toSpinalCase()
            });
            that.clear();
            promise.resolve();
        }

        // Find some default columns to show
        Object.keys(feather.properties).find(function (key) {
            if (feather.properties[key].isNaturalKey) {
                naturalKey = key;
                return true;
            }
        });

        if (naturalKey) {
            dlist.columns.push({
                attr: naturalKey
            });
        } else {
            dlist.columns.push({
                attr: "id"
            });
        }

        Object.keys(feather.properties).find(function (key) {
            if (feather.properties[key].isLabelKey) {
                labelKey = key;
                return true;
            }
        });

        if (labelKey) {
            dlist.columns.push({
                attr: labelKey
            });
        }

        workbook.set(data);
        workbook.save().then(callback);
    }

    that.addCalculated({
        name: "feathers",
        type: "array",
        function: theFeathers
    });

    that.addCalculated({
        name: "modules",
        type: "array",
        function: modules
    });

    that.state().resolve("/Ready/New").event("save", addWorkbook);

    return that;
}

// Load catalog and process models
function initPromises() {
    loadCatalog = new Promise(function (resolve) {

        catalog.fetch(true).then(function (data) {
            let payload = {
                method: "GET",
                path: "/settings-definition"
            };
            let initSettings = [];
            let toFetch = [];

            feathers = data;

            Object.keys(data).forEach(function (name) {
                let feather = catalog.getFeather(name);

                if (feather.isFetchOnStartup) {
                    toFetch.push(feather);
                }

                name = name.toCamelCase();

                // Implement generic function to object from model
                if (typeof models[name] !== "function") {
                    // Model instance
                    models[name] = function (data, spec) {
                        return model(data, spec || f.copy(feather));
                    };

                    // Calculated properties
                    models[name].calculated = f.prop({});

                    // Actions
                    models[name].static = f.prop({});

                    Object.freeze(models[name]);
                }
            });

            // Load settings
            datasource.request(payload).then(function (definitions) {

                // Loop through each definition and build a settings model
                // function
                definitions.forEach(function (definition) {
                    let name = definition.name;

                    // Implement generic function to object from model
                    if (typeof models[name] !== "function") {
                        // Model instance
                        models[name] = function () {
                            return settings(definition);
                        };
                    }

                    // Allow retrieving of definition directly from object
                    models[name].definition = function () {
                        return definition;
                    };

                    // Instantiate settings models
                    initSettings.push(new Promise(function (presolve) {
                        models[name]().fetch().then(presolve);
                    }));
                });

                // Global settings get a special model
                let gs = models.globalSettings;
                function globalSettings(data) {
                    let gsm = gs(data);
                    let d = gsm.data;

                    function handleReadOnly() {
                        let isNotSmtp = d.smtpType() !== "SMTP";
                        d.smtpHost.isReadOnly(isNotSmtp);
                        d.smtpPassword.isReadOnly(isNotSmtp);
                        d.smtpUser.isReadOnly(isNotSmtp);
                        d.smtpPort.isReadOnly(isNotSmtp);
                        d.smtpSecure.isReadOnly(isNotSmtp);
                    }
                    gsm.onChanged("smtpType", handleReadOnly);
                    gsm.onChanged("smtpType", function () {
                        if (d.smtpType() !== "SMTP") {
                            d.smtpHost("");
                            d.smtpPassword("");
                            d.smtpUser("");
                        }
                    });
                    handleReadOnly();

                    return gsm;
                }
                globalSettings.definition = gs.definition;

                f.catalog().registerModel("GlobalSettings", globalSettings);

                // Load data as indicated
                function fetchData() {
                    toFetch.forEach(function (feather) {
                        let list = f.createList(feather.name, {
                            subscribe: true,
                            fetch: false,
                            showDeleted: true
                        });
                        let prop = f.prop(list);

                        catalog.register(
                            "data",
                            feather.plural.toCamelCase(),
                            prop
                        );
                        list.defaultLimit(undefined);
                        preFetch.push(prop);
                    });

                    resolve();
                }

                Promise.all(initSettings).then(fetchData);
            });
        });
    });

    // Load forms
    loadForms = new Promise(function (resolve) {
        let payload = {
            method: "POST",
            path: "/data/forms",
            body: {
                subscription: {
                    id: formsSid,
                    eventKey: catalog.eventKey()
                }
            }
        };

        datasource.request(payload).then(function (data) {
            catalog.register("subscriptions", formsSid, data);
            catalog.register("data", "forms", f.prop(data));
            resolve();
        });
    });

    // Load modules
    loadModules = new Promise(function (resolve) {
        let payload = {
            method: "POST",
            path: "/data/modules",
            body: {
                subscription: {
                    id: moduleSid,
                    eventKey: catalog.eventKey()
                },
                properties: ["id", "name", "script", "version", "dependencies"]
            }
        };


        datasource.request(payload).then(function (data) {
            let mapped;

            moduleData = data;
            catalog.register("subscriptions", moduleSid, moduleData);

            // Resolve dependencies back to array for easier handling
            moduleData.forEach(function (module) {
                if (module.dependencies) {
                    module.dependencies = module.dependencies.map(
                        function (dep) {
                            return dep.module.name;
                        }
                    );
                } else {
                    module.dependencies = [];
                }
                if (module.name === "Core") {
                    f.version(module.version);
                }
            });

            mapped = moduleData.map(function (mod) {
                return {
                    value: mod.name,
                    label: mod.name
                };
            }).sort(function (a, b) {
                if (a.value > b.value) {
                    return 1;
                }

                return -1;
            });

            mapped.unshift({
                value: "",
                label: ""
            });

            catalog.register(
                "data",
                "modules",
                f.prop(mapped)
            );

            resolve();
        });
    });

    // Load profile
    loadProfile = new Promise(function (resolve) {
        let payload = {
            method: "GET",
            path: "/profile"
        };

        datasource.request(payload).then(function (resp) {
            catalog.register("data", "profile", f.prop(resp));
            resolve();
        });
    });

    // Load workbooks
    loadWorkbooks = new Promise(function (resolve) {
        let payload = {
            method: "GET",
            path: "/workbooks/"
        };

        datasource.request(payload).then(function (data) {
            workbookData = data;
            resolve();
        });
    });

    // Load navigation categories -- the ribbon's category tabs, which
    // are rows the user maintains rather than a hard-coded table
    // (John, Oct 2026). See ribbon.js's vm.categories().
    loadNavigationCategories = new Promise(function (resolve) {
        datasource.request({
            method: "GET",
            path: "/navigation-categories/"
        }).then(function (data) {
            catalog.register(
                "data",
                "navigationCategories",
                f.prop(data)
            );
            resolve();
        });
    });
}

/**
    Re-read the navigation categories and redraw, so the ribbon picks
    up tabs added, renamed or removed in the maintenance dialog
    without a browser refresh.
    @method refreshNavigationCategories
    @return {Promise}
*/
function refreshNavigationCategories() {
    return datasource.request({
        method: "GET",
        path: "/navigation-categories/"
    }).then(function (data) {
        catalog.store().data().navigationCategories(data);
        m.redraw();
    });
}

function initApp() {
    let keys = Object.keys(feathers);

    initialized = true;

    function resolveDependencies(module, dependencies) {
        dependencies = dependencies || module.dependencies;

        module.dependencies.forEach(function (dependency) {
            let parent = moduleData.find(
                (module) => module.name === dependency
            );

            parent.dependencies.forEach(
                (pDepencency) => dependencies.push(pDepencency)
            );

            resolveDependencies(parent, dependencies);
        });
    }

    // Process modules, start by resolving, then sorting on dependencies
    moduleData.forEach((module) => resolveDependencies(module));
    moduleData = (function () {
        let module;
        let idx;
        let ret = [];

        function top(mod) {
            return mod.dependencies.every(
                (dep) => ret.some((added) => added.name === dep)
            );
        }

        while (moduleData.length) {
            module = moduleData.find(top);

            ret.push(module);
            idx = moduleData.indexOf(module);
            moduleData.splice(idx, 1);
        }

        return ret;
    }());

    moduleData.forEach(function (module) {
        try {
            new Function("f", "\"use strict\";" + module.script)(f);
        } catch (e) {
            console.error(e);
        }
    });

    // Propagate static functions to child classes
    keys.forEach(function (key) {
        feathers[key].children = {};
    });

    keys.forEach(function (key) {
        let parent = feathers[key].inherits || "Object";

        feathers[parent].children[key] = feathers[key];
    });

    delete feathers.Object.children.Object;

    function subclass(name, parent) {
        let feather = feathers[name];
        let funcs = Object.keys(parent.static());
        let calculated = Object.keys(parent.calculated());

        Object.keys(feather.children).forEach(function (name) {
            let child = models[name.toCamelCase()];

            // Inherit static functions
            funcs.forEach(function (func) {
                child.static()[func] = child.static()[func] ||
                parent.static()[func];
            });

            // Inherit calculated properties
            calculated.forEach(function (prop) {
                child.calculated()[prop] = child.calculated()[prop] ||
                parent.calculated()[prop];
            });

            subclass(name, child);
        });
    }

    subclass("Object", models.object);

    // Set up money as special feather,
    // but there will be no corresponding model.
    // Only to help build filters, displays etc.
    catalog.register("feathers", "Money", {
        name: "Money",
        isSystem: true,
        description: "Money definition",
        properties: {
            amount: {
                description: "Natural key",
                type: "number"
            },
            currency: {
                description: "Natural key",
                type: "string"
            },
            effective: {
                description: "Effective time",
                type: "date",
                format: "dateTime"
            },
            baseAmount: {
                description: "Amount in base currency",
                type: "number"
            }
        }
    });

    // Process workbooks
    workbookData.forEach(registerWorkbook);

    preFetch.forEach(function (ary) {
        // No limit on fetch
        fetchRequests.push(ary().fetch({}));
    });
    Promise.all(fetchRequests).then(function () {
        isAdmin = (
            f.currentUser().isAdmin ||
            f.currentUser().isSuper
        );
        /*
            Administering the organization is standing in the manager,
            not a role in this instance: somebody appointed over it has
            no local authority until given some, so the instance's own
            flags alone shut them out of the very screens that exist to
            give it (John, Oct 2026). The server decides what each
            screen then lets them do.
        */
        canAdminister = (
            isAdmin ||
            f.currentUser().isOrgAdmin === true ||
            f.currentUser().isPlatformAdmin === true
        );

        // Menu. The ribbon (ribbon.js) replaces the sidebar navigator
        // in the horizontal-menu rework; navigator-menu.js is left in the
        // tree unused, so swapping these two lines back restores it.
        menu = viewModels.ribbon();

        // Account actions (Info / Password / Sign Out), now buttons in
        // the ribbon's Home tab Accounts group rather than a dropdown
        // (John, Oct 2026). Created once here, same as the dialogs
        // below, rather than per-render, so its dialogs keep their
        // state across redraws.
        acctMenu = viewModels.accountMenu();

        // View model for adding workbooks.
        addWorkbookViewModel = viewModels.formDialog({
            icon: "add",
            title: "Add new workbook",
            model: addWorkbookModel(),
            config: addWorkbookConfig
        });

        // View model for adding workbooks from template
        let lastError = f.prop("");
        let selId = f.createId();

        function isValid(delOnly) {
            let names = Object.keys(workbooks);
            if (!template()) {
                lastError("A template must be selected");
                return false;
            }
            if (!delOnly) {
                if (!newname()) {
                    lastError("Name is required");
                    return false;
                }
                if (names.some((n) => workbooks[n].data.name() === newname())) {
                    lastError("Name is already used");
                    return false;
                }
            }
            lastError("");
            return true;
        }
        addWbFromTemplateDlg = viewModels.dialog({
            icon: "library_add",
            title: "Add workbook using a template"
        });
        addWbFromTemplateDlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: selId
                    }, "Template:"),
                    m("select", {
                        id: selId,
                        onchange: (e) => template(e.target.value),
                        value: template()
                    }, templates())
                ]),
                m("div", {class: "pure-control-group"}, [
                    m("label", {}, "Workbook Name:"),
                    m("input", {
                        onchange: (e) => newname(e.target.value),
                        value: newname(),
                        autocomplete: "off"
                    })
                ])
            ]);
        };
        addWbFromTemplateDlg.onOk(async function () {
            let name = template().toSpinalCase().toCamelCase();
            let data = workbooks[name].toJSON();
            data.id = f.createId();
            data.name = newname();
            data.label = "";
            data.isTemplate = false;
            let opts = {
                workbook: data.name.toSpinalCase(),
                key: data.defaultConfig[0].name.toSpinalCase()
            };

            // Instantiate copy
            let newWb = f.catalog().store().models().workbook();
            newWb.set(data);
            // Save it to server
            await newWb.save();
            newWb.checkUpdate();
            // Add to menu
            registerWorkbook(data);
            // Go there
            m.route.set("/workbook/:workbook/:key", opts);
        });
        addWbFromTemplateDlg.buttonOk().isDisabled = () => !isValid();
        addWbFromTemplateDlg.buttonOk().title = function () {
            if (!isValid()) {
                return lastError();
            }
        };

        // View model for deleting workbook templates
        deleteWbTemplateDlg = viewModels.dialog({
            icon: "playlist_remove",
            title: "Delete workbook template"
        });
        deleteWbTemplateDlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: selId
                    }, "Template:"),
                    m("select", {
                        id: selId,
                        onchange: (e) => template(e.target.value),
                        value: template()
                    }, templates())
                ])
            ]);
        };
        deleteWbTemplateDlg.onOk(async function () {
            let name = template().toSpinalCase().toCamelCase();
            await workbooks[name].delete(true);
            f.catalog().unregister("workbooks", name);
        });
        deleteWbTemplateDlg.buttonOk().isDisabled = () => !isValid(true);
        deleteWbTemplateDlg.buttonOk().title = function () {
            if (!isValid(true)) {
                return lastError();
            }
        };
        deleteWbTemplateDlg.buttonOk().label("Delete");
        deleteWbTemplateDlg.buttonOk().style().background = "red";
        deleteWbTemplateDlg.buttonOk().class("fb-button-delete");

        /*
            View model for the dashboard's reporting date. Empty means
            today, which is both the default and the way back from a
            pinned date -- a second control to unpin would be a second
            thing to explain.
        */
        asOfDlg = viewModels.dialog({
            icon: "event",
            title: "Dashboard reporting date"
        });
        asOfDlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: asOfId
                    }, "As of:"),
                    m("input", {
                        id: asOfId,
                        type: "date",
                        onchange: (e) => asOfPending(e.target.value),
                        value: asOfPending()
                    })
                ]),
                m("div", {
                    class: "fb-dialog-note"
                }, (
                    "Leave this empty to report as of today. A fixed " +
                    "date is what makes year-to-date figures and " +
                    "prior-year comparisons worth showing on a " +
                    "database whose sample data sits in another year."
                ))
            ]);
        };
        /*
            The metrics list on the Add Tile dialog: what is available
            on the left, what the tile actually shows on the right.

            Checkboxes said which metrics were on a tile but nothing
            about the order its rows appear in -- that was whatever
            order the boxes happened to be ticked in, so a tile read
            as arbitrary and there was no way to change it (John, Oct
            2026). The right-hand list IS the tile, top to bottom:
            drag a row within it, or use the arrows, and the tile
            follows.

            Left is one flat alphabetical list of "Group - Metric".
            The prefix carries the grouping the old module headings
            did, and sorting the whole label keeps one contributor's
            metrics together anyway, so the headings are redundant.
            The filter narrows the left list only -- what is already
            chosen is never hidden, since a filter that hides
            somebody's work loses it silently.

            Several rows can be taken at once (ctrl or cmd click to
            add one, shift click for a run), because moving a dozen
            metrics one at a time is the thing this replaces.
        */
        function metricsPicker(offered) {
            let needle = addTileFilter().trim().toLowerCase();
            let chosen = addTileKpis();
            let byKey = {};
            let avail;

            offered.forEach(function (kpi) {
                byKey[kpi.key] = kpi;
            });

            // A metric names its contributor as well as itself: two
            // packages may well both ship an "On Time Completions".
            function label(key) {
                let kpi = byKey[key];

                if (!kpi) {
                    return key;
                }
                return (
                    (kpi.group || kpi.module || "Other") + " - " + kpi.label
                );
            }

            avail = offered.map(function (kpi) {
                return kpi.key;
            }).filter(function (key) {
                return chosen.indexOf(key) === -1;
            }).filter(function (key) {
                return (
                    !needle || label(key).toLowerCase().indexOf(needle) > -1
                );
            }).sort(function (a, b) {
                return label(a).localeCompare(label(b));
            });

            /*
                Puts `keys` into the chosen list at `at`, whether they
                come from the left list or are being shuffled within
                the right one -- the two are the same operation, since
                a key can only be in one list at a time. `from` says
                which order the moved rows keep among themselves: the
                left list's alphabetical one, or the order they
                already sit in on the right.
            */
            function moveTo(keys, at, from) {
                let kept = chosen.filter(function (key) {
                    return keys.indexOf(key) === -1;
                });
                // Pulling rows out from above the drop point shifts it.
                let lifted = chosen.slice(0, at).filter(function (key) {
                    return keys.indexOf(key) > -1;
                }).length;
                let where = at - lifted;
                let ordered = (
                    from === "avail"
                    ? avail
                    : chosen
                ).filter(function (key) {
                    return keys.indexOf(key) > -1;
                });

                if (!ordered.length) {
                    return;
                }
                addTileKpis(
                    kept.slice(0, where).concat(ordered, kept.slice(where))
                );
                addTileAvailSel([]);
                addTileChosenSel(ordered);
            }

            function take(keys) {
                let ordered = chosen.filter(function (key) {
                    return keys.indexOf(key) > -1;
                });

                if (!ordered.length) {
                    return;
                }
                addTileKpis(chosen.filter(function (key) {
                    return keys.indexOf(key) === -1;
                }));
                addTileChosenSel([]);
                addTileAvailSel(ordered);
            }

            /*
                Moves every selected row one place up or down, as a
                block: a row stays put when the place it would go to
                is off the end or is itself selected, which is what
                keeps a multiple-row selection together at the edges.
            */
            function nudge(delta) {
                let next = chosen.slice();
                let sel = addTileChosenSel();
                let order = next.map(function (ignore, idx) {
                    return idx;
                });

                if (delta > 0) {
                    order.reverse();
                }
                order.forEach(function (idx) {
                    let to = idx + delta;
                    let key = next[idx];

                    if (
                        sel.indexOf(key) > -1 &&
                        to >= 0 && to < next.length &&
                        sel.indexOf(next[to]) === -1
                    ) {
                        next[idx] = next[to];
                        next[to] = key;
                    }
                });
                addTileKpis(next);
            }

            function canNudge(delta) {
                let sel = addTileChosenSel();

                return sel.length > 0 && sel.some(function (key) {
                    let to = chosen.indexOf(key) + delta;

                    return (
                        to >= 0 && to < chosen.length &&
                        sel.indexOf(chosen[to]) === -1
                    );
                });
            }

            /*
                Click to select, ctrl or cmd click to add one, shift
                click for a run from the last plain click.
            */
            function clicked(e, key, list, selProp, anchorProp) {
                let sel = selProp();
                let from = list.indexOf(anchorProp());
                let to = list.indexOf(key);

                if (e.shiftKey && from > -1) {
                    selProp(list.slice(
                        Math.min(from, to),
                        Math.max(from, to) + 1
                    ));
                } else if (e.ctrlKey || e.metaKey) {
                    selProp(
                        sel.indexOf(key) > -1
                        ? sel.filter((one) => one !== key)
                        : sel.concat([key])
                    );
                    anchorProp(key);
                } else {
                    selProp([key]);
                    anchorProp(key);
                }
            }

            // Dragging anything not already selected takes that row
            // alone, the way a file manager does.
            function dragging(key, selProp) {
                let sel = selProp();

                return (
                    sel.indexOf(key) > -1
                    ? sel
                    : [key]
                );
            }

            function markDrop(e, side, at) {
                let drop = addTileDrop();

                e.preventDefault();
                if (drop && drop.side === side && drop.at === at) {
                    // dragover fires continuously; only a change is
                    // worth a redraw.
                    e.redraw = false;
                    return;
                }
                addTileDrop({side, at});
            }

            function row(key, side, idx) {
                let isChosen = side === "chosen";
                let siblings = (
                    isChosen
                    ? chosen
                    : avail
                );
                let selProp = (
                    isChosen
                    ? addTileChosenSel
                    : addTileAvailSel
                );
                let anchorProp = (
                    isChosen
                    ? addTileChosenAnchor
                    : addTileAvailAnchor
                );
                let drop = addTileDrop();
                let classes = ["fb-dual-row"];

                if (selProp().indexOf(key) > -1) {
                    classes.push("fb-dual-row-selected");
                }
                if (isChosen && drop && drop.side === "chosen") {
                    if (drop.at === idx) {
                        classes.push("fb-dual-row-drop-before");
                    }
                    if (drop.at === idx + 1 && idx === chosen.length - 1) {
                        classes.push("fb-dual-row-drop-after");
                    }
                }
                return m("li", {
                    class: classes.join(" "),
                    draggable: true,
                    key,
                    title: label(key),
                    onclick: function (e) {
                        clicked(e, key, siblings, selProp, anchorProp);
                    },
                    ondblclick: function () {
                        if (isChosen) {
                            take([key]);
                        } else {
                            moveTo([key], chosen.length, "avail");
                        }
                    },
                    ondragstart: function (e) {
                        let moved = dragging(key, selProp);

                        selProp(moved);
                        addTileDragFrom(side);
                        // Firefox will not start a drag without this.
                        e.dataTransfer.setData("text/plain", moved.join(" "));
                        e.dataTransfer.effectAllowed = "move";
                    },
                    ondragend: function (e) {
                        addTileDragFrom(null);
                        addTileDrop(null);
                        e.redraw = false;
                    },
                    ondragover: function (e) {
                        let half = e.currentTarget.getBoundingClientRect();
                        let after = e.clientY > half.top + half.height / 2;

                        markDrop(e, side, (
                            isChosen
                            ? idx + Number(after)
                            : 0
                        ));
                    },
                    ondrop: function (e) {
                        let from = addTileDragFrom();
                        let landing = addTileDrop();

                        e.preventDefault();
                        e.stopPropagation();
                        if (isChosen) {
                            moveTo(
                                (
                                    from === "chosen"
                                    ? addTileChosenSel()
                                    : addTileAvailSel()
                                ),
                                (
                                    landing
                                    ? landing.at
                                    : chosen.length
                                ),
                                from
                            );
                        } else if (from === "chosen") {
                            take(addTileChosenSel());
                        }
                        addTileDragFrom(null);
                        addTileDrop(null);
                    }
                }, label(key));
            }

            function list(side, keys, empty) {
                let isChosen = side === "chosen";

                return m("ul", {
                    class: (
                        (
                            addTileDrop() &&
                            addTileDrop().side === side &&
                            addTileDragFrom() &&
                            addTileDragFrom() !== side
                        )
                        ? "fb-dual-list fb-dual-list-over"
                        : "fb-dual-list"
                    ),
                    // Dropping below the last row, on the empty part
                    // of the box, means the end of the list.
                    ondragover: (e) => markDrop(e, side, keys.length),
                    ondrop: function (e) {
                        let from = addTileDragFrom();

                        e.preventDefault();
                        if (isChosen && from === "avail") {
                            moveTo(addTileAvailSel(), chosen.length, "avail");
                        } else if (isChosen) {
                            moveTo(
                                addTileChosenSel(),
                                chosen.length,
                                "chosen"
                            );
                        } else if (from === "chosen") {
                            take(addTileChosenSel());
                        }
                        addTileDragFrom(null);
                        addTileDrop(null);
                    }
                }, (
                    keys.length
                    ? keys.map(function (key, idx) {
                        return row(key, side, idx);
                    })
                    : m("li", {class: "fb-dual-empty"}, empty)
                ));
            }

            function arrow(icon, hint, why, disabled, onclick) {
                return m("button[type=button]", {
                    class: (
                        disabled
                        ? "pure-button fb-icon-only fb-button-disabled"
                        : "pure-button fb-icon-only"
                    ),
                    disabled,
                    title: (
                        disabled
                        ? why
                        : hint
                    ),
                    onclick
                }, f.icon(icon, "fb-button-icon"));
            }

            return m("div", {class: "fb-dual"}, [
                m("div", {class: "fb-dual-side"}, [
                    m("div", {class: "fb-dual-label"}, "Available"),
                    m("input", {
                        class: "fb-dialog-picker-filter",
                        type: "search",
                        placeholder: "Filter metrics",
                        oninput: function (e) {
                            addTileFilter(e.target.value);
                            addTileAvailSel([]);
                        },
                        value: addTileFilter()
                    }),
                    list("avail", avail, (
                        needle
                        ? "No metric matches that."
                        : "Every metric is on the tile."
                    )),
                    m("div", {class: "fb-dual-note"}, arrow(
                        "arrow_forward",
                        "Put the selected metrics on the tile",
                        "Select a metric on the left first",
                        !addTileAvailSel().length,
                        () => moveTo(
                            addTileAvailSel(),
                            chosen.length,
                            "avail"
                        )
                    ))
                ]),
                m("div", {class: "fb-dual-side"}, [
                    m("div", {class: "fb-dual-label"}, "On the tile"),
                    m("div", {
                        class: "fb-dual-hint"
                    }, "Top to bottom, as the tile shows them"),
                    list("chosen", chosen, "Nothing on this tile yet."),
                    m("div", {class: "fb-dual-note"}, [
                        arrow(
                            "arrow_back",
                            "Take the selected metrics off the tile",
                            "Select a metric on the right first",
                            !addTileChosenSel().length,
                            () => take(addTileChosenSel())
                        ),
                        m("span", {class: "fb-toolbar-fill"}),
                        arrow(
                            "arrow_upward",
                            "Move up",
                            (
                                addTileChosenSel().length
                                ? "Already at the top"
                                : "Select a metric on the right first"
                            ),
                            !canNudge(-1),
                            () => nudge(-1)
                        ),
                        arrow(
                            "arrow_downward",
                            "Move down",
                            (
                                addTileChosenSel().length
                                ? "Already at the bottom"
                                : "Select a metric on the right first"
                            ),
                            !canNudge(1),
                            () => nudge(1)
                        )
                    ])
                ])
            ]);
        }

        /*
            View model for removing a saved layout, shaped like the
            workbook template one above: a list to choose from and a red
            confirm, rather than a control on the board itself, because
            deleting a layout others may be using is not a thing to do
            by brushing against it.

            The service decides whether it is allowed, so a refusal is
            shown rather than guessed at here.
        */
        deleteLayoutErrDlg = viewModels.dialog({
            icon: "error",
            title: "Error"
        });
        deleteLayoutDlg = viewModels.dialog({
            icon: "playlist_remove",
            title: "Delete dashboard layout"
        });
        deleteLayoutDlg.content = function () {
            let listed = catalog.store().global().dashboardLayouts;
            let rows = (
                listed
                ? listed()
                : []
            );

            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: layoutDeleteId
                    }, "Layout:"),
                    m("select", {
                        id: layoutDeleteId,
                        onchange: (e) => layoutToDelete(e.target.value),
                        value: layoutToDelete()
                    }, [
                        // Named, not blank: an empty first row reads
                        // as a glitch rather than as "nothing chosen".
                        m("option", {value: ""}, "(choose a layout)")
                    ].concat(rows.map(function (row) {
                        return m("option", {
                            value: row.name
                        }, (
                            row.isDefault
                            ? row.label + " (default)"
                            : row.label
                        ));
                    })))
                ]),
                m("div", {
                    class: "fb-dialog-note"
                }, (
                    "A layout belongs to whoever saved it. Anyone still " +
                    "using one that is deleted falls back to the " +
                    "default."
                ))
            ]);
        };
        deleteLayoutDlg.onOk(function () {
            let remove = catalog.store().global().dashboardDeleteLayout;

            if (!remove || !layoutToDelete()) {
                return;
            }
            remove(layoutToDelete()).catch(function (err) {
                deleteLayoutErrDlg.message(err.message);
                deleteLayoutErrDlg.show();
            });
        });
        deleteLayoutDlg.buttonOk().label("Delete");
        deleteLayoutDlg.buttonOk().style().background = "red";
        deleteLayoutDlg.buttonOk().class("fb-button-delete");
        deleteLayoutDlg.buttonOk().isDisabled = () => !layoutToDelete();
        deleteLayoutDlg.buttonOk().title = function () {
            if (!layoutToDelete()) {
                return "Choose a layout to delete";
            }
        };

        /*
            View model for putting a tile on the board.

            Everything it offers comes from what has registered: the
            sources, the questions each one accepts, and the metrics a
            Key Metrics tile can hold. Nothing here knows what revenue,
            a region or a user count is, which is what lets a package
            contribute a tile type without the framework being taught
            about it.
        */
        addTileErrDlg = viewModels.dialog({
            icon: "error",
            title: "No room"
        });
        addTileDlg = viewModels.dialog({
            icon: "add_chart",
            title: "Add tile"
        });
        addTileDlg.style().width = "520px";
        addTileDlg.content = function () {
            let choices = catalog.store().global().dashboardTileChoices;
            let offer = (
                choices
                ? choices()
                : {kpis: [], sources: []}
            );
            let picked = offer.sources.find(
                (one) => one.key === addTileWhat()
            );
            let schedules = offer.schedules || [];
            let parts = [];

            // Two lists side by side want more room than one column
            // of fields. Set here rather than once at creation
            // because it depends on what the dialog is showing, and
            // the dialog reads its style after asking for content.
            addTileDlg.style().width = (
                addTileWhat() === ADD_TILE_KPIS
                ? "760px"
                : "520px"
            );

            function group(label, control) {
                return m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", label),
                    control
                ]);
            }

            parts.push(m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: addTileId
                }, "Show:"),
                m("select", {
                    id: addTileId,
                    onchange: function (e) {
                        addTileWhat(e.target.value);
                        // A time axis wants width.
                        if (
                            e.target.value === ADD_TILE_HIST &&
                            addTileSize() === "medium"
                        ) {
                            addTileSize("wide");
                        }
                        // The questions belong to the source that was
                        // chosen, so answers to the last one's are not
                        // carried over.
                        addTileOpts({});
                    },
                    value: addTileWhat()
                }, [
                    m("option", {
                        value: ADD_TILE_KPIS
                    }, "Key metrics")
                ].concat(
                    schedules.length
                    ? [m("option", {
                        value: ADD_TILE_HIST
                    }, "Due dates (histogram)")]
                    : []
                ).concat(offer.sources.map(function (one) {
                    return m("option", {
                        value: one.key
                    }, one.label + " (" + one.module + ")");
                })))
            ]));

            parts.push(group("Title:", m("input", {
                oninput: (e) => addTileHeading(e.target.value),
                placeholder: "Named from its settings",
                value: addTileHeading()
            })));

            if (addTileWhat() === ADD_TILE_KPIS) {
                parts.push(m("div", {
                    class: "pure-control-group fb-dialog-wide-group"
                }, [
                    m("label", "Metrics:"),
                    metricsPicker(offer.kpis)
                ]));
            } else if (addTileWhat() === ADD_TILE_HIST) {
                parts.push(group("Orders:", m(
                    "div",
                    {class: "fb-dialog-picker-list"},
                    schedules.map(function (one) {
                        let held = addTileSchedules();

                        return m("label", [
                            m("input", {
                                type: "checkbox",
                                checked: held.indexOf(one.key) !== -1,
                                onchange: function (e) {
                                    let next = held.filter(
                                        (key) => key !== one.key
                                    );

                                    if (e.target.checked) {
                                        next.push(one.key);
                                    }
                                    // Keep registration order, so the
                                    // side-by-side order never shuffles.
                                    addTileSchedules(schedules.map(
                                        (sched) => sched.key
                                    ).filter(
                                        (key) => next.indexOf(key) !== -1
                                    ));
                                }
                            }),
                            " " + one.label
                        ]);
                    })
                )));
                parts.push(group("Buckets:", m("select", {
                    onchange: (e) => addTileBucket(e.target.value),
                    value: addTileBucket()
                }, ADD_TILE_BUCKETS.map(function (one) {
                    return m("option", {value: one.value}, one.label);
                }))));
                parts.push(group("Values:", m("select", {
                    onchange: (e) => addTileValue(e.target.value),
                    value: addTileValue()
                }, [
                    m("option", {value: "amount"}, "Money"),
                    m("option", {value: "units"}, "Quantity")
                ])));
                parts.push(group("Max horizon:", m("input", {
                    type: "number",
                    min: "1",
                    step: "1",
                    placeholder: "Default",
                    oninput: (e) => addTileMaxHorizon(e.target.value),
                    value: addTileMaxHorizon()
                })));
                parts.push(m("div", {
                    class: "fb-dialog-note"
                }, (
                    "How many " + ADD_TILE_HORIZON_NOUNS[addTileBucket()] +
                    " ahead to show, at most -- orders due later are " +
                    "folded into the \"After\" total instead of adding " +
                    "more buckets. Leave this empty for the usual window."
                )));
            } else if (picked) {
                picked.options.forEach(function (option) {
                    let held = addTileOpts();
                    let now = (
                        held[option.key] === undefined
                        ? option.default
                        : held[option.key]
                    );

                    parts.push(group(option.label + ":", m("select", {
                        onchange: function (e) {
                            let next = Object.assign({}, addTileOpts());

                            next[option.key] = e.target.value;
                            addTileOpts(next);
                        },
                        value: now
                    }, option.choices.map(function (choice) {
                        return m("option", {
                            value: choice.value
                        }, choice.label);
                    }))));
                });

                parts.push(group("Chart:", m("select", {
                    onchange: (e) => addTileDisplay(e.target.value),
                    value: addTileDisplay()
                }, [
                    m("option", {value: "bullets"}, "Bars with comparison"),
                    m("option", {value: "bars"}, "Ranked bars"),
                    m("option", {value: "table"}, "Numbers only"),
                    m("option", {
                        value: "multiples"
                    }, "Small multiples, a year each")
                ])));

                // For a tile beside another sorted by name.
                parts.push(group("Hide names:", m("input", {
                    type: "checkbox",
                    checked: addTileHideNames(),
                    onchange: (e) => addTileHideNames(e.target.checked)
                })));

                parts.push(group("History:", m("input", {
                    type: "checkbox",
                    checked: addTileSpark(),
                    onchange: (e) => addTileSpark(e.target.checked)
                })));
            }

            if (
                addTileTarget() === "auto" &&
                addTileWhat() !== ADD_TILE_KPIS
            ) {
                addTileTarget("history");
            }
            // A histogram is not judged against anything.
            if (addTileWhat() !== ADD_TILE_HIST) {
                parts.push(group("Judged:", m("select", {
                    onchange: function (e) {
                        addTileTarget(e.target.value);
                    },
                    value: addTileTarget()
                }, ADD_TILE_TARGETS.filter(function (one) {
                    // Stored targets exist only for metrics.
                    return (
                        one.value !== "auto" ||
                        addTileWhat() === ADD_TILE_KPIS
                    );
                }).map(function (one) {
                    return m("option", {
                        value: one.value
                    }, one.label);
                }))));

                if (addTileTarget() === "growth") {
                    parts.push(group("Percent:", m("input", {
                        type: "number",
                        step: "1",
                        oninput: (e) => addTileTargetValue(e.target.value),
                        value: addTileTargetValue()
                    })));
                }

                if (addTileTarget() === "fixed") {
                    parts.push(group("Target:", m("input", {
                        type: "number",
                        oninput: (e) => addTileTargetValue(e.target.value),
                        value: addTileTargetValue()
                    })));
                }
            }

            /*
                Size is asked only when adding. A tile already on the
                board has been put where it is and sized by hand, and
                answering this question again would undo both -- every
                edit snapping it back to a preset and shoving its
                neighbours out of the way (John, Oct 2026). Drag its
                corner to resize it.
            */
            if (!addTileEditingId()) {
                parts.push(group("Size:", m("select", {
                    onchange: (e) => addTileSize(e.target.value),
                    value: addTileSize()
                }, ADD_TILE_SIZES.map(function (size) {
                    return m("option", {
                        value: size.value
                    }, size.label);
                }))));
            }

            parts.push(m("div", {
                class: "fb-dialog-note"
            }, (
                "The tile appears straight away. Nothing is kept until " +
                "you save the layout."
            )));

            return m("div", {
                class: "pure-form pure-form-aligned"
            }, parts);
        };
        addTileDlg.onOk(function () {
            let editingId = addTileEditingId();
            let add = catalog.store().global().dashboardAddTile;
            let update = catalog.store().global().dashboardUpdateTile;
            let size = ADD_TILE_SIZES.find(
                (one) => one.value === addTileSize()
            );
            // Editing says nothing about size, so the tile keeps the one
            // it has -- see the dialog's own note above.
            let tile = (
                editingId
                ? {}
                : {cols: size.cols, rows: size.rows}
            );
            let placed;

            if (editingId) {
                if (!update) {
                    return;
                }
            } else if (!add) {
                return;
            }

            tile.targetMode = addTileTarget();
            if (
                addTileTarget() === "fixed" ||
                addTileTarget() === "growth"
            ) {
                tile.targetValue = Number(addTileTargetValue());
            }

            let named = addTileHeading().trim();

            if (named) {
                tile.heading = named;
            }
            if (addTileWhat() === ADD_TILE_KPIS) {
                tile.type = "kpi";
                tile.heading = named || "Key Metrics";
                tile.kpis = addTileKpis();
            } else if (addTileWhat() === ADD_TILE_HIST) {
                tile.type = "histogram";
                tile.schedules = addTileSchedules();
                tile.bucket = addTileBucket();
                tile.value = addTileValue();
                tile.maxHorizon = (
                    Number(addTileMaxHorizon()) > 0
                    ? Number(addTileMaxHorizon())
                    : null
                );
                delete tile.targetMode;
            } else {
                tile.type = "measure";
                tile.source = addTileWhat();
                tile.display = addTileDisplay();
                tile.showSpark = addTileSpark();
                tile.hideLabels = addTileHideNames();
                // Whatever the source asked to be asked, handed back
                // as tile properties for its own load to read.
                Object.keys(addTileOpts()).forEach(function (key) {
                    tile[key] = addTileOpts()[key];
                });
            }

            placed = (
                editingId
                ? update(editingId, tile)
                : add(tile)
            );
            addTileEditingId(null);
            // Added from a workbook page, the tile is waiting on a board
            // nobody is looking at. Go and look at it.
            if (placed && m.route.get() !== "/home") {
                m.route.set("/home");
            }
            if (!placed) {
                addTileErrDlg.message(
                    editingId
                    ? "That tile could not be changed."
                    : "There is no room left on the board for a tile " +
                    "that size. Take one off, or choose a smaller size."
                );
                addTileErrDlg.show();
            }
        });
        addTileDlg.buttonOk().label("Add");
        addTileDlg.buttonOk().isDisabled = function () {
            return (
                (addTileWhat() === ADD_TILE_KPIS && !addTileKpis().length) ||
                (
                    addTileWhat() === ADD_TILE_HIST &&
                    !addTileSchedules().length
                )
            );
        };
        addTileDlg.buttonOk().title = function () {
            if (
                addTileWhat() === ADD_TILE_KPIS &&
                !addTileKpis().length
            ) {
                return "Choose at least one metric";
            }
            if (
                addTileWhat() === ADD_TILE_HIST &&
                !addTileSchedules().length
            ) {
                return "Choose at least one kind of order";
            }
        };

        /*
            View model for metric targets: a number, or a signed percent
            of the comparison (negative where lower is better).
        */
        targetsErrDlg = viewModels.dialog({
            icon: "error",
            title: "Error"
        });
        targetsDlg = viewModels.dialog({
            icon: "flag",
            title: "Metric targets"
        });
        targetsDlg.style().width = "680px";
        targetsDlg.content = function () {
            let kpis = catalog.store().global().dashboardKpis;
            let offered = (
                kpis
                ? kpis.list()
                : []
            );
            let needle = targetsFilter().trim().toLowerCase();
            let shown = offered.filter(function (kpi) {
                return (
                    !needle ||
                    kpi.name.toLowerCase().indexOf(needle) > -1 ||
                    String(kpi.module).toLowerCase().indexOf(needle) > -1
                );
            });
            let draft = targetsDraft();

            function entry(kpi) {
                return draft[kpi.key] || {amount: "", basis: "", better: ""};
            }

            function change(kpi, key, value) {
                let next = Object.assign({}, targetsDraft());

                next[kpi.key] = Object.assign({}, entry(kpi));
                next[kpi.key][key] = value;
                targetsDraft(next);
            }

            function row(kpi) {
                let one = entry(kpi);
                let better = one.better || kpi.better || "higher";
                let hint = (
                    one.basis === "percent"
                    ? (
                        better === "lower"
                        ? "% vs comparison, e.g. -5"
                        : "% vs comparison, e.g. 5"
                    )
                    : (
                        kpi.unit === "percent"
                        ? "e.g. 95"
                        : "target"
                    )
                );

                return m("div", {class: "fb-target-row"}, [
                    m("div", {class: "fb-target-name"}, [
                        m("span", kpi.name),
                        m("span", {class: "fb-target-module"}, kpi.module)
                    ]),
                    m("select", {
                        disabled: !isAdmin,
                        onchange: (e) => change(kpi, "basis", e.target.value),
                        value: one.basis
                    }, [
                        m("option", {value: ""}, "Prior period"),
                        m("option", {value: "fixed"}, "A number"),
                        m("option", {value: "percent"}, "A percentage")
                    ]),
                    m("input", {
                        disabled: !isAdmin || !one.basis,
                        placeholder: (
                            one.basis
                            ? hint
                            : ""
                        ),
                        step: "any",
                        type: "number",
                        oninput: (e) => change(kpi, "amount", e.target.value),
                        value: (
                            one.basis
                            ? one.amount
                            : ""
                        )
                    }),
                    m("select", {
                        disabled: !isAdmin,
                        onchange: (e) => change(kpi, "better", e.target.value),
                        title: "Which way is good for this metric",
                        value: one.better || kpi.better || "higher"
                    }, [
                        m("option", {value: "higher"}, "Higher is better"),
                        m("option", {value: "lower"}, "Lower is better")
                    ])
                ]);
            }

            return m("div", {class: "pure-form"}, [
                m("input", {
                    class: "fb-dialog-picker-filter",
                    type: "search",
                    placeholder: "Filter metrics",
                    oninput: (e) => targetsFilter(e.target.value),
                    value: targetsFilter()
                }),
                m("div", {class: "fb-target-list"}, (
                    shown.length
                    ? shown.map(row)
                    : m("div", {
                        class: "fb-dialog-picker-none"
                    }, "No metric matches that.")
                )),
                m("div", {
                    class: "fb-dialog-note"
                }, (
                    isAdmin
                    ? (
                        "A metric with no target is judged against its " +
                        "prior period. A percentage is of that prior " +
                        "period, and is negative where lower is better."
                    )
                    : (
                        "Targets are what every board showing a metric " +
                        "judges it by, so only an administrator can " +
                        "change them."
                    )
                ))
            ]);
        };
        targetsDlg.onOk(function () {
            let save = catalog.store().global().dashboardSaveTargets;
            let stored = catalog.store().global().dashboardTargets;
            let held = (
                stored
                ? stored()
                : {}
            );
            let draft = targetsDraft();
            let changes = [];

            if (!save || !isAdmin) {
                return;
            }

            Object.keys(draft).forEach(function (key) {
                let one = draft[key];
                let was = held[key];
                let basis = (
                    (one.basis && one.amount !== "")
                    ? one.basis
                    : ""
                );

                if (!basis) {
                    if (was) {
                        changes.push({metric: key});
                    }
                    return;
                }
                if (
                    was &&
                    was.basis === basis &&
                    Number(was.amount) === Number(one.amount) &&
                    (was.better || "") === (one.better || "")
                ) {
                    return;
                }
                changes.push({
                    amount: Number(one.amount),
                    basis,
                    better: one.better || null,
                    metric: key
                });
            });

            save(changes).catch(function (err) {
                targetsErrDlg.message(err.message);
                targetsErrDlg.show();
            });
        });
        targetsDlg.buttonOk().isDisabled = () => !isAdmin;
        targetsDlg.buttonOk().title = function () {
            if (!isAdmin) {
                return "Only an administrator can change targets";
            }
        };

        /*
            View model for saving the board's arrangement. The error
            dialog is its own, in the idiom of the navigation category
            dialogs above: a save that the service refused -- somebody
            else's layout, most often -- has to say so without the
            arrangement being lost behind a closed dialog.
        */
        saveLayoutErrDlg = viewModels.dialog({
            icon: "error",
            title: "Error"
        });
        saveLayoutDlg = viewModels.dialog({
            icon: "bookmark_add",
            title: "Save dashboard layout"
        });
        saveLayoutDlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: layoutNameId
                    }, "Name:"),
                    m("input", {
                        id: layoutNameId,
                        autocomplete: "off",
                        oninput: (e) => layoutName(e.target.value),
                        value: layoutName()
                    })
                ]),
                (
                    /*
                        The default is a decision about the instance --
                        what everyone without a preference sees -- so
                        only an administrator is offered it. The server
                        enforces the same rule; this just keeps the
                        dialog from offering what it would then refuse.
                    */
                    canAdminister
                    ? m("div", {
                        class: "pure-control-group"
                    }, [
                        m("label", {
                            for: layoutDefaultId
                        }, "Default:"),
                        m("input", {
                            id: layoutDefaultId,
                            type: "checkbox",
                            checked: layoutIsDefault(),
                            onchange: (e) => layoutIsDefault(e.target.checked)
                        })
                    ])
                    : null
                ),
                m("div", {
                    class: "fb-dialog-note"
                }, (
                    canAdminister
                    ? (
                        "The default layout is what anyone who has not " +
                        "chosen one sees. Saving under a new name " +
                        "leaves the old layout alone."
                    )
                    : (
                        "Saving under a new name leaves the old layout " +
                        "alone. Everyone can choose any saved layout; " +
                        "an administrator picks which one people start " +
                        "on."
                    )
                ))
            ]);
        };
        saveLayoutDlg.onOk(function () {
            let save = catalog.store().global().dashboardSaveLayout;
            let listed = catalog.store().global().dashboardLayouts;
            let rows = (
                listed
                ? listed()
                : []
            );
            let existing = rows.find(
                (row) => row.name === layoutName().trim()
            );

            if (!save) {
                return;
            }
            save({
                /*
                    A non-administrator echoes the flag as it stands:
                    sending false for a layout an administrator made
                    the default would read as demoting it, which is
                    not theirs to do and would be refused.
                */
                isDefault: (
                    canAdminister
                    ? layoutIsDefault()
                    : Boolean(existing && existing.isDefault)
                ),
                name: layoutName().trim()
            }).catch(function (err) {
                saveLayoutErrDlg.message(err.message);
                saveLayoutErrDlg.show();
            });
        });
        saveLayoutDlg.buttonOk().isDisabled = () => !layoutName().trim();
        saveLayoutDlg.buttonOk().title = function () {
            if (!layoutName().trim()) {
                return "A layout needs a name";
            }
        };

        asOfDlg.onOk(function () {
            let setAsOf = catalog.store().global().dashboardSetAsOf;

            if (setAsOf) {
                setAsOf(asOfPending() || null);
            }
        });

        // View model for maintaining navigation categories -- the
        // ribbon's tabs. Dropping down from the top of the viewport
        // started here and is now how every dialog behaves, so there
        // is nothing to ask for (John, Oct 2026).
        navCategoryErrDlg = viewModels.dialog({
            icon: "error",
            title: "Error"
        });
        navCategoryDlg = viewModels.dialog({
            icon: "dashboard_customize",
            title: "Navigation categories"
        });
        navCategoryDlg.style().width = "640px";
        navCategoryDlg.content = function () {
            return m("div", {
                class: "pure-form"
            }, [
                m("div", {
                    class: "fb-category-row fb-category-head"
                }, [
                    m("div", "Name"),
                    m("div", "Icon"),
                    m("div", "Order"),
                    m("div", "")
                ]),
                m("div", {
                    class: "fb-category-list"
                }, categoryRows()),
                // Same pick-list the workbook dialog's Icon field
                // offers: every icon name the app knows, by display
                // name (John, Oct 2026)
                m("datalist", {
                    id: "fb-category-icon-list"
                }, f.icons().map((icon) => m("option", f.iconLabel(icon)))),
                m("div", {
                    class: "fb-category-actions"
                }, [
                    m("button[type=button]", {
                        class: "pure-button",
                        title: "Add a category",
                        onclick: addCategory
                    }, [
                        f.icon("add", "fb-button-icon"),
                        m("span", {
                            class: "fb-button-label"
                        }, "Add Category")
                    ]),
                    m("span", {
                        class: "fb-category-hint"
                    }, (
                        "Workbooks with no category show under \"Other\". " +
                        "Set a workbook's category from its own " +
                        "Edit workbook dialog."
                    ))
                ])
            ]);
        };
        navCategoryDlg.onOk(function () {
            // Row position IS the tab order -- see moveCategory.
            let specs = navCategories().map(function (cat, idx) {
                return {
                    id: cat.id,
                    name: cat.name.trim(),
                    icon: cat.icon.trim(),
                    sequence: idx
                };
            });

            datasource.request({
                method: "PUT",
                path: "/navigation-categories/",
                body: specs
            }).then(
                refreshNavigationCategories
            ).catch(function (err) {
                navCategoryErrDlg.message(err.message);
                navCategoryErrDlg.show();
            });
        });
        navCategoryDlg.buttonOk().isDisabled = () => !isCategoryListValid();
        navCategoryDlg.buttonOk().title = function () {
            if (!isCategoryListValid()) {
                return lastCategoryError();
            }
        };

        // Registered globally, not just held in this module's own
        // variables, so homeDialogs and homeRibbonGroups above can
        // reach them from workbook-page.js too (John, Oct 2026).
        catalog.register("global", "acctMenu", acctMenu);
        catalog.register(
            "global",
            "addWorkbookViewModel",
            addWorkbookViewModel
        );
        catalog.register(
            "global",
            "addWbFromTemplateDlg",
            addWbFromTemplateDlg
        );
        catalog.register(
            "global",
            "deleteWbTemplateDlg",
            deleteWbTemplateDlg
        );
        catalog.register(
            "global",
            "navCategoryDlg",
            navCategoryDlg
        );
        catalog.register(
            "global",
            "navCategoryErrDlg",
            navCategoryErrDlg
        );
        catalog.register(
            "global",
            "asOfDlg",
            asOfDlg
        );
        catalog.register(
            "global",
            "saveLayoutDlg",
            saveLayoutDlg
        );
        catalog.register(
            "global",
            "saveLayoutErrDlg",
            saveLayoutErrDlg
        );
        catalog.register(
            "global",
            "addTileDlg",
            addTileDlg
        );
        catalog.register(
            "global",
            "addTileErrDlg",
            addTileErrDlg
        );
        catalog.register("global", "dashboardEditTile", openTileEditor);
        catalog.register("global", "appZoom", appZoom);
        catalog.register("global", "profileValue", profileValue);
        catalog.register("global", "profileSave", profileSave);
        catalog.register(
            "global",
            "deleteLayoutDlg",
            deleteLayoutDlg
        );
        catalog.register(
            "global",
            "deleteLayoutErrDlg",
            deleteLayoutErrDlg
        );
        catalog.register("global", "targetsDlg", targetsDlg);
        catalog.register("global", "targetsErrDlg", targetsErrDlg);

        m.route(document.body, "/home", routes);
    });
}

// Load application data
async function start() {
    if (initialized) {
        return;
    }

    applyStoredZoom();
    initPromises();
    await Promise.all([
        loadCatalog,
        loadModules,
        loadForms,
        loadProfile,
        loadWorkbooks,
        loadNavigationCategories
    ]);
    applyProfileZoom();
    initApp();
}

// Connect
function connect() {
    return new Promise(function (resolve) {
        let payload = {
            method: "POST",
            path: "/connect"
        };

        datasource.request(payload).then(resolve);
    });
}

// Make sure the path has a slash at the end
if (window.location.pathname.slice(
    window.location.pathname.length - 1,
    window.location.pathname.length
) !== "/") {
    let theUrl = (
        window.location.protocol + "//" +
        window.location.hostname + ":" +
        window.location.port +
        window.location.pathname + "/"
    );
    window.open(theUrl, "_self");
} else {
    connect().then(async function (resp) {
        let edata;
        let socket; // current WebSocket -- lets listen() be re-called to
        // reconnect, from connectionMonitor's reconnect handler, without
        // opening a duplicate (John, Oct 2026)
        let wp = (
            window.location.protocol.indexOf("s") === -1
            ? "ws://"
            : "wss://"
        );

        function listen() {
            let intentionalClose = false;
            let wsurl;
            let evsubscr;

            if (socket && socket.readyState <= 1) {
                // CONNECTING (0) or OPEN (1) already -- nothing to do.
                return;
            }

            wsurl = (
                wp + window.location.hostname +
                ":" + window.location.port +
                window.location.pathname
            );
            evsubscr = new WebSocket(wsurl);
            socket = evsubscr;

            // Connection opened
            evsubscr.onopen = function () {
                evsubscr.send(catalog.eventKey());
                connectionMonitor.setSocketUp(true);
            };

            // Listen for messages
            evsubscr.onmessage = function (e) {
                f.processEvent({
                    event: e,
                    moduleSubscrId: moduleSid,
                    formsSubscrId: formsSid
                });
            };

            // Stop listening when we sign out. We'll realign on
            // Session with a new listener when we sign back in
            f.state().resolve("/SignedOut").enter(function () {
                intentionalClose = true;
                evsubscr.close();

                // Remove this function
                f.state().resolve("/SignedOut").enters.pop();
            });

            // Houston, we've got a problem (unless we just closed this
            // ourselves to sign out). Report it to the state handler and
            // to the connection monitor, which puts up the reconnecting
            // banner (see connection-monitor.js) and, once its own
            // /api/ping probe shows the server is back, calls listen()
            // again through the reconnect handler registered below.
            evsubscr.onclose = function (e) {
                if (socket === evsubscr) {
                    socket = undefined;
                }
                if (!intentionalClose) {
                    connectionMonitor.setSocketUp(false);
                }
                sseState.send("error", e);
            };
        }

        connectionMonitor.setReconnectHandler(listen);

        if (resp.data) {
            edata = resp.data;
            catalog.register("subscriptions");

            // Listen for event changes for this instance
            catalog.eventKey(edata.eventKey);

            // Initiate event listener with key on sign in
            f.state().resolve("/SignedIn").enter(listen);
            f.state().resolve("/SignedIn/Ready").enter(function () {
                // Wait for start() rather than reload to finish it: a
                // reload loaded every catalog, form and module twice.
                starting.then(function () {
                    if (!hash || (hash === "/sign-in")) {
                        m.route.set("/home");
                        return;
                    }
                    m.route.set(hash);
                });
            });

            if (resp.data.authorized) {
                f.currentUser(edata.authorized);
                f.state().send("preauthorized");
                await start();
            } else {
                m.route(document.body, "/sign-in", routes);
                f.state().resolve("/SignedIn").enter(function () {
                    starting = start();
                });
                f.state().send("signIn");
            }
        }
    });
}

// Let displays handle their own overflow locally
document.documentElement.style.overflow = "hidden";

window.onresize = function () {
    m.redraw(true);
};
