/*
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
*/
/*jslint this, browser*/
/**
    @module Dialog
*/
import f from "../core.js";

const catalog = f.catalog();
const dialog = {};
const m = window.m;
const dialogPolyfill = window.dialogPolyfill;
/**
    View model for dialog.

    @class Dialog
    @namespace ViewModels
    @constructor
    @param {Object} [options]
    @param {String} [options.icon] Dialog icon
    @param {String} [options.title] Dialog title
    @param {String} [options.message] Text message
    @param {Function} [options.onclickOk] Callback to execute on `Ok` clicked
    @param {Function} [options.onclickCancel] Callback to execute on `Cancel`
    clicked
*/
dialog.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    /**
        Ok button view model
        @method buttonOk
        @param {ViewModels.Button} [button]
        @return {ViewModels.Button}
    */
    vm.buttonOk = f.prop();
    /**
        Cancel button view model
        @method buttonCancel
        @param {ViewModels.Button} [button]
        @return {ViewModels.Button}
    */
    vm.buttonCancel = f.prop();
    /**
        Returns array of button view models on the dialog.
        @method buttons
        @return {Array}
    */
    vm.buttons = f.prop([
        vm.buttonOk,
        vm.buttonCancel
    ]);
    /**
        @method icon
        @param {String} [icon]
        @return {String}
    */
    vm.icon = f.prop(options.icon);
    /**
        Returns an object with ids for:
        * dialag
        * header
        * buttonOk
        * buttonCancel
        * contents
        @method ids
        @return {Object}
    */
    vm.ids = f.prop({
        dialog: options.id || f.createId(),
        header: f.createId(),
        buttonOk: f.createId(),
        buttonCancel: f.createId(),
        content: f.createId()
    });
    /**
        Runs cancel function if any, then closes dialog.
        @method cancel
    */
    vm.cancel = function () {
        let doCancel = vm.onCancel();
        if (typeof doCancel === "function") {
            doCancel();
        }
        state.send("close");
    };
    /**
        Edit dialog content.
        @method content
        @param {Boolean} isCell
        @return {Object} View
    */
    vm.content = function () {
        return m("div", {
            id: vm.ids().content
        }, vm.message());
    };
    /**
        Determine whether cancel is shown.
        @method displayCancel
        @return {String} Style
    */
    vm.displayCancel = function () {
        return (
            vm.onOk()
            ? "inline-block"
            : "none"
        );
    };
    /**
        @method message
        @param {String} message
        @return {String}
    */
    vm.message = f.prop(options.message || "Your message here");
    /**
        Function called on `Cancel` clicked.
        @method onCancel
        @param {Function} f
        @return {Function}
    */
    vm.onCancel = f.prop(options.onCancel);
    /**
        Function called on `Ok` clicked.
        @method onOk
        @param {Function} f
        @return {Function}
    */
    vm.onOk = f.prop(options.onOk);
    /**
        Call `Ok`.
        @method ok
    */
    vm.ok = function () {
        let doOk = vm.onOk();
        if (typeof doOk === "function") {
            doOk();
        }
        state.send("close");
    };
    /**
        @method okDisabled
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.okDisabled = f.prop(false);
    /**
        @method okTitle
        @param {String} title
        @return {String}
    */
    vm.okTitle = f.prop("");
    /**
        Show the dialog.
        @method show
    */
    vm.show = function () {
        state.send("show");
    };
    /**
        @method title
        @param {String} title
        @return {String}
    */
    vm.title = f.prop(options.title || "");
    /**
        @method state
        @param {String} title
        @return {State}
    */
    vm.state = function () {
        return state;
    };
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop({
        width: "450px"
    });

    // ..........................................................
    // PRIVATE
    //

    vm.buttonOk(f.createViewModel("Button", {
        onclick: vm.ok,
        label: "&Ok",
        class: "fb-dialog-button"
    }));
    vm.buttonOk().id(vm.ids().buttonOk);
    vm.buttonOk().isPrimary(true);

    vm.buttonCancel(f.createViewModel("Button", {
        onclick: vm.cancel,
        label: "&Cancel",
        class: "fb-dialog-button"
    }));
    vm.buttonCancel().id(vm.ids().buttonCancel);
    vm.buttonCancel().style = vm.displayCancel;

    // Statechart
    state = f.State.define(function () {
        this.state("Display", function () {
            this.state("Closed", function () {
                this.enter(function () {
                    let id = vm.ids().dialog;
                    let dlg = document.getElementById(id);

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
                    let id = vm.ids().dialog;
                    let dlg = document.getElementById(id);

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

catalog.register("viewModels", "dialog", dialog.viewModel);

/**
    Dialog component

    @class Dialog
    @statics
    @namespace Components
*/
dialog.component = {
    /**
        Pass either `vnode.attrs.viewModel` or `vnode.attrs` with options
        to build view model.

        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} [vnode.attrs.viewModel]
        @param {String} [vnode.attrs.title] Title
        @param {String} [vnode.attrs.icon] Icon name
        @param {Function} [vnode.attrs.onclickOk] On click `Ok` function
        @param {Function} [vnode.attrs.onclickCancel] On click `Cancel` function
        @param {String} [vnode.attrs.message] Message
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel ||
            dialog.viewModel(vnode.attrs)
        );
    },

    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let content;
        let vm = this.viewModel;
        let ids = vm.ids();

        if (vm.okDisabled()) {
            vm.buttonOk().disable();
        } else {
            vm.buttonOk().enable();
        }
        vm.buttonOk().title(vm.okTitle());

        content = vm.buttons().map(function (buttonItem) {
            return m(f.getComponent("Button"), {
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
                let dlg = document.getElementById(vnode.dom.id);
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

catalog.register("components", "dialog", dialog.component);

export default Object.freeze(dialog);