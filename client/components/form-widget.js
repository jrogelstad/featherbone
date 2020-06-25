/*
    Framework for building object relational database apps
    Copyright (C) 2020  John Rogelstad

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
    @module FormWidget
*/
import f from "../core.js";

const catalog = f.catalog();
const formWidget = {};
const m = window.m;
const console = window.console;

function buildButtons(vm) {
    let ret;
    let className;
    let lonelyTabClass = [
        "pure-button",
        "fb-group-tab",
        "fb-group-tab-form"
    ];
    let midTabClass = f.copy(lonelyTabClass);
    let leftTabClass = f.copy(lonelyTabClass);
    let rightTabClass = f.copy(lonelyTabClass);
    let tabs = vm.config().tabs || [];
    let last = tabs.length - 1;

    tabs = tabs.map((tab) => tab.name);

    if (tabs.length > 1) {
        midTabClass.push("fb-group-tab-middle");
        leftTabClass.push("fb-group-tab-left");
        rightTabClass.push("fb-group-tab-right");

        ret = tabs.map(function (name, idx) {
            switch (idx) {
            case 0:
                className = leftTabClass;
                break;
            case last:
                className = rightTabClass;
                break;
            default:
                className = f.copy(midTabClass);
            }

            if (idx + 1 === vm.selectedTab()) {
                className.push("fb-group-tab-active");
            }

            return m("button", {
                class: className.join(" "),
                onclick: vm.selectedTab.bind(null, idx + 1)
            }, name);
        });
        // One button only gets all four corners rounded
    } else {
        lonelyTabClass.push("fb-group-tab-lonely");
        lonelyTabClass.push("fb-group-tab-active");

        return m("button", {
            class: lonelyTabClass.join(" "),
            onclick: vm.selectedTab.bind(null, 1)
        }, tabs[0]);
    }

    return ret;
}

function buildFieldset(vm, attrs) {
    return attrs.map(function (item) {
        let result;
        let labelOpts;
        let label;
        let key = item.attr;
        let model = vm.model();
        let prop = model.data[key];
        if (!prop) {
            console.error("Unknown attribute " + key + " in form");
            return;
        }
        let dataList = item.dataList || prop.dataList;
        let value = prop();
        let options = {
            height: item.height
        };
        let menuButtons = vm.menuButtons();
        let relation = vm.relations()[key];

        function openMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (relation && relation.model && !relation.model()) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        function editMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (
                relation && relation.isReadOnly &&
                relation.isReadOnly()
            ) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        function newMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (
			    (relation && relation.isReadOnly && relation.isReadOnly()) ||
                !relation.canCreate()
            ) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        options.disableCurrency = item.disableCurrency;

        if (dataList) {
            // If reference a property, get the property
            if (typeof dataList === "string") {
                dataList = model.data[dataList]();

            // Must referencoe a simple array, transform
            } else if (typeof dataList[0] !== "object") {
                dataList = dataList.map(function (item) {
                    return {value: item, label: item};
                });
            }
        }

        labelOpts = {
            for: key,
            key: key + "FormLabel",
            class: "fb-form-label",
            style: {},
            title: prop.description
        };

        // For relations we get buttons for label
        if (relation && relation.isRelationWidget) {
            if (!menuButtons[key]) {
                menuButtons[key] = {
                    display: "none"
                };
            }

            labelOpts.class = "pure-button fb-form-label-button";
            labelOpts.onclick = function () {
                menuButtons[key].display = "block";
            };
            labelOpts.onmouseout = function (ev) {
                if (
                    !ev || !ev.toElement ||
                    !ev.toElement.id ||
                    ev.toElement.id.indexOf(
                        "nav-relation"
                    ) === -1
                ) {
                    menuButtons[key].display = "none";
                }
            };
            label = m("div", labelOpts, [
                m("div", {
                    id: "nav-relation-div-" + key,
                    class: "pure-menu fb-relation-menu"
                }, [
                    m("ul", {
                        class: "pure-menu-list fb-relation-menu-list",
                        id: "nav-relation-list-" + key,
                        style: {
                            top: "27px",
                            display: menuButtons[key].display
                        }
                    }, [
                        m("li", {
                            id: "nav-relation-search-" + key,
                            class: editMenuClass(),
                            onclick: relation.search
                        }, [m("i", {
                            id: "nav-relation-search-icon-" + key,
                            class: "fa fa-search"
                        })], " Search"),
                        m("li", {
                            id: "nav-relation-open-" + key,
                            class: openMenuClass(),
                            onclick: relation.open
                        }, [m("i", {
                            id: "nav-relation-open-icon-" + key,
                            class: "fa fa-folder-open"
                        })], " Open"),
                        m("li", {
                            id: "nav-relation-new-" + key,
                            class: newMenuClass(),
                            onclick: relation.new
                        }, [m("i", {
                            id: "nav-relation-new-icon-" + key,
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
        }

        if (vm.focusAttr() === key) {
            options.oncreate = function (vnode) {
                document.getElementById(vnode.dom.id).focus();
            };
        }

        if (
            prop.isRequired() && (
                value === null || (prop.type === "string" && !value)
            )
        ) {
            labelOpts.style.color = "Red";
        }
        result = m("div", {
            class: "pure-control-group"
        }, [
            label,
            f.createEditor({
                model: model,
                key: key,
                dataList: dataList,
                filter: item.filter,
                viewModel: vm,
                options: options,
                widget: item.relationWidget
            })
        ]);
        return result;
    });
}

function resize(vm, vnode) {
    let e = document.getElementById(vnode.dom.id);
    let bodyHeight = window.innerHeight;
    let eids = vm.outsideElementIds();

    eids.forEach(function (id) {
        let h = document.getElementById(id).clientHeight;
        bodyHeight = bodyHeight.minus(h);
    });

    e.style.maxHeight = bodyHeight - 5 + "px";
}

function buildUnit(vm, attrs, n) {
    let fieldset = buildFieldset(vm, attrs);

    return m("div", {
        class: "pure-u-1 pure-u-md-1-" + n
    }, [
        m("div", {
            class: "pure-form pure-form-aligned"
        }, [m("fieldset", fieldset)])
    ]);
}

function buildGrid(grid, idx) {
    let units;
    let vm = this;
    let className = "fb-tabbed-panes fb-tabbed-panes-form";

    units = grid.map(function (unit) {
        return buildUnit(vm, unit, grid.length);
    });

    if (!idx) {
        return m("div", {
            class: "pure-g fb-top-pane"
        }, units);
    }

    if (idx !== vm.selectedTab()) {
        className += " fb-tabbed-panes-hidden";
    }

    return m("div", {
        class: className
    }, [
        buildButtons(vm),
        m("div", {
            class: "pure-g fb-tabbed-pane"
        }, units)
    ]);
}

/**
    @class FormWidget
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {Object} [options.config] Layout configuration
    @param {String} [options.config.focus] Focus attribute
    @param {String} [options.containerId]
    @param {String} [options.isScrollable]
    @param {Array} [options.outsideElementIds]
*/
formWidget.viewModel = function (options) {
    let model;
    let modelState;
    let vm = {};

    /**
        Layout configuration.
        @method config
        @param {Object} [config]
        @return {Object}
    */
    vm.config = f.prop(options.config);
    /**
        @method containerId
        @param {String} [id]
        @return {String}
    */
    vm.containerId = f.prop(options.containerId);
    /**
        @method errorDialog
        @param {ViewModels.Dialog} [dialog]
        @return {ViewModels.Dialog}
    */
    vm.errorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "exclamation-circle",
        title: "Error"
    }));
    vm.errorDialog().buttonCancel().hide();
    /**
        @method isScrollable
        @param {Boolean} [flag]
        @return {Boolean}
    */
    vm.isScrollable = f.prop(options.isScrollable !== false);
    /**
        @method focusAttr
        @param {String} [attr]
        @return {String}
    */
    vm.focusAttr = f.prop(options.config.focus);
    /**
        @method menuButtons
        @param {Array} [buttons]
        @return {Array}
    */
    vm.menuButtons = f.prop({});
    /**
        @method selectedTab
        @param {Integer} [index]
        @return {Integer}
    */
    vm.selectedTab = f.prop(1);
    /**
        @method model
        @param {Model} [model]
        @return {Model}
    */
    vm.model = f.prop();
    /**
        @method outsideElementIds
        @param {String} [id]
        @return {String}
    */
    vm.outsideElementIds = f.prop(options.outsideElementIds || []);

    /**
        Places to store relation content between redraws
        @method relations
        @param {Object} [relations]
        @return {Object}
    */
    vm.relations = f.prop({});
    /**
        Places to store selector components between redraws
        @method selectComponents
        @param {Object} [components]
        @return {Object}
    */
    vm.selectComponents = f.prop({});

    // ..........................................................
    // PRIVATE
    //
    if (typeof options.model === "object") {
        vm.model(options.model);
    } else {
        model = vm.model(f.createModel(
            options.model.toCamelCase(true)
        ));
        if (options.id) {
            model.id(options.id);
            if (!options.isNew) {
                model.fetch();
                model.checkUpdate();
            }
        }
    }

    // Bind model state to error event
    modelState = vm.model().state();
    modelState.resolve("/Ready").enter(function () {
        let err = vm.model().lastError();

        if (err) {
            vm.errorDialog().message(err.message);
            vm.errorDialog().show();
        }
    });

    // Subscribe to external events
    vm.model().subscribe(true);

    return vm;
};

catalog.register("viewModels", "formWidget", formWidget.viewModel);

/**
    @class FormWidget
    @static
    @namespace Components
*/
formWidget.component = {
    /**
        Pass either `vnode.attrs.viewModel` or `vnode.attrs` with options
        to build view model.

        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs
        @param {Object} vnode.attrs.viewModel
    */
    oninit: function (vnode) {
        this.viewModel = vnode.attrs.viewModel;
    },

    /**
        Makes sure subscriptions are ceased when done.
        @method onremove
    */
    onremove: function () {
        // Unsubscribe model when we're done here
        this.viewModel.model().subscribe(false);
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} View
    */
    view: function (vnode) {
        let vm = vnode.attrs.viewModel;
        let attrs = vm.config().attrs || [];
        let model = vm.model();
        let grids = [];

        // build grid matrix from inside out
        attrs.forEach(function (item) {
            let gidx = item.grid || 0;
            let uidx = item.unit || 0;
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

        grids.unshift(m(f.getComponent("Dialog"), {
            viewModel: vm.errorDialog()
        }));

        return m("div", {
            id: model.id(),
            class: (
                vm.isScrollable()
                ? "fb-form-content"
                : ""
            ),
            oncreate: resize.bind(null, vm),
            onupdate: resize.bind(null, vm)
        }, grids);
    }
};

catalog.register("components", "formWidget", formWidget.component);

export default Object.freeze(formWidget);