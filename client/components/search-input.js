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
    @param {Object} Options
    @param {Object} [options.style] Style
    @param {String} [options.icon] Icon name
    @param {Function} [options.onclick] On click function
  */
  f.viewModels.searchInputViewModel = function (options) {
    options = options || {};
    var vm, state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.clear = function () {
      vm.value("");
      vm.end();
    };
    vm.end = function () { state.send("end"); };
    vm.onkeydown = function (e) {
      var key = e.key || e.keyIdentifier;
      if (key === "Enter") { vm.refresh(); }
    };
    vm.refresh = function () {
      if (options.refresh) {
        options.refresh();
      }
    };
    vm.start = function () { state.send("start"); };
    vm.state = function () { return state; };
    vm.style = function () { 
      return state.resolve(state.current()[0]).style();
    };
    vm.value = m.prop();

    // ..........................................................
    // PRIVATE
    //

    // Define statechart
    state = f.statechart.State.define(function () {
      this.state("Search", function () {
        this.state("Off", function () {
          this.enter(function () {
            vm.value("Search");
          });
          this.event("start", function () {
            this.goto("../On");
          });
          this.style = function () {
            return {
              color: "LightGrey",
              margin: "2px"
            };
          };
          this.value = function () {
            return "";
          };
        });
        this.state("On", function () {
          this.enter(function () {
            vm.value("");
          });
          this.exit(function () {
            vm.refresh();
          });
          this.canExit = function () {
            return !vm.value();
          };
          this.event("end", function () {
            this.goto("../Off");
          });
          this.style = function () {
            return {
              color: "Black",
              margin: "2px"
            };
          };
          this.value = function () {
            return vm.value();
          };
        });
      });
    });
    state.goto();

    return vm;
  };

  // Define dialog component
  f.components.searchInput = function (options) {
    options = options || {};
    var component = {};

    /**
      @param {Object} Options
      @param {Object} [options.viewModel] View model
    */
    component.controller = function () {
      this.vm =  options.viewModel || f.viewModels.searchInputViewModel(options);
    };

    component.view = function (ctrl) {
      var opts, view,
        vm = ctrl.vm;

      opts = {
        value: vm.value(),
        style: vm.style(),
        onfocus: vm.start,
        onblur: vm.end,
        oninput:  m.withAttr("value", vm.value),
        onkeydown: vm.onkeydown
      };

      view = m("input", opts);

      return view;
    };

    return component;
  };

}(f));


