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
/**
    @module AggregateDialog
*/
import f from "../core.js";

const catalog = f.catalog();
const aggregateDialog = {};
const m = window.m;

/**
    View model for sort dialog.

    @class AggregateDialog
    @constructor
    @namespace ViewModels
    @extends ViewModels.FilterDialog
    @param {Object} options
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.aggregate] Aggregate property
*/
aggregateDialog.viewModel = function (options) {
    options = options || {};
    let vm;

    options.propertyName = "sort";
    options.title = options.title || "Aggregate";
    options.icon = options.icon || "calculator";

    // ..........................................................
    // PUBLIC
    //

    options.filter = options.aggregates;
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
        @method data
        @return {List}
    */
    vm.data = function () {
        return options.aggregates();
    };
    vm.viewHeaderIds = f.prop({
        column: f.createId(),
        func: f.createId()
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
            }, "Function")
        ];
    };
    /**
        Legal functions for a given attribute.
        @method operators
        @param {String} attr
        @return {Array}
    */
    vm.funcs = function (attr) {
        let prop;
        let format;
        let feather = vm.feather();
        let funcs = ["SUM", "AVG", "COUNT", "MIN", "MAX"];

        if (attr) {
            prop = vm.resolveProperty(feather, attr);

            if (
                prop.type !== "number" &&
                prop.type !== "integer"
            ) {
                funcs = ["COUNT"];
                
                if (prop.type === "string") {
                    funcs.push("MIN");
                    funcs.push("MAX");
                }
            }
        }

        return funcs;
    };
    vm.viewRows = function () {
        let view;

        view = vm.items().map(function (item) {
            let row;
            let funcs = vm.funcs(item.property);

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
                        value: item.func || "COUNT",
                        onchange: (e) =>
                        vm.itemChanged.bind(
                            this,
                            item.index,
                            "func"
                        )(e.target.value)
                    }, Object.keys(funcs).map(function (func) {
                        return m("option", {
                            value: func
                        }, funcs[func]);
                    }), item.func || "COUNT")
                ])
            ]);

            return row;
        });

        return view;
    };

    vm.style().width = "460px";

    return vm;
};

catalog.register("viewModels", "aggregateDialog", aggregateDialog.viewModel);

/**
    Aggregate dialog component
    @class AggregateDialog
    @namespace Components
    @static
    @uses Components.Dialog
*/
aggregateDialog.component = f.getComponent("Dialog");
catalog.register("components", "aggregateDialog", aggregateDialog.component);

export default Object.freeze(aggregateDialog);