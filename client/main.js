/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*global window, require, Promise, EventSource, console*/
/*jslint this, browser, eval */
(function () {

    "strict";

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

    var feathers, loadCatalog, loadModules, moduleData, workbookData,
            loadForms, loadRelationWidgets, loadWorkbooks, evstart, evsubscr,
            buildRelationWidget, menu,
            m = require("mithril"),
            f = require("component-core"),
            model = require("model"),
            settings = require("settings"),
            catalog = require("catalog"),
            dataSource = require("datasource"),
            list = require("list"),
            navigator = require("navigator-menu"),
            workbooks = catalog.register("workbooks");

    // Helper function for building relation widgets.
    buildRelationWidget = function (relopts) {
        var that,
            relationWidget = catalog.store().components().relationWidget,
            name = relopts.feather.toCamelCase() + "Relation";

        that = {
            oninit: function (vnode) {
                var options = vnode.attrs,
                    id = vnode.attrs.form || relopts.form,
                    oninit = relationWidget.oninit.bind(this);

                options.parentProperty = options.parentProperty || relopts.parentProperty;
                options.valueProperty = options.valueProperty || relopts.valueProperty;
                options.labelProperty = options.labelProperty || relopts.labelProperty;
                options.form = catalog.store().forms()[id];
                options.list = options.list || relopts.list;
                options.style = options.style || relopts.style;
                options.isCell = options.isCell === undefined
                    ? relopts.isCell
                    : options.isCell;
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
    };

    // Load catalog and process models
    function initPromises() {
        loadCatalog = new Promise(function (resolve) {

            catalog.fetch(true).then(function (data) {
                var models = catalog.register("models"),
                    payload = {
                        method: "GET",
                        path: "/settings-definition"
                    },
                    initSettings = [],
                    toFetch = [];

                feathers = data;

                Object.keys(data).forEach(function (name) {
                    var feather = catalog.getFeather(name);

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

                    // Loop through each definition and build a settings model function
                    definitions.forEach(function (definition) {
                        var name = definition.name;
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
                        var requests = [];

                        toFetch.forEach(function (feather) {
                            var name = feather.name.toCamelCase(),
                                ary = models[name].list({
                                    subscribe: true,
                                    fetch: false,
                                    showDeleted: true
                                });

                            catalog.register("data", feather.plural.toCamelCase(), ary);
                            ary().defaultLimit(undefined);
                            requests.push(ary().fetch({})); // No limit on fetch
                        });

                        Promise.all(requests).then(resolve);
                    }

                    Promise.all(initSettings).then(fetchData);
                });
            });
        });

        // Load modules
        loadModules = new Promise(function (resolve) {
            var payload = {
                method: "GET",
                path: "/modules/"
            };

            dataSource.request(payload).then(function (data) {
                moduleData = data;
                resolve();
            });
        });

        // Load forms
        loadForms = new Promise(function (resolve) {
            var payload = {
                    method: "GET",
                    path: "/data/forms"
                },
                forms = catalog.register("forms");

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
            var payload = {
                method: "GET",
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
            var payload = {
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
        var home,
            components = catalog.store().components(),
            models = catalog.store().models(),
            workbookModel = models.workbook,
            keys = Object.keys(feathers);

        // Process modules
        moduleData.forEach(function (module) {
            eval(module.script);
        });

        // Propagate static functions to child classes
        keys.forEach(function (key) {
            feathers[key].children = {};
        });

        keys.forEach(function (key) {
            var parent = feathers[key].inherits || "Object";

            feathers[parent].children[key] = feathers[key];
        });

        delete feathers.Object.children.Object;

        function subclass(name, parent) {
            var feather = feathers[name],
                funcs = Object.keys(parent);

            Object.keys(feather.children).forEach(function (name) {
                var child = models[name.toCamelCase()];

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
                ratio: {
                    description: "Conversion ration",
                    type: "number"
                }
            }
        });

        // Process workbooks
        workbookData.forEach(function (workbook) {
            var name = workbook.name.toSpinalCase().toCamelCase(),
                wmodel = workbookModel(workbook);
            workbooks[name] = wmodel;
            catalog.register("workbooks", name, wmodel);
        });

        // Menu
        menu = navigator.viewModel();

        // Build home navigation page
        home = {
            oninit: function (vnode) {
                Object.keys(workbooks).forEach(function (key) {
                    var workbook = workbooks[key],
                        config = workbook.getConfig();

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
                return m("div", {
                    style: {
                        position: "absolute",
                        height: "100%"
                    }
                }, [
                    m("div", {
                        class: "suite-navigator-menu-container"
                    }, [
                        m(navigator.component, {
                            viewModel: menu
                        }), [
                            m("div", [
                                m("h2", {
                                    class: "suite-header suite-header-home"
                                }, "Home")
                            ])
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
    evstart = new EventSource('/sse');
    evstart.onmessage = function (event) {
        var sessionId = event.data;

        if (sessionId) {
            catalog.sessionId(sessionId);
            catalog.register("subscriptions");

            // Listen for event changes for this session
            evsubscr = new EventSource('/sse/' + sessionId);
            evsubscr.onmessage = function (event) {
                var instance, ary, payload, subscriptionId, change, data, state;

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
                    //console.error('Target list for ' + subscriptionId + ' not found');
                    return;
                }

                // Apply event to the catalog;
                switch (change) {
                case 'update':
                    instance = ary.find(function (model) {
                        return model.id() === data.id;
                    });

                    if (instance) {
                        // Only update not if not caused by this instance
                        state = instance.state().current()[0];
                        if (state !== "/Locked" && state !== "/Busy/Saving/Patching") {
                            instance.set(data, true, true);
                            m.redraw();
                        }
                    }
                    break;
                case 'create':
                    ary.add(ary.model(data));
                    break;
                case 'delete':
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
                case 'lock':
                    instance = ary.find(function (model) {
                        return model.id() === data.id;
                    });

                    if (instance) {
                        instance.lock(data.lock);
                        m.redraw();
                    }
                    break;
                case 'unlock':
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
            ])
                .then(initApp);
        }
    };

    // Let displays handle their own overflow locally
    document.documentElement.style.overflow = 'hidden';

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