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
  f.viewModels.buttonViewModel = function (options) {
    options = options || {};
    var vm, state;

    // Define statechart
    state = f.statechart.State.define({concurrent: true}, function () {
      this.state("Mode", function () {
        this.state("Normal", function () {
          this.event("activate", function () {
            this.goto("../Active");
          });
          this.event("disable", function () {
            this.goto("../Disabled");
          });
          this.class = function () {
            return "pure-button";
          };
          this.isDisabled = function () {
            return false;
          };
        });
        this.state("Active", function () {
          this.event("deactivate", function () {
            this.goto("../Normal");
          });
          this.event("disable", function () {
            this.goto("../Disabled");
          });
          this.class = function () {
            return "pure-button-active";
          };
          this.isDisabled = function () {
            return false;
          };
        });
        this.state("Disabled", function () {
          this.event("enable", function () {
            this.goto("../Normal");
          });
          this.event("activate", function () {
            this.goto("../Active");
          });
          this.class = function () {
            return "pure-button";
          };
          this.isDisabled = function () {
            return true;
          };
        });
      });
      this.state("Primary", function () {
        this.state("On", function () {
          this.event("primaryOff", function () {
            this.goto("../Off");
          });
          this.class = function () {
            return "pure-button-primary";
          };
        });
        this.state("Off", function () {
          this.event("primaryOn", function () {
            this.goto("../On");
          });
          this.class = function () {
            return "";
          };
        });
      });
      this.state("Display", function () {
        this.state("On", function () {
          this.event("displayOff", function () {
            this.goto("../Off");
          });
          this.value = function () {
            return "inline-block";
          };
        });
        this.state("Off", function () {
          this.event("displayOn", function () {
            this.goto("../On");
          });
          this.value = function () {
            return "none";
          };
        });
      });
    });
    state.goto();

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.display = function () {
      return state.resolve(state.resolve("/Display").current()[0]);
    };
    vm.disabled = function () {
      return vm.mode().isDisabled();
    };
    vm.icon = m.prop(options.icon || "");
    vm.id = m.prop(f.createId());
    vm.label = m.prop(options.label || "");
    vm.onclick = m.prop(options.onclick);
    vm.mode = function () {
      return state.resolve(state.resolve("/Mode").current()[0]);
    };
    vm.primary = function () {
      return state.resolve(state.resolve("/Primary").current()[0]);
    };
    vm.state = function () {
      return state;
    };
    vm.style = function () {
      return options.style || {};
    };
    vm.title = m.prop(options.title || "");

    return vm;
  };

  // Define dialog component
  f.components.button = function (options) {
    options = options || {};
    var component = {};

    /**
      @param {Object} Options
      @param {Object} [options.viewModel] View model
    */
    component.controller = function () {
      this.vm =  options.viewModel || f.viewModels.buttonViewModel(options);
    };

    component.view = function (ctrl) {
      var view, iconView,
        vm = ctrl.vm,
        style = vm.style(),
        title = vm.title(),
        icon = vm.icon(),
        label = vm.label() ? " " + vm.label() : undefined,
        opts = {
          id: vm.id(),
          type: "button",
          class: "pure-button " + vm.mode().class(),
          style: style,
          disabled: vm.disabled(),
          onclick: vm.onclick()
        };

      style.backgroundColor = style.backgroundColor || "snow";
      style.display = vm.display().value();

      if (icon) {
        iconView = [m("i", {class: "fa fa-" + icon})];
      }

      if (title) {
        opts.title = title;
      }

      view = m("button", opts, iconView, label);

      return view;
    };

    return component;
  };

}(f));


