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
    /*
    vm.searchInput(searchInput.viewModel({
      refresh: vm.refresh
    }));
*/
    // Create table widget view model
    /*
    tableWidget.viewModel({
      config: options.config,
      search: vm.searchInput().value,
      ondblclick: function () {
        vm.close();
      }
    });
    */
    return vm;
  };

  /**
    Table dialog component

    @params {Object} View model
  */
  searchDialog.component = dialog.component;

  module.exports = searchDialog;

}());
