(function () {
  "use strict";

  var searchDialog = {},
    m = require("mithril"),
    f = require("component-core"),
    button = require("button"),
    dialog = require("dialog"),
    catalog = require("catalog"),
    searchInput = require("search-input"),
    tableWidget = require("table-widget"),
    sortDialog = require("sort-dialog"),
    filterDialog = require("filter-dialog");

  /**
    View model for table dialog.

    @param {Object} Options
  */
  searchDialog.viewModel = function (options) {
    var vm,
      feather = catalog.getFeather(options.config.feather);

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || feather.plural.toName();
    options.icon = options.icon || "search";

    vm = dialog.viewModel(options);
    vm.buttonClear = m.prop();
    vm.buttonFilter = m.prop();
    vm.buttonRefresh = m.prop();
    vm.buttonSort = m.prop();
    vm.filterDialog = m.prop();
    vm.okDisabled = function () {
      return !vm.tableWidget().selection();
    };
    vm.okTitle = function () {
      if (vm.okDisabled()) {
        return "A row must be selected";
      }
      return "";
    };
    vm.sortDialog = m.prop();
    vm.searchInput = m.prop();
    vm.tableWidget = m.prop();
    vm.content = function () {
      return m("div", [
        m.component(searchInput.component({viewModel: vm.searchInput()})),
        m.component(button.component({viewModel: vm.buttonRefresh()})),
        m.component(button.component({viewModel: vm.buttonClear()})),
        m.component(button.component({viewModel: vm.buttonSort()})),
        m.component(button.component({viewModel: vm.buttonFilter()})),
        m.component(sortDialog.component({viewModel: vm.sortDialog()})),
        m.component(filterDialog.component({viewModel: vm.filterDialog()})),
        m.component(tableWidget.component({viewModel: vm.tableWidget()}))
      ]);
    };
    vm.refresh = function () {
      vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    vm.ids().searchInput = f.createId();

    // Create search input view model
    vm.searchInput(searchInput.viewModel({
      refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
      config: options.config,
      search: vm.searchInput().value,
      ondblclick: vm.ok,
      outsideElementIds: [
        vm.ids().header,
        vm.ids().buttonOk,
        vm.searchInput().id()
      ],
      heightMargin: 115
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

    vm.style().width = undefined;
    vm.style().margin = "25px";
    vm.style().top = "0px";

    return vm;
  };

  /**
    Search dialog component

    @params {Object} View model
  */
  searchDialog.component = dialog.component;

  module.exports = searchDialog;

}());
