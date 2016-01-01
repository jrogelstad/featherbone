(function () {
  "use strict";

  var formDialog = {},
    m = require("mithril"),
    dialog = require("dialog"),
    catalog = require("catalog");

  /**
    View model for form dialog.

    @param {Object} Options
  */
  formDialog.viewModel = function (options) {
    var vm,
      feather = catalog.getFeather(options.config.feather);

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || feather.plural.toName();
    options.icon = options.icon || "file-text";

    vm = dialog.viewModel(options);
    vm.formDialog = m.prop();
    vm.okDisabled = function () {
      return true;
    };
    vm.okTitle = function () {
      return "";
    };
    vm.content = function () {
      return m("div", []);
    };

    // ..........................................................
    // PRIVATE
    //

    // Create dalog view models
    vm.formDialog(formDialog.viewModel({
      feather: feather
    }));

    vm.style().width = undefined;
    vm.style().margin = "25px";
    vm.style().top = "0px";

    return vm;
  };

  /**
    Form dialog component

    @params {Object} View model
  */
  formDialog.component = dialog.component;
  module.exports = formDialog;

}());
