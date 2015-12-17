/*global window*/
(function () {
  "use strict";

  var formDisplay = {},
    m = require("mithril"),
    f = require("component-core"),
    catalog = require("catalog"),
    button = require("button");

  formDisplay.viewModel = function (options) {
    var vm = {}, state, model, createButton, canSave,
      buttonDone, buttonApply, buttonSave, buttonSaveAndNew,
      wbkroute = "/" + options.workbook + "/" + options.sheet.name,
      frmroute = "/" + options.workbook + "/" + options.form,
      feather = options.feather,
      name = feather.toCamelCase(),
      models = catalog.store().models(),
      id = options.id;

    wbkroute = wbkroute.toSpinalCase();
    frmroute = frmroute.toSpinalCase();
    model = models[name]({id: id});

    if (id) { model.fetch(); }

    vm.buttonApply = function () { return buttonApply; };
    vm.buttonDone = function () { return buttonDone; };
    vm.buttonSave = function () { return buttonSave; };
    vm.buttonSaveAndNew = function () { return buttonSaveAndNew; };
    vm.doApply = function () {
      model.save();
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

    // ..........................................................
    // PRIVATE
    //

    // Create button view models
    createButton = button.viewModel;
    buttonDone = createButton({
      onclick: vm.doList,
      label: "&Back",
      icon: "arrow-left"
    });

    buttonApply = createButton({
      onclick: vm.doApply,
      label: "&Apply"
    });

    buttonSave = createButton({
      onclick: vm.doSave,
      label: "&Save",
      icon: "cloud-upload"
    });

    buttonSaveAndNew = createButton({
      onclick: vm.saveAll,
      label: "Save and &New",
      icon: "plus-circle"
    });

    // Bind model state to display state
    canSave = function (enable) {
      if (enable && model.isValid()) {
        buttonApply.enable();
        buttonSave.enable();
        buttonSaveAndNew.enable();
        buttonSaveAndNew.label("Save and &New");
      } else {
        buttonApply.disable();
        buttonSave.disable();
        buttonSaveAndNew.enable();
        buttonSaveAndNew.label("&New");        
      }
    };
    state = model.state();
    state.resolve("/Ready/New").enter(canSave.bind(this, true));
    state.resolve("/Ready/Fetched/Clean").enter(canSave.bind(this, false));
    state.resolve("/Ready/Fetched/Dirty").enter(canSave.bind(this, true));
    state.resolve("/Busy").enter(function () {
      buttonApply.disable();
      buttonSave.disable();
      buttonSaveAndNew.disable();
    });

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
      view = m("form", {
        class: "pure-form pure-form-aligned",
        config: function () {
          if (vm.isFirstLoad()) {
            document.getElementById(focusAttr).focus();
            vm.isFirstLoad(false);
          }
        }
      }, [
        m("div", {id: "toolbar",class: "suite-header"}, [
          m.component(button.component({viewModel: vm.buttonDone()})),
          m.component(button.component({viewModel: vm.buttonApply()})),
          m.component(button.component({viewModel: vm.buttonSave()})),
          m.component(button.component({viewModel: vm.buttonSaveAndNew()}))
        ]),
        m("div", {
          class: "suite-form-content",
          config: function (e) {
            var tb = document.getElementById("toolbar");

            // Set fields table to scroll and toolbar to stay put
            document.documentElement.style.overflow = 'hidden';
            e.style.maxHeight = (window.innerHeight - tb.clientHeight) + "px";
          }
        }, [m("fieldset", attrs)])
      ]);

      return view;
    };

    return widget;
  };

  catalog.register("components", "formDisplay", formDisplay.component);
  module.exports = formDisplay;

}());


