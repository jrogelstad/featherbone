/*global m, f, window */

f.init().then(function () {

  var Contact, ContactsWidget, ContactForm, ContactList;

  Contact = function (data) {
    data = data || {};
    this.id = m.prop(data.id);
    this.name = m.prop(data.name);
    this.email = m.prop(data.email);
  };
  Contact.list = function (data) {
    return m.request({method: "GET", url: "/data/contacts", data: data});
  };
  Contact.save = function (model) {
    /*
    var contact = f.models.contact({
      id: data.id(),
      name: data.name(),
      email: data.email()
    });
*/
    return model.save();
  };

  ContactsWidget = {
    controller: function update() {
      this.contacts = Contact.list();
      this.save = function (contact) {
        Contact.save(contact).then(update.bind(this));
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
      //this.contact = m.prop(args.contact || new Contact());
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
          contact = new Contact(contact);
          return m("tr", [
            m("td", contact.id()),
            m("td", contact.name()),
            m("td", contact.email())
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

