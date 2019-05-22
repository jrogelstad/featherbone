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
import f from "../core.js";
import button from "./button.js";
import catalog from "../models/catalog.js";
import tableWidget from "./table-widget.js";

const childTable = {};
const m = window.m;

/**
  View model for child table.

  @param {Object} Options
  @param {Array} [options.models] Array of child models
  @param {String} [options.feather] Feather
  @param {Array} [options.config] Column configuration
  @param {String} [options.height] Table height setting (optional)
*/
childTable.viewModel = function (options) {
    let tableState;
    let canAdd;
    let root = f.findRoot(options.parentViewModel.model());
    let vm = {};
    let instances = catalog.register("instances");

    function toggleCanAdd() {
        let currentState = root.state().current()[0];

        if (
            canAdd() &&
            currentState !== "/Ready/Fetched/ReadOnly" &&
            currentState !== "/Locked"
        ) {
            vm.buttonAdd().enable();
            vm.buttonOpen().enable();
        } else {
            vm.buttonAdd().disable();
            vm.buttonOpen().disable();
        }
    }

    // ..........................................................
    // PUBLIC
    //

    vm.buttonAdd = f.prop();
    vm.buttonOpen = f.prop();
    vm.buttonRemove = f.prop();
    vm.buttonUndo = f.prop();
    vm.childForm = f.prop();
    vm.doChildOpen = function () {
        let selection = vm.tableWidget().selection();
        let models = vm.tableWidget().models();
        let feather;

        if (!selection) {
            feather = options.feather.name.toCamelCase();
            selection = catalog.store().models()[feather]();
            models.add(selection);
        }

        instances[selection.id()] = selection;

        if (selection) {
            m.route.set("/traverse/:feather/:key", {
                feather: options.feather.name.toSpinalCase(),
                key: selection.id()
            }, {
                state: {
                    parentProperty: options.parentProperty,
                    form: options.config.form
                }
            });
        }
    };
    vm.tableWidget = f.prop();
    vm.parentViewModel = f.prop(options.parentViewModel);
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
        config: options.config,
        models: options.models,
        feather: options.feather,
        containerId: vm.parentViewModel().containerId(),
        height: options.height
    }));
    vm.tableWidget().toggleEdit();
    vm.tableWidget().isQuery(false);

    // Create button view models
    vm.buttonAdd(button.viewModel({
        onclick: vm.tableWidget().modelNew,
        title: "Insert",
        hotkey: "I",
        icon: "plus-circle",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(button.viewModel({
        onclick: vm.tableWidget().modelDelete,
        title: "Delete",
        hotkey: "D",
        icon: "trash",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonRemove().disable();

    vm.buttonUndo(button.viewModel({
        onclick: vm.tableWidget().undo,
        title: "Undo",
        hotkey: "U",
        icon: "undo",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));
    vm.buttonUndo().hide();

    vm.buttonOpen(button.viewModel({
        onclick: vm.doChildOpen,
        title: "Open",
        hotkey: "O",
        icon: "folder-plus",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    }));

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonRemove().disable();
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
        let current = root.state().current()[0];
        if (
            current !== "/Ready/Fetched/ReadOnly" &&
            current !== "/Locked"
        ) {
            vm.buttonRemove().enable();
        }

        vm.buttonOpen().icon("folder-open");
        vm.buttonOpen().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonRemove().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonRemove().hide();
        vm.buttonUndo().show();
    });
    root.state().resolve("/Ready/Fetched/Clean").enter(function () {
        let selection = vm.tableWidget().selection();

        function found(model) {
            return selection.id() === model.id();
        }

        // Unselect potentially deleted model
        if (selection && !vm.tableWidget().models().some(found)) {
            vm.tableWidget().select(undefined);
        }
    });
    canAdd = vm.tableWidget().models().canAdd;

    root.state().resolve("/Ready/Fetched/ReadOnly").enter(function () {
        vm.buttonAdd().disable();
        vm.buttonOpen().disable();
    });
    root.state().resolve("/Ready/Fetched/ReadOnly").exit(toggleCanAdd);
    root.state().resolve("/Locked").enter(vm.buttonAdd().disable);
    root.state().resolve("/Locked").exit(toggleCanAdd);
    canAdd.state().resolve("/Changing").exit(toggleCanAdd);
    toggleCanAdd();

    return vm;
};

catalog.register("viewModels", "childTable", childTable.viewModel);

/**
  Child table component

  @params {Object} View model
*/
childTable.component = {
    oninit: function (vnode) {
        let config;
        let overload;
        let keys;
        let parentProperty = vnode.attrs.parentProperty;
        let parentViewModel = vnode.attrs.parentViewModel;
        let prop = parentViewModel.model().data[parentProperty];
        let models = prop();
        let feather = catalog.getFeather(prop.type.relation);
        let parentFeather = catalog.getFeather(
            parentViewModel.model().name
        );
        let overloads = parentFeather.overloads || {};
        let relations = vnode.attrs.parentViewModel.relations();

        config = parentViewModel.config().attrs.find(function (item) {
            return item.attr === parentProperty;
        });

        // Apply parent defined overloads to child feather
        overload = overloads[parentProperty];
        if (overload) {
            feather.overloads = feather.overloads || {};
            keys = Object.keys(overload);
            keys.forEach(function (key) {
                feather.overloads[key] = overload[key];
            });
        }

        // Set up viewModel if required
        if (!relations[parentProperty]) {
            relations[parentProperty] = childTable.viewModel({
                parentViewModel: parentViewModel,
                parentProperty: parentProperty,
                models: models,
                feather: feather,
                config: config,
                height: vnode.attrs.height
            });
        }
        this.viewModel = relations[parentProperty];
    },

    view: function () {
        let vm = this.viewModel;

        return m("div", [
            m(button.component, {
                viewModel: vm.buttonAdd()
            }),
            m(button.component, {
                viewModel: vm.buttonRemove()
            }),
            m(button.component, {
                viewModel: vm.buttonUndo()
            }),
            m(button.component, {
                viewModel: vm.buttonOpen()
            }),
            m(tableWidget.component, {
                viewModel: vm.tableWidget()
            })
        ]);
    }
};

catalog.register("components", "childTable", childTable.component);

export default Object.freeze(childTable);