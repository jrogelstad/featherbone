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
      showMenu = false,
      parent = options.parent,
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      labelProperty = options.labelProperty,
      modelValue = parent.model().data[parentProperty],
      current = modelValue() ? modelValue().data[valueProperty]() : null,
      inputValue = m.prop(current),
      modelName = modelValue.type.relation.toCamelCase(),
      filter = {
        sort: [{property: valueProperty}],
        limit: 10
      },
      list =  f.models[modelName].list,
      modelList = list({filter: filter});

    vm.listId = m.prop(f.createId());
    vm.fetch = function () {
      list({
        value: modelList(),
        filter: filter,
        merge: false
      });
    };
    vm.label = function () {
      var model = modelValue();
      return (labelProperty && model) ? model.data[labelProperty]() : "";
    };
    vm.models = function () {
      return modelList();
    };
    vm.onblur = function () {
      hasFocus = false;
    };
    vm.onclicknew = function () {
      console.log("search new");
    };
    vm.onclickopen = function () {
      console.log("open clicked");
    };
    vm.onclicksearch = function () {
      console.log("search clicked");
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

      if (!value.length || !models.some(match)) {
        modelValue(null);
        inputValue(null);
        delete filter.criteria;
        vm.fetch();
      }
    };
    vm.onfocus = function () {
      hasFocus = true;
    };
    vm.oninput = function (value) {
      var fetch = false,
        inputVal = inputValue() || "";
      if (value.length <= inputVal.length ||
          modelList().length === 10) {
        fetch = true;
      }
      inputValue(value);
      if (fetch) {
        filter.criteria = [{
          property: valueProperty,
          operator: "~*",
          value: "^" + value
        }];
        vm.fetch();
      }
    };
    vm.onmouseovermenu = function () {
      showMenu = true;
    };
    vm.onmouseoutmenu = function () {
      showMenu = false;
    };
    vm.showMenu = function () {
      return showMenu;
    };
    vm.value = function (value) {
      var result;
      if (hasFocus) {
        if (arguments.length) {
          result = inputValue(value);
        } else {
          result = inputValue();
        }
        return result || "";
      }

      result = modelValue();
      if (!result) {
        return "";
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

    widget.view = function (ignore, args) {
      var rvm, listOptions, view,
        vm = args.viewModel,
        relations = vm.relations();

      // Set up viewModel if required
      if (!relations[parentProperty]) {
        relations[parentProperty] = f.viewModels.relationViewModel({
          parent: vm,
          parentProperty: parentProperty,
          valueProperty: valueProperty,
          labelProperty: labelProperty
        });
      }
      rvm = relations[parentProperty];

      // Generate picker list
      listOptions = rvm.models().map(function (model) {
        var content = {value: model.data[valueProperty]()};
        if (labelProperty) { content.label = model.data[labelProperty](); }
        return m("option", content);
      });

      // Build the view
      view = m("div", {
        style: {display: "inline-block"}
      },[
        m("input", {
          list: rvm.listId(),
          onchange: m.withAttr("value", rvm.onchange),
          onfocus: rvm.onfocus,
          onblur: rvm.onblur,
          oninput: m.withAttr("value", rvm.oninput),
          value: rvm.value()
        }),
        m("div", {
          style: {
            position: "relative",
            display: "inline"
          }
        }, [
          m("div", {
            class: "pure-menu custom-restricted-width",
            onmouseover: rvm.onmouseovermenu,
            onmouseout: rvm.onmouseoutmenu,
            style: {
              position: "absolute",
              display: "inline"
            }
          }, [
            m("span", {
              class:"pure-button fa fa-bars",
              style: {margin: "2px"}
            }),
            m("ul", {
              class: "pure-menu-list",
              style: {
                display: rvm.showMenu() ? "block" : "none",
                backgroundColor: "White",
                position: "absolute",
                zIndex: 9999,
                border: "1px solid lightgrey"
              }
            }, [
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclicksearch
              }, "Search"),
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclickopen
              }, "Open"),
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclicknew
              }, "New")
            ])
          ])
        ]),
        m("div", {
          style: {display: labelProperty ? "inline" : "none"}
        }, [
          m("div", {
            style: {marginLeft: "12px", marginTop: rvm.label() ? "6px" : ""} // Hack
          }, rvm.label())
        ]),
        m("datalist", {
          id: rvm.listId()
        }, listOptions)
      ]);
 
      return view;
    };

    return widget;
  };

}(f));


