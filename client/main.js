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

  var m = require("mithril"),
    f = require("component-core"),
    model = require("model"),
    catalog = require("catalog"),
    dataSource = require("datasource"),
    list = require("list"),
    workbooks = m.prop();

  // Load catalog and process models
  f.init(function () {
    return catalog.fetch(true).then(function (data) {
      var feathers,
        models = catalog.register("models");

      feathers = Object.keys(data());
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

      return true;
    });
  });

  // Load modules
  f.init(function () {
    var modules = m.prop([]),
      payload = {method: "GET", path: "/modules/"};

    return dataSource.request(payload).then(modules).then(function () {
      // Loop through each module record and run script
      modules().forEach(function (module) {
        eval(module.script);
      });

      return true;
    });
  });

  // Load forms
  f.init(function () {
    var data = m.prop([]),
      payload = {method: "GET", path: "/data/forms"},
      forms = catalog.register("forms");

    return dataSource.request(payload).then(data).then(function () {
      // Loop through each form record and load into catalog
      data().forEach(function (form) {
        forms[form.id] = form;
      });

      return true;
    });
  });

  // Load relation widgets
  f.init(function () {
    var data = m.prop([]),
      payload = {method: "GET", path: "/data/relation-widgets"};

    return dataSource.request(payload).then(data).then(function () {
      // Loop through each record and build widget
      data().forEach(function (item) {
        // Some transformation
        item.form = item.form.id;
        item.list = {columns: item.searchColumns};
        delete item.searchColumns;
        f.buildRelationWidget(item);
      });

      return true;
    });
  });

  // Load workbooks
  f.init(function () {
    var payload = {method: "GET", path: "/workbooks/"};

    return dataSource.request(payload).then(workbooks);
  });

  // When all intialization done, construct app.
  f.init().then(function () {
    var routes,
      app = {};

    // Build home navigation page
    app.Home = {
      controller: function () {
        var that = this;

        workbooks().forEach(function (workbook) {
          var config = f.getConfig(workbook),
            sheetname = config[0].name,
            name = workbook.name + sheetname,
            route = "/" + workbook.name + "/" + sheetname;
          route = route.toSpinalCase();

          that["go" + name] = function () {
            m.route(route);
          };
        });
      },
      view: function (ctrl) {
        var buttons = workbooks().map(function (workbook) {
            var config = f.getConfig(workbook),
              sheet = config[0].name,
              name = workbook.name + sheet,
              launchConfig = workbook.launchConfig,
              className = "fa fa-" + launchConfig.icon || "gear";
            return m("button[type=button]", {
              class: "pure-button",
              style: { 
                backgroundColor: launchConfig.backgroundColor,
                color: launchConfig.color,
                margin: "3px"
              },
              onclick: ctrl["go" + name]
            }, [m("i", {
              class: className, 
              style: {
                display: "block",
                fontSize: "xx-large",
                margin: "8px"
              }
            })], workbook.name.toName());
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
    routes = catalog.register("routes", "/home", app.Home);

    // Build workbook for each configured object
    workbooks().forEach(f.buildRoutes);

    m.route(document.body, "/home", routes);
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

