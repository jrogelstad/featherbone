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
import button from "./button.js";
import catalog from "../models/catalog.js";
import formWidget from "./form-widget.js";
import dialog from "./dialog.js";

const childFormPage = {};
const m = window.m;

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

    // ..........................................................
    // PUBLIC
    //

    vm.buttonDone = f.prop();
    vm.buttonPrevious = f.prop();
    vm.buttonNext = f.prop();
    vm.buttonNew = f.prop();
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
    vm.doDone = function () {
        // Once we consciously leave, purge memoize
        delete instances[vm.model().id()];
        window.history.go(pageIdx * -1);
    };
    vm.doPrevious = function () {
        let idx = ary.indexOf(model);

        vm.doChildOpen(idx - 1);
    };
    vm.doNext = function () {
        let idx = ary.indexOf(model);

        vm.doChildOpen(idx + 1);
    };
    vm.doNew = function () {
        let newInstance = catalog.store().models()[feather.toCamelCase()]();

        ary.add(newInstance);
        vm.doChildOpen(ary.length - 1);
    };
    vm.formWidget = f.prop();
    vm.model = function () {
        return vm.formWidget().model();
    };
    vm.sseErrorDialog = f.prop(dialog.viewModel({
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
    vm.title = function () {
        return options.parentProperty.toName();
    };

    // Create form widget
    vm.formWidget(formWidget.viewModel({
        isNew: isNew,
        model: model,
        id: options.key,
        config: form,
        outsideElementIds: ["toolbar"]
    }));

    // Create button view models
    vm.buttonDone(button.viewModel({
        onclick: vm.doDone,
        label: "&Done"
    }));
    vm.buttonDone().isPrimary(true);

    vm.buttonPrevious(button.viewModel({
        onclick: vm.doPrevious,
        label: "&Previous",
        icon: "arrow-up",
        class: "fb-toolbar-button"
    }));
    if (ary.indexOf(model) === 0) {
        vm.buttonPrevious().disable();
        vm.buttonPrevious().title("Current data is first record");
    }

    vm.buttonNext(button.viewModel({
        onclick: vm.doNext,
        label: "&Next",
        icon: "arrow-down",
        class: "fb-toolbar-button"
    }));
    if (ary.indexOf(model) === ary.length - 1) {
        vm.buttonNext().disable();
        vm.buttonNext().title("Current data is last record");
    }

    vm.buttonNew(button.viewModel({
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

childFormPage.component = {
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || childFormPage.viewModel(vnode.attrs)
        );
    },

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
                m(button.component, {
                    viewModel: vm.buttonDone()
                }),
                m(button.component, {
                    viewModel: vm.buttonPrevious()
                }),
                m(button.component, {
                    viewModel: vm.buttonNext()
                }),
                m(button.component, {
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
            m(dialog.component, {
                viewModel: vm.sseErrorDialog()
            }),
            m(formWidget.component, {
                viewModel: vm.formWidget()
            })
        ]);
    }
};

catalog.register("components", "childFormPage", childFormPage.component);

export default Object.freeze(childFormPage);
