/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    Ribbon -- the horizontal, Microsoft-Office-style menu that replaces the
    vertical navigator sidebar (navigator-menu.js).

    Two levels of navigation instead of three. A row of category tabs sits
    above a ribbon of labeled button groups:

        <category tabs>   Accounts | Workbooks (Home tab) --or--
                          Workbooks in that category | <the open workbook's
                          worksheets, as a contextual group> | ... |
                          Record | List

    Modelled on Documents/ddom's ribbon.js, which this app's palette and
    controls already follow. Differences from ddom, both at John's request
    (Oct 2026):

      - ddom's tabs are hard categories of its own screens. Featherbone has
        17 non-template workbooks in the Job Shop demo, far too many for one
        tab row, so (apart from the hard-coded Home tab, see HOME_TAB) the
        tabs are CATEGORIES OF WORKBOOKS (see WORKBOOK_CATEGORIES) and the
        workbooks themselves are the ribbon's big buttons -- the same shape
        as ddom's Data tab. Home is the one tab still hard-coded rather than
        reflective of the database; the category tabs are meant to become
        reflective too, later.
      - the worksheet actions (New / Edit / Save / Delete / Undo and the
        Sort / Filter / Aggregate list tools) move OUT of the toolbar above
        the grid and into groups at the RIGHT END of the ribbon. The toolbar
        keeps only the worksheet title and the search box.

    Behaviour borrowed from Office, same as ddom:
      - clicking a tab only changes which buttons show; it doesn't navigate.
        The tab owning the open screen keeps a dot while another is browsed,
        and the ribbon snaps back to it on navigation.
      - the ribbon collapses (chevron, or double-click a tab) to hand the
        vertical space back to the grid. While collapsed, clicking a tab
        drops the buttons down over the page until you pick one, click away,
        or press Esc.

    Routes are untouched -- every button is the same `m.route.set` the
    sidebar used, so bookmarks still work and main.js's route table is
    unchanged.

    Menu state is module-level, not per-instance, because each page builds
    its own layout and so recreates this component on navigation; the
    collapsed flag additionally persists in localStorage.

    @module Ribbon
*/

const ribbon = {};

/*
    Superseded by the "$navigation_category" table (John, Oct 2026):
    categories are rows the user maintains from Home > Workbooks >
    Categories, each workbook points at one by id, and vm.categories()
    below builds the tabs from those instead of from here. Kept, for
    now, as the record of the menu structure this app shipped with --
    the one to rebuild by hand before exporting packages, since
    nothing migrates these assignments automatically. Delete once
    those packages exist.

const WORKBOOK_CATEGORIES = [{
    key: "engineering",
    label: "Engineering",
    icon: "architecture",
    workbooks: ["Items"]
}, {
    key: "inventory",
    label: "Inventory",
    icon: "inventory_2",
    workbooks: ["Stock", "Count"]
}, {
    key: "planning",
    label: "Planning",
    icon: "event_note",
    workbooks: ["Plan", "Project", "Buy"]
}, {
    key: "production",
    label: "Production",
    icon: "precision_manufacturing",
    workbooks: ["Make", "Execute"]
}, {
    key: "delivery",
    label: "Delivery",
    icon: "local_shipping",
    workbooks: ["Sell", "Ship", "Bill", "Contacts"]
}, {
    key: "admin",
    label: "Admin",
    icon: "manage_accounts",
    workbooks: [
        "Settings", "Ship Engine", "Develop"
    ]
}];
*/

/**
    Name of the one workbook that gets its own permanent icon button
    at the ribbon's right end instead of being filed under a category
    tab -- "Alerts" isn't an admin thing, it's universal, so it needs
    to be reachable regardless of which tab is showing (John, Oct
    2026). A name, not a workbook object, since the actual Workbook
    model only exists per tenant -- see vm.alertsWorkbook() below.
*/
const OMNIPRESENT_WORKBOOK = "Alerts";

const OTHER_CATEGORY = {
    key: "other",
    label: "Other",
    icon: "more_horiz",
    workbooks: []
};

/**
    The Home tab -- hard-coded rather than reflective of the database,
    unlike the category tabs above (John, Oct 2026). Always the first
    tab; its body is whatever fixed button groups the page rendering
    the ribbon supplies via attrs.homeGroups (main.js currently
    supplies Accounts and Workbooks), not a list of workbooks.
*/
const HOME_TAB = {
    key: "home",
    label: "Home",
    icon: "home"
};

const COLLAPSED_KEY = "fb-ribbon-collapsed";

// How many hues featherbone.css cycles through for categories whose
// name has no hue of its own -- see hueIndex() in view(), below.
const HUE_COUNT = 8;

// ..........................................................
// Module-level state
//

let selectedTab;      // tab whose buttons are showing
let lastRoute;        // route selectedTab was last synced to
let popupOpen = false; // collapsed mode: buttons dropped over the page
let collapsed = (function () {
    try {
        return window.localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch (ignore) {
        return false;
    }
}());

function setCollapsed(value) {
    collapsed = value;
    popupOpen = false;
    try {
        window.localStorage.setItem(COLLAPSED_KEY, String(value));
    } catch (ignore) {
        return;
    }
}

/**
    Ribbon view model. Menu state is managed globally.
    @class Ribbon
    @constructor
    @namespace ViewModels
*/
ribbon.viewModel = function () {
    let vm = {};

    /**
        Non-template workbooks, keyed as the catalog keys them.
        @method workbooks
        @return {Object}
    */
    vm.workbooks = function () {
        let wbs = f.catalog().store().workbooks();
        let ret = {};

        Object.keys(wbs).forEach(function (key) {
            if (!wbs[key].data.isTemplate()) {
                ret[key] = wbs[key];
            }
        });

        return ret;
    };

    /**
        The navigation categories as the database has them, in
        presentation order (the server already sorts them by sequence
        then name). Read defensively: a page rendered before the
        startup fetch has finished -- or the sign-in page, which never
        fetches them -- just gets none, and every workbook falls into
        "Other".
        @method navigationCategories
        @return {Array}
    */
    vm.navigationCategories = function () {
        let cats = f.catalog().store().data().navigationCategories;

        return (
            cats
            ? cats()
            : []
        );
    };

    /**
        Categories with their workbooks resolved and ordered. Every
        defined category gets a tab, empty or not -- they're rows the
        user maintains, so one just created shouldn't vanish until
        something is filed under it. "Other" is the exception: it
        only appears when there are workbooks with no category.
        @method categories
        @return {Array}
    */
    vm.categories = function () {
        let workbooks = vm.workbooks();
        let claimed = [];
        let ret = [];
        // OMNIPRESENT_WORKBOOK has its own permanent button at the
        // ribbon's right end, so it is deliberately left out of the
        // tabs entirely -- otherwise, having no category, it would
        // also turn up under "Other" (John, Oct 2026).
        let keys = Object.keys(workbooks).filter(
            (key) => workbooks[key].data.name() !== OMNIPRESENT_WORKBOOK
        );

        function bySequence(a, b) {
            let aVal = workbooks[a].data.sequence() || 0;
            let bVal = workbooks[b].data.sequence() || 0;

            if (aVal === bVal) {
                return (
                    workbooks[a].data.name() < workbooks[b].data.name()
                    ? -1
                    : 1
                );
            }

            return aVal - bVal;
        }

        vm.navigationCategories().forEach(function (cat) {
            let mine = keys.filter(
                (key) => workbooks[key].data.category() === cat.id
            ).sort(bySequence);

            mine.forEach((key) => claimed.push(key));

            ret.push({
                key: cat.name.toSpinalCase(),
                label: cat.name,
                icon: cat.icon || "folder",
                keys: mine
            });
        });

        let rest = keys.filter(
            (key) => claimed.indexOf(key) === -1
        ).sort(bySequence);

        if (rest.length) {
            ret.push({
                key: OTHER_CATEGORY.key,
                label: OTHER_CATEGORY.label,
                icon: OTHER_CATEGORY.icon,
                keys: rest
            });
        }

        return ret;
    };

    /**
        The category tab that owns a workbook, or the first tab. Takes the
        workbook as the ROUTE spells it (spinal case), since that is what
        the page hands us, while the catalog keys workbooks in camel case.
        @method tabForWorkbook
        @param {String} name
        @return {String}
    */
    vm.tabForWorkbook = function (name) {
        let workbooks = vm.workbooks();
        let cats = vm.categories();
        let found = cats.find((cat) => cat.keys.some(
            (key) => workbooks[key].data.name().toSpinalCase() === name
        ));

        return (
            found
            ? found.key
            : (
                cats.length
                ? cats[0].key
                : OTHER_CATEGORY.key
            )
        );
    };

    /**
        The OMNIPRESENT_WORKBOOK model ("Alerts"), for the permanent
        icon button at the ribbon's right end -- undefined if this
        tenant has no workbook by that name, in which case the button
        just doesn't render.
        @method alertsWorkbook
        @return {Models.Workbook}
    */
    vm.alertsWorkbook = function () {
        let workbooks = vm.workbooks();

        return Object.keys(workbooks).map(
            (key) => workbooks[key]
        ).find((wb) => wb.data.name() === OMNIPRESENT_WORKBOOK);
    };

    /**
        @method goHome
    */
    vm.goHome = function () {
        m.route.set("/home");
    };

    /**
        Go to a workbook -- whichever worksheet was last open on it,
        or its first worksheet if we've never been there this session
        (same fallback/remembering logic as navigator-menu.js's own
        `goto`, kept separate since the two files don't share code).
        `this` is the workbook model, exactly as navigator-menu.js
        bound it.
        @method goto
    */
    vm.goto = function () {
        let config = this.getConfig();
        let wb = this.data.name().toSpinalCase();
        let lastSheets = f.catalog().register("workbookLastSheet");
        let pg = lastSheets[wb];
        let known = config.some(
            (item) => item.name.toSpinalCase() === pg
        );
        let openForms;
        let openForm;

        if (!pg || !known) {
            pg = config[0].name.toSpinalCase();
        }

        popupOpen = false;

        // This sheet has a form open on a record (see workbook-page.js's
        // `modelOpen`) -- go straight back into it rather than the
        // list behind it (John, Oct 2026).
        openForms = f.catalog().register("workbookOpenForm");
        openForm = openForms[wb + "/" + pg];
        if (openForm) {
            m.route.set("/edit/:feather/:key", {
                feather: openForm.feather,
                key: openForm.key
            });
            return;
        }

        m.route.set("/workbook/:workbook/:page", {
            workbook: wb,
            page: pg,
            key: f.hashCode(wb + "-" + pg)
        });
    };

    /**
        Open workbook, spelled as the route spells it (spinal case), set by
        the page rendering the ribbon so the right tab and button light up.
        @method selected
        @param {String} name
        @return {String}
    */
    vm.selected = f.prop();

    /**
        Tab whose buttons are showing.
        @method selectedTab
        @param {String} key
        @return {String}
    */
    vm.selectedTab = function (value) {
        if (value !== undefined) {
            selectedTab = value;
        }

        return selectedTab;
    };

    /**
        @method isCollapsed
        @return {Boolean}
    */
    vm.isCollapsed = function () {
        return collapsed;
    };

    /**
        @method toggleCollapsed
    */
    vm.toggleCollapsed = function () {
        setCollapsed(!collapsed);
    };

    /**
        @method isPopupOpen
        @return {Boolean}
    */
    vm.isPopupOpen = function () {
        return popupOpen;
    };

    /**
        Click a tab: show its buttons, and in collapsed mode drop them down
        over the page (clicking the showing tab again closes them).
        @method chooseTab
        @param {String} key
    */
    vm.chooseTab = function (key) {
        if (collapsed) {
            popupOpen = !(popupOpen && selectedTab === key);
        }

        selectedTab = key;
    };

    /**
        @method closePopup
    */
    vm.closePopup = function () {
        popupOpen = false;
    };

    return vm;
};

f.catalog().register("viewModels", "ribbon", ribbon.viewModel);

// ..........................................................
// Component
//

/** An icon glyph at the ribbon's own sizes. */
function icon(name, size) {
    return m("i", {
        class: "material-icons-outlined fb-rb-icon fb-rb-icon-" + size,
        "aria-hidden": "true"
    }, name);
}

/** Large icon-over-label button. */
function bigButton(item) {
    let opts = {
        class: "fb-rb-btn" + (
            item.active
            ? " fb-rb-active"
            : ""
        ),
        title: item.title || item.label,
        disabled: item.disabled,
        onclick: item.onclick
    };

    if (item.active) {
        opts["aria-current"] = "page";
    }

    return m("button[type=button]", opts, [
        icon(item.icon, "lg"),
        m("span", item.label)
    ]);
}

/** Compact one-line button, stacked three high in a group. */
function smallButton(item) {
    let opts = Object.assign({}, item.opts || {});

    opts.class = "fb-rb-btn-sm" + (
        item.active
        ? " fb-rb-active"
        : ""
    ) + (
        opts.class
        ? " " + opts.class
        : ""
    );

    if (item.title) {
        opts.title = item.title;
    }

    if (item.active) {
        opts["aria-current"] = "page";
    }

    return m("button[type=button]", opts, [
        icon(item.icon || "table_chart", "sm"),
        m("span", item.label)
    ]);
}

/**
    A labeled group of buttons. `opts.small` lays them out as a three-row
    grid; `opts.context` tints it as a contextual group (Office's idea: a
    group that only appears while the screen it belongs to is open).
*/
function group(label, buttons, opts) {
    opts = opts || {};

    return m("div", {
        class: "fb-rb-group" + (
            opts.context
            ? " fb-rb-context"
            : ""
        ) + (
            opts.actions
            ? " fb-rb-group-actions"
            : ""
        ),
        role: "group",
        "aria-label": label
    }, [
        m("div", {
            class: "fb-rb-buttons" + (
                opts.small
                ? " fb-rb-buttons-grid"
                : ""
            )
        }, buttons),
        m("div", {
            class: "fb-rb-group-label"
        }, label)
    ]);
}

/**
    @class Ribbon
    @static
    @namespace Components
*/
ribbon.component = {
    /**
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs] Options
        @param {ViewModels.Ribbon} [vnode.attrs.viewModel]
    */
    oninit: function (vnode) {
        let vm = vnode.attrs.viewModel || ribbon.viewModel(vnode.attrs);

        this.viewModel = vm;

        // Click away / Esc close the dropped-down buttons in collapsed
        // mode. Plain DOM listeners, so they redraw explicitly.
        this.onDocClick = function (ev) {
            if (vm.isPopupOpen() && !ev.target.closest(".fb-ribbon")) {
                vm.closePopup();
                m.redraw();
            }
        };

        this.onDocKey = function (ev) {
            if (vm.isPopupOpen() && ev.key === "Escape") {
                vm.closePopup();
                m.redraw();
            }
        };
    },

    /**
        @method oncreate
    */
    oncreate: function () {
        document.addEventListener("click", this.onDocClick);
        document.addEventListener("keydown", this.onDocKey);
    },

    /**
        @method onremove
    */
    onremove: function () {
        document.removeEventListener("click", this.onDocClick);
        document.removeEventListener("keydown", this.onDocKey);
    },

    /**
        @method view
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs.sheets] Contextual worksheet group
        @param {Array} [vnode.attrs.worksheetActions] Per-worksheet action
        buttons, shown as their own contextual group right after Worksheets
        @param {Array} [vnode.attrs.workbookActions] Configure sheet /
        configure workbook / share / revert buttons, shown as the
        contextual "Manage" group, plain descriptors (see bigButton)
        @param {Object} [vnode.attrs.workbookSettings] Single button
        descriptor (see bigButton), shown as its own contextual group
        @param {String} [vnode.attrs.workbookName] Label for that group
        -- the open workbook's own name/label; falls back to the literal
        "Workbook" if omitted
        @param {Array} [vnode.attrs.actions] Right-hand groups of buttons
        @param {Array} [vnode.attrs.topRight] Controls for the tab row's end
        @param {Array} [vnode.attrs.homeGroups] Fixed {label, buttons}
        groups shown when the hard-coded Home tab is selected, buttons
        as plain descriptors (see bigButton)
        @return {Object} View
    */
    view: function (vnode) {
        let vm = this.viewModel;
        let attrs = vnode.attrs || {};
        let workbooks = vm.workbooks();
        let cats = vm.categories();
        let tabs = [HOME_TAB].concat(cats);
        let route = m.route.get() || "";
        let isHome = route.indexOf("/home") === 0;
        let selectedKey = vm.selected();
        let alertsWb = vm.alertsWorkbook();
        let alertsButton;
        let routeTab = (
            isHome
            ? HOME_TAB.key
            : (
                selectedKey
                ? vm.tabForWorkbook(selectedKey)
                : null
            )
        );
        let groups = [];
        let tabKeys = tabs.map((cat) => cat.key);

        /*
            Categories are user-maintained rows now, so most won't
            have a hue of their own in the stylesheet the way the old
            hard-coded keys did. Each tab therefore carries a numbered
            fallback class as well -- featherbone.css cycles a palette
            across those, and lets any name-specific hue win over it,
            so "Engineering" keeps the blue it always had while a brand
            new category still gets a color instead of rendering
            untinted (John, Oct 2026).
        */
        function hueIndex(key) {
            return tabKeys.indexOf(key) % HUE_COUNT;
        }

        // Any navigation snaps the ribbon to the tab owning the new screen;
        // merely clicking a tab (no route change) doesn't.
        if (route !== lastRoute) {
            lastRoute = route;
            vm.selectedTab(routeTab || selectedTab || tabKeys[0]);
            vm.closePopup();
        }

        if (tabKeys.indexOf(vm.selectedTab()) === -1) {
            vm.selectedTab(routeTab || tabKeys[0]);
        }

        let showing = cats.find((cat) => cat.key === vm.selectedTab());
        let isHomeTab = vm.selectedTab() === HOME_TAB.key;

        // --- Home is exclusive: no open workbook belongs to it, so none
        // of the contextual groups below (Worksheets, Actions, Record,
        // List) apply and would be actively misleading if shown while
        // it's selected (John, Oct 2026) -- just its own hard-coded
        // groups, nothing else.
        if (isHomeTab) {
            let homeGroups = attrs.homeGroups || [];

            homeGroups.forEach(function (grp) {
                groups.push(group(grp.label, grp.buttons.map(bigButton)));
            });
        } else {
            // --- the showing tab's workbooks ---
            if (showing) {
                groups.push(group(
                    showing.label,
                    showing.keys.map(function (key) {
                        let wd = workbooks[key].data;

                        return bigButton({
                            label: wd.label() || wd.name(),
                            icon: wd.icon(),
                            title: (
                                wd.description() ||
                                wd.label() ||
                                wd.name()
                            ),
                            active: (
                                !isHome &&
                                wd.name().toSpinalCase() === selectedKey
                            ),
                            onclick: vm.goto.bind(workbooks[key])
                        });
                    })
                ));
            }

            // --- the open workbook's worksheets (contextual) ---
            if (attrs.sheets && attrs.sheets.items.length) {
                let sheets = attrs.sheets;
                let buttons = sheets.items.map(smallButton);

                if (sheets.add) {
                    buttons.push(smallButton({
                        label: "",
                        icon: "add",
                        title: "Add sheet",
                        opts: {
                            class: "fb-rb-btn-sm-icon",
                            onclick: sheets.add
                        }
                    }));
                }

                if (sheets.remove) {
                    buttons.push(m("div", {
                        class: (
                            "fb-rb-btn-sm fb-rb-btn-sm-icon fb-rb-drop" + (
                                sheets.isDragging
                                ? " fb-rb-drop-show"
                                : ""
                            )
                        ),
                        title: "Drag a sheet here to delete it",
                        ondragover: sheets.dragover,
                        ondrop: sheets.remove
                    }, icon("delete", "sm")));
                }

                groups.push(group(sheets.label || "Sheets", buttons, {
                    small: true,
                    context: true
                }));
            }

            // --- the open worksheet's configured actions (contextual) ---
            // Right after Worksheets, not at the ribbon's right end:
            // these are PER-WORKSHEET actions (admin-configured via
            // "Configure current worksheet", plus the three that are
            // always there -- Print List / Export / Import), so they
            // belong next to the worksheet picker they act on.
            // Individual buttons rather than the dropdown this used to
            // be (John, Oct 2026) -- table-widget.js's actionItems() is
            // the same data actions() turns into that dropdown's <li>s,
            // handed to workbook-page.js and passed through here as
            // plain button descriptors.
            if (attrs.worksheetActions && attrs.worksheetActions.length) {
                groups.push(group(
                    "Actions",
                    attrs.worksheetActions.map(smallButton),
                    {small: true, context: true}
                ));
            }

            // --- the open workbook's management actions (contextual) ---
            // Configure sheet / configure workbook / share / revert --
            // the generic items of the old per-workbook gear dropdown
            // (workbook-page.js's "Manage workbook" menu, removed in
            // favor of these ribbon buttons -- John, Oct 2026). Kept
            // apart from the Settings group below because these four
            // always do the same thing to "whatever's open", while
            // Settings routes to a different page per workbook/module.
            // Small buttons, same style as Worksheets/Actions (John,
            // Oct 2026 -- "all the manage buttons can be of the same
            // style... that is to say small").
            if (attrs.workbookActions && attrs.workbookActions.length) {
                groups.push(group(
                    "Manage",
                    attrs.workbookActions.map(smallButton),
                    {small: true, context: true}
                ));
            }

            // --- the open workbook's settings (contextual) ---
            // The old gear dropdown's "Settings" item, singled out into
            // its own group: unlike Manage's four buttons, which always
            // act on "whatever's open" the same way, this one routes to
            // a DIFFERENT settings page depending on which workbook's
            // module is open, so it gets its own label -- the open
            // workbook's own name/label, not the literal word
            // "Workbook" (John, Oct 2026): Make, Ship, etc., each with
            // just the one Settings button.
            if (attrs.workbookSettings) {
                groups.push(group(
                    attrs.workbookName || "Workbook",
                    [bigButton(attrs.workbookSettings)],
                    {context: true}
                ));
            }

            // --- right-hand groups (actions) ---
            if (attrs.actions && attrs.actions.length) {
                groups.push(m("div", {class: "fb-rb-fill"}));
                attrs.actions.forEach(function (grp) {
                    groups.push(group(grp.label, grp.buttons, {
                        actions: true
                    }));
                });
            }
        }

        // The one workbook that isn't filed under a category tab --
        // see OMNIPRESENT_WORKBOOK above. Same icon-button shape as
        // the collapse chevron beside it, since both are permanent
        // ribbon-level controls rather than tab/workbook buttons.
        if (alertsWb) {
            let alertsSlug = alertsWb.data.name().toSpinalCase();
            let isCurrent = !isHome && selectedKey === alertsSlug;

            alertsButton = m("button[type=button]", {
                class: "fb-ribbon-alerts" + (
                    isCurrent
                    ? " fb-ribbon-alerts-current"
                    : ""
                ),
                title: (
                    alertsWb.data.description() ||
                    alertsWb.data.label() ||
                    alertsWb.data.name()
                ),
                onclick: vm.goto.bind(alertsWb)
            }, m("i", {
                class: "material-icons-outlined"
            }, alertsWb.data.icon() || "notifications"));
        }

        let showBody = !collapsed || vm.isPopupOpen();

        return m("div", {
            // fb-rb-t-<tab> picks the hue for the tab being shown,
            // fb-rb-h-<n> the fallback for one with no named hue.
            class: "fb-ribbon fb-rb-h-" + hueIndex(vm.selectedTab()) +
            " fb-rb-t-" + vm.selectedTab() + (
                collapsed
                ? " fb-ribbon-collapsed"
                : ""
            ) + (
                (collapsed && vm.isPopupOpen())
                ? " fb-ribbon-open"
                : ""
            )
        }, [
            m("div", {
                class: "fb-ribbon-top"
            }, [
                m("div", {
                    class: "fb-ribbon-title",
                    title: "Home",
                    onclick: vm.goHome
                }, [
                    m("div", {
                        class: "fb-ribbon-logo",
                        "aria-hidden": "true"
                    }),
                    "Featherbone"
                ]),
                m("div", {
                    class: "fb-ribbon-tabs",
                    role: "tablist",
                    "aria-label": "Main menu"
                }, tabs.map(function (cat) {
                    let isSelected = cat.key === vm.selectedTab();

                    return m("button[type=button]", {
                        role: "tab",
                        id: "fb-ribbon-tab-" + cat.key,
                        "aria-selected": (
                            isSelected
                            ? "true"
                            : "false"
                        ),
                        "aria-controls": "fb-ribbon-body",
                        tabindex: (
                            isSelected
                            ? 0
                            : -1
                        ),
                        // Dot on the tab owning the open screen while
                        // another tab's buttons are showing.
                        class: "fb-ribbon-tab fb-ribbon-tab-h-" +
                        hueIndex(cat.key) +
                        " fb-ribbon-tab-" + cat.key + (
                            (cat.key === routeTab && !isSelected)
                            ? " fb-ribbon-tab-current"
                            : ""
                        ),
                        title: (
                            collapsed
                            ? "Click to show; double-click to pin the ribbon"
                            : "Double-click to collapse the ribbon"
                        ),
                        onclick: vm.chooseTab.bind(null, cat.key),
                        ondblclick: vm.toggleCollapsed
                    }, [
                        icon(cat.icon, "tab"),
                        cat.label
                    ]);
                })),
                m("div", {
                    class: "fb-ribbon-spacer"
                }),
                attrs.topRight || [],
                alertsButton,
                m("button[type=button]", {
                    class: "fb-ribbon-collapse",
                    title: (
                        collapsed
                        ? "Pin the ribbon"
                        : "Collapse the ribbon"
                    ),
                    "aria-label": (
                        collapsed
                        ? "Pin the ribbon"
                        : "Collapse the ribbon"
                    ),
                    "aria-pressed": (
                        collapsed
                        ? "true"
                        : "false"
                    ),
                    onclick: vm.toggleCollapsed
                }, m("i", {
                    class: "material-icons-outlined"
                }, (
                    collapsed
                    ? "keyboard_arrow_down"
                    : "keyboard_arrow_up"
                )))
            ]),
            (
                showBody
                ? m("div", {
                    id: "fb-ribbon-body",
                    role: "tabpanel",
                    "aria-labelledby": "fb-ribbon-tab-" + vm.selectedTab(),
                    class: "fb-ribbon-body" + (
                        collapsed
                        ? " fb-ribbon-body-popup"
                        : ""
                    )
                }, groups)
                : undefined
            )
        ]);
    }
};

f.catalog().register("components", "ribbon", ribbon.component);
