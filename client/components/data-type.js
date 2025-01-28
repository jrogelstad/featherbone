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
    @module DataType
*/

const dataType = {};
const listWidget = {};

listWidget.viewModel = function (options) {
    let vm = {};

    vm.name = f.prop(options.name);
    vm.items = f.prop([]);
    vm.onclick = function (e) {
        let selected = vm.selected();
        let idx = selected.indexOf(e.target.textContent);

        if (idx === -1) {
            selected.push(e.target.textContent);
        } else {
            selected.splice(idx, 1);
        }
    };
    vm.selected = f.prop([]);

    return vm;
};

listWidget.component = {
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel;
    },

    view: function (vnode) {
        let vm = this.viewModel;
        let name = vm.name();
        let items = vm.items() || [];
        let selected = vm.selected();

        return m("table", {
            class: "pure-table",
            style: vnode.attrs.style,
            readonly: vnode.attrs.readonly
        }, [
            m("thead", [
                m("tr", [
                    m("th", {
                        class: "fb-data-type-dialog-list-header"
                    }, name)
                ])
            ]),
            m("tbody", {
                class: "fb-table-body fb-data-type-dialog-list-body"
            }, items.map(function (i) {
                return m("tr", {
                    onclick: vm.onclick,
                    class: (
                        selected.indexOf(i) === -1
                        ? ""
                        : "fb-data-type-dialog-list-selected"
                    )
                }, [
                    m("td", i)
                ]);
            }))
        ]);
    }
};

/**
    View model editor for data type selction.
    @class DataType
    @constructor
    @namespace ViewModels
    @param {Object} options Options
    @param {Object} options.parentViewModel
    @param {String} options.parentProperty
    @param {String} [options.id]
    @param {Object} [options.isOverload]
*/
dataType.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    /**
        @method buttonAdd
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAdd = f.prop();
    /**
        @method buttonEdit
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonEdit = f.prop();
    /**
        @method buttonRemove
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRemove = f.prop();
    /**
        Editor dialog view model.
        @method dataTypeDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.dataTypeDialog = f.prop();
    /**
        Parent attribute, if applicable.
        @method childOf
        @return {String}
    */
    vm.childOf = function () {
        let type = vm.prop();

        if (typeof type === "object" && type !== null) {
            return type.childOf || "";
        }

        return "";
    };
    /**
        Array of feather as key value objects for selector options.
        @method feathers
        @return {Array}
    */
    vm.feathers = function () {
        let countries = f.catalog().store().data().countries().map(
            function (model) {
                return model.data.name();
            }
        ).sort();

        countries.unshift("");

        return countries;
    };
    /**
        @method key
        @param {String} key
        @return {String}
    */
    vm.key = f.prop(options.key || f.createId());
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(options.id || f.createId());
    /**
        Flag special handling if overload instance in a feather.
        @method isOverload
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isOverload = f.prop(Boolean(options.isOverload));
    /**
        @method model
        @return {Model}
    */
    vm.model = parent.model;
    /**
        @method onchange
        @param {Event} event,
        @param {Boolean} showDialog
    */
    vm.onchange = function (e, showDialog) {
        if (e.target.value === "relation") {
            vm.prop({});
            if (showDialog !== false) {
                vm.dataTypeDialog().show();
            }
            vm.buttonAdd().enable();
            vm.buttonRemove().enable();
            if (
                e.target.value &&
                vm.relation()
            ) {
                return;
            }
        } else {
            vm.prop(e.target.value);
        }

        vm.propsAvailableWidget().items([]);
        vm.propsSelectedWidget().items([]);
        vm.buttonAdd().disable();
        vm.buttonRemove().disable();
    };
    /**
        @method onchangeDialogChildOf
        @param {Event} event
    */
    vm.onchangeDialogChildOf = function (e) {
        let type = vm.prop();

        if (typeof type === "object") {
            type = f.copy(type);
            if (e.target.value) {
                type.childOf = e.target.value;
            } else {
                delete type.childOf;
            }

            vm.prop(type);
        }
    };
    /**
        @method onchangeDialogType
        @param {Event} event
    */
    vm.onchangeDialogType = function (e) {
        vm.onchange(e, false);
    };
    /**
        @method onchangeDialogRelation
        @param {Event} event
    */
    vm.onchangeDialogRelation = function (e) {
        let type = f.copy(vm.prop());

        if (typeof type === "object") {
            type.relation = e.target.value;
            vm.prop(type);

            if (e.target.value) {
                vm.buttonAdd().enable();
                vm.buttonRemove().enable();
                vm.propsAvailableWidget().items(vm.properties());
                vm.propsSelectedWidget().items([]);
            } else {
                vm.buttonAdd().disable();
                vm.buttonRemove().disable();
            }
        }
    };
    /**
        Adds selected available properties to relation.
        @method propertyAdd
    */
    vm.propertyAdd = function () {
        let selected = vm.propsAvailableWidget().selected();
        let items = vm.propertiesSelected().slice();

        selected.forEach((item) => items.push(item));
        selected.length = 0;
        vm.propsAvailableWidget().items(vm.propertiesAvailable());
        vm.propsSelectedWidget().items(items);
    };
    /**
        Removes selected relation properties from relation.
        @method propertyRemove
    */
    vm.propertyRemove = function () {
        let wSelected = vm.propsSelectedWidget().selected();
        let selected = vm.propertiesSelected().slice();

        wSelected.forEach(function (item) {
            selected.splice(selected.indexOf(item), 1);
        });
        wSelected.length = 0;
        vm.propsAvailableWidget().items(vm.propertiesAvailable());
        vm.propsSelectedWidget().items(selected);
    };
    /**
        All potential properties for relation.
        @method properties
    */
    vm.properties = function () {
        let props = [];
        let fp;
        let relation = vm.relation();
        let co = options.parentViewModel.model().data.type.childOf;

        if (relation && !vm.isOverload()) {
            fp = f.catalog().getFeather(relation).properties;
            // Exclude self property from list if child
            props = Object.keys(fp).filter((p) => p !== co).sort();
        }

        return props;
    };
    /**
        Available properties for relation.
        @method propertiesAvailable
    */
    vm.propertiesAvailable = function () {
        let props = vm.properties().slice();
        let selected = vm.propertiesSelected() || [];

        return props.filter(function (p) {
            return selected.indexOf(p) === -1;
        });
    };
    /**
        Properties assigned to relation.
        @method propertiesSelected
    */
    vm.propertiesSelected = function (...args) {
        let type = vm.prop();

        if (typeof type === "object" && type !== null) {
            type = f.copy(type);
            if (args.length) {
                type.properties = args[0];
                vm.prop(type);
            }
            return type.properties;
        }

        return [];
    };
    /**
        Feather used as relation type.
        @method relation
        @return {String}
    */
    vm.relation = function () {
        let type = vm.prop();

        if (typeof type === "object" && type !== null) {
            return type.relation;
        }

        return "";
    };
    /**
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});
    /**
        Parent property.
        @method prop
        @param {Object} property
        @return {Object}
    */
    vm.prop = options.parentViewModel.model().data[options.parentProperty];
    /**
        @method propsAvailableWidget
        @param {Object} View model
        @return {Object}
    */
    vm.propsAvailableWidget = f.prop();
    /**
        @method propsSelectedWidget
        @param {Object} View model
        @return {Object}
    */
    vm.propsSelectedWidget = f.prop();
    /**
        @method type
        @return {String}
    */
    vm.type = function () {
        let type = vm.prop();

        if (typeof type === "object" && type !== null) {
            return "relation";
        }

        return type;
    };
     /**
        Array of available types.
        @method types
        @param {Array} types
        @return {Array}
    */
    vm.types = f.prop(Object.freeze([
        "array",
        "boolean",
        "integer",
        "number",
        "object",
        "relation",
        "string"
    ]));
    /**
        Updates `prop` with selected value.
        @method update
    */
    vm.update = function () {
        let type = vm.type();
        let rel = vm.relation();
        let childOf = vm.childOf();
        let value = type;
        let props;

        if (type === "relation") {
            value = {
                relation: rel
            };

            props = vm.propertiesSelected();
            if (props) {
                value.properties = props;
            } else if (childOf) {
                value.childOf = childOf;
            }
        }

        vm.prop(value);
    };

    // ..........................................................
    // PRIVATE
    //

    vm.buttonAdd(f.createViewModel("Button", {
        onclick: vm.propertyAdd,
        title: "Add",
        icon: "chevron_right",
        style: {
            display: "block",
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(f.createViewModel("Button", {
        onclick: vm.propertyRemove,
        title: "Remove",
        icon: "chevron_left",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.dataTypeDialog(f.createViewModel("Dialog", {
        icon: "edit",
        title: (
            vm.isOverload()
            ? "Overload type"
            : "Data type"
        )
    }));

    vm.dataTypeDialog().buttons().pop();

    vm.dataTypeDialog().content = function () {
        let theId = vm.id();
        let isNotRelation = vm.type() !== "relation";
        let isNotFeather = !vm.relation();
        let propertiesSelected = vm.propertiesSelected() || [];
        let isOverload = vm.isOverload();
        let btn = f.getComponent("Button");
        let isNew = vm.model().state().current()[0] === "/Ready/New";

        return m("div", [
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: theId
                }, "Type:"),
                m("select", {
                    id: theId,
                    value: vm.type(),
                    onchange: vm.onchangeDialogType,
                    readonly: isOverload || !isNew,
                    disabled: isOverload || !isNew
                }, vm.types().map(function (item) {
                    return m("option", {
                        value: item,
                        label: item,
                        key: theId + "$" + item
                    });
                }))
            ]),
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: "dlgRelation"
                }, "Feather:"),
                m("select", {
                    id: "dlgRelation",
                    value: vm.relation(),
                    onchange: vm.onchangeDialogRelation,
                    readonly: isNotRelation,
                    class: "fb-input"
                }, f.feathers().map(function (item) {
                    return m("option", {
                        value: item.value,
                        label: item.label,
                        key: theId + "$feather$" + item.value
                    });
                }))
            ]),
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: "dlgChildOf"
                }, "Child Of:"),
                m("input", {
                    id: "dlgChildOf",
                    value: vm.childOf(),
                    onchange: vm.onchangeDialogChildOf,
                    readonly: (
                        isNotFeather ||
                        propertiesSelected.length ||
                        isOverload
                    )
                })
            ]),
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: "dlgSelectors"
                }, "Properties:"),
                m("div", {
                    id: "dlgSelectors",
                    style: {
                        marginLeft: "100px",
                        marginTop: "10px"
                    }
                }, [
                    m(listWidget.component, {
                        viewModel: vm.propsAvailableWidget(),
                        style: {
                            display: "inline-block",
                            width: "120px"
                        },
                        readonly: isNotFeather || isOverload
                    }),
                    m("div", {
                        style: {
                            display: "inline-block",
                            position: "absolute",
                            marginTop: "36px"
                        }
                    }, [
                        m(btn, {
                            viewModel: vm.buttonAdd()
                        }),
                        m(btn, {
                            viewModel: vm.buttonRemove()
                        })
                    ]),
                    m(listWidget.component, {
                        viewModel: vm.propsSelectedWidget(),
                        style: {
                            position: "absolute",
                            left: "285px",
                            display: "inline-block",
                            width: "120px"
                        },
                        readonly: isNotFeather || isOverload
                    })
                ])
            ])
        ]);
    };

    vm.dataTypeDialog().style().width = "500px";
    vm.dataTypeDialog().style().height = "450px";

    vm.buttonEdit(f.createViewModel("Button", {
        onclick: vm.dataTypeDialog().show,
        title: "Edit relation details",
        icon: "edit",
        class: "fb-data-type-edit-button"
    }));

    vm.propsAvailableWidget(listWidget.viewModel({
        name: "Available"
    }));
    vm.propsAvailableWidget().items = vm.propertiesAvailable;

    vm.propsSelectedWidget(listWidget.viewModel({
        name: "Selected"
    }));
    vm.propsSelectedWidget().items = vm.propertiesSelected;

    return vm;
};

/**
    Editor component for feather property type.
    @class DataType
    @static
    @namespace Components
*/
dataType.component = {
    /**
        @method onint
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {Object} vnode.attrs.parentViewModel
        @param {String} vnode.attrs.parentProperty
        @param {String} [vnode.attrs.id]
        @param {Boolean} [vnode.attrs.isOverload]
        @param {Boolean} [vnode.attrs.readonly]
    */
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = dataType.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            key: options.key,
            readonly: options.readonly,
            isOverload: options.isOverload
        });
    },

    /**
        @method view
        @param {Object} vnode Virtual node
    */
    view: function (vnode) {
        let vm = this.viewModel;
        let theId = vm.id();
        let theStyle = vm.style();
        let readOnly = (
            vnode.attrs.readonly === true ||
            vm.isOverload()
        );
        let btn = f.getComponent("Button");
        let isNew = vm.model().state().current()[0] === "/Ready/New";

        theStyle.display = theStyle.display || "inline-block";

        if (vnode.attrs.readonly) {
            vm.buttonEdit().disable();
        } else {
            vm.buttonEdit().enable();
        }

        // Build the view
        return m("div", {
            style: theStyle,
            key: vm.key()
        }, [
            m(f.getComponent("Dialog"), {
                viewModel: vm.dataTypeDialog()
            }),
            m("select", {
                id: theId,
                onchange: vm.onchange,
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                value: vm.type(),
                readonly: readOnly || !isNew,
                disabled: readOnly || !isNew
            }, vm.types().map(function (item) {
                let opts = {
                    value: item,
                    label: item,
                    key: theId + "$" + item
                };
                if (vm.type() === item) {
                    opts.selected = true;
                }
                return m("option", opts);
            })),
            m(btn, {
                viewModel: vm.buttonEdit()
            })
        ]);
    }
};

f.catalog().register(
    "components",
    "dataType",
    dataType.component
);
