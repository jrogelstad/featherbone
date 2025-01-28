/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
*/
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    @module Button
*/

const button = {};

/**
    Generate view model for button.

    @class Button
    @constructor
    @namespace ViewModels
    @param {Object} [options]
    @param {String} [options.label] Label
    @param {String} [options.icon] Icon name
    @param {Function} [options.onclick] On click function
    @param {String} [options.class] Class
    @param {Object} [options.style] Style
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
    let style = options.style || {};

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    /**
        @method activate
    */
    vm.activate = function () {
        state.send("activate");
    };
    /**
        @method isDisabled
        @return {Boolean}
    */
    vm.isDisabled = function () {
        return mode().isDisabled();
    };
    /**
        @method deactivate
    */
    vm.deactivate = function () {
        state.send("deactivate");
    };
    /**
        @method disable
    */
    vm.disable = function () {
        state.send("disable");
    };
    /**
        @method enable
    */
    vm.enable = function () {
        state.send("enable");
    };
    /**
        @method class
        @return {String}
    */
    vm.class = function () {
        return options.class + " " + mode().class();
    };
    /**
        @method hidden
        @return {Boolean}
    */
    vm.hidden = function () {
        return display().hidden();
    };
    /**
        @method hide
    */
    vm.hide = function () {
        state.send("hide");
    };
    /**
        @method hotKey
        @param {String} [key]
        @return {String} key
    */
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
    /**
        @method icon
        @param {String} [icon]
        @return {String}
    */
    vm.icon = f.prop(options.icon || "");
    /**
        @method id
        @param {String} [id]
        @return {String}
    */
    vm.id = f.prop(f.createId());
    /**
        @method isPrimary
        @param {Boolean} [flag]
        @return {Boolean}
    */
    vm.isPrimary = function (flag) {
        if (Boolean(flag)) {
            state.send("primaryOn");
        } else {
            state.send("primaryOff");
        }

        return state.current()[1] === "Primary/On";
    };
    /**
        @method label
        @param {String} [label]
        @return {String}
    */
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
    /**
        @method onclick
        @param {Function} [f]
        @return {Function}
    */
    vm.onclick = f.prop(options.onclick);
    /**
        @method onkeydown
        @param {Event} event
    */
    vm.onkeydown = function (e) {
        let id;
        let b;

        if (e.altKey && e.which === vm.hotKey()) {
            id = vm.id();
            b = document.getElementById(id);

            // Only fire if in visible content
            if (b.offsetParent) {
                b.focus();
                b.click();
                e.preventDefault();
            }
        }
    };
    /**
        @method primaryClass
        @return {String}
    */
    vm.primaryClass = function () {
        return primary().class();
    };
    /**
        @method show
    */
    vm.show = function () {
        state.send("show");
    };
    /**
        @method state
        @return {State}
    */
    vm.state = function () {
        return state;
    };
    /**
        @method style
        @return {Object}
    */
    vm.style = function () {
        return style;
    };
    /**
        @method title
        @param {String} [title]
        @return {String}
    */
    vm.title = f.prop(options.title || "");

    // ..........................................................
    // PRIVATE
    //

    vm.label(options.label || "");
    if (options.hotkey) {
        vm.hotKey(options.hotkey.toUpperCase().charCodeAt(0));
    }

    // Define statechart
    state = f.State.define({
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

f.catalog().register("viewModels", "button", button.viewModel);

/**
    Button component

    @class Button
    @static
    @namespace Components
*/
button.component = {
    /**
        Pass either `vnode.attrs.viewModel` or `vnode.attrs` with options
        to build view model.

        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} [vnode.attrs.viewModel]
        @param {String} [vnode.attrs.label] Label
        @param {String} [vnode.attrs.icon] Icon name
        @param {Function} [vnode.attrs.onclick] On click function
        @param {String} [vnode.attrs.class] Class
        @param {Object} [vnode.attrs.style] Style
    */
    oninit: function (vnode) {
        let vm = vnode.attrs.viewModel || button.viewModel(vnode.attrs);
        this.viewModel = vm;
    },

    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let opts;
        let view;
        let iconView;
        let vm = this.viewModel;
        let classes = ["pure-button"];
        let title = vm.title();
        let icon = vm.icon();
        let label = vm.label();

        opts = {
            id: vm.id(),
            type: "button",
            style: vm.style(),
            disabled: vm.isDisabled(),
            onclick: vm.onclick()
        };

        if (!icon) {
            opts.style.paddingTop = "8px";
        }

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
                class: "material-icons-outlined fb-button-icon"
            }, icon)];
        }

        if (title) {
            opts.title = title;
        }

        view = m("button", opts, iconView, label);

        return view;
    }
};

f.catalog().register("components", "button", button.component);
