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
    @module UrlWidget
*/
const urlWidget = {};

/**
    @class UrlWidget
    @param {Object} options
    @param {Object} options.parentViewModel
    @param {String} options.parentProprety
    @param {String} [options.id]
    @param {String} [options.key]
    @param {Object} [options.style]
*/
urlWidget.viewModel = function (options) {
    let vm = {};

    /**
        Open button view model.
        @method buttonOpen
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonOpen = f.prop();

    /*
        Open URL in browser
        @method doOpen
    */
    vm.doOpen = function () {
        let url = options.parentViewModel.model().data[
            options.parentProperty
        ]();
        if (url.slice(0, 4) !== "http") {
            url = "http://" + url;
        }

        window.open(url);
    };

    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());

    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key || f.createId());

    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});

    // ..........................................................
    // PRIVATE
    //

    vm.buttonOpen(f.createViewModel("Button", {
        onclick: vm.doOpen,
        title: "Open link in new browser tab",
        icon: "launch",
        class: "fb-data-type-edit-button"
    }));

    return vm;
};

/**
    URLwidget component

    @class UrlWidget
    @static
    @namespace Components
*/
urlWidget.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProprety
        @param {String} [vnode.attrs.id]
        @param {String} [vnode.attrs.key]
        @param {String} [vnode.attrs.readonly]
        @param {Object} [vnode.attrs.style] Style
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = urlWidget.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            key: options.key,
            style: options.style
        });
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        let options = vnode.attrs;
        let ret;
        let vm = this.viewModel;
        let theStyle = vm.style();
        let prop = options.prop;
        let opts = {
            readonly: options.readonly,
            id: vm.id(),
            //key: vm.id(),
            required: options.required,
            type: "url",
            onchange: (e) => prop(e.target.value),
            oncreate: options.onCreate,
            onremove: options.onRemove,
            value: prop()
        };

        if (opts.class) {
            opts.class = "fb-input " + opts.class;
        } else {
            opts.class = "fb-input";
        }

        theStyle.display = theStyle.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            m("input", opts),
            m(f.getComponent("Button"), {
                viewModel: vm.buttonOpen()
            })
        ]);

        return ret;
    }
};

f.catalog().register(
    "components",
    "urlWidget",
    urlWidget.component
);


