/*global m, f, window */

(function () {

  // Load catalog and process models
  f.init(function () {
    return f.catalog.fetch().then(function (data) {
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
      results = m.prop([]),
      payload = {method: "GET", path: "/modules/"};

    return ds.request(payload).then(results).then(function () {
      // Loop through each module record and load modules
      results().forEach(function (result) {
        var keys = Object.keys(result.modules);

        // Loop through each module definition and append
        keys.forEach(function (key) {
          f.modules[key] = result.modules[key];
        });
      });

      return true;
    });
  });

  // When all intialization done, construct app.
  f.init().then(function () {
    var keys,
      app = {},
      routes = {};

    keys = Object.keys(f.modules);

    // Build home navigation page
    app.Home = {
      controller: function () {
        var that = this;

        keys.forEach(function (key) {
          var plural = f.catalog.getFeather(key).plural;

          that["go" + plural] = function () {
            m.route("/" + plural.toSpinalCase());
          };
        });
      },
      view: function (ctrl) {
        var buttons = keys.map(function (key) {
            var plural = f.catalog.getFeather(key).plural;

            return m("button[type=button]", {
              onclick: ctrl["go" + plural]
            }, plural);
          });
        return m("div", buttons);
      }
    };
    routes["/home"] = app.Home;

    // Build relation widget for module if applicable
    keys.forEach(function (key) {
      var name,
        relopts = f.modules[key].relation;

      if (relopts) {
        name = key.toCamelCase();
        f.components[name + "Relation"] = function (options) {
          options = options || {};
          var w = f.components.relationWidget({
            parentProperty: options.parentProperty || relopts.parentProperty,
            valueProperty: options.valueProperty || relopts.valueProperty,
            labelProperty: options.labelProperty || relopts.labelProperty
          });

          return w;
        };
      }
    });

    // Build app for each configured object
    keys.forEach(function (key) {
      var plural = f.catalog.data()[key].plural.toSpinalCase(),
        name = key.toSpinalCase();

      // Build UI
      app[key + "TableDisplay"] = f.components.tableDisplay({
        feather: key,
        attrs: f.modules[key].list.attrs
      });

      app[key + "FormDisplay"] = f.components.formDisplay({
        feather: key,
        attrs: f.modules[key].form.attrs
      });

      // Build routes
      routes["/" + plural] = app[key + "TableDisplay"];
      routes["/" + name] = app[key + "FormDisplay"];
      routes["/" + name + "/:id"] = app[key + "FormDisplay"];
    });

    m.route(document.body, "/home", routes);
  });

  window.onresize = function (event) {
    m.redraw(true);
  };

}());

