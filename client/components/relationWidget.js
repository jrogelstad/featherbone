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

  f.viewModels = {};
  f.viewModels.relationViewModel = function (options) {
    var vm = {},
      parent = options.parent,
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      matches = [
        {id: "accounting", name: "Accounting", description: "Finance team"},
        {id: "everyone", name: "Everyone", description: "All users"},
        {id: "sales", name: "Sales", description: "Sales team"},
        {id: "shop", name: "Shop Floor", description: "Production team"}
      ];

    vm.models = function () {
      var name = parent.model.data[parentProperty].type.relation.toCamelCase();
      return matches.map(function (match) {
        return f.models[name](match);
      });
    };
    vm.onchange = function (value) {
      var models = vm.models(),
        match = function (model) {
          if (Array.isArray(model.data[valueProperty]().match("^" + value))) {
            parent.model.data[parentProperty](model);
            return true;
          }
          return false;
        };

      if (!models.some(match)) {
        parent.model.data[parentProperty](null);
        console.log("No match");
      }
    };

    return vm;
  };

  f.components.relationWidget = function (options) {
    var widget = {},
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      labelProperty = options.labelProperty;

    widget.view = function (ctrl, args) {
      var rvm, listOptions,
        vm = args.viewModel,
        d = vm.model.data,
        parentProp = d[parentProperty],
        valueProp = function () {
          if (parentProp() === null) { return null; }
          return parentProp().data[valueProperty]();
        },
        feather = parentProp.type.relation;

      // Set up role viewModel if required
      if (!vm.attrs[parentProperty]) {
        vm.attrs[parentProperty] = f.viewModels.relationViewModel({
          parent: vm,
          parentProperty: parentProperty,
          valueProperty: valueProperty,
          labelProperty: labelProperty
        });
      }
      rvm = vm.attrs[parentProperty];

      listOptions = rvm.models(feather).map(function (model) {
        var content = {value: model.data[valueProperty]()};
        if (labelProperty) { content.label = model.data[labelProperty](); }
        return m("option", content);
      });

      return m("div", [
        m("input", {
          list: "data",
          onchange: m.withAttr("value", rvm.onchange),
          value: valueProp()
        }),
        m("datalist", {
          id: "data"
        }, listOptions)
      ]);
    };

    return widget;
  };

}(f));


