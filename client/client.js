/*global m, f, window */

f.init().then(function () {

  var Home, ContactForm, ContactList;

  Home = {
    controller: function () {
      this.goContacts = function () {
        m.route("/contacts");
      };
    },
    view: function (ctrl) {
      return m("div", [
        m("button[type=button]", {
          onclick: ctrl.goContacts
        }, "Contacts")
      ]);
    }
  };

  ContactForm = {
    controller: function () {
      var id = m.route.param("id"),
        model = f.models.contact();
      this.contact = m.prop(model);
      this.doApply = function () {
        model.save();
      };
      this.doNew = function () {
        m.route("/contact");
      };
      this.doSave = function () {
        model.save().then(function () {
          m.route("/contacts");
        });
      };
      this.doSaveAndNew = function () {
        model.save().then(function () {
          m.route("/contact");
        });
      };
      this.goContacts = function () {
        m.route("/contacts");
      };
      this.isDirty = function () {
        var currentState = model.state.current()[0];
        return currentState === "/Ready/New" ||
          currentState === "/Ready/Fetched/Dirty";
      };
      if (id) {
        model.data.id(id);
        model.fetch();
      }
    },
    view: function (ctrl) {
      var contact = ctrl.contact(),
        d = contact.data;

      return m("form", [
        m("button", {
          type: "button",
          onclick: ctrl.goContacts
        }, "Done"),
        m("button", {
          type: "button",
          disabled: !ctrl.isDirty(),
          onclick: ctrl.doApply
        }, "Apply"),
        m("button", {
          type: "button",
          disabled: !ctrl.isDirty(),
          onclick: ctrl.doSave
        }, "Save"),
        m("button", {
          type: "button",
          onclick: ctrl.isDirty() ? ctrl.doSaveAndNew : ctrl.doNew
        }, ctrl.isDirty() ? "Save & New" : "New"),
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
                onclick: m.withAttr("checked", d.isActive),
                checked: d.isActive()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "birthDate"}, "Birth Date:")
            ]),
            m("td", [
              m("input", {
                id: "birthDate",
                type: "date",
                oninput: m.withAttr("value", d.birthDate),
                value: d.birthDate()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "workPhone"}, "Work Phone:")
            ]),
            m("td", [
              m("input", {
                id: "workPhone",
                type: "tel",
                oninput: m.withAttr("value", d.workPhone),
                value: d.workPhone()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "homePhone"}, "Home Phone:")
            ]),
            m("td", [
              m("input", {
                id: "homePhone",
                type: "tel",
                oninput: m.withAttr("value", d.homePhone),
                value: d.homePhone()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "creditScore"}, "Credit Score:")
            ]),
            m("td", [
              m("input", {
                id: "creditScore",
                type: "number",
                min: 0,
                max: 800,
                oninput: m.withAttr("value", d.creditScore),
                value: d.creditScore()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", "Created:")
            ]),
            m("td", [
              m("input", {
                type: "datetime-local",
                readonly: false,
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
                type: "datetime-local",
                readonly: false,
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
      var selection,
        that = this;

      this.contacts = f.models.contact.list();
      this.hasSelection = function () {
        return !selection;
      };
      this.deleteContact = function () {
        selection.delete().then(function () {
          that.contacts().remove(selection);
          m.route("/contacts");
        });
      };
      this.goHome = function () {
        m.route("/home");
      };
      this.newContact = function () {
        m.route("/contact");
      };
      this.openContact = function () {
        m.route("/contact/" + selection.data.id());
      };
      this.selected = function (model) {
        return selection === model;
      };
      this.toggleOpen = function (model) {
        selection = model;
        that.openContact();
      };
      this.toggleSelect = function (model) {
        if (selection === model) {
          selection = undefined;
          return false;
        }
        selection = model;
        return true;
      };
    },
    view: function (ctrl) {
      return m("div", [
        m("button", {
          type: "button",
          onclick: ctrl.goHome
        }, "Home"),
        m("button", {
          type: "button",
          onclick: ctrl.newContact
        }, "New"),
        m("button", {
          type: "button",
          onclick: ctrl.openContact,
          disabled: ctrl.hasSelection()
        }, "Open"),
        m("button", {
          type: "button",
          onclick: ctrl.deleteContact,
          disabled: ctrl.hasSelection()
        }, "Delete"),
        m("table", [
          (function () {
            var feather = f.catalog.getFeather("Contact"),
              tds = Object.keys(feather.properties).map(function (key) {
                return m("td", key.toProperCase(true));
              });
            return m("tr", {style: {backgroundColor: "LightGrey"}}, tds);
          }()),
          ctrl.contacts().map(function (contact) {
            var d = contact.data,
              tds = Object.keys(d).map(function (key) {
                var value = d[key](),
                  hasLocale = value !== null &&
                    typeof value.toLocaleString === "function";
                return m("td", hasLocale ? value.toLocaleString() : value);
              });
            return m("tr", {
              onclick: ctrl.toggleSelect.bind(this, contact),
              ondblclick: ctrl.toggleOpen.bind(this, contact),
              style: {
                backgroundColor: ctrl.selected(contact) ? "LightBlue" : "White"
              }
            }, tds);
          })
        ])
      ]);
    }
  };

  m.route(document.body, "/home", {
    "/home": Home,
    "/contacts": ContactList,
    "/contact": ContactForm,
    "/contact/:id": ContactForm
  });
});

window.onresize = function (event) {
  m.redraw(true);
};

