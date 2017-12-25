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

/*global window */
(function () {

  "strict";

  // Load pre-requisites
  require("extend-string");
  require("table");
  require("form");

  // These get pre-registered for
  // on-the-fly instantiation
  require("form-display");
  require("workbook-display");
  require("checkbox");
  require("relation-widget");
  require("child-table");

  var loadCatalog, loadSettings, loadModules,
    loadForms, loadRelationWidgets, loadWorkbooks,
    m = require("mithril"),
    f = require("component-core"),
    model = require("model"),
    settings = require("settings"),
    catalog = require("catalog"),
    dataSource = require("datasource"),
    list = require("list"),
    workbooks = catalog.register("workbooks");

  // Load catalog and process models
  loadCatalog = new Promise(function (resolve) {
    catalog.fetch(true).then(function (data) {
      var feathers,
        models = catalog.register("models");

      feathers = Object.keys(data);
      feathers.forEach(function (feather) {
        var name = feather.toCamelCase(),
          plural = catalog.getFeather(feather, false).plural;

        // Implement generic function to object from model
        if (typeof models[name] !== "function") {
          // Model instance
          models[name] = function (data, spec) {
            var shared = spec || catalog.getFeather(feather),
              obj = model(data, shared);

            return obj;
          };
        }

        // List instance
        if (plural && !models[name].list) {
          models[name].list = list(feather);
        }
      });

      resolve();
    });
  });

  // Load settings definition
  loadSettings = new Promise(function (resolve) {
    var payload = {method: "GET", path: "/settings-definition"},
      models = catalog.register("models");

    dataSource.request(payload).then(function (definitions) {

      // Loop through each definition and build a settings model function
      definitions.forEach(function (definition) {
        var name = definition.name;
        // Implement generic function to object from model
        if (typeof models[name] !== "function") {
          // Model instance
          models[name] = function () {
            return settings(name, definition);
          };
        } 

        // Allow retrieving of definition directly from object
        models[name].definition = function () {
          return definition;
        };       
      });

      resolve();
    });
  });

  // Load modules
  loadModules = new Promise (function (resolve) {
    var payload = {method: "GET", path: "/modules/"};

    dataSource.request(payload).then(function (modules) {
      // Loop through each module record and run script
      modules.forEach(function (module) {
        eval(module.script);
      });

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
        f.buildRelationWidget(item);
      });

      resolve();
    });
  });

  // Load workbooks
  loadWorkbooks = new Promise(function (resolve) {
    var payload = {method: "GET", path: "/workbooks/"};

    dataSource.request(payload).then(function (data) {
      var workbookModel = catalog.store().models().workbook;

      data.forEach(function (workbook) {
        workbooks[workbook.name.toSpinalCase().toCamelCase()] = workbookModel(workbook);
      });
      resolve();
    });
  });

  // When all intialization done, construct app.
  Promise.all([
    loadCatalog,
    loadSettings,
    loadForms,
    loadModules,
    loadRelationWidgets,
    loadWorkbooks])
  .then(function () {
    var home,
      components = catalog.store().components();

    // Build home navigation page
    home = {
      oninit: function (vnode) {
        Object.keys(workbooks).forEach(function (key) {
          var workbook = workbooks[key],
            config = workbook.getConfig();

          vnode["go" + workbook.data.name()] = function () {
            m.route.set("/workbook/:workbook/:sheet", {
              workbook: workbook.data.name().toSpinalCase(),
              sheet: config[0].name.toSpinalCase()
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
      "/workbook/:workbook/:sheet": components.workbookDisplay,
      "/edit/:feather": components.formDisplay,
      "/edit/:feather/:id": components.formDisplay
    });
  });

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

