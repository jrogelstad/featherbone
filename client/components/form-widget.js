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
      feather = options.feather,
      name = feather.toCamelCase(),
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
      var attrs, focusAttr, view,
        vm = ctrl.vm,
        model = vm.model(),
        d = model.data;

      // Build elements
      attrs = vm.attrs().map(function (item) {
        var key = item.attr;
        if (!focusAttr) { focusAttr = key; }
        var color, result;
        color = (d[key].isRequired() && d[key]()) === null ? "Red" : "Black";
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

      // Build view
      view = m("div", {
        class: "pure-form pure-form-aligned",
        config: function () {
          if (vm.isFirstLoad()) {
            document.getElementById(focusAttr).focus();
            vm.isFirstLoad(false);
          }
        }
      }, [
        m("div", {
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
        }, [m("fieldset", attrs)])
      ]);

      return view;
    };

    return widget;
  };

  catalog.register("components", "formWidget", formWidget.component);
  module.exports = formWidget;

}());


