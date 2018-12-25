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
/*global require, module*/
/*jslint this, es6*/
(function () {
    "use strict";

    var checkbox = {},
        m = require("mithril"),
        f = require("common-core"),
        catalog = require("catalog");

    // Define checkbox component
    checkbox.component = {
        oninit: function (vnode) {
            this.id = vnode.attrs.id || f.createId();
        },

        view: function (vnode) {
            return m("div", {
                class: "fb-checkbox"
            }, [
                m("input", {
                    id: this.id,
                    class: "fb-checkbox-input",
                    type: "checkbox",
                    onclick: (e) => vnode.attrs.onclick(e.target.checked),
                    checked: vnode.attrs.value,
                    style: vnode.attrs.style || {},
                    required: !!vnode.attrs.required,
                    disabled: !!vnode.attrs.disabled
                }),
                m("label", {
                    for: this.id,
                    class: "fb-checkbox-label"
                }, m("i", {
                    class: "fa fa-check",
                    style: {
                        visibility: vnode.attrs.value
                            ? "visible"
                            : "hidden"
                    }
                }))
            ]);
        }
    };

    catalog.register("components", "checkbox", checkbox.component);
    module.exports = checkbox;

}());