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
/*jslint this, browser, eval, devel, unordered*/
/*global f, WebSocket, m*/
import model from "./models/model.js";
import settings from "./models/settings.js";

const datasource = f.datasource();
const State = f.State;
const catalog = f.catalog();
const components = catalog.store().components();
const viewModels = catalog.store().viewModels();
const connectionMonitor = catalog.store().global().connectionMonitor;

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
let acctMenu;
let models = catalog.store().models();
let initialized = false;
let isAdmin = false;

// For workbook management
const template = f.prop("");
const newname = f.prop("");
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
    if (!isAdmin) {
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
                    name: "SMTP Credentials"
                }],
                "attrs": [
                    {
                        "attr": "logo",
                        "grid": 0
                    },
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
                        "attr": "smtpType",
                        "grid": 2,
                        "label": "Type"
                    },
                    {
                        "attr": "smtpHost",
                        "grid": 2,
                        "label": "Host"
                    },
                    {
                        "attr": "smtpUser",
                        "grid": 2,
                        "label": "Email"
                    },
                    {
                        "attr": "smtpPassword",
                        "grid": 2,
                        "label": "Password"
                    },
                    {
                        "attr": "smtpSecure",
                        "grid": 2,
                        "label": "Secure"
                    },
                    {
                        "attr": "smtpPort",
                        "grid": 2,
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
    return [{
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
            title: "Global settings",
            disabled: !isAdmin,
            onclick: (
                isAdmin
                ? goGlobalSettings
                : undefined
            )
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

        menu.selected("home");
    },
    oncreate: function () {
        document.getElementById("fb-title").text = "Featherbone";
    },
    onupdate: function () {
        menu.selected("home");
    },
    view: function () {
        let toolbarClass = "fb-toolbar";
        let homeGroups = homeRibbonGroups();

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
                            class: toolbarClass + " fb-toolbar-home"
                        }, [
                            m("div", {
                                class: "fb-header-home"
                            }, f.currentUser().splashTitle),
                            m("div", {
                                class: "fb-toolbar-fill"
                            })
                        ]),
                        m("iframe", {
                            style: {
                                border: "none",
                                display: "block",
                                height: "100%",
                                width: "100%"
                            },
                            src: f.currentUser().splashUrl
                        })
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

        m.route(document.body, "/home", routes);
    });
}

// Load application data
async function start() {
    if (initialized) {
        return;
    }

    initPromises();
    await Promise.all([
        loadCatalog,
        loadModules,
        loadForms,
        loadProfile,
        loadWorkbooks,
        loadNavigationCategories
    ]);
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
                evsubscr.send(edata.eventKey);
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
                if (!hash || (hash === "/sign-in")) {
                    m.route.set("/home");
                    window.history.go(0);
                    return;
                }
                m.route.set(hash);
            });

            if (resp.data.authorized) {
                f.currentUser(edata.authorized);
                f.state().send("preauthorized");
                await start();
            } else {
                m.route(document.body, "/sign-in", routes);
                f.state().resolve("/SignedIn").enter(async function () {
                    await start();
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
