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
import dialog from "./dialog.js";

const dataType = {};
const listWidget = {};
const m = window.m;

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
        let items = vm.items();
        let selected = vm.selected();

        return m("table", {
            class: "pure-table",
            style: vnode.attrs.style,
            disabled: vnode.attrs.disabled
        }, [
            m("thead", [
                m("tr", [
                    m("th", {
                        style: {
                            width: "100px"
                        }
                    }, name)
                ])
            ]),
            m("tbody", {
                class: "fb-table-body",
                style: {
                    height: "100px"
                }
            }, items.map(function (i) {
                return m("tr", {
                    onclick: vm.onclick,
                    style: {
                        backgroundColor: (
                            selected.indexOf(i) === -1
                            ? "White"
                            : "LightSkyBlue"
                        )
                    }
                }, [
                    m("td", i)
                ]);
            }))
        ]);
    }
};

dataType.viewModel = function (options) {
    let vm = {};
    let parent = options.parentViewModel;

    vm.buttonAdd = f.prop();
    vm.buttonRemove = f.prop();
    vm.dataTypeDialog = f.prop();
    vm.childOf = function () {
        let type = vm.prop();

        if (typeof type === "object") {
            return type.childOf || "";
        }

        return "";
    };
    vm.feathers = function () {
        let countries = catalog.store().data().countries().map(
            function (model) {
                return model.data.name();
            }
        ).sort();

        countries.unshift("");

        return countries;
    };
    vm.id = f.prop(options.id || f.createId());
    vm.isCell = f.prop(options.isCell);
    vm.model = parent.model().data[options.parentProperty];
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
                vm.relation() &&
                !vm.childOf()
            ) {
                vm.buttonAdd().enable();
                vm.buttonRemove().enable();
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
    vm.onchangeDialogChildOf = function (e) {
        let type = f.copy(vm.prop());

        if (typeof type === "object") {
            if (e.target.value) {
                type.childOf = e.target.value;
                vm.propsAvailableWidget().items([]);
                vm.propsSelectedWidget().items([]);
                vm.buttonAdd().disable();
                vm.buttonRemove().disable();
            } else {
                delete type.childOf;
                vm.propsAvailableWidget().items(vm.properties());
                vm.buttonAdd().enable();
                vm.buttonRemove().enable();
            }

            vm.prop(type);
        }
    };
    vm.onchangeDialogType = function (e) {
        vm.onchange(e, false);
    };
    vm.onchangeDialogRelation = function (e) {
        let type = f.copy(vm.prop());

        if (typeof type === "object") {
            type.relation = e.target.value;
            vm.prop(type);

            if (e.target.value && !vm.childOf()) {
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
    vm.propertyAdd = function () {
        let selected = vm.propsAvailableWidget().selected();

        selected.forEach((item) => vm.propertiesSelected().push(item));
        selected.length = 0;
        vm.propsAvailableWidget().items(vm.propertiesAvailable());
        vm.propsSelectedWidget().items(vm.propertiesSelected());
    };
    vm.propertyRemove = function () {
        let wSelected = vm.propsSelectedWidget().selected();
        let selected = vm.propertiesSelected();

        wSelected.forEach(function (item) {
            selected.splice(selected.indexOf(item), 1);
        });
        wSelected.length = 0;
        vm.propsAvailableWidget().items(vm.propertiesAvailable());
        vm.propsSelectedWidget().items(vm.propertiesSelected());
    };
    vm.properties = function () {
        let props = [];
        let feather;
        let relation = vm.relation();

        if (relation) {
            feather = catalog.getFeather(relation);
            props = Object.keys(feather.properties).sort();
        }

        return props;
    };
    vm.propertiesAvailable = function () {
        let props = vm.properties().slice();
        let selected = vm.propertiesSelected();

        return props.filter(function (p) {
            return selected.indexOf(p) === -1;
        });
    };
    vm.propertiesSelected = f.prop([]);
    vm.relation = function () {
        let type = vm.prop();

        if (typeof type === "object") {
            return type.relation;
        }

        return "";
    };
    vm.style = f.prop(options.style || {});
    vm.prop = options.parentViewModel.model().data[options.parentProperty];
    vm.propsAvailableWidget = f.prop();
    vm.propsSelectedWidget = f.prop();
    vm.type = function () {
        let type = vm.prop();

        if (typeof type === "object") {
            return "relation";
        }

        return type;
    };
    vm.types = f.prop(Object.freeze([
        "array",
        "integer",
        "number",
        "object",
        "relation",
        "string"
    ]));
    vm.update = function () {
        let type = vm.type();
        let relation = vm.relation();
        let childOf = vm.childOf();
        let value = type;
        let props;

        if (type === "relation") {
            value = {
                relation: relation
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

    vm.buttonAdd(button.viewModel({
        onclick: vm.propertyAdd,
        title: "Add",
        icon: "arrow-alt-circle-right",
        style: {
            display: "block",
            backgroundColor: "white"
        }
    }));

    vm.buttonRemove(button.viewModel({
        onclick: vm.propertyRemove,
        title: "Remove",
        icon: "arrow-alt-circle-left",
        style: {
            backgroundColor: "white"
        }
    }));

    vm.dataTypeDialog(dialog.viewModel({
        icon: "edit",
        title: "Data type"
    }));

    vm.dataTypeDialog().buttons().pop();

    vm.dataTypeDialog().content = function () {
        let id = vm.id();
        let isNotRelation = vm.type() !== "relation";
        let isNotFeather = !vm.relation();

        return m("div", [
            m("div", {
                class: "pure-control-group"
            }, [
                m("label", {
                    for: id
                }, "Type:"),
                m("select", {
                    id: id,
                    key: id,
                    value: vm.type(),
                    onchange: vm.onchangeDialogType
                }, vm.types().map(function (item) {
                    return m("option", {
                        value: item,
                        label: item,
                        key: id + "$" + item
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
                    key: "dlgRelation",
                    value: vm.relation(),
                    onchange: vm.onchangeDialogRelation,
                    disabled: isNotRelation,
                    class: "fb-input"
                }, f.feathers().map(function (item) {
                    return m("option", {
                        value: item.value,
                        label: item.label,
                        key: id + "$feather$" + item.value
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
                    disabled: isNotFeather || vm.propertiesSelected().length
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
                        disabled: isNotFeather
                    }),
                    m("div", {
                        style: {
                            display: "inline-block",
                            position: "absolute",
                            marginTop: "36px"
                        }
                    }, [
                        m(button.component, {
                            viewModel: vm.buttonAdd()
                        }),
                        m(button.component, {
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
                        disabled: isNotFeather
                    })
                ])
            ])
        ]);
    };

    vm.dataTypeDialog().style().width = "450px";
    vm.dataTypeDialog().style().height = "450px";

    vm.propsAvailableWidget(listWidget.viewModel({
        name: "Available"
    }));
    vm.propsSelectedWidget(listWidget.viewModel({
        name: "Selected"
    }));

    return vm;
};

dataType.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;

        // Set up viewModel if required
        this.viewModel = dataType.viewModel({
            parentViewModel: options.parentViewModel,
            parentProperty: options.parentProperty,
            id: options.id,
            isCell: options.isCell,
            style: options.style,
            disabled: options.disabled
        });
    },

    view: function (vnode) {
        let ret;
        let vm = this.viewModel;
        let id = vm.id();
        let style = vm.style();
        let disabled = vnode.attrs.disabled === true;

        style.display = style.display || "inline-block";

        // Build the view
        ret = m("div", {
            style: style
        }, [
            m(dialog.component, {
                viewModel: vm.dataTypeDialog()
            }),
            m("select", {
                id: id,
                key: id,
                onchange: vm.onchange,
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                style: vnode.attrs.style,
                value: vm.type(),
                disabled: disabled
            }, vm.types().map(function (item) {
                let opts = {
                    value: item,
                    label: item,
                    key: id + "$" + item
                };
                if (vm.type() === item) {
                    opts.selected = true;
                }
                return m("option", opts);
            }))
        ]);

        return ret;
    }
};

catalog.register(
    "components",
    "dataType",
    dataType.component
);
