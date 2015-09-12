/*global m, f, window */

f.init().then(function () {

  var Home, ContactForm, ContactList,
    ary = [],
    idx = {};

  f.models.contact.list = function (data) {
    return m.request({
      method: "GET",
      url: "/data/contacts",
      data: data
    }).then(function (data) {
      var id, model,
        len = data.length,
        i = 0;
      while (i < len) {
        id = data[i].id;
        model = f.models.contact(data[i]);
        if (idx[id]) {
          ary.splice(idx[id], 1, model);
        } else {
          idx[id] = ary.length;
          ary.push(model);
        }
        i++;
      }
      return ary;
    });
  };

  Home = {
    controller: function () {
      this.doContact = function () {
        m.route("/contact");
      };
      this.doContacts = function () {
        m.route("/contacts");
      };
    },
    view: function (ctrl) {
      return m("div", [
        m("button[type=button]", {
          onclick: ctrl.doContacts
        }, "Contacts")
      ]);
    }
  };

  ContactForm = {
    controller: function () {
      this.contact = m.prop(f.models.contact());
      this.doApply = function (contact) {
        contact.save();
      };
      this.doSave = function (contact) {
        contact.save().then(function () {
          m.route("/contacts");
        });
      };
      this.doContacts = function () {
        m.route("/contacts");
      };
    },
    view: function (ctrl) {
      var contact = ctrl.contact(),
        d = contact.data;

      return m("form", [
        m("button[type=button]", {
          onclick: ctrl.doContacts
        }, "Done"),
        m("button[type=button]", {
          onclick: ctrl.doApply.bind(this, contact)
        }, "Apply"),
        m("button[type=button]", {
          onclick: ctrl.doSave.bind(this, contact)
        }, "Save"),
        m("table", [
          m("tr", [
            m("td", [
              m("label", {for: "name"}, "Name:")
            ]),
            m("td", [
              m("input", {
                id: "name",
                type: "text",
                required: true,
                autofocus: true,
                oninput: m.withAttr("value", d.name),
                value: d.name()
              })
            ]),
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "email"}, "Email:")
            ]),
            m("td", [
              m("input", {
                id: "email",
                type: "email",
                oninput: m.withAttr("value", d.email),
                value: d.email()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "isActive"}, "Active:")
            ]),
            m("td", [
              m("input", {
                id: "isActive",
                type: "checkbox",
                oninput: m.withAttr("value", d.isActive),
                value: d.isActive()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", "Created:")
            ]),
            m("td", [
              m("input", {
                type: "datetime",
                readonly: true,
                oninput: m.withAttr("value", d.created),
                value: d.created()
              })
            ]),
          ]),
          m("tr", [
            m("td", [
              m("label", "Created By:")
            ]),
            m("td", [
              m("input", {
                type: "text",
                readonly: true,
                oninput: m.withAttr("value", d.createdBy),
                value: d.createdBy()
              })
            ]),
          ]),
          m("tr", [
            m("td", [
              m("label", "Updated:")
            ]),
            m("td", [
              m("input", {
                type: "datetime",
                readonly: true,
                oninput: m.withAttr("value", d.updated),
                value: d.updated()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", "Updated By:")
            ]),
            m("td", [
              m("input", {
                type: "text",
                readonly: true,
                oninput: m.withAttr("value", d.updatedBy),
                value: d.updatedBy()
              })
            ])
          ])
        ])
      ]);
    }
  };

  ContactList = {
    controller: function () {
      var selections = [];
      this.contacts = f.models.contact.list();
      this.doHome = function () {
        m.route("/home");
      };
      this.doContact = function () {
        m.route("/contact");
      };
      this.toggleSelect = function (id) {
        var sel = selections.indexOf(id);
        if (sel === -1) {
          selections.push(id);
          return true;
        }
        selections.splice(sel, 1);
        return false;
      };
      this.selected = function (id) {
        return selections.indexOf(id) !== -1;
      };
    },
    view: function (ctrl) {
      return m("div", [
        m("button[type=button]", {
          onclick: ctrl.doHome
        }, "Home"),
        m("button[type=button]", {
          onclick: ctrl.doContact
        }, "New"),
        m("table", [
          m("tr", [
            m("th", "Id"),
            m("th", "Name"),
            m("th", "Email")
          ]),
          ctrl.contacts().map(function (contact) {
            var d = contact.data,
              id = d.id();
            return m("tr", {
              onclick: ctrl.toggleSelect.bind(this, id),
              style: {
                backgroundColor: ctrl.selected(id) ? "LightBlue" : "White"
              }
            }, [
              m("td", d.id()),
              m("td", d.name()),
              m("td", d.email())
            ]);
          })
        ])
      ]);
    }
  };

  m.route(document.body, "/home", {
    "/home": Home,
    "/contacts": ContactList,
    "/contact": ContactForm
  });
});

window.onresize = function (event) {
  m.redraw(true);
};

