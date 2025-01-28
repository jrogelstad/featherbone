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
/*jslint this browser unordered*/
/*global f, m*/
/**
    @module FormWidget
*/

const formWidget = {};
const HORIZONTAL_TABS = "H";
const VERTICAL_SECTIONS = "V";

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
    let childTableItems = [];
    // Make child tables fixed if there's more than
    // one as autosize is wonkey otherwise
    attrs.forEach(function (item) {
        let prop = vm.model().data[item.attr];
        if (prop && prop.isToMany()) {
            childTableItems.push(item);
        }
    });

    if (
        childTableItems.length > 1 ||
        vm.config().orientation === VERTICAL_SECTIONS
    ) {
        childTableItems.forEach(function (item) {
            item.height = f.TABLE_MIN_HEIGHT + "px";
        });
    }
    return attrs.map(function (item) {
        let result;
        let labelOpts;
        let label;
        let theKey = item.attr;
        let theModel = vm.model();
        let prop = theModel.data[theKey];
        if (!prop) {
            window.console.error("Unknown attribute " + theKey + " in form");
            return;
        }
        let theDataList = item.dataList || prop.dataList;
        let value = prop();
        let theOptions = {height: item.height};
        let menuButtons = vm.menuButtons();
        let relation = vm.relations()[theKey];

        function canOpen() {
            return relation && relation.model && relation.model();
        }

        function openMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (!canOpen()) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        function canEdit() {
            return relation && relation.isReadOnly && !relation.isReadOnly();
        }

        function editMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (!canEdit()) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        function canCreate() {
            return (
                relation &&
                relation.isReadOnly &&
                !relation.isReadOnly() &&
                relation.canCreate()
            );
        }

        function newMenuClass() {
            let ret = "pure-menu-link fb-form-label-menu-item";

            if (!canCreate()) {
                ret += " pure-menu-disabled";
            }

            return ret;
        }

        theOptions.disableCurrency = item.disableCurrency;

        if (theDataList) {
            // If reference a property, get the property
            if (typeof theDataList === "string") {
                theDataList = theModel.data[theDataList]();

            // Must referencoe a simple array, transform
            } else if (typeof theDataList[0] !== "object") {
                theDataList = theDataList.map(function (item) {
                    return {value: item, label: item};
                });
            }
        }

        labelOpts = {
            for: theKey,
            key: theKey + "FormLabel",
            class: "fb-form-label",
            style: {}
        };

        // For relations we get buttons for label
        if (relation && relation.isRelationWidget) {
            if (!menuButtons[theKey]) {
                menuButtons[theKey] = {
                    display: "none"
                };
            }

            labelOpts.fbtitle = prop.description;
            labelOpts.class = (
                "pure-button fb-form-label-button fb-tags " +
                "fb-button-tags"
            );
            labelOpts.onclick = function () {
                menuButtons[theKey].display = "block";
            };
            labelOpts.onmouseout = function (ev) {
                if (
                    !ev || !ev.relatedTarget ||
                    !ev.relatedTarget.id ||
                    ev.relatedTarget.id.indexOf(
                        "nav-relation"
                    ) === -1
                ) {
                    menuButtons[theKey].display = "none";
                }
            };
            label = m("div", labelOpts, [
                m("div", {
                    id: "nav-relation-div-" + theKey,
                    class: "pure-menu fb-relation-menu"
                }, [
                    m("ul", {
                        class: "pure-menu-list fb-relation-menu-list",
                        id: "nav-relation-list-" + theKey,
                        style: {
                            top: "27px",
                            display: menuButtons[theKey].display
                        }
                    }, [
                        m("li", {
                            id: "nav-relation-search-" + theKey,
                            class: editMenuClass(),
                            onclick: (
                                canEdit()
                                ? function () {
                                    menuButtons[theKey].display = "none";
                                    relation.search();
                                    return false; // Stop propagation
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-search-icon-" + theKey,
                            class: "material-icons fb-menu-list-icon"
                        }, "search")], " Search"),
                        m("li", {
                            id: "nav-relation-open-" + theKey,
                            class: openMenuClass(),
                            onclick: (
                                canOpen()
                                ? function () {
                                    menuButtons[theKey].display = "none";
                                    relation.open();
                                    return false; // Stop propagation
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-open-icon-" + theKey,
                            class: "material-icons fb-menu-list-icon"
                        }, "file_open")], " Open"),
                        m("li", {
                            id: "nav-relation-new-" + theKey,
                            class: newMenuClass(),
                            onclick: (
                                canCreate()
                                ? function () {
                                    menuButtons[theKey].display = "none";
                                    relation.new();
                                    return false; // Stop propagation
                                }
                                : undefined
                            )
                        }, [m("i", {
                            id: "nav-relation-new-icon-" + theKey,
                            class: "material-icons fb-menu-list-icon"
                        }, "add_circle")], " New")
                    ])
                ]),
                m("div", {
                    class: "material-icons fb-form-label-button-icon"
                }, "menu")
            ], item.label || prop.alias() + ":");
        } else {
            label = m(
                "label",
                labelOpts,
                [
                    m("a", {
                        class: "fb-tags",
                        fbtitle: prop.description
                    }, (item.label || prop.alias()) + ":")
                ]
            );
        }

        if (item.showLabel === false) {
            labelOpts.style.display = "none";
        }

        if (!prop.isReadOnly() && !vm.focusAttr()) {
            vm.focusAttr(theKey);
        }

        if (vm.focusAttr() === theKey) {
            theOptions.oncreate = function (vnode) {
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
                model: theModel,
                key: theKey,
                dataList: theDataList,
                filter: item.filter,
                viewModel: vm,
                options: theOptions,
                widget: item.relationWidget
            })
        ]);
        return result;
    });
}

/*
function resizeWidget(vm, vnode) {
    let e = document.getElementById(vnode.dom.id);
    let height = vm.height();
    let maxHeight = vm.maxHeight();
    if (height) {
        e.style.height = height;
        return;
    }
    if (maxHeight) {
        e.style.maxHeight = maxHeight;
        return;
    }
    let bodyHeight = window.innerHeight;
    let eids = vm.outsideElementIds();

    if (!e) {
        return;
    }

    eids.forEach(function (id) {
        let h = document.getElementById(id).clientHeight;
        bodyHeight = bodyHeight.minus(h);
    });

    e.style.maxHeight = bodyHeight - 5 + "px";
}
*/

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
    let header;
    let orient = vm.config().orientation || HORIZONTAL_TABS;

    if (orient === HORIZONTAL_TABS) {
        header = buildButtons(vm);
    } else if (idx) {
        header = m("div", {
            style: {padding: ".5em 1em", display: "inline-block"},
            class: "fb-group-tab fb-group-tab-form fb-group-tab-active"
        }, vm.config().tabs[idx - 1].name);
    }

    units = grid.map(function (unit) {
        return buildUnit(vm, unit, grid.length);
    });

    if (!idx) {
        return m("div", {
            class: "pure-g fb-top-pane"
        }, units);
    }

    if (
        orient === HORIZONTAL_TABS &&
        idx !== vm.selectedTab()
    ) {
        className += " fb-tabbed-panes-hidden";
    }

    return m("div", {
        class: className
    }, [
        header,
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
    @param {Boolean} [options.isScrollable]
    @param {Object} [options.style]
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
        icon: "report_problem",
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
        Fixed max height of the form.

        @method maxHeight
        @param {String} [max height]
        @return {String}
    */
    vm.maxHeight = f.prop(options.maxHeight);
    /**
        Fixed min height of the form.

        @method height
        @param {String} [height]
        @return {String}
    */
    vm.height = f.prop(options.height);
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
        @method parentViewModel
        @param {Object} [viewModel]
        @return {Object}
    */
    vm.parentViewModel = f.prop(options.parent);
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
    /**
        Style over-rides
        @method style
        @param {Object} style
        @return {Object}
    */
    vm.style = f.prop(options.style || {});

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
                model.checkCreate();
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
    if (vm.model().state().current()[0] === "/Ready/New") {
        vm.model().state().resolve("/Ready/Fetched/Clean").enter(function () {
            if (!vm.model().subscribe()) {
                vm.model().subscribe(true);
            }
        });
    } else {
        vm.model().subscribe(true);
    }

    return vm;
};

f.catalog().register("viewModels", "formWidget", formWidget.viewModel);

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
            style: vm.style(),
            class: (
                vm.isScrollable()
                ? "fb-form-content"
                : ""
            ),
            //oncreate: resizeWidget.bind(null, vm),
            //onupdate: resizeWidget.bind(null, vm)
        }, grids);
    }
};

f.catalog().register("components", "formWidget", formWidget.component);
