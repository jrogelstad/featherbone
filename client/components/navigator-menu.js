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
/*jslint this, browser, bitwise, unordered*/
/*global f, m*/
/**
    @module NavigatorMenu
*/

const selected = f.prop();
const navigator = {};

// Define state (global)
const state = f.State.define(function () {
    function navmode() {
        switch (f.currentUser().mode) {
        case "test":
            return "fb-navigator-menu-test ";
        case "dev":
            return "fb-navigator-menu-dev ";
        }
        return "";
    }

    this.state("Expanded", function () {
        this.event("toggle", function () {
            this.goto("../Collapsed");
        });
        this.classMenu = function () {
            return (
                "pure-menu fb-navigator-menu " +
                navmode()
            );
        };
        this.classHeader = "";
        this.classHeaderIcon = (
            "material-icons-outlined " +
            "fb-navigator-header-icon " +
            "fb-navigator-header-icon-expanded"
        );
        this.icon = "chevron_left";
        this.content = function (value) {
            return value;
        };
        this.title = function (value) {
            return value;
        };
    });
    this.state("Collapsed", function () {
        this.event("toggle", function () {
            this.goto("../Expanded");
        });
        this.classMenu = function () {
            return (
                "pure-menu fb-navigator-menu " +
                navmode()
            );
        };
        this.classHeader = "fb-navigator-menu-header-collapsed";
        this.classHeaderIcon = (
            "material-icons-outlined " +
            "fb-navigator-header-icon"
        );
        this.icon = "expand_more";
        this.content = function () {
            return undefined;
        };
        this.title = function (value) {
            return value;
        };
    });
});
state.goto();

/**
    Menu navigator view model. Menu state is managed globally.
    @class NavigatorMenu
    @constructor
    @namespace ViewModels
*/
navigator.viewModel = function () {
    let vm;

    // ..........................................................
    // PUBLIC
    //

    vm = {};

    /**
        Workbook index.
        @method workbooks
        @return {Object}
    */
    vm.workbooks = function () {
        let wbs = f.catalog().store().workbooks();
        let ret = {};
        Object.keys(wbs).forEach(function (key) {
            if (!wbs[key].data.isTemplate()) {
                ret[key] = wbs[key];
            }
        });
        return ret;
    };

    /**
        @method goHome
    */
    vm.goHome = function () {
        m.route.set("/home");
    };
    /**
        Go to selected workbook.
        @method goto
    */
    vm.goto = function () {
        let config = this.getConfig();
        let wb = this.data.name().toSpinalCase();
        let pg = config[0].name.toSpinalCase();

        m.route.set("/workbook/:workbook/:page", {
            workbook: wb,
            page: pg,
            key: f.hashCode(wb + "-" + pg)
        });
    };

    /**
        Menu name.
        @method itemContent
        @param {String} name
        @return {String}
    */
    vm.itemContent = function (value) {
        return state.resolve(state.current()[0]).content(value);
    };
    /**
        @method title
        @param {String} title
        @return {String}
    */
    vm.itemTitle = function (value) {
        return state.resolve(state.current()[0]).title(value);
    };
    /**
        Menu currently hovered over.
        @method mouseoverKey
        @param {String} key
        @return {String}
    */
    vm.mouseoverKey = f.prop();
    /**
        @method mouseout
    */
    vm.mouseout = function () {
        vm.mouseoverKey(undefined);
    };
    /**
        @method mouseover
    */
    vm.mouseover = function () {
        vm.mouseoverKey(this);
    };
    /**
        Toggle collapsed or expanded.
        @method toggle
    */
    vm.toggle = function () {
        state.send("toggle");
    };
    /**
        @method classHeader
        @return {String}
    */
    vm.classHeader = function () {
        return state.resolve(state.current()[0]).classHeader;
    };
    /**
        @method classHeaderIcon
        @return {String}
    */
    vm.classHeaderIcon = function () {
        return state.resolve(state.current()[0]).classHeaderIcon;
    };
    /**
        @method classMenu
        @return {String}
    */
    vm.classMenu = function () {
        return state.resolve(state.current()[0]).classMenu();
    };
    /**
        @method headerIcon
        @return {String}
    */
    vm.headerIcon = function () {
        return state.resolve(state.current()[0]).icon;
    };
    /**
        @method selected
        @param {String} name
        @return {String}
    */
    vm.selected = selected;
    /**
        Menu statechart.
        @method state
        @param {State} state
        @return {State}
    */
    vm.state = f.prop(state);

    // ..........................................................
    // PRIVATE
    //

    return vm;
};

f.catalog().register("viewModels", "navigatorMenu", navigator.viewModel);

/**
    @class NavigatorMenu
    @static
    @namespace Components
*/
navigator.component = {
    /**
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs Options]
        @param {ViewModels.NavigatorMenu} [vnode.attrs.viewModel]
    */
    oninit: function (vnode) {
        let vm = vnode.attrs.viewModel || navigator.viewModel(vnode.attrs);
        this.viewModel = vm;
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let menuItems;
        let itemClass;
        let vm = this.viewModel;
        let workbooks = vm.workbooks();
        let keys;

        function items(key) {
            let wd = workbooks[key].data;
            let label = wd.label() || wd.name();
            let desc = wd.description();

            itemClass = "pure-menu-item fb-navigator-item";

            if (vm.selected() && vm.selected() === key) {
                itemClass += " fb-navigator-item-selected";
            } else if (vm.mouseoverKey() === key) {
                itemClass += " fb-navigator-item-mouseover";
            }

            return m("li", {
                class: itemClass,
                onclick: vm.goto.bind(workbooks[key]),
                onmouseover: vm.mouseover.bind(key),
                onmouseout: vm.mouseout,
                title: vm.itemTitle(desc)
            }, [
                m("i", {
                    class: (
                        "material-icons-outlined " +
                        "fb-navigator-item-icon"
                    )
                }, workbooks[key].data.icon())
            ], vm.itemContent(label));
        }

        keys = Object.keys(workbooks).sort(function (a, b) {
            let aVal = workbooks[a].data.sequence() || 0;
            let bVal = workbooks[b].data.sequence() || 0;
            return aVal - bVal;
        });
        menuItems = keys.map(items);

        itemClass = "pure-menu-item fb-navigator-item";
        if (vm.selected() === "home") {
            itemClass += " fb-navigator-item-selected";
        } else if (vm.mouseoverKey() === "home") {
            itemClass += " fb-navigator-item-mouseover";
        }

        menuItems.unshift(
            m("li", {
                class: itemClass,
                onclick: vm.goHome,
                onmouseover: vm.mouseover.bind("home"),
                onmouseout: vm.mouseout,
                title: vm.itemTitle("Home")
            }, [
                m("i", {
                    class: "material-icons-outlined fb-navigator-item-icon"
                }, "home")
            ], vm.itemContent("Home"))
        );

        return m("div", {
            class: vm.classMenu()
        }, [
            m("div", {
                class: vm.classHeader()
            }, "Featherbone", [
                m("i", {
                    class: vm.classHeaderIcon(),
                    onclick: vm.toggle
                }, vm.headerIcon())
            ]),
            m("ul", {
                class: "pure-menu-list"
            }, menuItems)
        ]);
    }
};

f.catalog().register("components", "navigatorMenu", navigator.component);

