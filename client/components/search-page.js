/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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

/*global window*/
(function () {
  "use strict";

  var searchPage = {},
    m = require("mithril"),
    stream = require("stream"),
    button = require("button"),
    catalog = require("catalog"),
    searchInput = require("search-input"),
    tableWidget = require("table-widget"),
    sortDialog = require("sort-dialog"),
    filterDialog = require("filter-dialog");

  searchPage.viewModel = function (options) {
    var vm = {},
      feather = catalog.getFeather(options.feather.toCamelCase(true)),
      config = catalog.register("config")[options.config];

    // ..........................................................
    // PUBLIC
    //

    vm.buttonBack = stream();
    vm.buttonSelect = stream();
    vm.buttonClear = stream();
    vm.buttonFilter = stream();
    vm.buttonRefresh = stream();
    vm.buttonSort = stream();
    vm.doBack = function () {
      window.history.back();
    };
    vm.doSelect = function () {
      var receivers, selection;
      if (options.receiver) {
        receivers = catalog.register("receivers");
          if (receivers[options.receiver]) {
            selection = vm.tableWidget().selection();
            receivers[options.receiver].callback(selection);
            delete receivers[options.receiver];
          }
      }
      vm.doBack();
    };
    vm.filterDialog = stream();
    vm.sortDialog = stream();
    vm.searchInput = stream();
    vm.tableWidget = stream();
    vm.refresh = function () {
      vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create search input view model
    vm.searchInput(searchInput.viewModel({
      refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
      config: config,
      feather: options.feather.toCamelCase(true),
      search: vm.searchInput().value,
      ondblclick: vm.doSelect
    }));

    // Create dalog view models
    vm.filterDialog(filterDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather
    }));

    vm.sortDialog(sortDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather
    }));

    // Create button view models
    vm.buttonBack(button.viewModel({
      onclick: vm.doBack,
      label: "&Back",
      icon: "arrow-left",
      class: "suite-toolbar-button"
    }));

    vm.buttonSelect(button.viewModel({
      onclick: vm.doSelect,
      label: "&Select",
      title: vm.selectTitle,
      disabled: vm.selectDisabled,
      class: "suite-toolbar-button"
    }));
    vm.buttonSelect().isDisabled = function () {
      return !vm.tableWidget().selection();
    };
    vm.buttonSelect().title = function () {
      if (vm.buttonSelect().isDisabled()) {
        return "A row must be selected";
      }
      return "";
    };

    vm.buttonRefresh(button.viewModel({
      onclick: vm.refresh,
      title: "Refresh",
      hotkey: "R",
      icon: "refresh",
      style: {backgroundColor: "white"}
    }));

    vm.buttonClear(button.viewModel({
      onclick: vm.searchInput().clear,
      title: "Clear search",
      hotkey: "C",
      icon: "eraser",
      style: {backgroundColor: "white"}
    }));
    vm.buttonClear().isDisabled = function () {
      return !vm.searchInput().value();
    };

    vm.buttonFilter(button.viewModel({
      onclick: vm.filterDialog().show,
      title: "Filter",
      hotkey: "F",
      icon: "filter",
      style: {backgroundColor: "white"}
    }));

    vm.buttonSort(button.viewModel({
      onclick: vm.sortDialog().show,
      title: "Sort",
      hotkey: "O",
      icon: "sort",
      style: {backgroundColor: "white"}
    }));

    vm.buttonRefresh(button.viewModel({
      onclick: vm.refresh,
      title: "Refresh",
      hotkey: "R",
      icon: "refresh",
      style: {backgroundColor: "white"}
    }));

    vm.buttonClear(button.viewModel({
      onclick: vm.searchInput().clear,
      title: "Clear search",
      hotkey: "C",
      icon: "eraser",
      style: {backgroundColor: "white"}
    }));

    return vm;
  };

  searchPage.component = {
    oninit: function (vnode) {
      this.viewModel = vnode.attrs.viewModel || searchPage.viewModel(vnode.attrs);
    },

    onremove: function (vnode) {
      delete catalog.register("config")[vnode.attrs.config];
    },

    view: function () {
      var vm = this.viewModel;

      // Build view
      return m("div", {
          class: "pure-form"
        }, [
        m(button.component, {viewModel: vm.buttonBack()}),
        m(button.component, {viewModel: vm.buttonSelect()}),
        m(searchInput.component, {viewModel: vm.searchInput()}),
        m(button.component, {viewModel: vm.buttonRefresh()}),
        m(button.component, {viewModel: vm.buttonClear()}),
        m(button.component, {viewModel: vm.buttonSort()}),
        m(button.component, {viewModel: vm.buttonFilter()}),
        m(sortDialog.component, {viewModel: vm.sortDialog()}),
        m(filterDialog.component, {viewModel: vm.filterDialog()}),
        m(tableWidget.component, {viewModel: vm.tableWidget()})
      ]);
    }
  };

  catalog.register("components", "searchPage", searchPage.component);
  module.exports = searchPage;

}());


