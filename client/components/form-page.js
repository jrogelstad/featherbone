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
/*jslint this, es6, browser*/
/*global window, require, module*/
(function () {
    "use strict";

    const formPage = {};
    const m = require("mithril");
    const f = require("common-core");
    const stream = require("stream");
    const button = require("button");
    const catalog = require("catalog");
    const formWidget = require("form-widget");
    const dialog = require("dialog");

    formPage.viewModel = function (options) {
        var isDisabled, applyTitle, saveTitle, model,
                instances = catalog.register("instances"),
                sseState = catalog.store().global().sseState,
                feather = options.feather.toCamelCase(true),
                forms = catalog.store().forms(),
                formId = options.form || Object.keys(forms).find(function (id) {
            return forms[id].feather === feather;
        }),
                form = forms[formId],
                vm = {},
                pageIdx = options.index || 1,
                isNew = options.create && options.isNew !== false;

        // Helper function to pass back data to sending model
        function callReceiver() {
            var receivers;
            if (options.receiver) {
                receivers = catalog.register("receivers");
                if (receivers[options.receiver]) {
                    receivers[options.receiver].callback(vm.model());
                }
            }
        }

        // Check if we've already got a model instantiated
        if (options.key && instances[options.key]) {
            model = instances[options.key];
        } else {
            model = options.feather.toCamelCase();
        }

        // ..........................................................
        // PUBLIC
        //

        vm.buttonApply = stream();
        vm.buttonBack = stream();
        vm.buttonSave = stream();
        vm.buttonSaveAndNew = stream();
        vm.doApply = function () {
            vm.model().save().then(function () {
                callReceiver(false);
            });
        };
        vm.doBack = function () {
            var instance = vm.model();

            if (instance.state().current()[0] === "/Ready/Fetched/Dirty") {
                instance.state().send("undo");
            }

            // Once we consciously leave, purge memoize
            delete instances[vm.model().id()];
            window.history.go(pageIdx * -1);
        };
        vm.doNew = function () {
            var opts = {
                    feather: options.feather,
                    key: f.createId()
                },
                state = {
                    state: {
                        form: options.form,
                        index: pageIdx + 1,
                        create: true,
                        receiver: options.receiver
                    }
                };
            m.route.set("/edit/:feather/:key", opts, state);
        };
        vm.doSave = function () {
            vm.model().save().then(function () {
                callReceiver();
                vm.doBack();
            });
        };
        vm.doSaveAndNew = function () {
            vm.model().save().then(function () {
                callReceiver();
                delete instances[vm.model().id()];
                vm.doNew();
            });
        };
        vm.formWidget = stream();
        vm.model = function () {
            return vm.formWidget().model();
        };
        vm.sseErrorDialog = stream(dialog.viewModel({
            icon: "close",
            title: "Connection Error",
            message: "You have lost connection to the server. Click \"Ok\" to attempt to reconnect.",
            onOk: function () {
                document.location.reload();
            }
        }));
        vm.sseErrorDialog().buttonCancel().hide();
        vm.title = function () {
            return options.feather.toName();
        };
        vm.toggleNew = function () {
            vm.buttonSaveAndNew().title("");
            if (!vm.model().canSave()) {
                vm.buttonSaveAndNew().label("&New");
                vm.buttonSaveAndNew().onclick(vm.doNew);
            } else {
                vm.buttonSaveAndNew().label("Save and &New");
                vm.buttonSaveAndNew().onclick(vm.doSaveAndNew);
            }
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

        // Memoize our model instance in case we leave and come back while zooming
        // deeper into detail
        instances[vm.model().id()] = vm.model();

        // Create button view models
        vm.buttonBack(button.viewModel({
            onclick: vm.doBack,
            label: "&Back",
            icon: "arrow-left",
            class: "fb-toolbar-button"
        }));

        vm.buttonApply(button.viewModel({
            onclick: vm.doApply,
            label: "&Apply",
            class: "fb-toolbar-button"
        }));

        vm.buttonSave(button.viewModel({
            onclick: vm.doSave,
            label: "&Save",
            icon: "cloud-upload",
            class: "fb-toolbar-button"
        }));

        vm.buttonSaveAndNew(button.viewModel({
            onclick: vm.doSaveAndNew,
            label: "Save and &New",
            icon: "plus-circle",
            class: "fb-toolbar-button"
        }));
        if (catalog.getFeather(feather).isReadOnly) {
            vm.buttonSaveAndNew().label("&New");
            vm.buttonSaveAndNew().title("Table is read only");
            vm.buttonSaveAndNew().disable();
        }

        // Bind model state to display state
        isDisabled = function () {
            return !vm.model().canSave();
        };
        applyTitle = vm.buttonApply().title;
        saveTitle = vm.buttonSave().title;
        vm.buttonApply().isDisabled = isDisabled;
        vm.buttonApply().title = function () {
            if (isDisabled()) {
                return vm.model().lastError() || "No changes to apply";
            }
            return applyTitle();
        };
        vm.buttonSave().isDisabled = isDisabled;
        vm.buttonSave().title = function () {
            if (isDisabled()) {
                return vm.model().lastError() || "No changes to save";
            }
            return saveTitle();
        };

        sseState.resolve("Error").enter(function () {
            vm.sseErrorDialog().show();
        });

        return vm;
    };

    formPage.component = {
        oninit: function (vnode) {
            this.viewModel = vnode.attrs.viewModel || formPage.viewModel(vnode.attrs);
        },

        view: function () {
            var lock, title,
                    vm = this.viewModel,
                    model = vm.model(),
                    icon = "file-text";

            vm.toggleNew();

            switch (model.state().current()[0]) {
            case "/Locked":
                icon = "lock";
                lock = model.data.lock() || {};
                title = "User: " + lock.username + "\x0ASince: " +
                        new Date(lock.created).toLocaleTimeString();
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
                        viewModel: vm.buttonBack()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonApply()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonSave()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonSaveAndNew()
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

    catalog.register("components", "formPage", formPage.component);
    module.exports = formPage;

}());