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
    @module AggregateDialog
*/

const aggregateDialog = {};

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
    let monkeyPatch = options.onOk;

    options.propertyName = "sort";
    options.title = options.title || "Aggregate";
    options.icon = options.icon || "calculate";

    function resolveProperty(feather, property) {
        let prefix;
        let suffix;
        let rel;
        let idx = property.indexOf(".");

        if (idx > -1) {
            prefix = property.slice(0, idx);
            suffix = property.slice(idx + 1, property.length);
            if (f.isMoney(feather.properties[prefix].format)) {
                return feather.properties[prefix];
            }
            rel = (
                feather.properties[prefix].type.relation ||
                feather.properties[prefix].format.toProperCase()
            );
            feather = f.catalog().getFeather(rel);
            return resolveProperty(feather, suffix);
        }

        return feather.properties[property];
    }

    // ..........................................................
    // PUBLIC
    //

    options.onOk = function () {
        options.aggregates(vm.data());
        if (monkeyPatch) {
            monkeyPatch();
        }
    };
    vm = f.createViewModel("TableDialog", options);
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                property: attr,
                method: "COUNT"
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
        return vm.resolveProperties(
            feather,
            keys,
            undefined,
            undefined,
            true
        ).sort();
    };
     /**
        @method data
        @return {List}
    */
    vm.data = f.prop([]);
    /**
        @method feather
        @param {Object} feather
        @return {Object}
    */
    vm.feather = f.prop(f.catalog().getFeather(
        options.feather.name,
        true,
        false
    ));
    vm.viewHeaderIds = f.prop({
        column: f.createId(),
        method: f.createId()
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
    vm.methods = function (attr) {
        let prop;
        let feather = vm.feather();
        let methods = ["AVG", "COUNT", "MAX", "MIN", "SUM"];

        if (attr) {
            prop = resolveProperty(feather, attr);

            if (
                prop.type !== "number" &&
                prop.type !== "integer" &&
                !f.isMoney(prop.format)
            ) {
                methods = ["COUNT"];

                if (prop.type === "string") {
                    methods.push("MIN");
                    methods.push("MAX");
                }
            }
        }

        return methods;
    };
    vm.reset = function () {
        let aggregates = f.copy(options.aggregates());

        aggregates = aggregates || [];
        vm.data(aggregates);
        if (!aggregates.length) {
            vm.add();
        }
        vm.selection(0);
    };
    vm.viewRows = function () {
        let view;

        function resetSelector(item, vnode) {
            let e = document.getElementById(vnode.dom.id);
            e.value = item.method || "COUNT";
        }

        view = vm.items().map(function (item) {
            let row;
            let methods = vm.methods(item.property);

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
                    onchange: function (e) {
                        let i = item.index;
                        let v = e.target.value;
                        vm.itemChanged(i, "property", v);
                        vm.itemChanged(i, "method", "COUNT");
                    }
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
                        value: item.method || "COUNT",
                        id: "agg_fn_" + item.index,
                        oncreate: resetSelector.bind(null, item),
                        onupdate: resetSelector.bind(null, item),
                        onchange: (e) =>
                        vm.itemChanged.bind(
                            this,
                            item.index,
                            "method"
                        )(e.target.value)
                    }, methods.map(function (method) {
                        return m("option", {
                            value: method
                        }, method);
                    }), item.method || "COUNT")
                ])
            ]);

            return row;
        });

        return view;
    };

    vm.reset();

    vm.style().width = "460px";

    return vm;
};

f.catalog().register(
    "viewModels",
    "aggregateDialog",
    aggregateDialog.viewModel
);

/**
    Aggregate dialog component
    @class AggregateDialog
    @namespace Components
    @static
    @uses Components.Dialog
*/
aggregateDialog.component = f.getComponent("Dialog");
f.catalog().register(
    "components",
    "aggregateDialog",
    aggregateDialog.component
);
