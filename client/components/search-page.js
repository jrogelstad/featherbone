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
    @module SearchPage
*/

const searchPage = {};

/**
    @class SearchPage
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {String} options.feather Feather name
    @param {Object} options.config Column configuration
    @param {String} options.receiever Receiver id to send back selection
*/
searchPage.viewModel = function (options) {
    let vm = {};
    let theFeather = f.catalog().getFeather(options.feather.toCamelCase(true));
    let theConfig = f.catalog().register("config")[options.config];

    // ..........................................................
    // PUBLIC
    //
    /**
        @method buttonBack
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonBack = f.prop();
    /**
        @method buttonSelect
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSelect = f.prop();
    /**
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();
    /**
        @method buttonFilter
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonFilter = f.prop();
    /**
        @method buttonRefresh
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRefresh = f.prop();
    /**
        @method buttonSort
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSort = f.prop();
    /**
        @method doBack
    */
    vm.doBack = function () {
        window.history.back();
    };
    /**
        @method doSelect
    */
    vm.doSelect = function () {
        let receivers;
        let selection;

        if (options.receiver) {
            receivers = f.catalog().register("receivers");
            if (receivers[options.receiver]) {
                selection = vm.tableWidget().selection();
                receivers[options.receiver].callback(selection);
                delete receivers[options.receiver];
            }
        }
        vm.doBack();
    };
    /**
        @method filterDialog
        @param {ViewModels.FilterDialog} dialog
        @return {ViewModels.FilterDialog}
    */
    vm.filterDialog = f.prop();
    /**
        @method sortDialog
        @param {ViewModels.SortDialog} dialog
        @return {ViewModels.SortDialog}
    */
    vm.sortDialog = f.prop();
    /**
        @method searchInput
        @param {ViewModels.SearchInput} input
        @return {ViewModels.SearchInput}
    */
    vm.searchInput = f.prop();
    /**
        @method tableWidget
        @param {ViewModels.TableWidget} widget
        @return {ViewModels.TableWidget}
    */
    vm.tableWidget = f.prop();
    /**
        @method refresh
    */
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create search input view model
    vm.searchInput(f.createViewModel("SearchInput", {
        refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        config: theConfig,
        feather: options.feather.toCamelCase(true),
        search: vm.searchInput().value,
        ondblclick: vm.doSelect
    }));

    // Create dalog view models
    vm.filterDialog(f.createViewModel("FilterDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: theFeather
    }));

    vm.sortDialog(f.createViewModel("SortDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: theFeather
    }));

    // Create button view models
    vm.buttonBack(f.createViewModel("Button", {
        onclick: vm.doBack,
        label: "&Back",
        icon: "arrow_back",
        class: "fb-toolbar-button"
    }));

    vm.buttonSelect(f.createViewModel("Button", {
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

    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: vm.refresh,
        title: "Refresh",
        hotkey: "R",
        icon: "sync",
        class: "fb-toolbar-button fb-toolbar-button-left-side"
    }));

    vm.buttonClear(f.createViewModel("Button", {
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "clear",
        class: "fb-toolbar-button fb-toolbar-button-clear"
    }));
    vm.buttonClear().isDisabled = function () {
        return !vm.searchInput().value();
    };

    vm.buttonFilter(f.createViewModel("Button", {
        onclick: vm.filterDialog().show,
        title: "Filter",
        hotkey: "F",
        icon: "filter_list",
        class: "fb-toolbar-button fb-toolbar-button-right-side"
    }));

    vm.buttonSort(f.createViewModel("Button", {
        onclick: vm.sortDialog().show,
        title: "Sort",
        hotkey: "O",
        icon: "sort_by_alpha",
        class: "fb-toolbar-button fb-toolbar-button-middle-side"
    }));

    return vm;
};

f.catalog().register("viewModels", "searchPage", searchPage.viewModel);

/**
    Search component.
    @class SearchPage
    @static
    @namespace Components
*/
searchPage.component = {
    /**
        Must pass view model instance or options to build one.
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs] Options
        @param {ViewModels.SearchInput} [vnode.attrs.viewModel]
        @param {String} [vnode.attrs.feather] Feather name
        @param {Object} [vnode.attrs.config] Column configuration
        @param {String} [vnode.attrs.receiever] Receiver id to send back
        selection
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || searchPage.viewModel(vnode.attrs)
        );
    },

    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;
        let btn = f.getComponent("Button");
        let srch = f.getComponent("SearchInput");
        let sdlg = f.getComponent("SortDialog");
        let fdlg = f.getComponent("FilterDialog");
        let tw = f.getComponent("TableWidget");

        // Build view
        return m("div", {
            class: "pure-form"
        }, [
            m("div", {
                class: "fb-toolbar"
            }, [
                m(btn, {
                    viewModel: vm.buttonBack()
                }),
                m(btn, {
                    viewModel: vm.buttonSelect()
                }),
                m(srch, {
                    viewModel: vm.searchInput()
                }),
                m(btn, {
                    viewModel: vm.buttonClear()
                }),
                m(btn, {
                    viewModel: vm.buttonRefresh()
                }),
                m(btn, {
                    viewModel: vm.buttonSort()
                }),
                m(btn, {
                    viewModel: vm.buttonFilter()
                })
            ]),
            m(sdlg, {
                viewModel: vm.sortDialog()
            }),
            m(fdlg, {
                viewModel: vm.filterDialog()
            }),
            m(tw, {
                viewModel: vm.tableWidget()
            })
        ]);
    }
};

f.catalog().register("components", "searchPage", searchPage.component);
