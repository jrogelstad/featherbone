/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
**/
/*global require, console, EventSource*/
/*jslint this, browser, eval*/
(function () {
    "use strict";

    // Load pre-requisites
    require("extend-number");
    require("table");
    require("form");

    // These get pre-registered for
    // on-the-fly instantiation
    require("form-page");
    require("workbook-page");
    require("search-page");
    require("settings-page");
    require("checkbox");
    require("relation-widget");
    require("child-table");
    require("address-relation");
    require("contact-relation");
    require("common-core");

    // Core models
    require("contact");
    require("currency");
    require("currency-conversion");
    require("currency-unit");

    const m = require("mithril");
    const f = require("component-core");
    const model = require("model");
    const settings = require("settings");
    const catalog = require("catalog");
    const dataSource = require("datasource");
    const list = require("list");
    const navigator = require("navigator-menu");
    const statechart = require("statechartjs");
    const dialog = require("dialog");

    let feathers;
    let loadCatalog;
    let loadModules;
    let moduleData;
    let workbookData;
    let sseState;
    let loadForms;
    let loadRelationWidgets;
    let loadWorkbooks;
    let evstart;
    let evsubscr;
    let menu;
    let workbooks = catalog.register("workbooks");

    // Helper function for building relation widgets.
    function buildRelationWidget(relopts) {
        let that;
        let relationWidget = catalog.store().components().relationWidget;
        let name = relopts.feather.toCamelCase() + "Relation";

        that = {
            oninit: function (vnode) {
                let options = vnode.attrs;
                let id = vnode.attrs.form || relopts.form;
                let oninit = relationWidget.oninit.bind(this);

                options.parentProperty = (
                    options.parentProperty || relopts.parentProperty
                );
                options.valueProperty = (
                    options.valueProperty || relopts.valueProperty
                );
                options.labelProperty = (
                    options.labelProperty || relopts.labelProperty
                );
                options.form = catalog.store().forms()[id];
                options.list = options.list || relopts.list;
                options.style = options.style || relopts.style;
                options.isCell = (
                    options.isCell === undefined
                    ? relopts.isCell
                    : options.isCell
                );
                oninit(vnode);
            },
            view: relationWidget.view
        };

        that.labelProperty = function () {
            return relopts.labelProperty;
        };
        that.valueProperty = function () {
            return relopts.valueProperty;
        };
        catalog.register("components", name, that);
    }

    // Load catalog and process models
    function initPromises() {
        loadCatalog = new Promise(function (resolve) {

            catalog.fetch(true).then(function (data) {
                let models = catalog.register("models");
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
                    }

                    // List instance
                    if (feather.plural && !models[name].list) {
                        models[name].list = list(feather.name);
                    }
                });

                // Load settings
                dataSource.request(payload).then(function (definitions) {

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
                        let requests = [];

                        toFetch.forEach(function (feather) {
                            let name = feather.name.toCamelCase();
                            let ary = models[name].list({
                                subscribe: true,
                                fetch: false,
                                showDeleted: true
                            });

                            catalog.register(
                                "data",
                                feather.plural.toCamelCase(),
                                ary
                            );
                            ary().defaultLimit(undefined);
                            // No limit on fetch
                            requests.push(ary().fetch({}));
                        });

                        Promise.all(requests).then(resolve);
                    }

                    Promise.all(initSettings).then(fetchData);
                });
            });
        });

        // Global sse state handler, allows any page
        // to observe when we've got a sse connection problem,
        // presumably a disconnect
        sseState = statechart.define(function () {
            this.state("Ok", function () {
                this.event("error", function (error) {
                    this.goto("/Error", {
                        context: error
                    });
                });
            });
            this.state("Error");
        });
        sseState.goto(); // Initialze
        catalog.register("global", "sseState", sseState);

        // Load modules
        loadModules = new Promise(function (resolve) {
            let payload = {
                method: "GET",
                path: "/modules/"
            };

            dataSource.request(payload).then(function (data) {
                moduleData = data;
                // Resolve dependencies back to array for easier handling
                moduleData.forEach(function (module) {
                    if (module.dependencies && module.dependencies.value) {
                        module.dependencies = module.dependencies.value;
                    } else {
                        module.dependencies = [];
                    }
                });
                resolve();
            });
        });

        // Load forms
        loadForms = new Promise(function (resolve) {
            let payload = {
                method: "POST",
                path: "/data/forms"
            };
            let forms = catalog.register("forms");

            dataSource.request(payload).then(function (data) {
                // Loop through each form record and load into catalog
                data.forEach(function (form) {
                    forms[form.id] = form;
                });

                resolve();
            });
        });

        // Load relation widgets
        loadRelationWidgets = new Promise(function (resolve) {
            let payload = {
                method: "POST",
                path: "/data/relation-widgets"
            };

            return dataSource.request(payload).then(function (data) {
                // Loop through each record and build widget
                data.forEach(function (item) {
                    // Some transformation
                    item.form = item.form.id;
                    item.list = {
                        columns: item.searchColumns
                    };
                    delete item.searchColumns;
                    buildRelationWidget(item);
                });

                resolve();
            });
        });

        // Load workbooks
        loadWorkbooks = new Promise(function (resolve) {
            let payload = {
                method: "GET",
                path: "/workbooks/"
            };

            dataSource.request(payload).then(function (data) {
                workbookData = data;
                resolve();
            });
        });
    }

    function initApp() {
        let home;
        let sseErrorDialog;
        let components = catalog.store().components();
        let models = catalog.store().models();
        let workbookModel = models.workbook;
        let keys = Object.keys(feathers);
        let msg;

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
            eval(module.script);
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
            let funcs = Object.keys(parent);

            Object.keys(feather.children).forEach(function (name) {
                let child = models[name.toCamelCase()];

                funcs.forEach(function (func) {
                    child[func] = child[func] || parent[func];
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
        workbookData.forEach(function (workbook) {
            let name = workbook.name.toSpinalCase().toCamelCase();
            let wmodel = workbookModel(workbook);
            workbooks[name] = wmodel;
            catalog.register("workbooks", name, wmodel);
        });

        // Menu
        menu = navigator.viewModel();

        // Handle connection errors
        msg = "You have lost connection to the server.";
        msg += "Click \"Ok\" to attempt to reconnect.";
        sseErrorDialog = dialog.viewModel({
            icon: "close",
            title: "Connection Error",
            message: msg,
            onOk: function () {
                document.location.reload();
            }
        });
        sseErrorDialog.buttonCancel().hide();
        sseState.resolve("Error").enter(function () {
            sseErrorDialog.show();
        });

        // Build home navigation page
        home = {
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
            onupdate: function () {
                menu.selected("home");
            },
            view: function () {
                let apiUrl;

                apiUrl = "http://" + window.location.hostname + ":";
                apiUrl += window.location.port + "/api.html";
                return m("div", {
                    style: {
                        position: "absolute",
                        height: "100%"
                    }
                }, [
                    m("div", {
                        class: "fb-navigator-menu-container"
                    }, [
                        m(navigator.component, {
                            viewModel: menu
                        }), [
                            m(dialog.component, {
                                viewModel: sseErrorDialog
                            }),
                            m("div", [
                                m("h2", {
                                    class: "fb-header fb-header-home"
                                }, "Home")
                            ]),
                            m("a", {
                                href: apiUrl,
                                style: {
                                    position: "relative",
                                    width: "150px",
                                    top: "50px",
                                    padding: "10px"
                                }
                            }, "REST API")
                        ]
                    ])
                ]);
            }
        };

        m.route(document.body, "/home", {
            "/home": home,
            "/workbook/:workbook/:key": components.workbookPage,
            "/edit/:feather/:key": components.formPage,
            "/search/:feather": components.searchPage,
            "/settings/:settings": components.settingsPage
        });
    }

    // Listen for session id
    evstart = new EventSource("/sse");
    evstart.onmessage = function (event) {
        let sessionId = event.data;

        if (sessionId) {
            catalog.sessionId(sessionId);
            catalog.register("subscriptions");

            // Listen for event changes for this session
            evsubscr = new EventSource("/sse/" + sessionId);
            evsubscr.onmessage = function (event) {
                let instance;
                let ary;
                let payload;
                let subscriptionId;
                let change;
                let data;
                let state;

                // Ignore heartbeats
                if (event.data === "") {
                    return;
                }

                payload = JSON.parse(event.data);
                subscriptionId = payload.message.subscription.subscriptionid;
                change = payload.message.subscription.change;
                data = payload.message.data;
                ary = catalog.store().subscriptions()[subscriptionId];

                if (!ary) {
                    return;
                }

                // Apply event to the catalog;
                switch (change) {
                case "update":
                    instance = ary.find(function (model) {
                        return model.id() === data.id;
                    });

                    if (instance) {
                        // Only update if not caused by this instance
                        state = instance.state().current()[0];
                        if (state !== "/Busy/Saving/Patching") {
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

            // Houston, we've got a problem.
            // Report it to state handler.
            evsubscr.onerror = function (e) {
                sseState.send("error", e);
            };

            // Done with startup event
            evstart.close();

            // When all intialization done, construct app.
            initPromises();
            Promise.all([
                loadCatalog,
                loadForms,
                loadModules,
                loadRelationWidgets,
                loadWorkbooks
            ]).then(initApp);
        }
    };

    // Let displays handle their own overflow locally
    document.documentElement.style.overflow = "hidden";

    window.onresize = function () {
        m.redraw(true);
    };

    // Expose some stuff globally for debugging purposes
    window.featherbone = {
        global: f,
        catalog: catalog,
        workbooks: workbooks
    };

}());