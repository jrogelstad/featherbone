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
    @module FilterDialog
*/
import f from "../core.js";

const catalog = f.catalog();
const filterDialog = {};
const m = window.m;

/**
    View model for filter and sort dialog.

    @class FilterDialog
    @constructor
    @namespace ViewModels
    @extends ViewModels.TableDialog
    @param {Object} options
    @param {Array} options.propertyName Filter property being modified
    @param {Array} options.attrs Attributes
    @param {Array} options.list Model list
    @param {Function} options.filter Filter property
*/
filterDialog.viewModel = function (options) {
    options = options || {};
    let vm;
    let store;
    let monkeyPatch = options.onOk;
    let showDeletedButton = f.prop(f.createViewModel("Button", {
        label: "Show Deleted",
        icon: "far fa-square",
        onclick: function () {
            vm.filter().showDeleted = !Boolean(vm.filter().showDeleted);
        },
        class: "fb-button-checkbox fb-icon-button"
    }));

    function resolveProperty(feather, property) {
        let prefix;
        let suffix;
        let rel;
        let idx = property.indexOf(".");

        if (idx > -1) {
            prefix = property.slice(0, idx);
            suffix = property.slice(idx + 1, property.length);
            rel = (
                feather.properties[prefix].type.relation ||
                feather.properties[prefix].format.toProperCase()
            );
            feather = catalog.getFeather(rel);
            return resolveProperty(feather, suffix);
        }

        return feather.properties[property];
    }

    /**
        @private
        Helper function for building input elements

        @method createEditor
        @param {Object} obj Arguments object
        @param {Number} obj.index Index
        @param {String} obj.attr Property
        @param {Object} obj.value Value
    */
    function createEditor(obj) {
        let w;
        let component;
        let prop;
        let type;
        let format;
        let feather = vm.feather();
        let attr = obj.key;
        let value = obj.value;
        let index = obj.index;
        let featherName;
        let op = obj.operator;
        let id = "fltr_value_editor_" + attr + index;
        let opts = {
            id: id,
            key: id
        };
        let setToday = false;

        prop = resolveProperty(feather, attr);
        type = prop.type;
        format = prop.format || prop.type;

        // Handle input types
        if (typeof type === "string") {
            if (type === "boolean") {
                component = m(f.getComponent("Checkbox"), {
                    value: value,
                    onclick: vm.itemChanged.bind(this, index, "value")
                });
            } else if (
                (format === "date" || format === "dateTime") &&
                op === "IS"
            ) {
                if (f.dateOptions.indexOf(value) === -1) {
                    value = "TODAY";
                    setToday = true;	
                }

                component = m("select", {
                    id: id,
                    key: id,
                    onchange: (e) => vm.itemChanged.bind(
                        this,
                        index,
                        "value"
                    )(e.target.value),
                    value: value
                }, f.dateOptions.map(function (item) {
                    return m("option", {
                        value: item,
                        key: id + "$" + item
                    }, item.toLowerCase().toCamelCase(true).toProperCase());
                }));

                if (setToday) {
                    vm.itemChanged.bind(
                        this,
                        index,
                        "value"
                    )(value);
                }
            } else {
                opts.type = f.inputMap[format];
                opts.onchange = (e) => vm.itemChanged.bind(
                    this,
                    index,
                    "value"
                )(e.target.value);
                opts.value = value;
                component = m("input", opts);
            }

            return component;
        }

        // Handle relations
        if (!type.childOf && !type.parentOf) {
            featherName = feather.name.toCamelCase();

            w = f.findRelationWidget(type.relation, true);

            if (!w) {
                // Nothing specific, deduce from feather definition
                w = f.createRelationWidget(type, featherName);
            }

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
        let value;
        let feather = vm.feather();
        let prop = resolveProperty(feather, attr);
        let type = prop.type;
        let format = prop.format;

        if (typeof type === "object") {
            return {
                id: ""
            };
        }

        if (
            format && f.formats()[format] &&
            f.formats()[format].default
        ) {
            value = f.formats()[format].default;
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
        if (monkeyPatch) {
            monkeyPatch();
        }
    };
    options.title = options.title || "Filter";
    options.icon = options.icon || "filter";

    // ..........................................................
    // PUBLIC
    //

    vm = f.createViewModel("TableDialog", options);

    /**
        @method addAttr
        @param {String} attr Attribute
    */
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                property: attr,
                value: getDefault(attr)
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
    vm.data = function () {
        return vm.filter()[vm.propertyName()];
    };
    /**
        @method propertyChanged
        @param {Integer} index
        @param {Any} value
    */
    vm.itemPropertyChanged = function (index, value) {
        vm.itemChanged(index, "property", value);
        vm.data()[index].value = getDefault(value);
        vm.data()[index].operator = "=";
    };
    /**
        @method feather
        @param {Object} feather
        @return {Object}
    */
    vm.feather = f.prop(catalog.getFeather(
        options.feather.name,
        true,
        false
    ));
    /**
        @method filter
        @param {Filter} filter
        @return {Filter}
    */
    vm.filter = f.prop();
   /**
        @method model
        @return {Model}
    */
    vm.model = function () {
        return store;
    };
    /**
        Legal operators for a given attribute.
        @method operators
        @param {String} attr
        @return {Array}
    */
    vm.operators = function (attr) {
        let ops;
        let prop;
        let format;
        let feather = vm.feather();

        ops = f.copy(f.operators);

        if (attr) {
            prop = resolveProperty(feather, attr);
            format = prop.format || prop.type;

            switch (format) {
            case "date":
            case "dateTime":
                delete ops["~*"];
                delete ops["!~*"];
                break;
            case "integer":
            case "number":
            case "money":
                delete ops["~*"];
                delete ops["!~*"];
                delete ops.IS;
                break;
            case "boolean":
                delete ops["~*"];
                delete ops["!~*"];
                delete ops[">"];
                delete ops["<"];
                delete ops[">="];
                delete ops["<="];
                delete ops.IS;
                break;
            case "string":
            case "password":
            case "tel":
                delete ops[">"];
                delete ops["<"];
                delete ops[">="];
                delete ops["<="];
                delete ops.IS;
                break;
            default:
                delete ops["~*"];
                delete ops["!~*"];
                delete ops[">"];
                delete ops["<"];
                delete ops[">="];
                delete ops["<="];
                delete ops.IS;
            }
        }

        // Currently unsupported operators
        delete ops.IN;
        delete ops["~"];
        delete ops["!~"];

        return ops;
    };
    /**
        @method propertyName
        @param {String} name
        @return {String}
    */
    vm.propertyName = f.prop(options.propertyName || "criteria");
    /**
        Cache of relation widget view models in use.
        @method relations
        @param {Object} obj
        @return {Object}
    */
    vm.relations = f.prop({});
    /**
        @method reset
    */
    vm.reset = function () {
        let name = vm.propertyName();
        let filter = f.copy(options.filter());

        filter[name] = filter[name] || [];
        vm.filter(filter);
        if (!filter[name].length) {
            vm.add();
        }
        vm.selection(0);
    };

    /**
        Object with column, operator and value input element ids.
        @method viewHeaderIds
        @param {Object} obj
        @return {Object}
    */
    vm.viewHeaderIds = f.prop({
        column: f.createId(),
        operator: f.createId(),
        value: f.createId()
    });
    /**
        View containing table headers
        @method viewHeaders
        @return {Object} View
    */
    vm.viewHeaders = function () {
        let ids = vm.viewHeaderIds();
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
    /**
        View containing row content.
        @method viewRows
        @return {Object} View
    */
    vm.viewRows = function () {
        let view;

        if (vm.filter().showDeleted) {
            showDeletedButton().icon("check-square");
        } else {
            showDeletedButton().icon("far fa-square");
        }

        view = vm.items().map(function (item) {
            let row;
            let operators = vm.operators(item.property);

            row = m("tr", {
                onclick: vm.selection.bind(this, item.index, true),
                style: {
                    backgroundColor: vm.rowColor(item.index)
                }
            }, [
                m("td", m("select", {
                    class: "fb-filter-dialog-property",
                    style: {
                        minWidth: "175px"
                    },
                    value: item.property,
                    onchange: (e) =>
                            vm.itemPropertyChanged.bind(
                        this,
                        item.index
                    )(e.target.value)
                }, vm.attrs().map(function (attr) {
                    return m("option", {
                        value: attr
                    }, attr.toName());
                }))),
                m("td", {
                    class: "fb-filter-dialog-operator"
                }, [
                    m("select", {
                        id: "filter_op_" + item.index,
                        oncreate: function (vnode) {
                            let e = document.getElementById(vnode.dom.id);
                            e.value = item.operator || "=";
                        },
                        onchange: (e) => vm.itemChanged.bind(
                            this,
                            item.index,
                            "operator"
                        )(e.target.value)
                    }, Object.keys(operators).map(function (op) {
                        return m("option", {
                            value: op
                        }, operators[op]);
                    }), item.operator || "=")
                ]),
                m("td", {
                    class: "fb-filter-dialog-input-cell"
                }, [createEditor({
                    index: item.index,
                    key: item.property,
                    value: item.value,
                    operator: item.operator,
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
    store = f.createModel({}, vm.feather());
    Object.keys(store.data).forEach(function (key) {
        if (store.data[key].isToOne()) {
            // If property updated, forward change
            store.onChange(key, function (prop) {
                let items = vm.items();
                items.forEach(function (item) {
                    let value;
                    if (item.property === key) {
                        value = prop.newValue();
                        value = (
                            value
                            ? {
                                id: value.data.id()
                            }
                            : {
                                id: ""
                            }
                        );
                        vm.itemChanged(item.index, "value", value);
                    }
                });
            });
        }
    });

    vm.buttons().push(showDeletedButton);

    vm.reset();

    return vm;
};

catalog.register("viewModels", "filterDialog", filterDialog.viewModel);

/**
    Filter dialog component
    @class FilterDialog
    @namespace Components
    @static
    @uses Components.Dialog
*/
filterDialog.component = f.getComponent("Dialog");

catalog.register("components", "filterDialog", filterDialog.component);

export default Object.freeze(filterDialog);