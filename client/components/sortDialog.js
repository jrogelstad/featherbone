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

  var statechart = window.statechart;

  f.viewModels.sortDialogViewModel = function (options) {
    var vm, state;

    // Statechart
    //state = statechart.State.define({concurrent: true}, function () {});
    //state.goto();

    vm = {};
    vm.close = function () {
      var dlg = document.getElementById(options.id);
      dlg.close();
    };

    return vm;
  };

  // Define dialog component
  f.components.sortDialog = function () {
    var component = {};

    component.controller = function (options) {
      this.vm = f.viewModels.sortDialogViewModel(options);
    };

    component.view = function (ctrl, options) {
      var view,
        vm = ctrl.vm;

      view = m("dialog", {
          id: "sortDialog",
          style: {borderRadius: "10px"}
        }, [
        m("p", "Hi, I'm modal!"),
        m("button", {
          id: "sortDialogOk",
          class: "pure-button  pure-button-primary",
          style: {marginRight: "5px"},
          onclick: vm.close
        }, "Ok"),
        m("button", {
          id: options.id,
          class: "pure-button",
          onclick: vm.close
        }, "Cancel")
      ]);

      return view;
    };

    return component;
  };

}(f));


