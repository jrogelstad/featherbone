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

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Function} [options.config] Filter property being modified
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.sheetConfigureDialogViewModel = function (options) {
    options = options || {};
    var vm, state, setModel;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.id = m.prop(options.id || f.createId());
    vm.feathers = function () {
      var feathers = f.catalog.data(),
        result = Object.keys(feathers).filter(function (name) {
          return !feathers[name].isChild;
        }).sort();
      return result;
    };
    vm.show = function () {
      state.send("show");
    };
    vm.ok = function () {
      state.send("close");
    };
    vm.cancel = function () {
      state.send("close");
    };
    vm.config = options.config;
    vm.sheet = f.prop(options.sheet);
    vm.model = m.prop();
    vm.title = m.prop( options.title || "Configure worksheet");

    // ..........................................................
    // PRIVATE
    //

    setModel = function (sheet) {
      var model = {},
        config = vm.config();

      model.isNew = !config[sheet];
      model.name = m.prop(sheet.name || "");
      model.feather = m.prop(sheet.feather || "");
      model.form = m.prop(sheet.form || {});
      model.list = m.prop(sheet.list || []);
      model.toJSON = function () {
        return {
          feather: model.feather(),
          form: model.form(),
          list: model.list()
        };
      };
      vm.model(model);
    };
    setModel(vm.sheet());

    // When sheet changes, update model referenced
    vm.sheet.state().resolve("/Changing").enter(function () {
      setModel(vm.sheet.newValue());
    });

    // Statechart
    state = f.statechart.State.define(function () {
      this.state("Display", function () {
        this.state("Closed", function () {
          this.enter(function () {
            var  id = vm.id(),
              dlg = document.getElementById(id);
            if (dlg) { dlg.close(); }
          });
          this.event("show", function () {
            this.goto("../Showing");
          });
        });
        this.state("Showing", function () {
          this.enter(function () {
            var id = vm.id(),
              dlg = document.getElementById(id);
            if (dlg) { dlg.showModal(); }
          });
          this.event("close", function () {
            this.goto("../Closed");
          });
          this.C(function() {
            if (vm.model().isNew) { 
              return "./New";
            }
            return "./Edit";
          });
          this.state("New", function () {
          });
          this.state("Edit", function () {
            this.exit(function () {
              var route,
                config = vm.config(),
                sheet = vm.sheet(),
                model = vm.model(),
                name = model.name();
              delete config[sheet];
              config[name] = model.toJSON();
              route = "/" + options.workbook + "/" + name;
              route = route.toSpinalCase();
              m.route(route);
            });
          });
        });
      });
    });
    state.goto();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  f.components.sheetConfigureDialog = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel;
    };

    component.view = function (ctrl) {
      var view, feathers,
        vm = ctrl.vm,
        model = vm.model(),
        nameId = f.createId(),
        featherId = f.createId();

      feathers = vm.feathers().map(function (feather) {
        return m("option", feather);
      });

      view = m("dialog",  {
          id: vm.id(),
          style: {
            borderRadius: "10px",
            padding: "0px"
          }
        }, [
        m("h3", {
          style: {
            backgroundColor: "snow",
            borderBottomColor: "lightgrey",
            borderBottomStyle: "solid",
            borderBottomWidth: "thin",
            margin: "2px",
            padding: "6px"
          }
        }, [m("i", {
          class:"fa fa-gear", 
          style: {marginRight: "5px"}
        })], vm.title()),
        m("div", {style: {padding: "1em"}}, [
          m("form", {
            class: "pure-form pure-form-aligned"
          }, [
            m("div", {class: "pure-control-group"}, [
              m("label", {
                for: nameId
              }, "Name:"),
              m("input", {
                value: model.name(),
                oninput: m.withAttr("value", model.name)
              })
            ]),
            m("div", {class: "pure-control-group"}, [
              m("label", {
                for: featherId
              }, "Feather:"),
              m("select", {
                value: model.feather(),
                oninput: m.withAttr("value", model.feather)
              }, feathers)
            ])
          ]),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary",
            style: {marginRight: "5px"},
            autofocus: true,
            onclick: vm.ok
          }, "Ok"),
          m("button", {
            class: "pure-button",
            onclick: vm.cancel
          }, "Cancel")
       ])
      ]);

      return view;
    };

    return component;
  };

}(f));
