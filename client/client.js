/*global m, f, window */

f.init().then(function () {

  var Home, ContactForm, ContactTable, ContactList;

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
      this.log = function (msg) {
        console.log(msg);
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
              m("label", {for: "role"}, "Role:")
            ]),
            m("td", [
              m("input", {
                id: "role",
                type: "text",
              }),
              m("div", {
                id: "roleList",
                style: {
                  position: "relative"
                }
              }, [
                m("div", {
                  id: "roleScroller",
                  style: {
                    display: "block",
                    backgroundColor: "White",
                    position: "absolute",
                    zIndex: 9999,
                    top: "1px",
                    maxHeight: "100px",
                    width: "172px",
                    overflowY: "scroll",
                    borderLeft: "1px solid lightgrey",
                    borderRight: "1px solid lightgrey",
                    borderBottom: "1px solid lightgrey"
                  }
                }, [
                  m("div", "One"),
                  m("div", "Two"),
                  m("div", "Three"),
                  m("div", "Four"),
                  m("div", "Five"),
                  m("div", "Six"),
                  m("div", "Seven"),
                  m("div", "Eight"),
                  m("div", "Nine"),
                  m("div", "Ten")
                ])
              ])
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

  ContactTable = f.components.tableDisplay({
    feather: "Contact",
    columns: ["name", "email", "isActive", "birthDate", "workPhone",
      "homePhone", "creditScore"]
  });

  ContactList = {
    view: function () {
      return m.component(ContactTable);
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

