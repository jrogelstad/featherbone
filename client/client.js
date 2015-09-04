/*global m, f, window */

var app = {};

app.home = {
  controller: function () {
    return {
      onunload: function () {
        console.log("unloading home component");
      }
    };
  },
  view: function () {
    return m("div", "Home");
  }
};

app.contacts = {};

app.contacts.contact = function (data, model) {
  var shared = model || f.catalog.getModel("Contact"),
    that = f.object(data, shared);

  // ..........................................................
  // EVENT BINDINGS
  //

  that.onChange("first", function (prop) {
    console.log("First name changing from " +
      (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
  });

  that.onChange("last", function (prop) {
    console.log("Last name changing from " +
      (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
  });

  that.onChange("id", function (prop) {
    console.log("Id changing from " +
      (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
  });

  that.onValidate(function (validator) {
    if (!that.data.first()) {
      throw "First name must not be empty.";
    }
  });

  that.onError(function (err) {
    console.log("Error->", err);
  });

  return that;
};

app.contacts.list = Array;

app.vm = (function () {
  var vm = {};
  vm.fetch = function () {
    var ds = f.dataSource,
      result = f.prop({}),
      payload = {method: "GET", path: "/data/contacts"},
      callback = function () {
        vm.list.length = 0;
        result().forEach(function (item) {
          var obj = app.contacts.contact(item);
          vm.list.push(obj);
        });
      };

    ds.request(payload).then(result).then(callback);
  };
  vm.init = function () {
    vm.list = new app.contacts.list();
  };
  return vm;
}());

app.contacts.controller = function () {
  app.vm.init();
};

app.contacts.view = function () {
  return m("div", [
    m("button", {
      onclick: app.vm.fetch
    }, "Fetch"),
    m("div", {style: {fontFamily: "arial", overflowY: "auto",
      maxHeight: window.innerHeight - 30 + "px"}}, [
      app.vm.list.map(function (contact, index) {
        var d = contact.data;
        return m("div", [
          m("b", d.last()),
          m("span", ", " + d.first())
        ]);
      })
    ])
  ]);
};

m.route(document.body, "/home", {
  "/home": app.home,
  "/contacts": app.contacts
});

window.onresize = function (event) {
  m.redraw(true);
};




