/*global m, f, window */

f.init().then(function () {

  var Observable, ContactsWidget, ContactForm, ContactList, list;

  list = function (data) {
    return m.request({
      method: "GET",
      url: "/data/contacts",
      data: data
    }).then(function (contacts) {
      return contacts.map(function (data) {
        var model = f.models.contact(data);
        model.state.goto("/Ready/Fetched");
        return model;
      });
    });
  };

  Observable = function () {
    var channels = {};
    return {
      register: function (subscriptions, controller) {
        return function self() {
          var ctrl = new controller,
            reload = controller.bind(ctrl);
          Observable.on(subscriptions, reload);
          ctrl.onunload = function () {
            Observable.off(reload);
          };
          return ctrl;
        };
      },
      on: function (subscriptions, callback) {
        subscriptions.forEach(function (subscription) {
          if (!channels[subscription]) { channels[subscription] = []; }
          channels[subscription].push(callback);
        });
      },
      off: function (callback) {
        var index, keys;
        keys = Object.keys(channels);
        keys.forEach(function (channel) {
          index = channels[channel].indexOf(callback);
          if (index > -1) { channels[channel].splice(index, 1); }
        });
      },
      trigger: function (channel, args) {
        console.log(channel);
        channels[channel].map(function (callback) {
          callback(args);
        });
      }
    };
  }.call();

  //model layer observer
  Observable.on(["saveContact"], function (model) {
    model.save().then(Observable.trigger("updateContact"));
  });

  ContactsWidget = {
    controller: Observable.register(["updateContact"], function () {
      this.contacts = list();
    }),
    view: function (ctrl) {
      return [
        m.component(ContactForm),
        m.component(ContactList, {contacts: ctrl.contacts})
      ];
    }
  };

  ContactForm = {
    controller: function (args) {
      var that = this;
      this.contact = f.models.contact();
      this.save = function () {
        Observable.trigger("saveContact", that.contact);
      };
    },
    view: function (ctrl, args) {
      var contact = ctrl.contact,
        d = contact.data;

      return m("form", [
        m("label", "Name"),
        m("input", {
          oninput: m.withAttr("value", d.name),
          value: d.name()
        }),

        m("label", "Email"),
        m("input", {
          oninput: m.withAttr("value", d.email),
          value: d.email()
        }),

        m("button[type=button]", {
          onclick: ctrl.save
        }, "Save")
      ]);
    }
  };

  ContactList = {
    view: function (ctrl, args) {
      return m("table", [
        args.contacts().map(function (contact) {
          var d = contact.data;
          return m("tr", [
            m("td", d.id()),
            m("td", d.name()),
            m("td", d.email())
          ]);
        })
      ]);
    }
  };

  m.mount(document.body, ContactsWidget);

});

window.onresize = function (event) {
  m.redraw(true);
};

