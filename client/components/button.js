/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {
  "use strict";

  var button = {},
    f = require("common-core"),
    m = require("mithril"),
    stream = require("stream"),
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
    vm.icon = stream(options.icon || "");
    vm.id = stream(f.createId());
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
    vm.onclick = stream(options.onclick);
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
    vm.title = stream(options.title || "");

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
          this.class = stream("");
          this.isDisabled = stream(false);
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
          this.isDisabled = stream(false);
        });
        this.state("Disabled", function () {
          this.event("enable", function () {
            this.goto("../Normal");
          });
          this.event("activate", function () {
            this.goto("../Active");
          });
          this.class = stream("");
          this.isDisabled = stream(true);
        });
      });
      this.state("Primary", function () {
        this.state("Off", function () {
          this.event("primaryOn", function () {
            this.goto("../On");
          });
          this.class = stream("");
        });
        this.state("On", function () {
          this.event("primaryOff", function () {
            this.goto("../Off");
          });
          this.class = stream("pure-button-primary");
        });
      });
      this.state("Display", function () {
        this.state("On", function () {
          this.event("hide", function () {
            this.goto("../Off");
          });
          this.hidden = stream("");
        });
        this.state("Off", function () {
          this.event("show", function () {
            this.goto("../On");
          });
          this.hidden = stream("pure-button-hidden");
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

  // Helper function to generate button icon
  var iconView = function (icon) {
    if (icon) {
      return [m("i", {
        class: "fa fa-" + icon,
        style: {marginRight: "4px"}
      })];
    }
  };

  // Define button component
  button.component =  {
    oninit: function (vnode) {
      var vm =  vnode.attrs.viewModel || button.viewModel(vnode.attrs);
      this.viewModel = vm;
      this.classes = ["pure-button suite-button"];
      if (vm.class()) { this.classes.push(vm.class()); }
      if (vm.primary()) { this.classes.push(vm.primary()); }
      this.classes.push(vm.hidden());
    },

    view: function () {
      var vm = this.viewModel;

      return m("button", {
        id: vm.id(),
        type: "button",
        class: this.classes.join(" "),
        style: vm.style(),
        disabled: vm.isDisabled(),
        onclick: vm.onclick(),
        title: vm.title(),
        oncreate: function () {
          if (vm.hotKey()) {
            document.addEventListener("keydown", vm.onkeydown);
          }
        },
        onremove: function () {
          if (vm.hotKey()) {
            document.removeEventListener("keydown", vm.onkeydown);
          }
        }
      }, 
      iconView(vm.icon()),
      vm.label());
    }
  };

  module.exports = button;

}());


