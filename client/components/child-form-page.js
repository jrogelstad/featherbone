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
/*
    @module ChildFormPage
*/
import f from "../core.js";

const catalog = f.catalog();
const childFormPage = {};
const m = window.m;

/**
    Generate view model for child form page.

    @class ChildFormPage
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {String} options.parentProperty
    @param {String} [options.form]
    @param {String} [options.index]
    @param {Boolean} [options.isNew]
    @param {Boolean} [options.create]
*/
childFormPage.viewModel = function (options) {
    if (!catalog.store().instances) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let instances = catalog.store().instances();
    let model = instances[options.key];

    if (!model) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let ary = model.parent().data[options.parentProperty]();
    let sseState = catalog.store().global().sseState;
    let feather = options.feather.toCamelCase(true);
    let form = f.getForm({
        form: options.form,
        feather: feather
    });
    let vm = {};
    let pageIdx = options.index || 1;
    let isNew = options.create && options.isNew !== false;

    /**
        Done button view model.
        @method buttonDone
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDone = f.prop();
    /**
        Previous button view model.
        @method buttonPrevious
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonPrevious = f.prop();
    /**
        Next button view model.
        @method buttonNext
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonNext = f.prop();
    /**
        New button view model.
        @method buttonNew
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonNew = f.prop();
    /**
        Open a detail record.
        @method doChildOpen
    */
    vm.doChildOpen = function (idx) {
        let target = ary[idx];

        delete instances[model.id()];
        instances[target.id()] = target;

        m.route.set("/traverse/:feather/:key", {
            feather: options.feather,
            key: target.id()
        }, {
            state: {
                parentProperty: options.parentProperty,
                form: options.form,
                index: pageIdx + 1
            }
        });
    };
    /**
        @method doDone
    */
    vm.doDone = function () {
        // Once we consciously leave, purge memoize
        delete instances[vm.model().id()];
        window.history.go(pageIdx * -1);
    };
    /**
        Navigate to previous model in parent.
        @method doNext
    */
    vm.doPrevious = function () {
        let idx = ary.indexOf(model);

        vm.doChildOpen(idx - 1);
    };
    /**
        Advance to next model in parent.
        @method doNext
    */
    vm.doNext = function () {
        let idx = ary.indexOf(model);

        vm.doChildOpen(idx + 1);
    };
    /**
        Create a new model and navigate to it.
        @method doNew
    */
    vm.doNew = function () {
        let newInstance = f.createList(feather);

        ary.add(newInstance);
        vm.doChildOpen(ary.length - 1);
    };
    /**
        @method formWidget
        @param {ViewModels.FormWidget} widget
        @return {ViewModels.FormWidget}
    */
    vm.formWidget = f.prop();
    /**
        Data model.
        @method model
        @return {Model}
    */
    vm.model = function () {
        return vm.formWidget().model();
    };
    /**
        Dialog to report server side event errors.
        @method sseErrorDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sseErrorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "close",
        title: "Connection Error",
        message: (
            "You have lost connection to the server." +
            "Click \"Ok\" to attempt to reconnect."
        ),
        onOk: function () {
            document.location.reload();
        }
    }));
    vm.sseErrorDialog().buttonCancel().hide();
    /**
        @method title
        @return {String}
    */
    vm.title = function () {
        return options.parentProperty.toName();
    };

    // Create form widget
    vm.formWidget(f.createViewModel("FormWidget", {
        isNew: isNew,
        model: model,
        id: options.key,
        config: form,
        outsideElementIds: ["toolbar"]
    }));

    // Create button view models
    vm.buttonDone(f.createViewModel("Button", {
        onclick: vm.doDone,
        label: "&Done"
    }));
    vm.buttonDone().isPrimary(true);

    vm.buttonPrevious(f.createViewModel("Button", {
        onclick: vm.doPrevious,
        label: "&Previous",
        icon: "arrow-up",
        class: "fb-toolbar-button"
    }));
    if (ary.indexOf(model) === 0) {
        vm.buttonPrevious().disable();
        vm.buttonPrevious().title("Current data is first record");
    }

    vm.buttonNext(f.createViewModel("Button", {
        onclick: vm.doNext,
        label: "&Next",
        icon: "arrow-down",
        class: "fb-toolbar-button"
    }));
    if (ary.indexOf(model) === ary.length - 1) {
        vm.buttonNext().disable();
        vm.buttonNext().title("Current data is last record");
    }

    vm.buttonNew(f.createViewModel("Button", {
        onclick: vm.doNew,
        label: "&New",
        icon: "plus-circle",
        class: "fb-toolbar-button"
    }));
    if (f.findRoot(model).state().current()[0] === "/Ready/Fetched/ReadOnly") {
        vm.buttonNew().disable();
        vm.buttonNew().title("Data is read only");
    }

    sseState.resolve("Error").enter(function () {
        vm.sseErrorDialog().show();
    });

    return vm;
};

catalog.register("viewModels", "childFormPage", childFormPage.viewModel);

/**
    Child form page component

    @class ChildFormPage
    @static
    @namespace Components
*/
childFormPage.component = {
    /**
        Pass either `vnode.attrs.viewModel` or `vnode.attrs` with options
        to build view model.

        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs Options
        @param {String} vnode.attrs.viewModel
        @param {String} vnode.attrs.parentProperty
        @param {String} vnode.attrs.form
        @param {String} vnode.attrs.index
        @param {Boolean} vnode.attrs.isNew
        @param {Boolean} vnode.attrs.create
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || childFormPage.viewModel(vnode.attrs)
        );
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        if (vnode.attrs.isInvalid) {
            return;
        }

        let lock;
        let title;
        let vm = this.viewModel;
        let model = vm.model();
        let icon = "file-alt";

        if (model.isValid()) {
            switch (model.state().current()[0]) {
            case "/Locked":
                icon = "lock";
                lock = model.data.lock() || {};
                title = (
                    "User: " + lock.username + "\nSince: " +
                    new Date(lock.created).toLocaleTimeString()
                );
                break;
            case "/Ready/Fetched/Dirty":
                icon = "pencil-alt";
                title = "Editing record";
                break;
            case "/Ready/New":
                icon = "plus";
                title = "New record";
                break;
            }
        } else {
            icon = "exclamation-triangle";
            title = model.lastError();
        }

        // Build view
        return m("div", [
            m("div", {
                id: "toolbar",
                class: "fb-toolbar"
            }, [
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonDone()
                }),
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonPrevious()
                }),
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonNext()
                }),
                m(f.getComponent("Button"), {
                    viewModel: vm.buttonNew()
                })
            ]),
            m("div", {
                class: "fb-title"
            }, [
                m("i", {
                    class: "fa fa-" + icon + " fb-title-icon",
                    title: title
                }),
                m("label", vm.title())
            ]),
            m(f.getComponent("Dialog"), {
                viewModel: vm.sseErrorDialog()
            }),
            m(f.getComponent("FormWidget"), {
                viewModel: vm.formWidget()
            })
        ]);
    }
};

catalog.register("components", "childFormPage", childFormPage.component);

export default Object.freeze(childFormPage);
