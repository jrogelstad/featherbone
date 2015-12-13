/*global window*/
(function () {
  "use strict";

  var formDisplay = {},
    m = require("mithril"),
    f = require("component-core"),
    catalog = require("catalog");

  formDisplay.viewModel = function (options) {
    var vm = {}, model,
      wbkroute = "/" + options.workbook + "/" + options.sheet.name,
      frmroute = "/" + options.workbook + "/" + options.form,
      feather = options.feather,
      name = feather.toCamelCase(),
      models = catalog.store().models(),
      id = options.id;

    wbkroute = wbkroute.toSpinalCase();
    frmroute = frmroute.toSpinalCase();
    model = models[name]({id: id}); // FIX THIS

    if (id) { model.fetch(); }

    vm.doApply = function () {
      model.save();
    };
    vm.canSave = function () {
      return vm.model().isValid() && (
        vm.model().state().current()[0] === "/Ready/New" || 
        vm.model().canUndo()
      );
    };
    vm.doList = function () {
      m.route(wbkroute);
    };
    vm.doNew = function () {
      m.route(frmroute);
    };
    vm.doSave = function () {
      model.save().then(function () {
        m.route(wbkroute);
      });
    };
    vm.doSaveAndNew = function () {
      model.save().then(function () {
        m.route(frmroute);
      });
    };
    vm.isFirstLoad = m.prop(true);
    vm.model = function () {
      return model;
    };
    vm.relations = m.prop({});

    return vm;
  };

  formDisplay.component = function (options) {
    var widget = {};

    widget.controller = function () {
      this.vm = formDisplay.viewModel({
        workbook: options.workbook,
        sheet: options.sheet,
        form: options.form,
        feather: options.feather,
        id: m.route.param("id")
      });
    };

    widget.view = function (ctrl) {
      var attrs, focusAttr, view,
        vm = ctrl.vm,
        model = vm.model(),
        d = model.data;

      // Build elements
      attrs = options.attrs.map(function (item) {
        var key = item.attr;
        if (!focusAttr) { focusAttr = key; }
        var color, result;
        color = (d[key].isRequired() && d[key]()) === null ? "Red" : "Black";
        result = m("div", {
          class: "pure-control-group"
        }, [
          m("label", {
            for: key,
            style: {
              color: color,
              verticalAlign: "top", // Hack (relation widget)
              marginTop: "9px" // Hack (relation widget)
            }
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
      view = m("form", {
        class: "pure-form pure-form-aligned",
        config: function () {
          if (vm.isFirstLoad()) {
            document.getElementById(focusAttr).focus();
            vm.isFirstLoad(false);
          }
        }
      }, [
        m("div", {id: "toolbar",
          style: {
            backgroundColor: "snow",
            borderBottomColor: "lightgrey",
            borderBottomStyle: "solid",
            borderBottomWidth: "thin",
            margin: "2px"
          }
        }, [
          m("button", {
            type: "button",
            class: "pure-button",
            style: { backgroundColor: "snow" },
            onclick: vm.doList
          }, [m("i", {class:"fa fa-arrow-left"})], " Done"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { backgroundColor: "snow" },
            disabled: !model.canUndo() || !model.isValid(),
            onclick: vm.doApply
          }, "Apply"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { backgroundColor: "snow" },
            disabled: !vm.canSave(),
            onclick: vm.doSave
          }, [m("i", {class:"fa fa-cloud-upload"})], " Save"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { backgroundColor: "snow" },
            onclick: (model.canUndo() && model.isValid()) ? vm.doSaveAndNew : vm.doNew
          }, [m("i", {class:"fa fa-plus-circle"})],
          (model.canUndo() && model.isValid()) ? " Save & New" : " New")
        ]),
        m("div", {
          style: {
            overflow: "auto"
          },
          config: function (e) {
            var tb = document.getElementById("toolbar");

            // Set fields table to scroll and toolbar to stay put
            document.documentElement.style.overflow = 'hidden';
            e.style.maxHeight = (window.innerHeight - tb.clientHeight) + "px";
          }
        }, [
          m("fieldset", attrs)
        ])
      ]);

      return view;
    };

    return widget;
  };

  catalog.register("components", "formDisplay", formDisplay.component);
  module.exports = formDisplay;

}());


