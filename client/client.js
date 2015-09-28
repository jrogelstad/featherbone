/*global m, f, window */

f.init().then(function () {

  var Home, ContactForm, ContactDisplay;

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
      this.vm = f.viewModels.formViewModel("Contact", m.route.param("id"));
    },
    view: function (ctrl) {
      var model = ctrl.vm.model,
        d = model.data,
        roleWidget = f.components.relationWidget({
          parentProperty: "role",
          valueProperty: "name",
          labelProperty: "description"
        });

      return m("form", [
        m("button", {
          type: "button",
          onclick: ctrl.vm.doList
        }, "Done"),
        m("button", {
          type: "button",
          disabled: !ctrl.vm.isDirty(),
          onclick: ctrl.vm.doApply
        }, "Apply"),
        m("button", {
          type: "button",
          disabled: !ctrl.vm.isDirty(),
          onclick: ctrl.vm.doSave
        }, "Save"),
        m("button", {
          type: "button",
          onclick: ctrl.vm.isDirty() ? ctrl.vm.doSaveAndNew : ctrl.vm.doNew
        }, ctrl.vm.isDirty() ? "Save & New" : "New"),
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
                onchange: m.withAttr("value", d.name),
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
                onchange: m.withAttr("value", d.email),
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
                onchange: m.withAttr("value", d.birthDate),
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
                onchange: m.withAttr("value", d.workPhone),
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
                onchange: m.withAttr("value", d.homePhone),
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
                onchange: m.withAttr("value", d.creditScore),
                value: d.creditScore()
              })
            ])
          ]),
          m("tr", [
            m("td", [
              m("label", {for: "role"}, "Role:")
            ]),
            m("td", [
              m.component(roleWidget, {
                viewModel: ctrl.vm
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
                readonly: true,
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
                readonly: true,
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
                value: d.updatedBy()
              })
            ])
          ])
        ])
      ]);
    }
  };

  ContactDisplay = f.components.tableDisplay({
    feather: "Contact",
    columns: ["name", "email", "isActive", "birthDate", "workPhone",
      "homePhone", "creditScore"]
  });

  m.route(document.body, "/home", {
    "/home": Home,
    "/contacts": ContactDisplay,
    "/contact": ContactForm,
    "/contact/:id": ContactForm
  });
});

window.onresize = function (event) {
  m.redraw(true);
};

