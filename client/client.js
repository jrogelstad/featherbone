/*global m, f, window */

f.init().then(function () {

  var Home, ContactFormDisplay, ContactTableDisplay;

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

  ContactFormDisplay = f.components.formDisplay({
    feather: "Contact",
    attrs: ["name", "isActive", "email", "birthDate", "workPhone",
      "homePhone", "creditScore", "role", "created", "createdBy", "updated",
      "updatedBy"]
  });

  ContactTableDisplay = f.components.tableDisplay({
    feather: "Contact",
    attrs: ["name", "email", "isActive", "birthDate", "workPhone",
      "homePhone", "creditScore"]
  });

  m.route(document.body, "/home", {
    "/home": Home,
    "/contacts": ContactTableDisplay,
    "/contact": ContactFormDisplay,
    "/contact/:id": ContactFormDisplay
  });
});

window.onresize = function (event) {
  m.redraw(true);
};

