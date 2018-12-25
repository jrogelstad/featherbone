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
/*global require, module*/
/*jslint this, es6*/
(function () {
    "use strict";

    var filterDialog = {},
        m = require("mithril"),
        stream = require("stream"),
        f = require("component-core"),
        catalog = require("catalog"),
        model = require("model"),
        checkbox = require("checkbox"),
        tableDialog = require("table-dialog");

    /**
      View model for sort dialog.

      @param {Object} Options
      @param {Array} [options.propertyName] Filter property being modified
      @param {Array} [options.attrs] Attributes
      @param {Array} [options.list] Model list
      @param {Function} [options.filter] Filter property
    */
    filterDialog.viewModel = function (options) {
        options = options || {};
        var vm, store;

        function resolveProperty(feather, property) {
            var prefix, suffix, rel,
                    idx = property.indexOf(".");

            if (idx > -1) {
                prefix = property.slice(0, idx);
                suffix = property.slice(idx + 1, property.length);
                rel = feather.properties[prefix].type.relation || feather.properties[prefix].format.toProperCase();
                feather = catalog.getFeather(rel);
                return resolveProperty(feather, suffix);
            }

            return feather.properties[property];
        }

        /** @private
          Helper function for building input elements

          @param {Object} Arguments object
          @param {Number} [obj.index] Index
          @param {String} [obj.attr] Property
          @param {Object} [obj.value] Value
        */
        function buildInputComponent(obj) {
            var rel, w, component, prop, type, format,
                    feather = vm.feather(),
                    attr = obj.key,
                    value = obj.value,
                    index = obj.index,
                    opts = {};

            prop = resolveProperty(feather, attr);
            type = prop.type;
            format = prop.format || prop.type;

            // Handle input types
            if (typeof type === "string") {
                if (type === "boolean") {
                    component = m(checkbox.component, {
                        value: value,
                        onclick: vm.itemChanged.bind(this, index, "value")
                    });
                } else {
                    opts.type = f.inputMap[format];
                    opts.onchange = (e) =>
                            vm.itemChanged.bind(this, index, "value")(e.target.value);
                    opts.value = value;
                    component = m("input", opts);
                }

                return component;
            }

            // Handle relations
            if (!type.childOf && !type.parentOf) {
                rel = type.relation.toCamelCase();
                w = catalog.store().components()[rel + "Relation"];

                if (w) {
                    return m(w, {
                        parentProperty: attr,
                        parentViewModel: vm,
                        isCell: true
                    });
                }
            }

            //console.log("Widget for property '" + attr + "' is unknown");
        }

        function getDefault(attr) {
            var value,
                feather = vm.feather(),
                prop = resolveProperty(feather, attr),
                type = prop.type,
                format = prop.format;

            if (typeof type === "object") {
                return {
                    id: ""
                };
            }

            if (format && f.formats[format] &&
                    f.formats[format].default) {
                value = f.formats[format].default;
            } else {
                value = f.types[type].default;
            }

            if (typeof value === "function") {
                value = value();
            }

            return value;
        }

        options.onOk = function () {
            options.filter(vm.filter());
        };
        options.title = options.title || "Filter";
        options.icon = options.icon || "filter";

        // ..........................................................
        // PUBLIC
        //

        vm = tableDialog.viewModel(options);
        vm.addAttr = function (attr) {
            if (!this.some(vm.hasAttr.bind(attr))) {
                this.push({
                    property: attr,
                    value: getDefault(attr)
                });

                return true;
            }
        };
        vm.attrs = function () {
            var feather = vm.feather(),
                keys = Object.keys(feather.properties);
            return vm.resolveProperties(feather, keys).sort();
        };
        vm.data = function () {
            return vm.filter()[vm.propertyName()];
        };
        vm.itemPropertyChanged = function (index, value) {
            vm.itemChanged(index, "property", value);
            vm.data()[index].value = getDefault(value);
            vm.data()[index].operator = "=";
        };
        vm.feather = stream(options.feather);
        vm.filter = stream();
        vm.model = function () {
            return store;
        };
        vm.operators = function (attr) {
            var ops, prop, format,
                    feather = vm.feather();

            ops = f.copy(f.operators);

            if (attr) {
                prop = resolveProperty(feather, attr);
                format = prop.format || prop.type;

                switch (format) {
                case "integer":
                case "number":
                case "date":
                case "dateTime":
                case "money":
                    delete ops["~*"];
                    delete ops["!~*"];
                    break;
                case "boolean":
                    delete ops["~*"];
                    delete ops["!~*"];
                    delete ops[">"];
                    delete ops["<"];
                    delete ops[">="];
                    delete ops["<="];
                    break;
                case "string":
                case "password":
                case "tel":
                    delete ops[">"];
                    delete ops["<"];
                    delete ops[">="];
                    delete ops["<="];
                    break;
                default:
                    delete ops["~*"];
                    delete ops["!~*"];
                    delete ops[">"];
                    delete ops["<"];
                    delete ops[">="];
                    delete ops["<="];
                }
            }

            // Currently unsupported operators
            delete ops.IN;
            delete ops["~"];
            delete ops["!~"];

            return ops;
        };
        vm.propertyName = stream(options.propertyName || "criteria");
        vm.relations = stream({});
        vm.reset = function () {
            var name = vm.propertyName(),
                filter = f.copy(options.filter());
            filter[name] = filter[name] || [];
            vm.filter(filter);
            if (!filter[name].length) {
                vm.add();
            }
            vm.selection(0);
        };
        vm.viewHeaderIds = stream({
            column: f.createId(),
            operator: f.createId(),
            value: f.createId()
        });
        vm.viewHeaders = function () {
            var ids = vm.viewHeaderIds();
            return [
                m("th", {
                    class: "fb-filter-dialog-table-header-column",
                    id: ids.column
                }, "Column"),
                m("th", {
                    class: "fb-filter-dialog-table-header-operator",
                    id: ids.operator
                }, "Operator"),
                m("th", {
                    class: "fb-filter-dialog-table-header-value",
                    id: ids.value
                }, "Value")
            ];
        };
        vm.viewRows = function () {
            var view;

            view = vm.items().map(function (item) {
                var row,
                    operators = vm.operators(item.property);

                row = m("tr", {
                    onclick: vm.selection.bind(this, item.index, true),
                    style: {
                        backgroundColor: vm.rowColor(item.index)
                    }
                }, [
                    m("td", m("select", {
                        class: "fb-filter-dialog-property",
                        value: item.property,
                        onchange: (e) =>
                                vm.itemPropertyChanged.bind(this, item.index)(e.target.value)
                    }, vm.attrs().map(function (attr) {
                        return m("option", {
                            value: attr
                        }, attr.toName());
                    }))),
                    m("td", {
                        class: "fb-filter-dialog-operator"
                    }, [
                        m("select", {
                            onchange: (e) =>
                                    vm.itemChanged.bind(this, item.index, "operator")(e.target.value)
                        }, Object.keys(operators).map(function (op) {
                            return m("option", {
                                value: op
                            }, operators[op]);
                        }), item.operator || "=")
                    ]),
                    m("td", {
                        class: "fb-filter-dialog-input-cell"
                    }, [buildInputComponent({
                        index: item.index,
                        key: item.property,
                        value: item.value,
                        class: "fb-filter-dialog-input"
                    })])
                ]);

                return row;
            });

            return view;
        };

        // ..........................................................
        // PRIVATE
        //

        vm.style().width = "750px";

        // Build internal model for processing relations where applicable
        store = model({}, vm.feather());
        Object.keys(store.data).forEach(function (key) {
            if (store.data[key].isToOne()) {
                // If property updated, forward change
                store.onChange(key, function (prop) {
                    var items = vm.items();
                    items.forEach(function (item) {
                        var value;
                        if (item.property === key) {
                            value = prop.newValue();
                            value = value
                                ? {
                                    id: value.data.id()
                                }
                                : {
                                    id: ""
                                };
                            vm.itemChanged(item.index, "value", value);
                        }
                    });
                });
            }
        });
        vm.reset();

        return vm;
    };

    /**
      Filter dialog component

      @params {Object} View model
    */
    filterDialog.component = tableDialog.component;

    module.exports = filterDialog;

}());