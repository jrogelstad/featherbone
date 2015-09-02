/*global m, f, window */

var app = {};

app.contact = function (data, model) {
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

app.contactList = Array;

app.vm = (function () {
  var vm = {};
  vm.fetch = function () {
    var ds = f.dataSource,
      result = f.prop({}),
      payload = {method: "GET", path: "/data/contacts"},
      callback = function () {
        vm.list.length = 0;
        result().forEach(function (item) {
          var obj = app.contact(item);
          vm.list.push(obj);
        });
      };

    ds.request(payload).then(result).then(callback);
  };
  vm.init = function () {
    vm.list = new app.contactList();
  };
  return vm;
}());

app.controller = function () {
  app.vm.init();
};

app.view = function () {
  return m("html", [
    m("body", [
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
    ])
  ]);
};

m.mount(document, {controller: app.controller, view: app.view});

window.onresize = function (event) {
  m.redraw(true);
};

