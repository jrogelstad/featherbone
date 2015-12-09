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
    @param {Array} [options.icon] Dialog icon
    @param {Array} [options.title] Dialog title
    @param {Array} [options.message] Text message
    @param {Function} [options.onclickOk] Function to execute on ok clicked
  */
  f.viewModels.dialogViewModel = function (options) {
    options = options || {};
    var vm, state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.icon = m.prop(options.icon);
    vm.id = m.prop(options.id || f.createId());
    vm.cancel = function () {
      state.send("close");
    };
    vm.content = function () {
      return m("div", vm.message());
    };
    vm.displayOk = function () {
      return options.onclickOk ? "inline-block" : "none";
    };
    vm.message = m.prop(options.message || "Your message here");
    vm.onclickOk = function () {
      state.send("close");
      options.onclickOk();
    };
    vm.show = function () {
      state.send("show");
    };
    vm.title = m.prop(options.title);
    vm.state = function () {
      return state;
    };

    // ..........................................................
    // PRIVATE
    //

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
  f.components.dialog = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel || f.viewModels.dialogViewModel(options);
    };

    component.view = function (ctrl) {
      var view,
        vm = ctrl.vm;

      view = m("dialog", {
          id: vm.id(),
          class: "suite-dialog"
        }, [
        m("h3", {
          class: "suite-header"
        }, [m("i", {
          class:"fa fa-" + vm.icon()
        })], vm.title().toName()),
        m("div", {class: "suite-dialog-content-frame"}, [
          vm.content(),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary suite-dialog-button-ok",
            style: { display: vm.displayOk() },
            onclick: vm.onclickOk
          }, "Ok"),
          m("button", {
            class: "pure-button",
            onclick: vm.cancel,
            autofocus: true
          }, "Cancel")
        ])
      ]);

      return view;
    };

    return component;
  };

}(f));
