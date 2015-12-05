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
    @param {Function} [options.config] Filter property being modified
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.sheetConfigureDialogViewModel = function (options) {
    options = options || {};
    var vm, tableView,
      cache = f.copy(options.parentViewModel.sheet());

    options.onclickOk = function () {
      var route,
        sheet = vm.model().toJSON(),
        workbook = vm.workbook();

      vm.sheet(sheet);
      workbook.data.localConfig(vm.config());
      f.buildRoutes(workbook.toJSON());
      route = "/" + workbook.data.name() + "/" + sheet.name;
      route = route.toSpinalCase();
      m.route(route);
      vm.state().send("close");
    };
    options.icon = "gear";
    options.title = "Configure worksheet";

    // ..........................................................
    // PUBLIC
    //

    vm = f.viewModels.tableDialogViewModel(options);
    tableView = vm.content;
    vm.addAttr = function (attr) {
      if (!this.some(vm.hasAttr.bind(attr))) {
        this.push({attr: attr});
        return true;
      }
    };
    vm.attrs = function () {
      return options.parentViewModel.attrs();
    };
    vm.content = function () {
      var feathers,
        d = vm.model().data,
        nameId = f.createId(),
        featherId = f.createId();

      feathers = vm.feathers().map(function (feather) {
        return m("option", feather);
      });

      return m("form", {
        class: "pure-form pure-form-aligned"
      }, [
        m("div", {class: "pure-control-group"}, [
          m("label", {
            for: nameId
          }, "Name:"),
          m("input", {
            value: d.name(),
            oninput: m.withAttr("value", d.name)
          })
        ]),
        m("div", {class: "pure-control-group"}, [
          m("label", {
            for: featherId
          }, "Feather:"),
          m("select", {
            value: d.feather(),
            oninput: m.withAttr("value", d.feather)
          }, feathers)
        ]),
        tableView()
      ]);
    };
    vm.data = m.prop(cache.list.columns);
    vm.feathers = function () {
      var feathers = f.catalog.data(),
        result = Object.keys(feathers).filter(function (name) {
          return !feathers[name].isChild && !feathers[name].isSystem;
        }).sort();
      return result;
    };
    vm.sheet = options.parentViewModel.sheet;
    vm.config = options.parentViewModel.config;
    vm.model = f.prop(f.models.workbookLocalConfig(cache));
    vm.reset = function () {
      cache = f.copy(vm.sheet());
      vm.model(f.models.workbookLocalConfig(cache));
      vm.data(cache.list.columns);
      if (cache.list.columns.length) { vm.add(); }
      vm.selection(0);
    };
    vm.workbook = options.parentViewModel.workbook;
    vm.viewHeaderIds = m.prop({
      column: f.createId(),
      label: f.createId()
    });
    vm.viewHeaders = function () {
      var ids = vm.viewHeaderIds();
      return [
        m("th", {style: {minWidth: "165px"}, id: ids.column }, "Column"),
        m("th", {style: {minWidth: "220px"}, id: ids.column }, "Label")
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
          m("td", {style: {minWidth: "165px", maxWidth: "165px"}}, m("select", {
              value: item.attr,
              onchange: m.withAttr(
                "value",
                vm.itemChanged.bind(this, item.index, "attr"))
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", {style: {minWidth: "220px", maxWidth: "220px"}}, m("input", {
              value: item.label || item.attr.toName(),
              onchange: m.withAttr(
                "value",
                vm.itemChanged.bind(this, item.index, "label"))
            })
          )
        ]);

        return row;
      });

      return view;
    };
    vm.reset();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  f.components.sheetConfigureDialog = f.components.dialog;

}(f));
