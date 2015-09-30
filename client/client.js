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

  ContactForm = f.components.formDisplay({
    feather: "Contact",
    properties: ["name", "isActive", "email", "birthDate", "workPhone",
      "homePhone", "creditScore", "role", "created", "createdBy", "updated",
      "updatedBy"]
  });

  ContactDisplay = f.components.tableDisplay({
    feather: "Contact",
    properties: ["name", "email", "isActive", "birthDate", "workPhone",
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

