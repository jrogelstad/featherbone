/*global window */
(function () {

  "strict";

  // Load pre-requisites
  require("extend-string");
  require("form-display");
  require("workbook-display");

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

          // List instance
          if (plural) {
            models[name].list = list(feather);
          }
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

  // Load workbooks
  f.init(function () {
    var payload = {method: "GET", path: "/workbooks/"};

    return dataSource.request(payload).then(workbooks);
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
    catalog.register("routes", "/home", app.Home);

    // Build workbook for each configured object
    workbooks().forEach(f.buildRoutes);

    m.route(document.body, "/home", f.routes);
  });

  window.onresize = function () {
    m.redraw(true);
  };

}());

