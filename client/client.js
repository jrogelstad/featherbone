/*global m, f, window */

f.init().then(function () {

  var config, keys,
    app = {},
    routes = {};

  config = {
    Contact: {
      form: {
        attrs: ["name", "isActive", "email", "birthDate", "workPhone",
          "homePhone", "annualIncome", "creditScore", "role", "created",
          "createdBy", "updated", "updatedBy", "objectType"]
      },
      list: {
        attrs: ["name", "email", "isActive", "birthDate", "workPhone",
          "homePhone", "creditScore", "objectType"]
      },
    },
    Lead: {
      form: {
        attrs: ["company", "name", "isActive", "email", "birthDate",
          "workPhone", "homePhone", "annualIncome", "creditScore", "role",
          "probability", "remarks", "created", "createdBy", "updated",
          "updatedBy"]
      },
      list: {
        attrs: ["company", "name", "email", "isActive", "birthDate",
          "workPhone", "probability", "homePhone", "creditScore"]
      }
    },
    Activity: {
      form: {
        attrs: ["name", "description", "startDate", "dueDate",
          "priority", "isCompleted", "objectType",
          "created", "createdBy", "updated", "updatedBy"]
      },
      list: {
        attrs: ["name", "description", "startDate", "dueDate",
          "priority", "isCompleted", "objectType",
          "created", "createdBy", "updated", "updatedBy"]
      }
    },
    Task: {
      form: {
        attrs: ["name", "description", "startDate", "dueDate",
          "priority", "isCompleted",
          "created", "createdBy", "updated", "updatedBy"]
      },
      list: {
        attrs: ["name", "description", "startDate", "dueDate",
          "priority", "isCompleted",
          "created", "createdBy", "updated", "updatedBy"]
      }
    },
    Opportunity: {
      form: {
        attrs: ["name", "description", "startDate", "dueDate",
          "amount", "stage", "priority", "isCompleted",
          "created", "createdBy", "updated", "updatedBy"]
      },
      list: {
        attrs: ["name", "description", "startDate", "dueDate",
          "amount", "stage", "priority", "isCompleted",
          "created", "createdBy", "updated", "updatedBy"]
      }
    }
  };

  keys = Object.keys(config);

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

  // Build app for each configured object
  keys.forEach(function (key) {
    var plural = f.catalog.data()[key].plural.toSpinalCase(),
      name = key.toSpinalCase();

    // Build UI
    app[key + "TableDisplay"] = f.components.tableDisplay({
      feather: key,
      attrs: config[key].list.attrs
    });

    app[key + "FormDisplay"] = f.components.formDisplay({
      feather: key,
      attrs: config[key].form.attrs
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

