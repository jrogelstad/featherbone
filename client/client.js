/*global m, f */

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
      m("table", [
        app.vm.list.map(function (contact, index) {
          return m("tr", [
            m("td", [
              m("input", {
                onchange: m.withAttr("value", contact.data.first),
                value: contact.data.first()
              })
            ]),
            m("td", [
              m("input", {
                onchange: m.withAttr("value", contact.data.last),
                value: contact.data.last()
              })
            ])
          ]);
        })
      ])
    ])
  ]);
};

m.mount(document, {controller: app.controller, view: app.view});

