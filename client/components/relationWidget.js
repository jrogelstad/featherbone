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

  f.viewModels.relationViewModel = function (options) {
    var vm = {},
      hasFocus = false,
      parent = options.parent,
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      inputValue = m.prop(null),
      modelValue = parent.model.data[parentProperty],
      modelName = modelValue.type.relation.toCamelCase(),
      modelList = f.models[modelName].list({
        filter: {
          sort: [{property: valueProperty}],
          limit: 10
        }
      });

    vm.models = function () {
      return modelList() || [];
    };
    vm.onblur = function () {
      hasFocus = false;
    };
    vm.onchange = function (value) {
      var models = vm.models(),
        regexp = new RegExp("^" + value, "i"),
        match = function (model) {
          var currentValue = model.data[valueProperty]();
          if (Array.isArray(currentValue.match(regexp))) {
            modelValue(model);
            inputValue(currentValue);
            return true;
          }
          return false;
        };

      if (!models.some(match)) {
        modelValue(null);
        inputValue(null);
        console.log("No match");
      }
    };
    vm.onfocus = function () {
      hasFocus = true;
    };
    vm.oninput = function (value) {
      inputValue(value);
    };
    vm.value = function (value) {
      var result;
      if (hasFocus) {
        if (arguments.length) {
          result = inputValue(value);
        } else {
          result = inputValue();
        }
        return result;
      }

      result = modelValue();
      if (!result) {
        return null;
      }
      return result.data[valueProperty]();
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
        vm = args.viewModel;

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

      // Generate picker list
      listOptions = rvm.models().map(function (model) {
        var content = {value: model.data[valueProperty]()};
        if (labelProperty) { content.label = model.data[labelProperty](); }
        return m("option", content);
      });

      // Return the widget
      return m("div", [
        m("input", {
          list: "data",
          onchange: m.withAttr("value", rvm.onchange),
          onfocus: rvm.onfocus,
          onblur: rvm.onblur,
          oninput: m.withAttr("value", rvm.oninput),
          value: rvm.value() || ""
        }),
        m("datalist", {
          id: "data"
        }, listOptions)
      ]);
    };

    return widget;
  };

}(f));


