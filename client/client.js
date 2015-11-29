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

  var workbooks = m.prop(),
    getConfig = function (workbook) {
      var config = workbook.defaultConfig;
      if (workbook.localConfig.length) {
        config = workbook.localConfig;
      }
      return config;
    };

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
    var app = {},
      routes = {};

    // Build home navigation page
    app.Home = {
      controller: function () {
        var that = this;

        workbooks().forEach(function (workbook) {
          var config = getConfig(workbook),
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
            var config = getConfig(workbook),
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
            style: {
              backgroundColor: "snow",
              borderBottomColor: "lightgrey",
              borderBottomStyle: "solid",
              borderBottomWidth: "thin",
              margin: "2px",
              padding: "6px"
            }
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
    routes["/home"] = app.Home;

    // Build workbook for each configured object
    f.workbooks = {};
    workbooks().forEach(function (workbook) {
      var config = getConfig(workbook);

      f.workbooks[workbook.name.toCamelCase()] = f.models.workbook(workbook);
      config.forEach(function (item) {
        var sheet = item.name,
          form = item.form.name,
          sheetname = workbook.name + sheet,
          formname = workbook.name + form,
          feather = item.feather,
          wbkroute = "/" + workbook.name + "/" + sheet,
          frmroute = "/" + workbook.name + "/" + form;
        sheetname = sheetname.toCamelCase();
        formname = formname.toCamelCase();
        wbkroute = wbkroute.toSpinalCase();
        frmroute = frmroute.toSpinalCase();

        // Build UI
        app[sheetname + "WorkbookDisplay"] = f.components.workbookDisplay({
          name: workbook.name,
          feather: feather,
          config: config,
          sheet: item
        });

        app[formname + "FormDisplay"] = f.components.formDisplay({
          workbook: workbook.name,
          sheet: item,
          form: form,
          feather: feather,
          attrs: item.form.attrs
        });

        // Build routes
        routes[wbkroute] = app[sheetname + "WorkbookDisplay"];
        routes[frmroute] = app[formname + "FormDisplay"];
        routes[frmroute + "/:id"] = app[formname + "FormDisplay"];
      });
    });

    m.route(document.body, "/home", routes);
  });

  window.onresize = function () {
    m.redraw(true);
  };

}());

