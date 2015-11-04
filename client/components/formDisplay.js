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

  f.viewModels.formViewModel = function (options) {
    var vm = {}, model,
      wbkroute = "/" + options.workbook + "/" + options.sheet,
      frmroute = "/" + options.workbook + "/" + options.form,
      feather = options.feather,
      name = feather.toCamelCase(),
      id = options.id;

    wbkroute = wbkroute.toSpinalCase();
    frmroute = frmroute.toSpinalCase();
    model = f.models[name]({id: id});

    if (id) { model.fetch(); }

    vm.relations = m.prop({});
    vm.model = function () {
      return model;
    };
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

    return vm;
  };

  f.components.formDisplay = function (options) {
    var widget = {};

    widget.controller = function () {
      this.vm = f.viewModels.formViewModel({
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
        feather = f.catalog.getFeather(options.feather),
        d = model.data;

      // Build elements
      attrs = options.attrs.map(function (key) {
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
          }, key.toProperCase() + ":"),
          f.buildInputComponent({
            feather: feather,
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
            margin: "2px"
          }
        }, [
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: vm.doList
          }, [m("i", {class:"fa fa-arrow-left"})], " Done"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            disabled: !model.canSave(),
            onclick: vm.doApply
          }, "Apply"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            disabled: !model.canSave(),
            onclick: vm.doSave
          }, [m("i", {class:"fa fa-save"})], " Save"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: model.canSave() ? vm.doSaveAndNew : vm.doNew
          }, [m("i", {class:"fa fa-plus-circle"})],
          model.canSave() ? " Save & New" : " New")
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

}(f));


