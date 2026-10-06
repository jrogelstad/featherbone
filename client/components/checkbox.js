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
    @module Checkbox
*/

const checkbox = {};

/**
    Generate view model for checkbox.

    @class Checkbox
    @constructor
    @namespace ViewModels
    @param {Object} [options] Options
    @param {String} [options.id] Id
    @param {Boolean} [options.isCell] Use style for cell in table
*/
checkbox.viewModel = function (options) {
    let vm = {};

    vm.id = f.prop(options.id || f.createId());
    /**
        @method isCell
        @param {Boolean} flag
        @return {String}
    */
    vm.isCell = f.prop(Boolean(options.isCell));

    return vm;
};

/**
    Checkbox component.

    Renders a real `<input type="checkbox">` rather than hiding one
    off-screen and redrawing a checkmark by hand: the native control
    already paints its own check in the theme's accent color (see
    `.fb-checkbox-input` in featherbone.css, which sets `accent-color`)
    and already knows whether it's checked, so nothing here has to
    compute a `visibility` style on every render to fake that. The
    focus ring is plain CSS (`:focus-visible`) for the same reason.

    @class Checkbox
    @static
    @namespace Components
*/
checkbox.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {String} [vnode.attrs.id] Id
        @param {String} [vnode.attrs.label] Label
        @param {Function} [vnode.attrs.onclick] On click handler
        @param {Function} [vnode.attrs.onCreate] On create handler
        @param {Function} [vnode.attrs.onRemove] On remove handler
        @param {Function} [vnode.attrs.value] Value
        @param {Boolean} [vnode.attrs.title] Title
        @param {Boolean} [vnode.attrs.readonly] Read only flag
        @param {Object} [vnode.attrs.style] Style
    */
    oninit: function (vnode) {
        this.viewModel = checkbox.viewModel(vnode.attrs);
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {String} [vnode.attrs.label] Label
        @param {Function} [vnode.attrs.onclick] On click handler
        @param {Function} [vnode.attrs.onCreate] On create handler
        @param {Function} [vnode.attrs.onRemove] On remove handler
        @param {Function} [vnode.attrs.value] Value
        @param {Boolean} [vnode.attrs.title] Title
        @param {Boolean} [vnode.attrs.readonly] Read only flag
        @param {Object} [vnode.attrs.style] Style
        @return {Object} View
    */
    view: function (vnode) {
        let labelClass = vnode.attrs.labelClass || "fb-checkbox-label";
        let vm = this.viewModel;
        let theclass = vnode.attrs.inputClass || "fb-checkbox-input";
        let wrapClass = "fb-checkbox";
        let thestyle = vnode.attrs.style || {};

        if (vm.isCell()) {
            wrapClass += " fb-checkbox-cell";
        }

        return m("div", {
            class: wrapClass
        }, [
            m("input", {
                id: vm.id(),
                class: theclass,
                type: "checkbox",
                title: vnode.attrs.title,
                onclick: function (e) {
                    vnode.attrs.onclick(e.target.checked);
                },
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                checked: vnode.attrs.value,
                style: thestyle,
                disabled: vnode.attrs.readonly,
                required: Boolean(vnode.attrs.required),
                onfocus: vnode.attrs.onFocus,
                onblur: vnode.attrs.onBlur
            }),
            (
                vnode.attrs.label
                ? m("label", {
                    for: vm.id(),
                    class: labelClass
                }, vnode.attrs.label)
                : undefined
            )
        ]);
    }
};

f.catalog().register("components", "checkbox", checkbox.component);
