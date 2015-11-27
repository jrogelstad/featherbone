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
    @param {Array} [options.propertyName] Filter property being modified
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Array} [options.feather] Feather
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.sheetConfigureDialogViewModel = function (options) {
    options = options || {};
    var vm, state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.id = m.prop(options.id || f.createId());
    vm.show = function () {
      state.send("show");
    };
    vm.ok = function () {
      state.send("close");
    };
    vm.cancel = function () {
      state.send("close");
    };
    vm.title = m.prop( "Edit sheet");

    // ..........................................................
    // PRIVATE
    //

    // Statechart
    state = f.statechart.State.define({concurrent: true}, function () {
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
      var view,
        button = f.components.button,
        vm = ctrl.vm;

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
          class:"fa fa-edit", 
          style: {marginRight: "3px"}
        })], vm.title()),
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
      ]);

      return view;
    };

    return component;
  };

}(f));
