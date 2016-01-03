(function () {
  "use strict";

  var childTable = {},
    m = require("mithril"),
    button = require("button"),
    catalog = require("catalog"),
    //formDialog = require("form-dialog"),
    tableWidget = require("table-widget");

  /**
    View model for child table.

    @param {Object} Options
  */
  childTable.viewModel = function (options) {
    var vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.buttonAdd = m.prop();
    vm.buttonOpen = m.prop();
    vm.buttonRemove = m.prop();
    vm.buttonUndo = m.prop();
    //vm.formDialog = m.prop();
    vm.tableWidget = m.prop();
    vm.refresh = function () {
      vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create dalog view model
    /*
    vm.formDialog(formDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather
    }));
    */

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
      config: options.config,
      models: options.models,
      //ondblclick: vm.formDialog().show,
      outsideElementIds: [],
      heightMargin: 0
    }));
    vm.tableWidget().toggleEdit();

    // Create button view models
    vm.buttonAdd(button.viewModel({
      onclick: vm.tableWidget().modelNew,
      title: "Add",
      hotkey: "A",
      icon: "plus-circle",
      style: {backgroundColor: "white"}
    }));

    vm.buttonRemove(button.viewModel({
      onclick: vm.tableWidget().modelDelete,
      title: "Remove",
      hotkey: "V",
      icon: "remove",
      style: {backgroundColor: "white"}
    }));

    vm.buttonUndo(button.viewModel({
      onclick: vm.tableWidget().undo,
      title: "Undo",
      hotkey: "U",
      icon: "undo",
      style: {backgroundColor: "white"}
    }));

    vm.buttonOpen(button.viewModel({
      onclick: vm.formDialog().show,
      title: "Open",
      hotkey: "O",
      icon: "folder-open",
      style: {
        backgroundColor: "white",
        float: "right"
      }
    }));

    return vm;
  };

  /**
    Child table component

    @params {Object} View model
  */
  childTable.component = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel;
    };

    component.view = function (ctrl) {
      var view,
        vm = ctrl.vm;

      view = m("div", [
        m.component(button.component({viewModel: vm.buttonAdd()})),
        m.component(button.component({viewModel: vm.buttonOpen()})),
        m.component(button.component({viewModel: vm.buttonRemove()})),
        m.component(button.component({viewModel: vm.buttonUndo()})),
        //m.component(formDialog.component({viewModel: vm.formDialog()})),
        m.component(tableWidget.component({viewModel: vm.tableWidget()}))
      ]);

      return view;
    };

    return component;
  };

  catalog.register("components", "childTable", childTable.component);

  module.exports = childTable;

}());
