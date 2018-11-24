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
/*jslint this, browser, es6*/
/*global window, require, module, Big*/
(function () {
    "use strict";

    const formWidget = {};
    const m = require("mithril");
    const stream = require("stream");
    const f = require("component-core");
    const catalog = require("catalog");
    const dialog = require("dialog");

    function buildButtons(vm) {
        var className,
            midTabClass = ["pure-button", "suite-sheet-group-tab", "suite-sheet-group-tab-form"],
            leftTabClass = f.copy(midTabClass),
            rightTabClass = f.copy(midTabClass),
            tabs = vm.config().tabs || [],
            last = tabs.length - 1;

        midTabClass.push("suite-sheet-group-tab-middle");
        leftTabClass.push("suite-sheet-group-tab-left");
        rightTabClass.push("suite-sheet-group-tab-right");

        tabs = tabs.map(function (tab) {
            return tab.name;
        });

        return tabs.map(function (name, idx) {
            switch (idx) {
            case 0:
                className = leftTabClass;
                break;
            case last:
                className = rightTabClass;
                break;
            default:
                className = midTabClass;
            }

            if (idx + 1 === vm.selectedTab()) {
                className.push("suite-sheet-group-tab-active");
            }
            return m("button", {
                class: className.join(" "),
                onclick: vm.selectedTab.bind(this, idx + 1)
            }, name);
        });
    }

    function buildFieldset(vm, attrs) {
        return attrs.map(function (item) {
            var result, labelOpts, label,
                    key = item.attr,
                    model = vm.model(),
                    prop = model.data[key],
                    dataList = item.dataList || prop.dataList,
                    value = prop(),
                    options = {},
                    menuButtons = vm.menuButtons(),
                    relation = vm.relations()[key];

            function openMenuClass() {
                var ret = "pure-menu-link suite-form-label-menu-item";

                if (relation && relation.model && !relation.model()) {
                    ret += " pure-menu-disabled";
                }

                return ret;
            }

            function editMenuClass() {
                var ret = "pure-menu-link suite-form-label-menu-item";

                if (relation && relation.isDisabled && relation.isDisabled()) {
                    ret += " pure-menu-disabled";
                }

                return ret;
            }

            options.showCurrency = item.showCurrency;

            if (dataList) {
                // If reference a property, get the property
                if (typeof dataList === "string") {
                    dataList = f.resolveProperty(model, dataList)();

                // Must referencoe a simple array, transform
                } else if (typeof dataList[0] !== "object") {
                    dataList = dataList.map(function (item) {
                        return {value: item, label: item};
                    });
                }
            }

            labelOpts = {
                for: key,
                class: "suite-form-label",
                style: {}
            };

            // For relations we get buttons for label
            if (relation) {
                if (!menuButtons[key]) {
                    menuButtons[key] = {
                        display: "none"
                    };
                }

                labelOpts.class = "pure-button suite-form-label-button";
                labelOpts.onclick = function () {
                    menuButtons[key].display = "block";
                };
                labelOpts.onmouseout = function () {
                    menuButtons[key].display = "none";
                };
                label = m("div", labelOpts, [
                    m("div", {
                        class: "pure-menu suite-relation-menu",
                        onmouseover: function () {
                            menuButtons[key].display = "block";
                        }
                    }, [
                        m("ul", {
                            class: "pure-menu-list suite-relation-menu-list",
                            style: {
                                top: "27px",
                                display: menuButtons[key].display
                            }
                        }, [
                            m("li", {
                                class: editMenuClass(),
                                onclick: relation.search
                            }, [m("i", {
                                class: "fa fa-search"
                            })], " Search"),
                            m("li", {
                                class: openMenuClass(),
                                onclick: relation.open
                            }, [m("i", {
                                class: "fa fa-folder-open"
                            })], " Open"),
                            m("li", {
                                class: editMenuClass(),
                                onclick: relation.new
                            }, [m("i", {
                                class: "fa fa-plus-circle"
                            })], " New")
                        ])
                    ]),
                    m("i", {
                        class: "fa fa-bars",
                        style: {
                            marginRight: "4px"
                        }
                    })
                ], item.label || prop.alias() + ":");
            } else {
                label = m("label", labelOpts, item.label || prop.alias() + ":");
            }

            if (item.showLabel === false) {
                labelOpts.style.display = "none";
            }

            if (!prop.isReadOnly() && !vm.focusAttr()) {
                vm.focusAttr(key);
                options.oncreate = function (vnode) {
                    document.getElementById(vnode.dom.id).focus();
                };
            }

            if (prop.isRequired() && (value === null ||
                    (prop.type === "string" && !value))) {
                labelOpts.style.color = "Red";
            }
            result = m("div", {
                class: "pure-control-group"
            }, [
                label,
                f.buildInputComponent({
                    model: model,
                    key: key,
                    dataList: dataList,
                    filter: item.filter,
                    viewModel: vm,
                    options: options
                })
            ]);
            return result;
        });
    }

    function buildUnit(vm, attrs, n) {
        var fieldset = buildFieldset(vm, attrs);

        return m("div", {
            class: "pure-u-1 pure-u-md-1-" + n
        }, [
            m("div", {
                class: "pure-form pure-form-aligned"
            }, [m("fieldset", fieldset)])
        ]);
    }

    function buildGrid(grid, idx) {
        var units,
            vm = this,
            className = "suite-tabbed-panes suite-tabbed-panes-form";

        units = grid.map(function (unit) {
            return buildUnit(vm, unit, grid.length);
        });

        if (!idx) {
            return m("div", {
                class: "pure-g suite-top-pane"
            }, units);
        }

        if (idx !== vm.selectedTab()) {
            className += " suite-tabbed-panes-hidden";
        }

        return m("div", {
            class: className
        }, [
            buildButtons(vm),
            m("div", {
                class: "pure-g suite-tabbed-pane"
            }, units)
        ]);
    }

    formWidget.viewModel = function (options) {
        var model, modelState,
                vm = {},
                models = catalog.store().models();

        vm.config = stream(options.config);
        vm.containerId = stream(options.containerId);
        vm.errorDialog = stream(dialog.viewModel({
            icon: "exclamation-circle",
            title: "Error"
        }));
        vm.errorDialog().buttonCancel().hide();
        vm.focusAttr = stream(),
        vm.menuButtons = stream({});
        vm.selectedTab = stream(1);
        vm.model = stream();
        vm.outsideElementIds = stream(options.outsideElementIds || []);

        // Places to hang selector content between redraws
        vm.relations = stream({});
        vm.selectComponents = stream({});

        // ..........................................................
        // PRIVATE
        //
        if (typeof options.model === "object") {
            vm.model(options.model);
        } else {
            model = vm.model(models[options.model]());
            if (options.id) {
                model.id(options.id);
                if (!options.isNew) {
                    model.fetch();
                }
            }
        }

        // Bind model state to error event
        modelState = vm.model().state();
        modelState.resolve("/Ready").enter(function () {
            var err = vm.model().lastError();

            if (err) {
                vm.errorDialog().message(err.message);
                vm.errorDialog().show();
            }
        });

        // Subscribe to external events
        vm.model().subscribe(true);

        return vm;
    };

    formWidget.component = {
        oninit: function (vnode) {
            this.viewModel = vnode.attrs.viewModel;
        },

        onremove: function () {
            // Unsubscribe model when we're done here
            this.viewModel.model().subscribe(false);
        },

        view: function (vnode) {
            var vm = vnode.attrs.viewModel,
                attrs = vm.config().attrs || [],
                model = vm.model(),
                grids = [];

            // build grid matrix from inside out
            attrs.forEach(function (item) {
                var gidx = item.grid || 0,
                    uidx = item.unit || 0;
                if (!grids[gidx]) {
                    grids[gidx] = [];
                }
                if (!grids[gidx][uidx]) {
                    grids[gidx][uidx] = [];
                }
                grids[gidx][uidx].push(item);
            });

            // Build pane content
            grids = grids.map(buildGrid.bind(vm));

            grids.unshift(m(dialog.component, {
                viewModel: vm.errorDialog()
            }));

            return m("div", {
                id: model.id(),
                class: "suite-form-content",
                oncreate: function (vnode) {
                    var e = document.getElementById(vnode.dom.id),
                        bodyHeight = window.innerHeight,
                        eids = vm.outsideElementIds();

                    eids.forEach(function (id) {
                        var h = document.getElementById(id).clientHeight;
                        bodyHeight = bodyHeight.minus(h);
                    });

                    e.style.maxHeight = bodyHeight + "px";
                }
            }, grids);
        }
    };

    catalog.register("components", "formWidget", formWidget.component);
    module.exports = formWidget;

}());