/**
    Framework for building object relational database apps

    Copyright (C) 2016  John Rogelstad
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

(function () {
  "use strict";

  var button = {},
    f = require("feather-core"),
    m = require("mithril"),
    statechart = require("statechartjs");

  /**
    @param {Object} Options
    @param {Object} [options.style] Style
    @param {String} [options.icon] Icon name
    @param {Function} [options.onclick] On click function
  */
  button.viewModel = function (options) {
    options = options || {};
    var vm, state, display, primary, mode, label, hotkey;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.activate = function () { state.send("activate"); };
    vm.isDisabled = function () { return mode().isDisabled(); };
    vm.deactivate = function () { state.send("deactivate"); };
    vm.disable = function () { state.send("disable"); };
    vm.enable = function () { state.send("enable"); };
    vm.class = function () { return mode().class(); };
    vm.hidden = function () { return display().hidden(); };
    vm.hide = function () { state.send("hide"); };
    vm.hotKey = function (value) {
      var title, len;

      if (arguments.length) {
        hotkey = value;
        title = vm.title();
        len = title.length;
        if (len) {
          title += " (";
        }
        title += "Alt + " + String.fromCharCode(hotkey);
        if (len) {
          title += ")";
        }
        vm.title(title);
      }
      return hotkey;
    };
    vm.icon = m.prop(options.icon || "");
    vm.id = m.prop(f.createId());
    vm.label = function (value) {
      var idx, ary;

      if (arguments.length) {
        idx = value.indexOf("&");
        if (idx > -1) {
          label = value.replace("&", "");
          vm.hotKey(label.slice(idx, idx + 1).toUpperCase().charCodeAt(0));
          ary = [];
          if (idx > 0) {
            ary.push(m("span", label.slice(0, idx)));
          }
          ary.push(m("span", {style: {
            textDecoration: "underline"
          }}, label.slice(idx, idx + 1)));
          ary.push(m("span", label.slice(idx + 1, label.length)));  
          label = ary;
        }
      }
      return label;
    };
    vm.onclick = m.prop(options.onclick);
    vm.onkeydown = function (e) {
      var id;
      if (e.altKey && e.which === vm.hotKey()) {
        id = vm.id();
        e.preventDefault();
        document.getElementById(id).click();
      }
    };
    vm.primary = function () { return primary().class(); };
    vm.show = function () { state.send("show"); };
    vm.state = function () { return state; };
    vm.style = function () { return options.style || {}; };
    vm.title = m.prop(options.title || "");

    // ..........................................................
    // PRIVATE
    //

    vm.label(options.label || "");
    if (options.hotkey) {
      vm.hotKey(options.hotkey.toUpperCase().charCodeAt(0));
    }

    // Define statechart
    state = statechart.define({concurrent: true}, function () {
      this.state("Mode", function () {
        this.state("Normal", function () {
          this.event("activate", function () {
            this.goto("../Active");
          });
          this.event("disable", function () {
            this.goto("../Disabled");
          });
          this.class = function () {
            return "";
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
            return "";
          };
          this.isDisabled = function () {
            return true;
          };
        });
      });
      this.state("Primary", function () {
        this.state("Off", function () {
          this.event("primaryOn", function () {
            this.goto("../On");
          });
          this.class = function () {
            return "";
          };
        });
        this.state("On", function () {
          this.event("primaryOff", function () {
            this.goto("../Off");
          });
          this.class = function () {
            return "pure-button-primary";
          };
        });
      });
      this.state("Display", function () {
        this.state("On", function () {
          this.event("hide", function () {
            this.goto("../Off");
          });
          this.hidden = function () {
            return "";
          };
        });
        this.state("Off", function () {
          this.event("show", function () {
            this.goto("../On");
          });
          this.hidden = function () {
            return "pure-button-hidden";
          };
        });
      });
    });
    state.goto();

    display = function () {
      return state.resolve(state.resolve("/Display").current()[0]);
    };

    mode = function () {
      return state.resolve(state.resolve("/Mode").current()[0]);
    };

    primary = function () {
      return state.resolve(state.resolve("/Primary").current()[0]);
    };

    return vm;
  };

  // Define button component
  button.component = function (options) {
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
      var opts, view, iconView,
        vm = ctrl.vm,
        classes = ["pure-button suite-button"],
        style = vm.style(),
        title = vm.title(),
        icon = vm.icon(),
        label = vm.label();

      if (vm.class()) { classes.push(vm.class()); }
      if (vm.primary()) { classes.push(vm.primary()); }
      classes.push(vm.hidden());

      opts = {
        id: vm.id(),
        type: "button",
        class: classes.join(" "),
        style: style,
        disabled: vm.isDisabled(),
        onclick: vm.onclick()
      };
      if (vm.hotKey()) {
        opts.config = function () {
          document.addEventListener("keydown", vm.onkeydown);
        };
      }

      if (icon) {
        iconView = [m("i", {
          class: "fa fa-" + icon,
          style: {marginRight: "4px"}
        })];
      }

      if (title) {
        opts.title = title;
      }

      view = m("button", opts, iconView, label);

      return view;
    };

    return component;
  };

  module.exports = button;

}());


