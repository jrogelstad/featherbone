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
/*jslint this, es6, browser*/
(function () {
    "use strict";

    var relationWidget = {},
        m = require("mithril"),
        stream = require("stream"),
        f = require("common-core"),
        catalog = require("catalog");

    /**
      @param {Object} Options
      @param {Object} [options.parentViewModel] Parent view-model. Required
        property "relations" returning javascript object to attach relation view model to.
      @param {String} [options.parentProperty] Name of the relation
        in view model to attached to
      @param {String} [options.valueProperty] Value property
      @param {Object} [options.form] Form configuration
      @param {Object} [options.list] (Search) List configuration
      @param {Boolean} [options.isCell] Use style for cell in table
      @param {Object} [options.filter] Filter object used for search
    */
    relationWidget.viewModel = function (options) {
        var duplicate,
            vm = {},
            registerReceiver,
            hasFocus = false,
            parent = options.parentViewModel,
            parentProperty = options.parentProperty,
            valueProperty = options.valueProperty,
            labelProperty = options.labelProperty,
            modelValue = parent.model().data[parentProperty],
            current = modelValue()
                ? modelValue().data[valueProperty]()
                : null,
            inputValue = stream(current),
            type = modelValue.type,
            modelName = type.relation.toCamelCase(),
            criteria = options.filter
                ? options.filter.criteria || []
                : [],
            filter = {
                criteria: f.copy(criteria),
                sort: [{
                    property: valueProperty
                }],
                limit: 10
            },
            list = catalog.store().models()[modelName].list,
            modelList = list({
                filter: filter
            }),
            configId = f.createId();

        function updateValue(prop) {
            var value = prop();
            if (value) {
                vm.value(value.data[options.valueProperty]());
            } else {
                vm.value("");
            }
        }

        // Make sure data changes made by biz logic in the model are recognized
        parent.model().onChanged(parentProperty, updateValue);

        // Because if relation is first focus, no logical way to respond to fetch
        parent.model().state().resolve("/Ready/Fetched").enter(
            updateValue.bind(null, parent.model().data[parentProperty])
        );

        vm.listId = stream(f.createId());
        vm.fetch = function () {
            list({
                value: modelList(),
                filter: filter,
                merge: false
            });
        };
        vm.formConfig = stream(options.form);
        vm.id = stream(options.id);
        vm.isCell = stream(!!options.isCell);
        vm.isDisabled = options.disabled || stream(false);
        vm.label = function () {
            var model = modelValue();
            return (labelProperty && model)
                ? model.data[labelProperty]()
                : "";
        };
        vm.labelProperty = stream(options.labelProperty);
        vm.labels = function () {
            return [
                m("div", {
                    class: "suite-input",
                    style: {
                        marginLeft: "12px",
                        marginTop: vm.label()
                            ? "6px"
                            : ""
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
            var searchList = f.copy(options.list);
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
            var currentModel,
                currentValue = false,
                models = vm.models(),
                regexp = new RegExp("^" + value, "i");

            function count(counter, model) {
                var mValue = model.data[valueProperty]();

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
            if (value.length && models.some(match) &&
                    models.reduce(count, 0) > 1) {
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
            var value = modelValue();

            hasFocus = true;
            value = value
                ? value.data[options.valueProperty]()
                : null;
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
            var fetch = false,
                inputVal = inputValue() || "";
            if (value.length <= inputVal.length ||
                    modelList().length === 10) {
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
        vm.parentProperty = stream(options.parentProperty);
        vm.parantViewModel = stream(options.parentViewModel);
        vm.showMenu = stream(false);
        vm.style = stream({});
        vm.value = function (...args) {
            var result,
                value = args[0];
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
        vm.valueProperty = stream(valueProperty);

        // Helper function for registering callbacks
        registerReceiver = function () {
            var receiverKey = f.createId();

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
        property "relations" returning javascript object to attach relation view model to.
      @param {String} [options.parentProperty] Name of the relation
        in view model to attached to
      @param {String} [options.valueProperty] Value property
      @params {Boolean} [options.isCell] Use style for cell in table
    */
    relationWidget.component = {
        oninit: function (vnode) {
            var options = vnode.attrs,
                parentProperty = options.parentProperty,
                relations = options.parentViewModel.relations();

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
                    disabled: options.disabled,
                    style: options.style
                });
            }

            this.viewModel = relations[parentProperty];
        },

        view: function (vnode) {
            var listOptions, inputStyle, menuStyle, maxWidth, menu,
                    vm = this.viewModel,
                    disabled = vm.isDisabled(),
                    style = vm.style(),
                    openMenuClass = "pure-menu-link",
                    editMenuClass = "pure-menu-link",
                    buttonClass = "pure-button fa fa-bars suite-relation-button",
                    labelClass = "suite-relation-label";

            menuStyle = {
                display: vm.showMenu()
                    ? "block"
                    : "none"
            };

            // Generate picker list
            listOptions = vm.models().map(function (model) {
                var content = {
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

            if (vm.isDisabled()) {
                editMenuClass += " pure-menu-disabled";
            }

            if (vm.isCell()) {
                inputStyle = {
                    minWidth: "100px",
                    maxWidth: "100%",
                    border: "none"
                };
                buttonClass += " suite-relation-button-cell";
                menuStyle.top = "35px";
                menuStyle.right = "-100px";
                labelClass = "suite-relation-label-cell";

                menu = m("div", {
                    style: {
                        position: "relative",
                        display: "inline"
                    }
                }, [
                    m("div", {
                        class: "pure-menu custom-restricted-width suite-relation-menu",
                        onmouseover: vm.onmouseovermenu,
                        onmouseout: vm.onmouseoutmenu
                    }, [
                        m("span", {
                            class: buttonClass
                        }),
                        m("ul", {
                            class: "pure-menu-list suite-relation-menu-list",
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
                maxWidth = maxWidth < 100
                    ? 100
                    : maxWidth;
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
                    onchange: m.withAttr("value", vm.onchange),
                    onfocus: vm.onfocus,
                    onblur: vm.onblur,
                    oninput: m.withAttr("value", vm.oninput),
                    value: vm.value(),
                    oncreate: vnode.attrs.onCreate,
                    disabled: disabled
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
    module.exports = relationWidget;

}());