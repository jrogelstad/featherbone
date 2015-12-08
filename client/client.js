/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global m, f, window */

(function () {

  "strict";

  var workbooks = m.prop();

  // Load catalog and process models
  f.init(function () {
    return f.catalog.fetch(true).then(function (data) {
      var feathers;

      feathers = Object.keys(data());
      feathers.forEach(function (feather) {
        var name = feather.toCamelCase(),
          plural = f.catalog.getFeather(feather, false).plural;

        // Implement generic function to object from model
        if (typeof f.models[name] !== "function") {
          // Model instance
          f.models[name] = function (data, model) {
            var shared = model || f.catalog.getFeather(feather),
              obj = f.model(data, shared);

            return obj;
          };

          // List instance
          if (plural) {
            f.models[name].list = f.list(feather);
          }
        }
      });

      return true;
    });
  });

  // Load modules
  f.init(function () {
    var ds = f.dataSource,
      modules = m.prop([]),
      payload = {method: "GET", path: "/modules/"};

    return ds.request(payload).then(modules).then(function () {
      // Loop through each module record and run script
      modules().forEach(function (module) {
        eval(module.script);
      });

      return true;
    });
  });

  // Load workbooks
  f.init(function () {
    var ds = f.dataSource,
      payload = {method: "GET", path: "/workbooks/"};

    return ds.request(payload).then(workbooks);
  });

  // When all intialization done, construct app.
  f.init().then(function () {
    var app = {};

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
            })], workbook.name.toCamelCase().toProperCase());
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
    f.routes["/home"] = app.Home;

    // Build workbook for each configured object
    f.workbooks = {};
    workbooks().forEach(f.buildRoutes);

    m.route(document.body, "/home", f.routes);
  });

  window.onresize = function () {
    m.redraw(true);
  };

}());

