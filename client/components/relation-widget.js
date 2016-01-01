(function () {
  "use strict";

  var relationWidget = {},
    m = require("mithril"),
    f = require("feather-core"),
    catalog = require("catalog"),
    searchDialog = require("search-dialog"),
    formDialog = require("form-dialog");

  relationWidget.viewModel = function (options) {
    var vm = {},
      hasFocus = false,
      parent = options.parent,
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      labelProperty = options.labelProperty,
      modelValue = parent.model().data[parentProperty],
      current = modelValue() ? modelValue().data[valueProperty]() : null,
      inputValue = m.prop(current),
      type =  modelValue.type,
      modelName = type.relation.toCamelCase(),
      filter = {
        sort: [{property: valueProperty}],
        limit: 10
      },
      list =  catalog.store().models()[modelName].list,
      modelList = list({filter: filter}),
      searchConfig;

    vm.listId = m.prop(f.createId());
    vm.fetch = function () {
      list({
        value: modelList(),
        filter: filter,
        merge: false
      });
    };
    vm.formConfig = m.prop(options.form);
    vm.formDialog = m.prop();
    vm.label = function () {
      var model = modelValue();
      return (labelProperty && model) ? model.data[labelProperty]() : "";
    };
    vm.listConfig = m.prop(options.list);
    vm.models = function () {
      return modelList();
    };
    vm.onblur = function () {
      hasFocus = false;
    };
    vm.onclicknew = function () {
      vm.formDialog().modelId(undefined);
      vm.formDialog().show();
    };
    vm.onclickopen = function () {
      var id,
        model = modelValue();
      if (!model) { return; }
      id = model.id();
      vm.formDialog().modelId(id);
      vm.formDialog().show();
    };
    vm.onclicksearch = function () {
      vm.searchDialog().show();
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
      vm.showMenu(true);
    };
    vm.onmouseoutmenu = function () {
      vm.showMenu(false);
    };
    vm.searchDialog = m.prop();
    vm.showMenu = m.prop(false);
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

    // Create search dialog
    searchConfig = {
      feather: type.relation,
      list: {}
    };
    searchConfig.list = vm.listConfig();
    vm.searchDialog(searchDialog.viewModel({
      config: searchConfig,
      onOk: function () {
        var selection = vm.searchDialog().tableWidget().selection();
        if (selection) {
          modelValue(selection);
        }
      }
    }));

    // Create form dialog
    vm.formDialog(formDialog.viewModel({
      feather: type.relation,
      attrs: vm.formConfig().attrs,
      onOk: function (model) {
        modelValue(model);
      }
    }));

    return vm;
  };

  /**
    @param {Object} Options
    @param {String} [options.parentProperty] Name of the relation
      in view model to attached to
    @param {String} [options.valueProperty] Value property
    @params {Object} [options.isCell] Style for cell in table
  */
  relationWidget.component = function (options) {
    var widget = {},
      parentProperty = options.parentProperty,
      valueProperty = options.valueProperty,
      labelProperty = options.labelProperty;

    widget.view = function (ignore, args) {
      var rvm, opts, listOptions, view,
        inputStyle, menuStyle, maxWidth,
        vm = args.viewModel,
        style = args.style || {},
        relations = vm.relations(),
        buttonStyle = {
          margin: "2px"
        },
        labelStyle = {
          display: "inline"
        };

      // Set up viewModel if required
      if (!relations[parentProperty]) {
        opts = f.copy(options);
        opts.parent = vm;
        relations[parentProperty] = relationWidget.viewModel(opts);
      }

      rvm = relations[parentProperty];

      menuStyle = {
        display: rvm.showMenu() ? "block" : "none",
        backgroundColor: "White",
        position: "absolute",
        zIndex: 9999,
        border: "1px solid lightgrey"
      };

      if (options.isCell) {
        inputStyle = {
          minWidth: "100px",
          maxWidth: "100%"
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
      listOptions = rvm.models().map(function (model) {
        var content = {value: model.data[valueProperty]()};
        if (labelProperty) { content.label = model.data[labelProperty](); }
        return m("option", content);
      });

      style.display = style.display || "inline-block";
      // Hack size to fit button. Should do this in CSS
      
      if (style.maxWidth) {
        maxWidth = style.maxWidth.replace("px", "");
        maxWidth = maxWidth - 35;
        maxWidth = maxWidth < 100  ? 100 : maxWidth;
        inputStyle.maxWidth = maxWidth + "px";
      }

      // Build the view
      view = m("div", {style: style}, [
        m.component(searchDialog.component({viewModel: rvm.searchDialog()})),
        m.component(formDialog.component({viewModel: rvm.formDialog()})),
        m("input", {
          style: inputStyle,
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
              style: buttonStyle
            }),
            m("ul", {
              class: "pure-menu-list",
              style: menuStyle
            }, [
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclicksearch
              },  [m("i", {class:"fa fa-search"})], " Search"),
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclickopen
              },  [m("i", {class:"fa fa-folder-open"})], " Open"),
              m("li", {
                class: "pure-menu-link",
                onclick: rvm.onclicknew
              },  [m("i", {class:"fa fa-plus-circle"})], " New")
            ])
          ])
        ]),
        m("div", {
          style: labelStyle
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

  catalog.register("components", "relationWidget", relationWidget.component);
  module.exports = relationWidget;

}());


