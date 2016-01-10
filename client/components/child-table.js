/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {
  "use strict";

  var findRoot,
    childTable = {},
    m = require("mithril"),
    button = require("button"),
    catalog = require("catalog"),
    //formDialog = require("form-dialog"),
    tableWidget = require("table-widget");

  findRoot = function (model) {
    var parent,
      d = model.data,
      keys = Object.keys(d);

    parent = keys.find(function (key) {
      if (d[key].isChild()) { return true; }
    });

    return parent ? findRoot(d[parent]()) : model;
  };

  /**
    View model for child table.

    @param {Object} Options
    @param {Array} [options.models] Array of child models
    @param {String} [options.feather] Feather
    @param {Array} [options.config] Column configuration
  */
  childTable.viewModel = function (options) {
    var tableState,
      root = findRoot(options.parentModel),
      vm = {};

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
      feather: options.feather,
      //ondblclick: vm.formDialog().show,
      outsideElementIds: [],
      heightMargin: 0
    }));
    vm.tableWidget().toggleEdit();

    // Create button view models
    vm.buttonAdd(button.viewModel({
      onclick: vm.tableWidget().modelNew,
      title: "Add",
      hotkey: "D",
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
    vm.buttonRemove().disable();

    vm.buttonUndo(button.viewModel({
      onclick: vm.tableWidget().undo,
      title: "Undo",
      hotkey: "U",
      icon: "undo",
      style: {backgroundColor: "white"}
    }));
    vm.buttonUndo().hide();

    vm.buttonOpen(button.viewModel({
      //onclick: vm.formDialog().show,
      title: "Open",
      hotkey: "O",
      icon: "folder-open",
      style: {
        backgroundColor: "white",
        float: "right"
      }
    }));
    vm.buttonOpen().disable();

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
      vm.buttonOpen().disable();
      vm.buttonRemove().disable();
      vm.buttonRemove().show();
      vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
      vm.buttonOpen().enable();
      vm.buttonRemove().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
      vm.buttonRemove().show();
      vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
      vm.buttonRemove().hide();
      vm.buttonUndo().show();
    });
    root.state().resolve("/Ready/Fetched/Clean").enter(function () {
      var selection = vm.tableWidget().selection(),
        found = function (model) {
          return selection.id() === model.id();
        };
      // Unselect potentially deleted model
      if (selection && !vm.tableWidget().models().some(found)) {
        vm.tableWidget().select(undefined);
      }
    });

    return vm;
  };

  /**
    Child table component

    @params {Object} View model
  */
  childTable.component = function (options) {
    var config,
      component = {},
      parentViewModel = options.parentViewModel,
      parentProperty = options.parentProperty,
      prop = parentViewModel.model().data[parentProperty],
      models = prop(),
      feather = prop.type.relation;

    config = parentViewModel.config().attrs.find(function (item)  {
      return item.attr === parentProperty;
    });

    component.controller = function () {
      var relations = options.parentViewModel.relations();

      // Set up viewModel if required
      if (!relations[parentProperty]) {
        relations[parentProperty] = childTable.viewModel({
          parentModel: parentViewModel.model(),
          models: models,
          feather: feather,
          config: config
        });
      }
      this.vm = relations[parentProperty];
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
