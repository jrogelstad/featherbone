/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint this, browser, eval*/
import f from "./core.js";
import datasource from "./datasource.js";
import model from "./models/model.js";
import settings from "./models/settings.js";
import catalog from "./models/catalog.js";
import State from "./state.js";
import navigator from "./components/navigator-menu.js";
import dialog from "./components/dialog.js";
import formDialog from "./components/form-dialog.js";
import formPage from "./components/form-page.js";
import childFormPage from "./components/child-form-page.js";
import searchPage from "./components/search-page.js";
import settingsPage from "./components/settings-page.js";
import workbookPage from "./components/workbook-page.js";
import signInPage from "./components/sign-in-page.js";
import accountMenu from "./components/account-menu.js";

const m = window.m;
const WebSocket = window.WebSocket;
const console = window.console;

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
let sseErrorDialogViewModel;
let models = catalog.store().models();
let workbookModel = models.workbook;
let initialized = false;
let isSuper = false;

const preFetch = [];
const fetchRequests = [];
const home = {
    oninit: function (vnode) {
        Object.keys(workbooks).forEach(function (key) {
            let workbook = workbooks[key];
            let config = workbook.getConfig();

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
        let toolbarButtonClass = "fb-toolbar-button";

        switch (f.currentUser().mode) {
        case "test":
            toolbarClass += " fb-toolbar-test";
            toolbarButtonClass = " fb-toolbar-button-test";
            break;
        case "dev":
            toolbarClass += " fb-toolbar-dev";
            toolbarButtonClass = " fb-toolbar-button-dev";
            break;
        }

        return m("div", {
            class: "fb-navigator-menu-container"
        }, [
            m(navigator.component, {
                viewModel: menu
            }), [
                m(dialog.component, {
                    viewModel: sseErrorDialogViewModel
                }),
                m(dialog.component, {
                    viewModel: addWorkbookViewModel
                }),
                m("span", {
                    class: toolbarClass + " fb-toolbar-home"
                }, [
                    m("div", {
                        class: "fb-header-home"
                    }, "Home"),
                    m(accountMenu.component),
                    m("button", {
                        class: (
                            toolbarButtonClass +
                            " fb-toolbar-button-home " + (
                                isSuper
                                ? ""
                                : "fb-button-disabled"
                            )
                        ),
                        title: (
                            isSuper
                            ? "Add workbook"
                            : "Must be a super user to add a workbook"
                        ),
                        onclick: addWorkbookViewModel.show,
                        disabled: !isSuper
                    }, [
                        m("i", {
                            class: "fa fa-plus fb-button-icon"
                        })
                    ])
                ])
            ]
        ]);
    }
};
let routes = {
    "/workbook/:workbook/:page": workbookPage.component,
    "/edit/:feather/:key": formPage.component,
    "/traverse/:feather/:key": childFormPage.component,
    "/search/:feather": searchPage.component,
    "/settings/:settings": settingsPage.component,
    "/sign-in": signInPage.component
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
    let wmodel = workbookModel(workbook);
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
                lable: ""
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
        isSuper = f.currentUser().isSuper;

        // Menu
        menu = navigator.viewModel();

        // View model for adding workbooks.
        addWorkbookViewModel = formDialog.viewModel({
            icon: "plus",
            title: "Add workbook",
            model: addWorkbookModel(),
            config: addWorkbookConfig
        });

        // View model for sse error trapping
        sseErrorDialogViewModel = dialog.viewModel({
            icon: "close",
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

        routes["/home"] = home;
        m.route(document.body, "/home", routes);

        if (hash === "/sign-in") {
            hash = "/home";
        }

        m.route.set(hash);
    });
}

// Load application data
function start() {
    if (initialized) {
        return;
    }

    initPromises();
    Promise.all([
        loadCatalog,
        loadModules,
        loadForms,
        loadProfile,
        loadWorkbooks
    ]).then(initApp);
}

function goSignIn() {
    m.route(document.body, "/sign-in", routes);
    f.state().resolve("/SignedIn").enter(start);
    f.state().send("signIn");
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

connect().then(function (resp) {
    let edata;

    function listen() {
        const wsurl = "ws://" + window.location.hostname + ":7070";
        const evsubscr = new WebSocket(wsurl);

        // Connection opened
        evsubscr.onopen = function () {
            evsubscr.send(edata.eventKey);
        };

        // Listen for messages
        evsubscr.onmessage = function (event) {
            let instance;
            let ary;
            let payload;
            let subscriptionId;
            let change;
            let patching = "/Busy/Saving/Patching";
            let data;

            try {
                payload = JSON.parse(event.data);
            } catch (ignore) {
                console.log(event.data);
                return;
            }
            change = payload.message.subscription.change;

            if (change === "signedOut") {
                f.state().send("signOut");
                return;
            }

            data = payload.message.data;

            if (change === "feather") {
                if (payload.message.subscription.deleted) {
                    catalog.unregister("feathers", data);
                    catalog.unregister("models", data.toCamelCase());
                } else {
                    catalog.register("feathers", data.name, data);
                    catalog.registerModel(
                        data.name,
                        function (d, spec) {
                            return model(d, spec || data);
                        },
                        Boolean(data.plural)
                    );
                }
                return;
            }

            subscriptionId = payload.message.subscription.subscriptionid;
            ary = catalog.store().subscriptions()[subscriptionId];

            if (!ary) {
                return;
            }

            // Special application change events
            switch (subscriptionId) {
            case moduleSid:
                if (change === "create") {
                    catalog.store().data().modules().push({
                        value: data.name,
                        label: data.name
                    });
                }
                return;
            case formsSid:
                if (change === "create") {
                    ary.push(data);
                } else if (change === "update") {
                    instance = ary.find((item) => item.id === data.id);
                    ary.splice(ary.indexOf(instance), 1, data);
                } else if (change === "delete") {
                    instance = ary.find((item) => item.id === data);
                    ary.splice(ary.indexOf(instance), 1);
                }

                return;
            }

            // Apply event to the catalog data;
            switch (change) {
            case "update":
                instance = ary.find(function (model) {
                    return model.id() === data.id;
                });

                if (instance) {
                    // Only update if not caused by this instance
                    if (
                        instance.state().current()[0] !== patching && (
                            !data.etag || (
                                data.etag && instance.data.etag &&
                                data.etag !== instance.data.etag()
                            )
                        )
                    ) {
                        instance.set(data, true, true);
                        m.redraw();
                    }
                }
                break;
            case "create":
                ary.add(ary.model(data));
                break;
            case "delete":
                instance = ary.find(function (model) {
                    return model.id() === data;
                });

                if (instance) {
                    if (ary.showDeleted()) {
                        instance.data.isDeleted(true);
                    } else {
                        ary.remove(instance);
                    }
                }
                break;
            case "lock":
                instance = ary.find(function (model) {
                    return model.id() === data.id;
                });

                if (instance) {
                    instance.lock(data.lock);
                    m.redraw();
                }
                break;
            case "unlock":
                instance = ary.find(function (model) {
                    return model.id() === data;
                });

                if (instance) {
                    instance.unlock();
                    m.redraw();
                }
                break;
            }

            m.redraw();
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

        if (resp.data.authorized) {
            f.currentUser(edata.authorized);
            f.state().send("preauthorized");
            start();
        } else {
            goSignIn();
        }
    }
});

// Let displays handle their own overflow locally
document.documentElement.style.overflow = "hidden";

window.onresize = function () {
    m.redraw(true);
};
