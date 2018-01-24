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

(function () {
  "use strict";

  var relationWidget = {},
    m = require("mithril"),
    stream = require("stream"),
    f = require("common-core"),
    catalog = require("catalog");

  /**
    @param {Object} Options
    @param {Object} [options.parentViewModel] Parent view-model. Required
      property "relations" returning javascript object to attach relation view model to.
    @param {String} [options.parentProperty] Name of the relation
      in view model to attached to
    @param {String} [options.valueProperty] Value property
    @param {Object} [options.form] Form configuration
    @param {Object} [options.list] (Search) List configuration
    @params {Boolean} [options.isCell] Use style for cell in table
  */
  relationWidget.viewModel = function (options) {
    var vm = {}, registerReceiver,
      hasFocus = false,
      parent = options.parentViewModel,
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      labelProperty = options.labelProperty,
      modelValue = parent.model().data[parentProperty],
      current = modelValue() ? modelValue().data[valueProperty]() : null,
      inputValue = stream(current),
      type =  modelValue.type,
      modelName = type.relation.toCamelCase(),
      filter = {
        sort: [{property: valueProperty}],
        limit: 10
      },
      list =  catalog.store().models()[modelName].list,
      modelList = list({filter: filter}),
      configId = f.createId();

    vm.listId = stream(f.createId());
    vm.fetch = function () {
      list({
        value: modelList(),
        filter: filter,
        merge: false
      });
    };
    vm.formConfig = stream(options.form);
    vm.isCell = stream(!!options.isCell);
    vm.label = function () {
      var model = modelValue();
      return (labelProperty && model) ? model.data[labelProperty]() : "";
    };
    vm.labelProperty = stream(options.labelProperty);
    vm.model = function () {
      return modelValue();
    };
    vm.models = function () {
      return modelList();
    };
    vm.onblur = function () {
      hasFocus = false;
    };
    vm.onclicknew = function () {
      m.route.set("/edit/:feather/:key", {
        feather: type.relation.toSpinalCase(),
        key: f.createId(),
        receiver: registerReceiver(),
        create: true
      });
    };
    vm.onclickopen = function () {
      m.route.set("/edit/:feather/:key", {
        feather: type.relation.toSpinalCase(),
        key: modelValue().id(),
        receiver: registerReceiver()
      });
    };
    vm.onclicksearch = function () {
      catalog.register("config", configId, options.list);
      m.route.set("/search/:feather", {
        feather: type.relation.toSpinalCase(),
        config: configId,
        receiver: registerReceiver()
      });
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
      inputValue(modelValue().data[options.valueProperty]());
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
      vm.showMenu(true);
    };
    vm.onmouseoutmenu = function () {
      vm.showMenu(false);
    };
    vm.parentProperty = stream(options.parentProperty);
    vm.parantViewModel = stream(options.parentViewModel);
    vm.showMenu = stream(false);
    vm.style = stream({});
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
    vm.valueProperty = stream(valueProperty);

    // Helper function for registering callbacks
    registerReceiver = function () {
      var receiverKey = f.createId();

      catalog.register("receivers", receiverKey, {
        callback: function (model) {
          modelValue(model);
          vm.showMenu(false);
        }
      });

      return receiverKey;
    };

    return vm;
  };

  /**
    @param {Object} Options
    @param {Object} [options.viewModel] Parent view-model. Must have
      property "relations" returning javascript object to attach relation view model to.
    @param {String} [options.parentProperty] Name of the relation
      in view model to attached to
    @param {String} [options.valueProperty] Value property
    @params {Boolean} [options.isCell] Use style for cell in table
  */
  relationWidget.component = {
    oninit: function (vnode) {
      var options = vnode.attrs,
        parentViewModel = options.parentViewModel,
        parentProperty = options.parentProperty,
        valueProperty = options.valueProperty,
        labelProperty = options.labelProperty,
        relations = parentViewModel.relations();

      // Set up viewModel if required
      if (!relations[parentProperty]) {
        relations[parentProperty] = relationWidget.viewModel({
          parentViewModel: parentViewModel,
          parentProperty: parentProperty,
          valueProperty: valueProperty,
          labelProperty: labelProperty,
          form: options.form,
          list: options.list,
          isCell: options.isCell
        });
      }
      this.viewModel = relations[parentProperty];
      this.viewModel.style(options.style || {});
    },

    view: function () {
      var listOptions, 
        inputStyle, menuStyle, maxWidth,
        vm = this.viewModel,
        style = vm.style(),
        openMenuClass = "pure-menu-link",
        buttonStyle = {
          margin: "2px"
        },
        labelStyle = {
          display: "inline"
        };

      menuStyle = {
        display: vm.showMenu() ? "block" : "none",
        backgroundColor: "White",
        position: "absolute",
        zIndex: 9999,
        border: "1px solid lightgrey"
      };

      if (vm.isCell()) {
        inputStyle = {
          minWidth: "100px",
          maxWidth: "100%",
          border: "none"
        };
        buttonStyle = {
          position: "absolute",
          margin: "2px"
        };
        menuStyle.top = "35px";
        menuStyle.right = "-100px";
        labelStyle.display = "none";
      }

      // Generate picker list
      listOptions = vm.models().map(function (model) {
        var content = {value: model.data[vm.valueProperty()]()};
        if (vm.labelProperty()) { content.label = model.data[vm.labelProperty()](); }
        return m("option", content);
      });

      style.display = style.display || "inline-block";
      
      // Hack size to fit button.
      if (style.maxWidth) {
        maxWidth = style.maxWidth.replace("px", "");
        maxWidth = maxWidth - 35;
        maxWidth = maxWidth < 100  ? 100 : maxWidth;
        inputStyle.maxWidth = maxWidth + "px";
      }

      if (!vm.model()) {
        openMenuClass += " pure-menu-disabled";
      }

      // Build the view
      return m("div", {style: style}, [
        m("input", {
          style: inputStyle,
          list: vm.listId(),
          onchange: m.withAttr("value", vm.onchange),
          onfocus: vm.onfocus,
          onblur: vm.onblur,
          oninput: m.withAttr("value", vm.oninput),
          value: vm.value()
        }),
        m("div", {
          style: {
            position: "relative",
            display: "inline"
          }
        }, [
          m("div", {
            class: "pure-menu custom-restricted-width",
            onmouseover: vm.onmouseovermenu,
            onmouseout: vm.onmouseoutmenu,
            style: {
              position: "absolute",
              display: "inline"
            }
          }, [
            m("span", {
              class:"pure-button fa fa-bars",
              style: buttonStyle
            }),
            m("ul", {
              class: "pure-menu-list",
              style: menuStyle
            }, [
              m("li", {
                class: "pure-menu-link",
                onclick: vm.onclicksearch
              },  [m("i", {class:"fa fa-search"})], " Search"),
              m("li", {
                class: openMenuClass,
                onclick: vm.onclickopen
              },  [m("i", {class:"fa fa-folder-open"})], " Open"),
              m("li", {
                class: "pure-menu-link",
                onclick: vm.onclicknew
              },  [m("i", {class:"fa fa-plus-circle"})], " New")
            ])
          ])
        ]),
        m("div", {
          style: labelStyle
        }, [
          m("div", {
            style: {marginLeft: "12px", marginTop: vm.label() ? "6px" : ""} // Hack
          }, vm.label())
        ]),
        m("datalist", {
          id: vm.listId()
        }, listOptions)
      ]);
    }
  };

  catalog.register("components", "relationWidget", relationWidget.component);
  module.exports = relationWidget;

}());


