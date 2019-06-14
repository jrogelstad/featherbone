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
import f from "../core.js";
import catalog from "../models/catalog.js";

const checkbox = {};
const m = window.m;

checkbox.viewModel = function (options) {
    let vm = {};

    vm.hasFocus = f.prop(false);
    vm.id = f.prop(options.id || f.createId());

    return vm;
};

// Define checkbox component
checkbox.component = {
    oninit: function (vnode) {
        this.viewModel = checkbox.viewModel(vnode.attrs);
    },

    view: function (vnode) {
        let labelClass = "fb-checkbox-label";
        let vm = this.viewModel;
        let id = vm.id();

        if (vnode.attrs.readonly) {
            labelClass += " fb-checkbox-readonly";
        }

        if (vm.hasFocus()) {
            labelClass += " fb-checkbox-focus";
        }

        return m("div", {
            class: "fb-checkbox"
        }, [
            m("input", {
                id: id,
                class: "fb-checkbox-input",
                type: "checkbox",
                onclick: function (e) {
                    vnode.attrs.onclick(e.target.checked);
                },
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                checked: vnode.attrs.value,
                style: vnode.attrs.style || {},
                disabled: vnode.attrs.readonly,
                required: Boolean(vnode.attrs.required),
                onfocus: () => vm.hasFocus(true),
                onblur: () => vm.hasFocus(false)
            }),
            m("label", {
                for: id,
                title: vnode.attrs.title,
                class: labelClass
            }, m("i", {
                class: "fa fa-check",
                style: {
                    visibility: (
                        vnode.attrs.value
                        ? "visible"
                        : "hidden"
                    )
                }
            }))
        ]);
    }
};

catalog.register("components", "checkbox", checkbox.component);

export default Object.freeze(checkbox);
