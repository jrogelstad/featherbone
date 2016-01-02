/*global window*/
(function () {
  "use strict";

  var formWidget = {},
    m = require("mithril"),
    f = require("component-core"),
    math = require("mathjs"),
    catalog = require("catalog");

  formWidget.viewModel = function (options) {
    var vm = {},
      name = options.feather.toCamelCase(),
      models = catalog.store().models();

    vm.attrs = m.prop(options.attrs || []);
    vm.isFirstLoad = m.prop(true);
    vm.model = m.prop(models[name]({id: options.id}));
    vm.outsideElementIds = m.prop(options.outsideElementIds || []);
    vm.relations = m.prop({});

    // ..........................................................
    // PRIVATE
    //

    if (options.id) { vm.model().fetch(); }

    return vm;
  };

  formWidget.component = function (options) {
    var widget = {};

    widget.controller = function () {
      this.vm = options.viewModel;
    };

    widget.view = function (ctrl) {
      var focusAttr, buildFieldset, buildColumn,
        vm = ctrl.vm,
        attrs = vm.attrs(),
        model = vm.model(),
        d = model.data,
        panes = [];

      // Build elements
      buildFieldset = function (attrs) {
        return attrs.map(function (item) {
          var result,
            color = "Black",
            key = item.attr,
            prop = d[key],
            value = prop();

          if (!focusAttr) { focusAttr = key; }

          if (prop.isRequired() && (value === null ||
            (prop.type === "string" && !value))) {
            color = "Red";
          }
          result = m("div", {
            class: "pure-control-group"
          }, [
            m("label", {
              for: key,
              class: "suite-form-label",
              style: {color: color}
            }, item.label || key.toProperCase() + ":"),
            f.buildInputComponent({
              model: model,
              key: key,
              viewModel: vm
            })
          ]);
          return result;
        });
      };

      buildColumn = function (attrs, n) {
        var fieldset = buildFieldset(attrs);

        return m("div", {
          class: "pure-u-1 pure-u-md-1-" + n
        }, [
            m("div", {
            class: "pure-form pure-form-aligned"
          }, [m("fieldset", fieldset)])
        ]);
      };

      // build pane/column matrix from inside out
      attrs.forEach(function (item) {
        var pidx = item.pane || 0,
          cidx = item.column || 0;
        if (!panes[pidx]) {
          panes[pidx] = [];
        }
        if (!panes[pidx][cidx]) {
          panes[pidx][cidx] = [];
        } 
        panes[pidx][cidx].push(item);
      });

      // Build pane content
      panes = panes.map(function (pane) {
        var columns = pane.map(function (column) {
          return buildColumn(column, pane.length);
        });

        return m("div", {class: "pure-g"}, columns);
      });

      return m("div", {
        class: "suite-form-content",
        config: function (e) {
          var bodyHeight = window.innerHeight,
            eids = vm.outsideElementIds();

          eids.forEach(function (id) {
            var h = document.getElementById(id).clientHeight;
            bodyHeight = math.subtract(bodyHeight, h);
          });

          e.style.maxHeight = bodyHeight + "px";
        }
      }, panes);
    };

    return widget;
  };

  catalog.register("components", "formWidget", formWidget.component);
  module.exports = formWidget;

}());


