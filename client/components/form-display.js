/*global window*/
(function () {
  "use strict";

  var formDisplay = {},
    m = require("mithril"),
    button = require("button"),
    catalog = require("catalog"),
    formWidget = require("form-widget");

  formDisplay.viewModel = function (options) {
    var vm = {}, state, toggleNew, isDisabled,
      wbkroute = "/" + options.workbook + "/" + options.sheet.name,
      frmroute = "/" + options.workbook + "/" + options.form;

    wbkroute = wbkroute.toSpinalCase();
    frmroute = frmroute.toSpinalCase();

    vm.buttonApply = m.prop();
    vm.buttonDone = m.prop();
    vm.buttonSave = m.prop();
    vm.buttonSaveAndNew = m.prop();
    vm.doApply = function () {
      vm.formWidget().model().save();
    };
    vm.doList = function () {
      m.route(wbkroute);
    };
    vm.doNew = function () {
      m.route(frmroute);
    };
    vm.doSave = function () {
      vm.model().save().then(function () {
        m.route(wbkroute);
      });
    };
    vm.doSaveAndNew = function () {
      vm.model().save().then(function () {
        m.route(frmroute);
      });
    };
    vm.formWidget = m.prop(formWidget.viewModel({
      feather: options.feather,
      id: options.id,
      config: options.config,
      outsideElementIds: ["toolbar"]
    }));
    vm.model = function () {
      return vm.formWidget().model();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create button view models
    vm.buttonDone(button.viewModel({
      onclick: vm.doList,
      label: "&Back",
      icon: "arrow-left"
    }));

    vm.buttonApply(button.viewModel({
      onclick: vm.doApply,
      label: "&Apply"
    }));

    vm.buttonSave(button.viewModel({
      onclick: vm.doSave,
      label: "&Save",
      icon: "cloud-upload"
    }));

    vm.buttonSaveAndNew(button.viewModel({
      onclick: vm.doSaveAndNew,
      label: "Save and &New",
      icon: "plus-circle"
    }));

    // Bind model state to display state
    isDisabled = function () { return !vm.model().canSave(); };
    vm.buttonApply().isDisabled = isDisabled;
    vm.buttonSave().isDisabled = isDisabled;
    toggleNew = function (isNew) {
      if (isNew) {
        vm.buttonSaveAndNew().label("&New");
        vm.buttonSaveAndNew().onclick(vm.doNew);    
      } else {
        vm.buttonSaveAndNew().label("Save and &New");
        vm.buttonSaveAndNew().onclick(vm.doSaveAndNew);  
      }
    };
    state = vm.model().state();
    state.resolve("/Ready/New").enter(toggleNew.bind(this, false));
    state.resolve("/Ready/Fetched/Clean").enter(toggleNew.bind(this, true));
    state.resolve("/Ready/Fetched/Dirty").enter(toggleNew.bind(this, false));

    return vm;
  };

  formDisplay.component = function (options) {
    var widget = {};

    widget.controller = function () {
      this.vm = formDisplay.viewModel({
        workbook: options.workbook,
        sheet: options.sheet,
        form: options.form,
        feather: options.feather,
        id: m.route.param("id"),
        config: options.config
      });
    };

    widget.view = function (ctrl) {
      var view,
        vm = ctrl.vm;

      // Build view
      view = m("div", [
        m("div", {
          id: "toolbar",
          class: "suite-header"
        }, [
          m.component(button.component({viewModel: vm.buttonDone()})),
          m.component(button.component({viewModel: vm.buttonApply()})),
          m.component(button.component({viewModel: vm.buttonSave()})),
          m.component(button.component({viewModel: vm.buttonSaveAndNew()}))
        ]),
        m.component(formWidget.component({viewModel: vm.formWidget()}))
      ]);

      return view;
    };

    return widget;
  };

  catalog.register("components", "formDisplay", formDisplay.component);
  module.exports = formDisplay;

}());


