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
import catalog from "../models/catalog.js";

const relationWidget = {};
const m = window.m;

/**
  @param {Object} Options
  @param {Object} [options.parentViewModel] Parent view-model. Required
    property "relations" returning javascript object to attach relation
    view model to.
  @param {String} [options.parentProperty] Name of the relation
    in view model to attached to
  @param {String} [options.valueProperty] Value property
  @param {Object} [options.form] Form configuration
  @param {Object} [options.list] (Search) List configuration
  @param {Boolean} [options.isCell] Use style for cell in table
  @param {Object} [options.filter] Filter object used for search
*/
relationWidget.viewModel = function (options) {
    let duplicate;
    let vm = {};
    let registerReceiver;
    let hasFocus = false;
    let parent = options.parentViewModel;
    let parentProperty = options.parentProperty;
    let valueProperty = options.valueProperty;
    let labelProperty = options.labelProperty;
    let modelValue = parent.model().data[parentProperty];
    let current = (
        modelValue()
        ? modelValue().data[valueProperty]()
        : null
    );
    let inputValue = f.prop(current);
    let type = modelValue.type;
    let modelName = type.relation.toCamelCase();
    let criteria = (
        options.filter
        ? options.filter.criteria || []
        : []
    );
    let filter = {
        criteria: f.copy(criteria),
        sort: [{
            property: valueProperty
        }],
        limit: 10
    };
    let list = catalog.store().models()[modelName].list;
    let modelList = list({
        filter: filter
    });
    let configId = f.createId();

    function updateValue(prop) {
        let value = prop();
        if (value) {
            vm.value(value.data[options.valueProperty]());
        } else {
            vm.value("");
        }
    }

    // Make sure data changes made by biz logic in the model are
    // recognized
    parent.model().onChanged(parentProperty, updateValue);

    // Because if relation is first focus, no logical way to respond
    // to fetch
    parent.model().state().resolve("/Ready/Fetched").enter(
        updateValue.bind(null, parent.model().data[parentProperty])
    );

    vm.listId = f.prop(f.createId());
    vm.fetch = function () {
        list({
            value: modelList(),
            filter: filter,
            merge: false
        });
    };
    vm.formConfig = f.prop(options.form);
    vm.id = f.prop(options.id);
    vm.isCell = f.prop(Boolean(options.isCell));
    vm.isReadOnly = options.isReadOnly || f.prop(false);
    vm.label = function () {
        let model = modelValue();
        return (
            (labelProperty && model)
            ? model.data[labelProperty]()
            : ""
        );
    };
    vm.labelProperty = f.prop(options.labelProperty);
    vm.labels = function () {
        return [
            m("div", {
                class: "fb-input",
                style: {
                    marginLeft: "12px",
                    marginTop: (
                        vm.label()
                        ? "6px"
                        : ""
                    )
                }
            }, vm.label())
        ];
    };
    vm.model = function () {
        return modelValue();
    };
    vm.models = function () {
        return modelList();
    };
    vm.new = function () {
        m.route.set("/edit/:feather/:key", {
            feather: type.relation.toSpinalCase(),
            key: f.createId()
        }, {
            state: {
                receiver: registerReceiver(),
                create: true
            }
        });
    };
    vm.open = function () {
        m.route.set("/edit/:feather/:key", {
            feather: type.relation.toSpinalCase(),
            key: modelValue().id()
        }, {
            state: {
                receiver: registerReceiver()
            }
        });
    };
    vm.search = function (filter) {
        let searchList = f.copy(options.list);
        searchList.filter = filter || options.filter || searchList.filter;

        catalog.register("config", configId, searchList);

        m.route.set("/search/:feather", {
            feather: type.relation.toSpinalCase(),
            config: configId
        }, {
            state: {
                receiver: registerReceiver()
            }
        });
    };
    vm.onchange = function (value) {
        let currentModel;
        let currentValue = false;
        let models = vm.models();
        let regexp = new RegExp("^" + value, "i");

        function count(counter, model) {
            let mValue = model.data[valueProperty]();

            if (mValue === currentValue) {
                return counter + 1;
            }

            return counter;
        }

        function match(model) {
            currentValue = model.data[valueProperty]();

            if (Array.isArray(currentValue.match(regexp))) {
                currentModel = model;
                return true;
            }

            currentValue = false;
            return false;
        }

        // If multiple matches, launch search to get one exactly
        if (
            value.length && models.some(match) &&
            models.reduce(count, 0) > 1
        ) {
            duplicate = {
                criteria: [{
                    property: valueProperty,
                    value: currentValue
                }]
            };

            // Avoid mithril error when selecting from data list by
            // letting finish here, then handle search on blur event
            document.getElementById(vm.id()).blur();

            return;
        }

        if (currentValue) {
            modelValue(currentModel);
            inputValue(currentValue);
        } else {
            modelValue(null);
            inputValue(null);
            delete filter.criteria;
            vm.fetch();
        }
    };
    vm.onfocus = function () {
        let value = modelValue();

        hasFocus = true;
        value = (
            value
            ? value.data[options.valueProperty]()
            : null
        );
        inputValue(value);
    };
    vm.onblur = function () {
        hasFocus = false;

        if (duplicate) {
            vm.search(duplicate);
        }
        duplicate = undefined;
    };
    vm.oninput = function (value) {
        let fetch = false;
        let inputVal = inputValue() || "";

        if (
            value.length <= inputVal.length ||
            modelList().length === 10
        ) {
            fetch = true;
        }
        inputValue(value);
        if (fetch) {
            filter.criteria = f.copy(criteria);
            filter.criteria.push({
                property: valueProperty,
                operator: "~*",
                value: "^" + value
            });
            vm.fetch();
        }
    };
    vm.onmouseovermenu = function () {
        vm.showMenu(true);
    };
    vm.onmouseoutmenu = function () {
        vm.showMenu(false);
    };
    vm.parentProperty = f.prop(options.parentProperty);
    vm.parantViewModel = f.prop(options.parentViewModel);
    vm.showMenu = f.prop(false);
    vm.style = f.prop({});
    vm.value = function (...args) {
        let result;
        let value = args[0];

        if (hasFocus) {
            if (args.length) {
                result = inputValue(value);
            } else {
                result = inputValue();
            }
            return result || "";
        }

        result = modelValue();
        if (!result) {
            return "";
        }
        return result.data[valueProperty]();
    };
    vm.valueProperty = f.prop(valueProperty);

    // Helper function for registering callbacks
    registerReceiver = function () {
        let receiverKey = f.createId();

        catalog.register("receivers", receiverKey, {
            callback: function (model) {
                modelValue(model);
                vm.showMenu(false);
            }
        });

        return receiverKey;
    };

    vm.style(options.style || {});

    return vm;
};

/**
  @param {Object} Options
  @param {Object} [options.viewModel] Parent view-model. Must have
    property "relations" returning javascript object to attach relation
    view model to.
  @param {String} [options.parentProperty] Name of the relation
    in view model to attached to
  @param {String} [options.valueProperty] Value property
  @params {Boolean} [options.isCell] Use style for cell in table
*/
relationWidget.component = {
    oninit: function (vnode) {
        let options = vnode.attrs;
        let parentProperty = options.parentProperty;
        let relations = options.parentViewModel.relations();

        // Set up viewModel if required
        if (!relations[parentProperty]) {
            relations[parentProperty] = relationWidget.viewModel({
                parentViewModel: options.parentViewModel,
                parentProperty: parentProperty,
                valueProperty: options.valueProperty,
                labelProperty: options.labelProperty,
                form: options.form,
                list: options.list,
                filter: options.filter,
                isCell: options.isCell,
                id: options.id,
                isReadOnly: options.isReadOnly,
                style: options.style
            });
        }

        this.viewModel = relations[parentProperty];
    },

    view: function (vnode) {
        let listOptions;
        let inputStyle;
        let menuStyle;
        let maxWidth;
        let menu;
        let vm = this.viewModel;
        let readonly = vm.isReadOnly();
        let style = vm.style();
        let openMenuClass = "pure-menu-link";
        let editMenuClass = "pure-menu-link";
        let buttonClass = "pure-button fa fa-bars fb-relation-button";
        let labelClass = "fb-relation-label";

        menuStyle = {
            display: (
                vm.showMenu()
                ? "block"
                : "none"
            )
        };

        // Generate picker list
        listOptions = vm.models().map(function (model) {
            let content = {
                value: model.data[vm.valueProperty()]()
            };
            if (vm.labelProperty()) {
                content.label = model.data[vm.labelProperty()]();
            }
            return m("option", content);
        });

        style.display = style.display || "inline-block";

        if (!vm.model()) {
            openMenuClass += " pure-menu-disabled";
        }

        if (readonly) {
            editMenuClass += " pure-menu-disabled";
        }

        if (vm.isCell()) {
            inputStyle = {
                minWidth: "100px",
                maxWidth: "100%"
            };
            buttonClass += " fb-relation-button-cell";
            menuStyle.top = "35px";
            menuStyle.right = "-100px";
            labelClass = "fb-relation-label-cell";

            menu = m("div", {
                onmouseover: vm.onmouseovermenu,
                style: {
                    position: "relative",
                    display: "inline"
                }
            }, [
                m("div", {
                    class: (
                        "pure-menu " +
                        "custom-restricted-width " +
                        "fb-relation-menu"
                    ),
                    onmouseover: vm.onmouseovermenu,
                    onmouseout: vm.onmouseoutmenu
                }, [
                    m("span", {
                        class: buttonClass
                    }),
                    m("ul", {
                        class: "pure-menu-list fb-relation-menu-list",
                        style: menuStyle
                    }, [
                        m("li", {
                            class: editMenuClass,
                            onclick: vm.search
                        }, [m("i", {
                            class: "fa fa-search"
                        })], " Search"),
                        m("li", {
                            class: openMenuClass,
                            onclick: vm.open
                        }, [m("i", {
                            class: "fa fa-folder-open"
                        })], " Open"),
                        m("li", {
                            class: editMenuClass,
                            onclick: vm.new
                        }, [m("i", {
                            class: "fa fa-plus-circle"
                        })], " New")
                    ])
                ])
            ]);
        }

        // Hack size to fit button.
        if (style.maxWidth) {
            maxWidth = style.maxWidth.replace("px", "");
            maxWidth = maxWidth - 35;
            maxWidth = (
                maxWidth < 100
                ? 100
                : maxWidth
            );
            inputStyle.maxWidth = maxWidth + "px";
        }

        // Build the view
        return m("div", {
            style: style
        }, [
            m("input", {
                style: inputStyle,
                list: vm.listId(),
                id: vm.id(),
                onchange: (e) => vm.onchange(e.target.value),
                onfocus: vm.onfocus,
                onblur: vm.onblur,
                oninput: (e) => vm.oninput(e.target.value),
                value: vm.value(),
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                readonly: readonly
            }),
            menu,
            m("div", {
                class: labelClass
            }, vm.labels()),
            m("datalist", {
                id: vm.listId()
            }, listOptions)
        ]);
    }
};

catalog.register("components", "relationWidget", relationWidget.component);

export default Object.freeze(relationWidget);