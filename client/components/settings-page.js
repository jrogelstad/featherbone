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
    @module SettingsPage
*/
const settingsPage = {};

/**
    View model for settings page.

    @class SettingsPage
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {Object} options.settings
*/
settingsPage.viewModel = function (options) {
    options = options || {};
    let vm = {};
    let form = options.form || {};
    let models = f.catalog().store().models();
    let theModel = models[options.settings]();
    let definition = models[options.settings].definition();

    // Build form from settings definition
    if (!options.form) {
        form.name = definition.name;
        form.description = definition.description;
        form.attrs = [];
        Object.keys(definition.properties).forEach(function (key) {
            form.attrs.push({
                attr: key,
                grid: 0,
                unit: 0
            });
        });
    }

    // ..........................................................
    // PUBLIC
    //

    /**
        @method buttonDone
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDone = f.prop();
    /**
        @method doDone
    */
    vm.doDone = function () {
        if (theModel.canSave()) {
            vm.formWidget().model().save().then(function () {
                window.history.back();
            });
            return;
        }

        window.history.back();
    };
    /**
        @method formWidget
        @param {ViewModels.FormWidget} widget
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop(f.createViewModel("FormWidget", {
        model: theModel,
        id: options.settings,
        config: form,
        outsideElementIds: ["toolbar"]
    }));

    /**
        @method model
        @param {Model} model
        @return {Model}
    */
    vm.model = f.prop(theModel);
    /**
        @method title
        @return {String}
    */
    vm.title = function () {
        return options.settings.toName();
    };

    // ..........................................................
    // PRIVATE
    //

    vm.buttonDone(f.createViewModel("Button", {
        onclick: vm.doDone,
        label: "&Done",
        class: "fb-toolbar-button"
    }));

    if (theModel.state().current()[0] === "/Ready/New") {
        theModel.fetch();
    }

    return vm;
};

/**
    Settings page component

    @class SettingsPage
    @static
    @namespace Components
*/
settingsPage.component = {
    /**
        Must pass view model instance or settings to build one.
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {ViewModels.SettingsPage} [vnode.attrs.viewModel]
        @param {Function} [vnode.attrs.settings]
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || settingsPage.viewModel(vnode.attrs)
        );
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;

        // Build view
        return m("div", [
            m("div", {
                id: "toolbar",
                class: "fb-toolbar"
            }, [
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonDone()
                })
            ]),
            m("div", {
                class: "fb-title"
            }, [
                m("i", {
                    class: "material-icons fb-title-icon"
                }, "build"),
                m("label", vm.title())
            ]),
            m(f.getComponent("FormWidget"), {
                viewModel: vm.formWidget()
            })
        ]);
    }
};

f.catalog().register("components", "settingsPage", settingsPage.component);
