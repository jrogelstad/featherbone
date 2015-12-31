(function () {
  "use strict";

  var searchDialog = {},
    m = require("mithril"),
    dialog = require("dialog"),
    searchInput = require("search-input"),
    tableWidget = require("table-widget");

  /**
    View model for table dialog.

    @param {Object} Options
  */
  searchDialog.viewModel = function (options) {
    options = options || {};
    var vm;

    // ..........................................................
    // PUBLIC
    //

    vm = dialog.viewModel(options);
    vm.okDisabled = function () {
      return !vm.tableWidget().selection();
    };
    vm.okTitle = function () {
      if (vm.okDisabled()) {
        return "A row must be selected";
      }
      return "";
    };
    vm.searchInput = m.prop();
    vm.tableWidget = m.prop();
    vm.content = function () {
      var opts = {viewModel: vm.tableWidget()};
      return m.component(tableWidget.component(opts));
    };
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
      config: options.config,
      search: vm.searchInput().value,
      ondblclick: vm.ok,
      outsideElementIds: [
        vm.ids().header,
        vm.ids().buttonOk
      ],
      heightMargin: 115
    }));

    vm.style().width = undefined;
    vm.style().margin = "25px";
    vm.style().top = "0px";

    return vm;
  };

  /**
    Table dialog component

    @params {Object} View model
  */
  searchDialog.component = dialog.component;

  module.exports = searchDialog;

}());
