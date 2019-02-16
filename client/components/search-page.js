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
import filterDialog from "./filter-dialog.js";
import sortDialog from "./sort-dialog.js";
import searchInput from "./search-input.js";
import tableWidget from "./table-widget.js";

const searchPage = {};
const m = window.m;

searchPage.viewModel = function (options) {
    let vm = {};
    let feather = catalog.getFeather(options.feather.toCamelCase(true));
    let config = catalog.register("config")[options.config];

    // ..........................................................
    // PUBLIC
    //

    vm.buttonBack = f.prop();
    vm.buttonSelect = f.prop();
    vm.buttonClear = f.prop();
    vm.buttonFilter = f.prop();
    vm.buttonRefresh = f.prop();
    vm.buttonSort = f.prop();
    vm.doBack = function () {
        window.history.back();
    };
    vm.doSelect = function () {
        let receivers;
        let selection;

        if (options.receiver) {
            receivers = catalog.register("receivers");
            if (receivers[options.receiver]) {
                selection = vm.tableWidget().selection();
                receivers[options.receiver].callback(selection);
                delete receivers[options.receiver];
            }
        }
        vm.doBack();
    };
    vm.filterDialog = f.prop();
    vm.sortDialog = f.prop();
    vm.searchInput = f.prop();
    vm.tableWidget = f.prop();
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create search input view model
    vm.searchInput(searchInput.viewModel({
        refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
        config: config,
        feather: options.feather.toCamelCase(true),
        search: vm.searchInput().value,
        ondblclick: vm.doSelect
    }));

    // Create dalog view models
    vm.filterDialog(filterDialog.viewModel({
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather
    }));

    vm.sortDialog(sortDialog.viewModel({
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather
    }));

    // Create button view models
    vm.buttonBack(button.viewModel({
        onclick: vm.doBack,
        label: "&Back",
        icon: "arrow-left",
        class: "fb-toolbar-button"
    }));

    vm.buttonSelect(button.viewModel({
        onclick: vm.doSelect,
        label: "&Select",
        title: vm.selectTitle,
        disabled: vm.selectDisabled,
        class: "fb-toolbar-button"
    }));
    vm.buttonSelect().isDisabled = function () {
        return !vm.tableWidget().selection();
    };
    vm.buttonSelect().title = function () {
        if (vm.buttonSelect().isDisabled()) {
            return "A row must be selected";
        }
        return "";
    };

    vm.buttonRefresh(button.viewModel({
        onclick: vm.refresh,
        title: "Refresh",
        hotkey: "R",
        icon: "sync",
        class: "fb-toolbar-button"
    }));

    vm.buttonClear(button.viewModel({
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "eraser",
        class: "fb-toolbar-button"
    }));
    vm.buttonClear().isDisabled = function () {
        return !vm.searchInput().value();
    };

    vm.buttonFilter(button.viewModel({
        onclick: vm.filterDialog().show,
        title: "Filter",
        hotkey: "F",
        icon: "filter",
        class: "fb-toolbar-button"
    }));

    vm.buttonSort(button.viewModel({
        onclick: vm.sortDialog().show,
        title: "Sort",
        hotkey: "O",
        icon: "sort",
        class: "fb-toolbar-button"
    }));

    vm.buttonClear(button.viewModel({
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "eraser",
        class: "fb-toolbar-button"
    }));

    return vm;
};

searchPage.component = {
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || searchPage.viewModel(vnode.attrs)
        );
    },

    onremove: function (vnode) {
        delete catalog.register("config")[vnode.attrs.config];
    },

    view: function () {
        let vm = this.viewModel;

        // Build view
        return m("div", {
            class: "pure-form"
        }, [
            m("div", {
                class: "fb-toolbar"
            }, [
                m(button.component, {
                    viewModel: vm.buttonBack()
                }),
                m(button.component, {
                    viewModel: vm.buttonSelect()
                }),
                m(searchInput.component, {
                    viewModel: vm.searchInput()
                }),
                m(button.component, {
                    viewModel: vm.buttonRefresh()
                }),
                m(button.component, {
                    viewModel: vm.buttonClear()
                }),
                m(button.component, {
                    viewModel: vm.buttonSort()
                }),
                m(button.component, {
                    viewModel: vm.buttonFilter()
                })
            ]),
            m(sortDialog.component, {
                viewModel: vm.sortDialog()
            }),
            m(filterDialog.component, {
                viewModel: vm.filterDialog()
            }),
            m(tableWidget.component, {
                viewModel: vm.tableWidget()
            })
        ]);
    }
};

catalog.register("components", "searchPage", searchPage.component);
export default Object.freeze(searchPage);
