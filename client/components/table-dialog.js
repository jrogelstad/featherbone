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
    @module TableDialog
*/

const tableDialog = {};

/**
    View model for sort dialog.

    @class TableDialog
    @constructor
    @namespace ViewModels
    @extends ViewModels.Dialog
    @param {Object} options
    @param {Array} options.propertyName Filter property being modified
    @param {Array} options.attrs Attributes
    @param {Array} options.list Model list
    @param {Array} options.feather Feather
    @param {Property} options.filter Filter property
*/
tableDialog.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;
    let buttonAdd;
    let buttonRemove;
    let buttonClear;
    let buttonDown;
    let buttonUp;
    let selection = f.prop();

    // ..........................................................
    // PUBLIC
    //

    vm = f.createViewModel("Dialog", options);
    /**
        @method add
    */
    vm.add = function () {
        let ary = vm.data();
        let attrs = vm.attrs();

        attrs.some(vm.addAttr.bind(ary));

        if (!vm.isSelected()) {
            vm.selection(ary.length - 1);
        }

        buttonRemove.enable();
        buttonClear.enable();
        vm.scrollBottom(true);
    };
    /**
        @method addAttr
        @param {String} attr Attribute
    */
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                property: attr
            });
            return true;
        }
    };
    /**
        @method buttonAdd
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAdd = function () {
        return buttonAdd;
    };
    /**
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = function () {
        return buttonClear;
    };
    /**
        @method buttonDown
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDown = function () {
        return buttonDown;
    };
    /**
        @method buttonRemove
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRemove = function () {
        return buttonRemove;
    };
    /**
        @method buttonUp
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUp = function () {
        return buttonUp;
    };
    /**
        @method clear
    */
    vm.clear = function () {
        vm.data().length = 0;
        buttonClear.disable();
    };
    /**
        @method content
        @return {Object} View
    */
    vm.content = function () {
        let btn = f.getComponent("Button");

        return [
            m(btn, {
                viewModel: vm.buttonAdd()
            }),
            m(btn, {
                viewModel: vm.buttonRemove()
            }),
            m(btn, {
                viewModel: vm.buttonClear()
            }),
            m(btn, {
                viewModel: vm.buttonDown()
            }),
            m(btn, {
                viewModel: vm.buttonUp()
            }),
            m("table", {
                class: "pure-table"
            }, [
                m("thead", {
                    class: "fb-table-dialog-table-header"
                }, vm.viewHeaders()),
                m("tbody", {
                    id: "sortTbody",
                    class: "fb-table-dialog-table-body",
                    oncreate: function (vnode) {
                        let e = document.getElementById(vnode.dom.id);

                        if (vm.scrollBottom()) {
                            e.scrollTop = e.scrollHeight;
                        }
                        vm.scrollBottom(false);
                    }
                }, vm.viewRows())
            ])
        ];
    };
    /**
        Placeholder function.
        @method data
        @return {List}
    */
    vm.data = function () {
        // Implement list here
        return;
    };
    /**
        @method isSelected
        @return {Boolean}
    */
    vm.isSelected = function () {
        return state.resolve(
            state.resolve("/Selection").current()[0]
        ).isSelected();
    };
    /**
        @method itemChanged
        @param {Integer} index
        @param {String} property
        @param {Any} value
    */
    vm.itemChanged = function (index, property, value) {
        vm.data()[index][property] = value;
    };
    /**
        @method items
        @return {Array}
    */
    vm.items = function () {
        let i = 0;
        let items = vm.data().map(function (item) {
            let ret = f.copy(item);
            ret.index = i;
            i += 1;
            return ret;
        });

        return items;
    };
     /**
        @method hasAttr
        @param {Object} item
        @return {Boolean}
    */
    vm.hasAttr = function (item) {
        return item.property === this;
    };
    /**
        @method list
        @param {List} list
        @return {List}
    */
    vm.list = f.prop(options.list);
    /**
        @method moveDown
    */
    vm.moveDown = function () {
        let ary = vm.data();
        let idx = vm.selection();
        let a = ary[idx];
        let b = ary[idx + 1];

        ary.splice(idx, 2, b, a);
        vm.selection(idx + 1);
    };
    /**
        @method moveUp
    */
    vm.moveUp = function () {
        let ary = vm.data();
        let idx = vm.selection() - 1;
        let a = ary[idx];
        let b = ary[idx + 1];

        ary.splice(idx, 2, b, a);
        vm.selection(idx);
    };
    /**
        @method remove
    */
    vm.remove = function () {
        let idx = selection();
        let ary = vm.data();

        ary.splice(idx, 1);
        state.send("unselected");
        if (ary.length) {
            if (idx > 0) {
                idx -= 1;
            }
            selection(idx);
            return;
        }
        buttonRemove.disable();
    };
    /**
        Placeholder function.
        @method reset
    */
    vm.reset = function () {
        // Reset code here
        return;
    };
    /**
        @method resolveProperties
        @param {Object} feather
        @param {Object} properties
        @param {Array} ary
        @param {String} prefix
        @return {Array}
    */
    vm.resolveProperties = function (feather, properties, ary, prefix, norel) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = f.catalog().getFeather(prop.type.relation);
                vm.resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + ".",
                    norel
                );
            }

            if (
                prop.format &&
                f.formats()[prop.format].isMoney
            ) {
                path += ".amount";
            } else if (
                prop.type === "object" || (
                    isObject && (
                        (norel && prop.type.childOf) ||
                        prop.type.parentOf ||
                        prop.type.isChild
                    )
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    };
    /**
        @method rowColor
        @param {Integer} index
        @return {String}
    */
    vm.rowColor = function (index) {
        if (vm.selection() === index) {
            if (vm.isSelected()) {
                return "LightSkyBlue";
            }
            return "AliceBlue";
        }
        return "White";
    };
    /**
        @method title
        @param {String} title
        @return {String}
    */
    vm.title = f.prop(options.title);
    /**
        Placeholder function.
        @method viewHeaderIds
        @return {Object}
    */
    vm.viewHeaderIds = f.prop();
    /**
        Placeholder function.
        @method viewHeaders
        @return {Object} View
    */
    vm.viewHeaders = function () {
        return;
    };
    /**
        Placeholder function.
        @method viewRows
        @return {Object} View
    */
    vm.viewRows = function () {
        return;
    };
    /**
        @method scrollBottom
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.scrollBottom = f.prop(false);
    /**
        @method selection
        @param {Integer} [index]
        @param {Boolean} [select]
        @return {Object} View
    */
    vm.selection = function (...args) {
        let ary = vm.data();
        let index = args[0];
        let select = args[1];

        if (select) {
            state.send("selected");
        }

        if (args.length) {
            buttonUp.disable();
            buttonDown.disable();

            if (ary.length > 1) {
                if (index < ary.length - 1) {
                    buttonDown.enable();
                }
                if (index > 0) {
                    buttonUp.enable();
                }
            }

            return selection(index);
        }

        return selection();
    };

    // ..........................................................
    // PRIVATE
    //

    buttonAdd = f.createViewModel("Button", {
        onclick: vm.add,
        label: "Add",
        icon: "add_circle_outline",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    });

    buttonRemove = f.createViewModel("Button", {
        onclick: vm.remove,
        label: "Remove",
        icon: "remove_circle_outline",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    });

    buttonClear = f.createViewModel("Button", {
        onclick: vm.clear,
        title: "Clear",
        icon: "clear",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white"
        }
    });

    buttonUp = f.createViewModel("Button", {
        onclick: vm.moveUp,
        icon: "keyboard_arrow_up",
        title: "Move up",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    });

    buttonDown = f.createViewModel("Button", {
        onclick: vm.moveDown,
        icon: "keyboard_arrow_down",
        title: "Move down",
        class: "fb-icon-button",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    });

    // Statechart
    state = f.State.define(function () {
        this.state("Selection", function () {
            this.state("Off", function () {
                this.event("selected", function () {
                    this.goto("../On");
                });
                this.isSelected = function () {
                    return false;
                };
            });
            this.state("On", function () {
                this.event("unselected", function () {
                    this.goto("../Off");
                });
                this.isSelected = function () {
                    return true;
                };
            });
        });
    });
    state.goto();

    vm.state().resolve("/Display/Showing").enter(function () {
        vm.reset();
    });

    return vm;
};

f.catalog().register("viewModels", "tableDialog", tableDialog.viewModel);

/**
    Table dialog component
    @class TableDialog
    @namespace Components
    @static
    @uses Components.Dialog
*/
tableDialog.component = f.getComponent("Dialog");

f.catalog().register("components", "tableDialog", tableDialog.component);
