/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint this, browser*/
import f from "../core.js";
import catalog from "../models/catalog.js";
import State from "../state.js";

const button = {};
const m = window.m;

/**
  @param {Object} Options
  @param {String} [options.label] Label
  @param {String} [options.icon] Icon name
  @param {Function} [options.onclick] On click function
  @param {String} [options.class] Class
  @param {Object} [options.style] Style
  @return {Object}
*/
button.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;
    let display;
    let primary;
    let mode;
    let label;
    let hotkey;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.activate = function () {
        state.send("activate");
    };
    vm.isDisabled = function () {
        return mode().isDisabled();
    };
    vm.deactivate = function () {
        state.send("deactivate");
    };
    vm.disable = function () {
        state.send("disable");
    };
    vm.enable = function () {
        state.send("enable");
    };
    vm.class = function () {
        return options.class + " " + mode().class();
    };
    vm.hidden = function () {
        return display().hidden();
    };
    vm.hide = function () {
        state.send("hide");
    };
    vm.hotKey = function (...args) {
        let title;
        let len;
        let value = args[0];

        if (args.length) {
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
    vm.icon = f.prop(options.icon || "");
    vm.id = f.prop(f.createId());
    vm.isPrimary = function (flag) {
        if (Boolean(flag)) {
            state.send("primaryOn");
        } else {
            state.send("primaryOff");
        }

        return state.current()[1] === "Primary/On";
    };
    vm.label = function (...args) {
        let idx;
        let ary;
        let value = args[0];

        if (args.length) {
            label = value;
            idx = value.indexOf("&");
            if (idx > -1) {
                label = value.replace("&", "");
                vm.hotKey(
                    label.slice(idx, idx + 1).toUpperCase().charCodeAt(0)
                );
                ary = [];
                if (idx > 0) {
                    ary.push(m("span", label.slice(0, idx)));
                }
                ary.push(m("span", {
                    style: {
                        textDecoration: "underline"
                    }
                }, label.slice(idx, idx + 1)));
                ary.push(m("span", label.slice(idx + 1, label.length)));
                label = ary;
            }
        }
        return label;
    };
    vm.onclick = f.prop(options.onclick);
    vm.onkeydown = function (e) {
        let id;

        if (e.altKey && e.which === vm.hotKey()) {
            id = vm.id();
            e.preventDefault();
            document.getElementById(id).click();
        }
    };
    vm.primaryClass = function () {
        return primary().class();
    };
    vm.show = function () {
        state.send("show");
    };
    vm.state = function () {
        return state;
    };
    vm.style = function () {
        return options.style || {};
    };
    vm.title = f.prop(options.title || "");

    // ..........................................................
    // PRIVATE
    //

    vm.label(options.label || "");
    if (options.hotkey) {
        vm.hotKey(options.hotkey.toUpperCase().charCodeAt(0));
    }

    // Define statechart
    state = State.define({
        concurrent: true
    }, function () {
        this.state("Mode", function () {
            this.state("Normal", function () {
                this.event("activate", function () {
                    this.goto("../Active");
                });
                this.event("disable", function () {
                    this.goto("../Disabled");
                });
                this.class = f.prop("");
                this.isDisabled = f.prop(false);
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
                this.isDisabled = f.prop(false);
            });
            this.state("Disabled", function () {
                this.event("enable", function () {
                    this.goto("../Normal");
                });
                this.event("activate", function () {
                    this.goto("../Active");
                });
                this.class = f.prop("");
                this.isDisabled = f.prop(true);
            });
        });
        this.state("Primary", function () {
            this.state("Off", function () {
                this.event("primaryOn", function () {
                    this.goto("../On");
                });
                this.class = f.prop("");
            });
            this.state("On", function () {
                this.event("primaryOff", function () {
                    this.goto("../Off");
                });
                this.class = f.prop("pure-button-primary");
            });
        });
        this.state("Display", function () {
            this.state("On", function () {
                this.event("hide", function () {
                    this.goto("../Off");
                });
                this.hidden = f.prop("");
            });
            this.state("Off", function () {
                this.event("show", function () {
                    this.goto("../On");
                });
                this.hidden = f.prop("pure-button-hidden");
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

catalog.register("viewModels", "button", button.viewModel);

// Define button component
button.component = {
    oninit: function (vnode) {
        let vm = vnode.attrs.viewModel || button.viewModel(vnode.attrs);
        this.viewModel = vm;
    },

    view: function () {
        let opts;
        let view;
        let iconView;
        let vm = this.viewModel;
        let classes = ["pure-button"];
        let style = vm.style();
        let title = vm.title();
        let icon = vm.icon();
        let label = vm.label();

        opts = {
            id: vm.id(),
            type: "button",
            style: style,
            disabled: vm.isDisabled(),
            onclick: vm.onclick()
        };

        if (vm.isDisabled()) {
            classes.push("fb-button-disabled");
        }

        if (vm.class()) {
            classes.push(vm.class());
        }
        if (vm.primaryClass()) {
            classes.push(vm.primaryClass());
        }
        classes.push(vm.hidden());
        opts.class = classes.join(" ");

        if (vm.hotKey()) {
            opts.oncreate = function () {
                document.addEventListener("keydown", vm.onkeydown);
            };
            opts.onremove = function () {
                document.removeEventListener("keydown", vm.onkeydown);
            };
        }

        if (icon) {
            iconView = [m("i", {
                class: "fa fa-" + icon + " fb-button-icon"
            })];
        }

        if (title) {
            opts.title = title;
        }

        view = m("button", opts, iconView, label);

        return view;
    }
};

catalog.register("components", "button", button.component);

export default Object.freeze(button);