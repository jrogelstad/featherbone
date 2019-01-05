/**
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
**/
/*jslint this, browser*/
import {f} from "../core.js";
import {stream} from "../../common/stream.js";
import {button} from "./button.js";
import {catalog} from "../models/catalog.js";
import {formWidget} from "./form-widget.js";
import {dialog} from "./dialog.js";

const childFormPage = {};
const m = window.m;

childFormPage.viewModel = function (options) {
    let model;
    let instances = catalog.store().instances();
    let sseState = catalog.store().global().sseState;
    let feather = options.feather.toCamelCase(true);
    let forms = catalog.store().forms();
    let formId = options.form || Object.keys(forms).find(function (id) {
        return forms[id].feather === feather;
    });
    let idx = options.index;
    let form = forms[formId];
    let vm = {};
    let pageIdx = options.index || 1;
    let isNew = options.create && options.isNew !== false;

    // Check if we've already got a model instantiated
    if (options.key && instances[options.key]) {
        model = instances[options.key];
    } else {
        model = options.feather.toCamelCase();
    }

    // ..........................................................
    // PUBLIC
    //

    vm.buttonDone = stream();
    vm.buttonPrevious = stream();
    vm.buttonNext = stream();
    vm.buttonNew = stream();
    vm.doDone = function () {
        // Once we consciously leave, purge memoize
        delete instances[vm.model().id()];
        window.history.go(pageIdx * -1);
    };
    vm.doPrevious = function () {
    };
    vm.doNext = function () {
    };
    vm.doNew = function () {
        let opts = {
            feather: options.feather,
            key: f.createId()
        };
        let state = {
            state: {
                form: options.form,
                index: pageIdx + 1,
                create: true,
                receiver: options.receiver
            }
        };
        m.route.set("/edit/:feather/:key", opts, state);
    };
    vm.formWidget = stream();
    vm.model = function () {
        return vm.formWidget().model();
    };
    vm.sseErrorDialog = stream(dialog.viewModel({
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
        return options.feather.toName();
    };

    // Create form widget
    vm.formWidget(formWidget.viewModel({
        isNew: isNew,
        model: model,
        id: options.key,
        config: form,
        outsideElementIds: ["toolbar"]
    }));

    // Once model instantiated let history know already created so we know
    // to fetch if navigating back here through history
    if (isNew) {
        options.isNew = false;
        m.route.set(m.route.get(), null, {
            replace: true,
            state: options
        });
    }

    // Memoize our model instance in case we leave and come back while
    // zooming deeper into detail
    instances[vm.model().id()] = vm.model();

    // Create button view models
    vm.buttonDone(button.viewModel({
        onclick: vm.doDone,
        label: "&Done",
        class: "fb-toolbar-button"
    }));

    vm.buttonPrevious(button.viewModel({
        onclick: vm.doPrevious,
        label: "&Previous",
        icon: "arrow-up",
        class: "fb-toolbar-button"
    }));

    vm.buttonNext(button.viewModel({
        onclick: vm.doNext,
        label: "&Next",
        icon: "arrow-down",
        class: "fb-toolbar-button"
    }));

    vm.buttonNew(button.viewModel({
        onclick: vm.doNew,
        label: "&New",
        icon: "plus-circle",
        class: "fb-toolbar-button"
    }));

    if (catalog.getFeather(feather).isReadOnly) {
        vm.buttonNew().title("Data is read only");
        vm.buttonNew().disable();
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

    view: function () {
        let lock;
        let title;
        let vm = this.viewModel;
        let model = vm.model();
        let icon = "file-text";

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
            icon = "pencil";
            title = "Editing record";
            break;
        case "/Ready/New":
            icon = "plus";
            title = "New record";
            break;
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

export {childFormPage};
