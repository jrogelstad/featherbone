/*global m, f, window */

f.init().then(function () {

  var ContactsWidget, ContactForm, ContactList;

  f.models.contact.list = function (data) {
    return m.request({
      method: "GET",
      url: "/data/contacts",
      data: data
    }).then(function (data) {
      return data.map(function (item) {
        return f.models.contact(item);
      });
    });
  };

  ContactsWidget = {
    controller: function update() {
      this.contacts = f.models.contact.list();
      this.save = function (contact) {
        contact.save().then(update.bind(this));
      }.bind(this);
    },
    view: function (ctrl) {
      return [
        m.component(ContactForm, {onsave: ctrl.save}),
        m.component(ContactList, {contacts: ctrl.contacts})
      ];
    }
  };

  ContactForm = {
    controller: function (args) {
      this.contact = m.prop(args.contact || f.models.contact());
    },
    view: function (ctrl, args) {
      var contact = ctrl.contact();

      return m("form", [
        m("label", "Name"),
        m("input", {
          oninput: m.withAttr("value", contact.data.name),
          value: contact.data.name()
        }),

        m("label", "Email"),
        m("input", {
          oninput: m.withAttr("value", contact.data.email),
          value: contact.data.email()
        }),

        m("button[type=button]", {
          onclick: args.onsave.bind(this, contact)
        }, "Save")
      ]);
    }
  };

  ContactList = {
    view: function (ctrl, args) {
      return m("table", [
        args.contacts().map(function (contact) {
          return m("tr", [
            m("td", contact.data.id()),
            m("td", contact.data.name()),
            m("td", contact.data.email())
          ]);
        })
      ]);
    }
  };

  m.mount(document.body, ContactsWidget);
/*
  var Observable, ContactsWidget, ContactForm, ContactList, list;

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
    var data = {data: model.toJSON()};
    Contact.save(data).then(Observable.trigger("updateContact"));
  });

  ContactsWidget = {
    controller: Observable.register(["updateContact"], function () {
      this.contacts = Contact.list();
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
          var model = f.models.contact(contact),
            d = model.data;
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
*/
});


window.onresize = function (event) {
  m.redraw(true);
};

