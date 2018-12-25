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
/*jslint this*/
/*global dialogPolyfill, require, module, document*/
(function () {
    "use strict";

    var dialog = {},
        m = require("mithril"),
        stream = require("stream"),
        f = require("common-core"),
        statechart = require("statechartjs"),
        dialogPolyfill = require("dialog-polyfill"),
        button = require("button");

    /**
      View model for sort dialog.

      @param {Object} Options
      @param {Array} [options.icon] Dialog icon
      @param {Array} [options.title] Dialog title
      @param {Array} [options.message] Text message
      @param {Function} [options.onclickOk] Function to execute on ok clicked
    */
    dialog.viewModel = function (options) {
        options = options || {};
        var vm, state;

        // ..........................................................
        // PUBLIC
        //

        vm = {};
        vm.buttonOk = stream();
        vm.buttonCancel = stream();
        vm.buttons = stream([
            vm.buttonOk,
            vm.buttonCancel
        ]);
        vm.icon = stream(options.icon);
        vm.ids = stream({
            dialog: options.id || f.createId(),
            header: f.createId(),
            buttonOk: f.createId(),
            buttonCancel: f.createId(),
            content: f.createId()
        });
        vm.cancel = function () {
            var doCancel = vm.onCancel();
            if (typeof doCancel === "function") {
                doCancel();
            }
            state.send("close");
        };
        vm.content = function () {
            return m("div", {
                id: vm.ids().content
            }, vm.message());
        };
        vm.displayCancel = function () {
            return vm.onOk()
                ? "inline-block"
                : "none";
        };
        vm.message = stream(options.message || "Your message here");
        vm.onCancel = stream(options.onCancel);
        vm.onOk = stream(options.onOk);
        vm.ok = function () {
            var doOk = vm.onOk();
            if (typeof doOk === "function") {
                doOk();
            }
            state.send("close");
        };
        vm.okDisabled = stream(false);
        vm.okTitle = stream("");
        vm.show = function () {
            state.send("show");
        };
        vm.title = stream(options.title || "");
        vm.state = function () {
            return state;
        };
        vm.style = stream({
            width: "450px"
        });

        // ..........................................................
        // PRIVATE
        //

        vm.buttonOk(button.viewModel({
            onclick: vm.ok,
            label: "&Ok",
            class: "fb-dialog-button"
        }));
        vm.buttonOk().id(vm.ids().buttonOk);
        vm.buttonOk().state().send("primaryOn");

        vm.buttonCancel(button.viewModel({
            onclick: vm.cancel,
            label: "&Cancel",
            class: "fb-dialog-button"
        }));
        vm.buttonCancel().id(vm.ids().buttonCancel);
        vm.buttonCancel().style = vm.displayCancel;

        // Statechart
        state = statechart.define(function () {
            this.state("Display", function () {
                this.state("Closed", function () {
                    this.enter(function () {
                        var id = vm.ids().dialog,
                            dlg = document.getElementById(id);
                        if (dlg && dlg.open) {
                            dlg.close();
                        }
                    });
                    this.event("show", function () {
                        this.goto("../Showing");
                    });
                });
                this.state("Showing", function () {
                    this.enter(function () {
                        var id = vm.ids().dialog,
                            dlg = document.getElementById(id);
                        if (dlg) {
                            dlg.showModal();
                        }
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
      Dialog component

      @params {Object} View model
    */
    dialog.component = {
        oninit: function (vnode) {
            this.viewModel = vnode.attrs.viewModel || dialog.viewModel(vnode.attrs);
        },

        view: function () {
            var content,
                vm = this.viewModel,
                ids = vm.ids();

            if (vm.okDisabled()) {
                vm.buttonOk().disable();
            } else {
                vm.buttonOk().enable();
            }
            vm.buttonOk().title(vm.okTitle());

            content = vm.buttons().map(function (buttonItem) {
                return m(button.component, {
                    viewModel: buttonItem()
                });
            });
            content.unshift(m("br"));
            content.unshift(vm.content());

            return m("dialog", {
                id: ids.dialog,
                class: "fb-dialog",
                style: f.copy(vm.style()),
                oncreate: function (vnode) {
                    // Make Chrome style dialog available for all browsers
                    var dlg = document.getElementById(vnode.dom.id);
                    if (!dlg.showModal) {
                        dialogPolyfill.registerDialog(dlg);
                    }
                }
            }, [
                m("h3", {
                    id: ids.header,
                    class: "fb-header"
                }, [m("i", {
                    class: "fa fa-" + vm.icon() + " fb-dialog-icon"
                })], vm.title().toName()),
                m("div", {
                    class: "fb-dialog-content-frame"
                }, content)
            ]);
        }
    };

    module.exports = dialog;

}());