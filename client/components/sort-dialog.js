/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
    @module SortDialog
*/
const sortDialog = {};

/**
    View model for sort dialog.

    @class SortDialog
    @constructor
    @namespace ViewModels
    @extends ViewModels.FilterDialog
    @param {Object} options
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.filter] Filter property
*/
sortDialog.viewModel = function (options) {
    options = options || {};
    let vm;

    options.propertyName = "sort";
    options.title = options.title || "Sort";
    options.icon = options.icon || "sort_by_alpha";
    options.enableShowDeleted = false;

    // ..........................................................
    // PUBLIC
    //

    vm = f.createViewModel("FilterDialog", options);
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                property: attr
            });
            return true;
        }
    };
    /**
        Available attributes
        @method attrs
        @return {Array}
    */
    vm.attrs = function () {
        let feather = vm.feather();
        let keys = Object.keys(feather.properties);
        return vm.resolveProperties(feather, keys).sort();
    };
    vm.viewHeaderIds = f.prop({
        column: f.createId(),
        order: f.createId()
    });
    vm.viewHeaders = function () {
        let ids = vm.viewHeaderIds();

        return [
            m("th", {
                style: {
                    minWidth: "175px"
                },
                id: ids.column
            }, "Column"),
            m("th", {
                style: {
                    minWidth: "175px"
                },
                id: ids.order
            }, "Order")
        ];
    };
    vm.viewRows = function () {
        let view;

        view = vm.items().map(function (item) {
            let row;

            row = m("tr", {
                onclick: vm.selection.bind(this, item.index, true),
                style: {
                    backgroundColor: vm.rowColor(item.index)
                }
            }, [
                m("td", {
                    style: {
                        minWidth: "175px",
                        maxWidth: "175px"
                    }
                }, m("select", {
                    style: {
                        minWidth: "175px",
                        maxWidth: "175px"
                    },
                    value: item.property,
                    onchange: (e) =>
                    vm.itemChanged.bind(
                        this,
                        item.index,
                        "property"
                    )(e.target.value)
                }, vm.attrs().map(function (attr) {
                    return m("option", {
                        value: attr
                    }, attr.toName());
                }))),
                m("td", {
                    style: {
                        minWidth: "175px",
                        maxWidth: "175px"
                    }
                }, [
                    m("select", {
                        style: {
                            minWidth: "175px",
                            maxWidth: "175px"
                        },
                        value: item.order || "ASC",
                        onchange: (e) =>
                        vm.itemChanged.bind(
                            this,
                            item.index,
                            "order"
                        )(e.target.value)
                    }, [
                        m("option", {
                            value: "ASC"
                        }, "Ascending"),
                        m("option", {
                            value: "DESC"
                        }, "Descending")
                    ])
                ])
            ]);

            return row;
        });

        return view;
    };

    vm.style().width = "460px";

    return vm;
};

f.catalog().register("viewModels", "sortDialog", sortDialog.viewModel);

/**
    Sort dialog component
    @class SortDialog
    @namespace Components
    @static
    @uses Components.Dialog
*/
sortDialog.component = f.getComponent("Dialog");
f.catalog().register("components", "sortDialog", sortDialog.component);
