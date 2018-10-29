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
/*jslint this, browser*/
/*global window, require, module*/
(function () {
    "use strict";

    var formWidget = {},
        m = require("mithril"),
        stream = require("stream"),
        f = require("component-core"),
        catalog = require("catalog"),
        dialog = require("dialog");

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
        vm.selectedTab = stream(1);
        vm.model = stream();
        vm.outsideElementIds = stream(options.outsideElementIds || []);
        vm.relations = stream({});

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
            var focusAttr, buildFieldset, buildUnit, buildButtons,
                    midTabClass = ["pure-button", "suite-sheet-group-tab", "suite-sheet-group-tab-form"],
                    leftTabClass = f.copy(midTabClass),
                    rightTabClass = f.copy(midTabClass),
                    vm = vnode.attrs.viewModel,
                    attrs = vm.config().attrs || [],
                    selectedTab = vm.selectedTab(),
                    model = vm.model(),
                    d = model.data,
                    grids = [];

            midTabClass.push("suite-sheet-group-tab-middle");
            leftTabClass.push("suite-sheet-group-tab-left");
            rightTabClass.push("suite-sheet-group-tab-right");

            buildButtons = function () {
                var className,
                    tabs = vm.config().tabs || [],
                    last = tabs.length - 1;

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

                    if (idx + 1 === selectedTab) {
                        className.push("suite-sheet-group-tab-active");
                    }
                    return m("button", {
                        class: className.join(" "),
                        onclick: vm.selectedTab.bind(this, idx + 1)
                    }, name);
                });
            };

            // Build elements
            buildFieldset = function (attrs) {
                return attrs.map(function (item) {
                    var result, labelOpts, dataList,
                            key = item.attr,
                            cfilter = item.filter,
                            prop = d[key],
                            value = prop(),
                            options = {};

                    if (item.dataList) {
                        dataList = f.resolveProperty(model, item.dataList)();
                    }

                    labelOpts = {
                        for: key,
                        class: "suite-form-label",
                        style: {}
                    };

                    if (item.showLabel === false) {
                        labelOpts.style.display = "none";
                    }

                    if (!prop.isReadOnly() && !focusAttr) {
                        focusAttr = key;
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
                        m("label", labelOpts,
                                item.label || prop.alias() + ":"),
                        f.buildInputComponent({
                            model: model,
                            key: key,
                            dataList: dataList,
                            filter: cfilter,
                            viewModel: vm,
                            options: options
                        })
                    ]);
                    return result;
                });
            };

            buildUnit = function (attrs, n) {
                var fieldset = buildFieldset(attrs);

                return m("div", {
                    class: "pure-u-1 pure-u-md-1-" + n
                }, [
                    m("div", {
                        class: "pure-form pure-form-aligned"
                    }, [m("fieldset", fieldset)])
                ]);
            };

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
            grids = grids.map(function (grid, idx) {
                var units,
                    className = "suite-tabbed-panes suite-tabbed-panes-form";

                units = grid.map(function (unit) {
                    return buildUnit(unit, grid.length);
                });

                if (!idx) {
                    return m("div", {
                        class: "pure-g suite-top-pane"
                    }, units);
                }

                if (idx !== selectedTab) {
                    className += " suite-tabbed-panes-hidden";
                }

                return m("div", {
                    class: className
                }, [
                    buildButtons(),
                    m("div", {
                        class: "pure-g suite-tabbed-pane"
                    }, units)
                ]);
            });

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
                        bodyHeight = Math.subtract(bodyHeight, h);
                    });

                    e.style.maxHeight = bodyHeight + "px";
                }
            }, grids);
        }
    };

    catalog.register("components", "formWidget", formWidget.component);
    module.exports = formWidget;

}());