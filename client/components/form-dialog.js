(function () {
  "use strict";

  var formDialog = {},
    m = require("mithril"),
    dialog = require("dialog"),
    formWidget = require("form-widget");

  /**
    View model for form dialog.

    @param {Object} Options
  */
  formDialog.viewModel = function (options) {
    var vm, substate,
      onOk = options.onOk;

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || options.feather.toName();
    options.icon = options.icon || "file-text";
    options.onOk = function () {
      var model = vm.formWidget().model();
      model.save().then(function () {
        if (onOk) { onOk(model); }
      });
    };

    vm = dialog.viewModel(options);
    vm.formWidget = m.prop();
    vm.modelId = m.prop(options.id);
    vm.okDisabled = function () {
      var w = vm.formWidget();
      return w ? !w.model().canSave() : true;
    };
    vm.okTitle = function () {
      var w = vm.formWidget();
      return w ? w.model().lastError() : "";
    };
    vm.content = function () {
      var state = vm.state();
      return state.resolve(state.current()[0]).content();
    };

    // ..........................................................
    // PRIVATE
    //

    // Only create the form instance when showing. Otherwise leads to creating forms
    // for entire relation tree which is too heavy and could lead to infinite loops
    substate = vm.state().resolve("/Display/Closed");
    substate.content = function () {
      return m("div"); 
    };
    substate = vm.state().resolve("/Display/Showing");
    substate.enter(function () {
      // Create dalog view models
      vm.formWidget(formWidget.viewModel({
        feather: options.feather,
        attrs: options.attrs,
        id: vm.modelId(),
        outsideElementIds: [
          vm.ids().header,
          vm.ids().buttonOk
        ]
      }));
    });
    substate.content = function () {
      return  m.component(formWidget.component({viewModel: vm.formWidget()}));
    };
    substate.exit(function () {
      vm.formWidget(undefined);
    });

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
