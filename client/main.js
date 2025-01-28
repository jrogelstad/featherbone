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
let menu;
let workbooks = catalog.register("workbooks");
let addWorkbookViewModel;
let addWbFromTemplateDlg;
let deleteWbTemplateDlg;
let sseErrorDialogViewModel;
let models = catalog.store().models();
let initialized = false;
let isAdmin = false;

// For workbook management
const showMenuWorkbook = f.prop(false);
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

const preFetch = [];
const fetchRequests = [];
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
        let menuButtonClass = (
            "pure-button " +
            "material-icons-outlined " +
            "fb-menu-button fb-menu-button-right-side"
        );
        let dlgsClosed = (
            addWorkbookViewModel.state().current()[0] ===
            "/Display/Closed" &&
            addWbFromTemplateDlg.state().current()[0] ===
            "/Display/Closed" &&
            deleteWbTemplateDlg.state().current()[0] ===
            "/Display/Closed"
        );
        let menuAuthLinkClass = (
            "pure-menu-link " + (
                isAdmin
                ? ""
                : " pure-menu-disabled"
            )
        );

        switch (f.currentUser().mode) {
        case "test":
            toolbarClass += " fb-toolbar-test";
            break;
        case "dev":
            toolbarClass += " fb-toolbar-dev";
            break;
        }

        return m("div", {
            class: "fb-navigator-menu-container"
        }, [
            m(components.navigatorMenu, {
                viewModel: menu
            }), [
                m(components.dialog, {
                    viewModel: sseErrorDialogViewModel
                }),
                m(components.dialog, {
                    viewModel: addWorkbookViewModel
                }),
                m(components.dialog, {
                    viewModel: addWbFromTemplateDlg
                }),
                m(components.dialog, {
                    viewModel: deleteWbTemplateDlg
                }),
                m("div", {style: {width: "100%"}}, [
                    m("span", {
                        class: toolbarClass + " fb-toolbar-home"
                    }, [
                        m("div", {
                            class: "fb-header-home"
                        }, f.currentUser().splashTitle),
                        m("div", {
                            id: "wb-manage-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu fb-menu-setup"
                            ),
                            onclick: function (e) {
                                if (
                                    dlgsClosed &&
                                    e.srcElement.nodeName !== "BUTTON" &&
                                    e.target.parentElement.nodeName !== "BUTTON"
                                ) {
                                    showMenuWorkbook(true);
                                }
                            },
                            onmouseout: function (ev) {
                                if (
                                    !ev || !ev.relatedTarget ||
                                    !ev.relatedTarget.id ||
                                    ev.relatedTarget.id.indexOf(
                                        "wb-manage"
                                    ) === -1
                                ) {
                                    showMenuWorkbook(false);
                                }
                            }
                        }, [
                            m("span", {
                                id: "wb-manage-button",
                                title: "Manage Workbooks",
                                class: menuButtonClass
                            }, "edit_notearrow_drop_down"),
                            m("ul", {
                                id: "wb-manage-list",
                                class: (
                                    "pure-menu-list fb-menu-list " +
                                    "fb-menu-list-setup" + (
                                        showMenuWorkbook()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, [
                                m("li", {
                                    id: "wb-manage-add",
                                    class: menuAuthLinkClass,
                                    title: "Add a new workbook",
                                    onclick: function () {
                                        if (isAdmin) {
                                            addWorkbookViewModel.show();
                                        }
                                    }
                                }, [m("i", {
                                    id: "wb-manage-add-icon",
                                    class: "material-icons fb-menu-list-icon"
                                }, "add")], "Add Workbook"),
                                m("li", {
                                    id: "wb-manage-from-template",
                                    class: menuAuthLinkClass,
                                    title: "Add workbook from template",
                                    onclick: function () {
                                        if (isAdmin) {
                                            template("");
                                            newname("");
                                            addWbFromTemplateDlg.show();
                                        }
                                    }
                                }, [m("i", {
                                    id: "wb-manage-from-template-icon",
                                    class: (
                                        "material-icons-outlined " +
                                        "fb-menu-list-icon"
                                    )
                                }, "copy")], "Copy From Template"),
                                m("li", {
                                    id: "wb-manage-delete-template",
                                    class: menuAuthLinkClass,
                                    title: "Delete template",
                                    onclick: function () {
                                        if (isAdmin) {
                                            template("");
                                            deleteWbTemplateDlg.show();
                                        }
                                    }
                                }, [m("i", {
                                    id: "wb-manage-delete-template-icon",
                                    class: (
                                        "material-icons-outlined " +
                                        "fb-menu-list-icon"
                                    )
                                }, "playlist_remove")], "Delete Template")
                            ])
                        ]),
                        m("button", {
                            id: "global-settings",
                            class: (
                                "pure-button fb-menu-setup fb-menu-button " +
                                "fb-menu-button-middle-side " + (
                                    isAdmin
                                    ? "pure-button-active"
                                    : "pure-button-disabled"
                                )
                            ),
                            title: "Global settings",
                            onclick: function () {
                                if (!isAdmin) {
                                    return;
                                }
                                m.route.set("/settings/:settings", {
                                    settings: "globalSettings"
                                }, {
                                    state: {
                                        form: {
                                            "name": "globalSettings",
                                            "description": "Global settings",
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
                        }, [m("i", {
                            id: "logo-edit-icon",
                            class: "material-icons fb-button-icon"
                        }, "public")]),
                        m(components.accountMenu)
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
        ]);
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

        // Menu
        menu = viewModels.navigatorMenu();

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

        // View model for sse error trapping
        sseErrorDialogViewModel = viewModels.dialog({
            icon: "error",
            title: "Connection Error",
            message: (
                "You have lost connection to the server." +
                "Click \"Ok\" to attempt to reconnect."
            ),
            onOk: function () {
                document.location.reload();
            }
        });
        sseState.resolve("Error").enter(sseErrorDialogViewModel.show);
        sseErrorDialogViewModel.buttonCancel().hide();

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
        loadWorkbooks
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
        let wp = (
            window.location.protocol.indexOf("s") === -1
            ? "ws://"
            : "wss://"
        );

        function listen() {
            const wsurl = (
                wp + window.location.hostname +
                ":" + window.location.port +
                window.location.pathname
            );
            const evsubscr = new WebSocket(wsurl);

            // Connection opened
            evsubscr.onopen = function () {
                evsubscr.send(edata.eventKey);
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
                evsubscr.close();

                // Remove this function
                f.state().resolve("/SignedOut").enters.pop();
            });

            // Houston, we've got a problem.
            // Report it to state handler.
            evsubscr.onclose = function (e) {
                sseState.send("error", e);
            };
        }

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
