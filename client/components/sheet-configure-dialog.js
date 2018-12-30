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
/*jslint this*/
import * as m from "../../node_modules/mithril/mithril.js";
import { f } from "./core.js";
import { stream } from "../../common/stream-client.js";
import { catalog } from "../models/catalog.js";
import { tableDialog } from "./table-dialog.js";

const sheetConfigureDialog = {};

/**
  View model for sort dialog.

  @param {Object} Options
  @param {Function} [options.config] Filter property being modified
  @param {Function} [options.filter] Filter property
*/
sheetConfigureDialog.viewModel = function (options) {
    options = options || {};
    let vm;
    let tableView;
    let createModel = catalog.store().models().workbookLocalConfig;
    let cache = f.copy(options.parentViewModel.sheet());
    let sheetButtonClass;
    let listButtonClass;
    let sheetTabClass;
    let listTabClass;

    options.onOk = function () {
        let id = vm.sheetId();
        let sheet = vm.model().toJSON();
        let tableWidget = options.parentViewModel.tableWidget();

        vm.sheet(id, sheet);
        // If we updated current sheet (not new), update list
        if (vm.sheet().id === id) {
            tableWidget.config(sheet.list);
        }
        vm.state().send("close");
    };
    options.icon = "gear";
    options.title = "Configure worksheet";

    // ..........................................................
    // PUBLIC
    //

    vm = tableDialog.viewModel(options);
    tableView = vm.content;
    vm.alias = function (attr) {
        let feather = catalog.getFeather(vm.model().data.feather());

        return f.resolveAlias(feather, attr);
    };
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                attr: attr
            });
            return true;
        }
    };
    vm.attrs = function () {
        let model = vm.model();
        let feather = catalog.getFeather(model.data.feather());
        let keys = (
            feather
            ? Object.keys(feather.properties)
            : false
        );

        return (
            keys
            ? vm.resolveProperties(feather, keys).sort()
            : []
        );
    };
    vm.config = options.parentViewModel.config;
    vm.content = function () {
        let feathers;
        let forms;
        let d = vm.model().data;
        let ids = vm.ids();
        let nameId = ids.name;
        let featherId = ids.feather;
        let formId = ids.form;

        feathers = vm.feathers().map(function (feather) {
            return m("option", feather);
        });

        forms = vm.forms().map(function (form) {
            return m("option", form);
        });

        return m("div", {
            class: "pure-form pure-form-aligned fb-sheet-configure-content"
        }, [
            m("div", {
                class: "fb-sheet-configure-tabs"
            }, [
                m("button", {
                    class: sheetButtonClass,
                    style: {
                        borderRadius: "4px 0px 0px 4px"
                    },
                    onclick: vm.toggleTab
                }, "Sheet"),
                m("button", {
                    class: listButtonClass,
                    style: {
                        borderRadius: "0px 4px 4px 0px"
                    },
                    onclick: vm.toggleTab
                }, "Columns")
            ]),
            m("div", {
                class: "fb-sheet-configure-group-box"
            }, [
                m("div", {
                    class: sheetTabClass
                }, [
                    m("div", {
                        class: "pure-control-group"
                    }, [
                        m("label", {
                            for: nameId
                        }, "Name:"),
                        m("input", {
                            value: d.name(),
                            required: true,
                            oninput: (e) => d.name(e.target.value)
                        })
                    ]),
                    m("div", {
                        class: "pure-control-group"
                    }, [
                        m("label", {
                            for: featherId
                        }, "Table:"),
                        m("select", {
                            value: d.feather(),
                            required: true,
                            oninput: (e) => d.feather(e.target.value)
                        }, feathers)
                    ]),
                    m("div", {
                        class: "pure-control-group"
                    }, [
                        m("label", {
                            for: formId
                        }, "Form:"),
                        m("select", {
                            value: vm.form(),
                            required: true,
                            oninput: (e) => vm.form(e.target.value)
                        }, forms)
                    ])
                ]),
                m("div", {
                    class: listTabClass
                }, [
                    tableView()
                ])
            ])
        ]);
    };
    vm.data = function () {
        return vm.model().data.list().data.columns();
    };
    vm.hasAttr = function (item) {
        return item.attr === this;
    };
    vm.feathers = function () {
        let feathers = catalog.store().feathers();
        let result = Object.keys(feathers).filter(function (name) {
            return !feathers[name].isChild && !feathers[name].isSystem;
        }).sort();

        return result;
    };
    vm.form = function (...args) {
        let forms;
        let form;
        let name = args[0];
        let prop = vm.model().data.form;

        if (args.length) {
            forms = catalog.store().forms();
            form = Object.keys(forms).find(function (key) {
                return forms[key].name === name;
            });
            prop(forms[form]);
        }
        return (
            prop()
            ? prop().data.name()
            : ""
        );
    };
    vm.forms = function () {
        let result;
        let forms = catalog.store().forms();
        let feather = vm.model().data.feather();

        // Only forms that have matching feather
        result = Object.keys(forms).filter(function (id) {
            return forms[id].feather === feather;
        });
        // Just return names
        result = result.map(function (id) {
            return forms[id].name;
        }).sort();

        return result;
    };
    vm.model = f.prop();
    vm.okDisabled = function () {
        return !vm.model().isValid();
    };
    vm.okTitle = function () {
        return vm.model().lastError();
    };
    vm.sheetId = stream(options.sheetId);
    vm.relations = stream({});
    vm.reset = function () {
        let model;
        let id = vm.sheetId();

        // Setup local model
        cache = f.copy(vm.sheet(id));
        model = createModel(cache);
        model.onChanged("form", m.redraw);
        vm.model(model);
        if (!cache.list.columns.length) {
            vm.add();
        }
        vm.selection(0);

        // Set button orientation
        sheetButtonClass = "pure-button pure-button-primary";
        listButtonClass = "pure-button";
        sheetTabClass = "";
        listTabClass = "fb-tabbed-panes-hidden";
    };
    vm.resolveProperties = function (feather, properties, ary, prefix) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = catalog.getFeather(prop.type.relation);
                vm.resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + "."
                );
            }

            if (
                isObject && (
                    prop.type.childOf ||
                    prop.type.parentOf ||
                    prop.type.isChild
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    };
    vm.sheet = options.parentViewModel.sheet;
    vm.toggleTab = function () {
        if (sheetTabClass) {
            sheetButtonClass = "pure-button pure-button-primary";
            listButtonClass = "pure-button";
            sheetTabClass = "";
            listTabClass = "fb-tabbed-panes-hidden";
        } else {
            sheetButtonClass = "pure-button";
            listButtonClass = "pure-button pure-button-primary";
            sheetTabClass = "fb-tabbed-panes-hidden";
            listTabClass = "";
        }
    };
    vm.workbook = options.parentViewModel.workbook;
    vm.viewHeaderIds = stream({
        column: f.createId(),
        label: f.createId()
    });
    vm.viewHeaders = function () {
        let ids = vm.viewHeaderIds();

        return [
            m("th", {
                style: {
                    minWidth: "165px"
                },
                id: ids.column
            }, "Column"),
            m("th", {
                style: {
                    minWidth: "220px"
                },
                id: ids.label
            }, "Label")
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
                        minWidth: "165px",
                        maxWidth: "165px"
                    }
                }, m("select", {
                    id: f.createId(),
                    value: item.attr,
                    style: {
                        maxWidth: "165px"
                    },
                    onchange: (e) =>
                    vm.itemChanged.bind(
                        this,
                        item.index,
                        "attr"
                    )(e.target.value)
                }, vm.attrs().map(function (attr) {
                    return m("option", {
                        value: attr
                    }, attr.toName());
                }))),
                m("td", {
                    style: {
                        minWidth: "220px",
                        maxWidth: "220px"
                    }
                }, m("input", {
                    value: item.label || vm.alias(item.attr),
                    onchange: (e) =>
                    vm.itemChanged.bind(
                        this,
                        item.index,
                        "label"
                    )(e.target.value)
                }))
            ]);

            return row;
        });

        return view;
    };

    // ..........................................................
    // PRIVATE
    //

    vm.ids().name = f.createId();
    vm.ids().feather = f.createId();
    vm.ids().form = f.createId();
    vm.style().width = "510px";
    vm.reset();

    return vm;
};

/**
  Filter dialog component

  @params {Object} View model
*/
sheetConfigureDialog.component = tableDialog.component;

export { sheetConfigureDialog };