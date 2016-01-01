(function () {
  "use strict";

  var sortDialog = {},
    m = require("mithril"),
    f = require("feather-core"),
    filterDialog = require("filter-dialog");

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.filter] Filter property
  */
  sortDialog.viewModel = function (options) {
    options = options || {};
    var vm;

    options.propertyName = "sort";
    options.title = options.title || "Sort";
    options.icon = options.icon || "sort";

    // ..........................................................
    // PUBLIC
    //

    vm = filterDialog.viewModel(options);
    vm.addAttr = function (attr) {
      if (!this.some(vm.hasAttr.bind(attr))) {
        this.push({property: attr});
        return true;
      }
    };
    vm.viewHeaderIds = m.prop({
      column: f.createId(),
      order: f.createId()
    });
    vm.viewHeaders = function () {
      var ids = vm.viewHeaderIds();
      return [
        m("th", {style: {minWidth: "175px"}, id: ids.column}, "Column"),
        m("th", {style: {minWidth: "175px"}, id: ids.order}, "Order")
      ];
    };
    vm.viewRows = function () {
      var view;

      view = vm.items().map(function (item) {
        var row;

        row = m("tr", {
          onclick: vm.selection.bind(this, item.index, true),
          style: {backgroundColor: vm.rowColor(item.index)}
        },[
          m("td", {
           style: {minWidth: "175px", maxWidth: "175px"}
          }, m("select", {
              value: item.property,
              onchange: m.withAttr("value", vm.itemChanged.bind(this, item.index, "property"))
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", {
            style: {minWidth: "175px", maxWidth: "175px"}
          },[
            m("select", {
              value: item.order || "ASC",
              onchange: m.withAttr("value", vm.itemChanged.bind(this, item.index, "order"))
            },[
              m("option", {value: "ASC"}, "Ascending"),
              m("option", {value: "DESC"}, "Descending")
            ])
          ])
        ]);

        return row;
      });

      return view;
    };

    vm.style().width = "460px";

    return vm;
  };

  sortDialog.component = filterDialog.component;
  module.exports = sortDialog;

}());


