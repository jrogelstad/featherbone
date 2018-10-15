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

/*global window, require, Promise, EventSource, featherbone*/
/*jslint white, this, browser, eval */

(function () {

  "strict";

  // Load pre-requisites
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
  require("common-core");

  var feathers, loadCatalog, loadModules, moduleData, workbookData,
    loadForms, loadRelationWidgets, loadWorkbooks, evstart, evsubscr,
    buildRelationWidget,
    m = require("mithril"),
    f = require("component-core"),
    model = require("model"),
    settings = require("settings"),
    catalog = require("catalog"),
    dataSource = require("datasource"),
    list = require("list"),
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
        options.isCell = options.isCell === undefined ? relopts.isCell : options.isCell;
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
          payload = {method: "GET", path: "/settings-definition"},
          initSettings = [],
          toFetch = [];

        feathers = data;

        Object.keys(data).forEach(function (name) {
          var feather = catalog.getFeather(name);
          
          if (feather.fetchOnStartup) {
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
            initSettings.push(new Promise (function(presolve) {
              models[name]().fetch().then(presolve);
            }));
          });

          // Load data as indicated
          function fetchData () {
            var requests = [];

            toFetch.forEach(function(feather) {
              var name = feather.name.toCamelCase(),
                ary = models[name].list({
                  subscribe: true,
                  fetch: false,
                  showDeleted: true
                });

              catalog.register("data", feather.plural.toCamelCase(), ary);
              requests.push(ary().fetch({})); // No limit on fetch
            });

            Promise.all(requests).then(resolve);
          }

          Promise.all(initSettings).then(fetchData);
        });
      });
    });

    // Load modules
    loadModules = new Promise (function (resolve) {
      var payload = {method: "GET", path: "/modules/"};

      dataSource.request(payload).then(function (data) {
        moduleData = data;
        resolve();
      });
    });

    // Load forms
    loadForms = new Promise (function (resolve) {
      var payload = {method: "GET", path: "/data/forms"},
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
    loadRelationWidgets = new Promise (function (resolve) {
      var payload = {method: "GET", path: "/data/relation-widgets"};

      return dataSource.request(payload).then(function (data) {
        // Loop through each record and build widget
        data.forEach(function (item) {
          // Some transformation
          item.form = item.form.id;
          item.list = {columns: item.searchColumns};
          delete item.searchColumns;
          buildRelationWidget(item);
        });

        resolve();
      });
    });

    // Load workbooks
    loadWorkbooks = new Promise(function (resolve) {
      var payload = {method: "GET", path: "/workbooks/"};

      dataSource.request(payload).then(function (data) {
        workbookData = data;
        resolve();
      });
    });
  }

  function initApp () {
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

    function subclass (name, parent) {
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

    // Process workbooks
    workbookData.forEach(function (workbook) {
      workbooks[workbook.name.toSpinalCase().toCamelCase()] = workbookModel(workbook);
    });

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
      },
      view: function (vnode) {
        var buttons = Object.keys(workbooks).map(function (key) {
            var workbook = workbooks[key],
              launchConfig = workbook.data.launchConfig(),
              className = "fa fa-" + launchConfig.icon || "gear";
            return m("button[type=button]", {
              class: "pure-button",
              style: { 
                backgroundColor: launchConfig.backgroundColor,
                color: launchConfig.color,
                margin: "3px"
              },
              onclick: vnode["go" + workbook.data.name()]
            }, [m("i", {
              class: className, 
              style: {
                display: "block",
                fontSize: "xx-large",
                margin: "8px"
              }
            })], workbook.data.name().toName());
          });
        return m("div", [
          m("h2", {
            class: "suite-header"
          }, "Suite Sheets"),
          m("div", {
            style: {
              margin: "2px",
              padding: "4px"
            }
          }, buttons)
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
         var instance, ary, payload, subscriptionId, data;
         
         // Ignore heartbeats
         if (event.data === "") { return; }
         
         payload = JSON.parse(event.data),
         subscriptionId = payload.message.subscription.subscriptionid,
         data = payload.message.data;

         //console.log(payload);
         // Apply event to the catalog;
         ary = catalog.store().subscriptions()[subscriptionId];
         if (ary) {
           instance = ary.find(function (model) {
             return model.id() === data.id;
           });

           if (instance) {
             instance.set(data, true, true);
             m.redraw();
           } else {
             console.error('Target model for ' + data.id + ' not found');
           }
         } else {
           console.error('Target list for ' + subscriptionId + ' not found');
         }
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
        loadWorkbooks])
        .then(initApp);
    }

  };

  // Let displays handle their own overflow locally
  document.documentElement.style.overflow = 'hidden';

  window.onresize = function () {
    m.redraw(true);
  };
  
  // Expose some stuff globally for debugging purposes
  featherbone = {
    global: f,
    catalog: catalog,
    workbooks: workbooks
  };

}());

