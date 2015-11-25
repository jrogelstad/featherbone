/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global window, f, m */
(function (f) {
  "use strict";

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.sortDialogViewModel = function (options) {
    var vm;

    // ..........................................................
    // PUBLIC
    //

    options.propertyName = "sort";
    vm = f.viewModels.filterDialogViewModel(options);
    vm.itemOrderChanged = function (index, value) {
      var sort = vm.data();
      sort[index].order = value;
    };
    vm.viewHeaders = function () {
      return [
        m("th", {style: {minWidth: "150px"}}, "Column"),
        m("th", {style: {minWidth: "150px"}}, "Order")
      ];
    };
    vm.viewRows = function () {
      var view;

      view = vm.items().map(function (item) {
        var row,
          color = "White";

        if (vm.selection() === item.index) {
          if (vm.isSelected()) {
            color = "LightSkyBlue" ;
          } else {
            color = "AliceBlue";
          }
        }

        row = m("tr", {
          onclick: vm.selection.bind(this, item.index, true),
          style: {backgroundColor: color}
        },[
          m("td",
            m("select", {
              style: {minWidth: "150px"}, 
              value: item.property,
              onchange: m.withAttr("value", vm.itemValueChanged.bind(this, item.index))
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", [
            m("select", {
              style: {minWidth: "150px"},
              onchange: m.withAttr("value", vm.itemOrderChanged.bind(this, item.index))
            },[
              m("option", {value: "ASC"}, "Ascending"),
              m("option", {value: "DESC"}, "Descending")
            ], item.order || "ASC")
          ])
        ]);

        return row;
      });

      return view;
    };

    return vm;
  };

}(f));


