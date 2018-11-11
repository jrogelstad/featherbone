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
/*jslint es6, this, browser*/
(function () {
    "use strict";

    var navigator = {},
        m = require("mithril"),
        catalog = require("catalog"),
        stream = require("stream"),
        statechart = require("statechartjs");

    navigator.viewModel = function (options) {
        options = options || {};
        var vm, state;

        // ..........................................................
        // PUBLIC
        //

        vm = {};

        vm.workbooks = catalog.store().workbooks;
        vm.goHome = function () {
            m.route.set("/home");
        };
        vm.goto = function () {
            var config = this.getConfig();

            m.route.set("/workbook/:workbook/:key", {
                workbook: this.data.name().toSpinalCase(),
                key: config[0].name.toSpinalCase()
            });
        };
        vm.mouseoverKey = stream();
        vm.mouseout = function () {
            vm.mouseoverKey(undefined);
        };
        vm.mouseover = function () {
            vm.mouseoverKey(this);
        };
        vm.toggle = function () {
            state.send("toggle");
        };
        vm.class = function () {
            return state.resolve(state.current()[0]).class;
        };
        vm.state = stream();

        // ..........................................................
        // PRIVATE
        //

        // Define state
        state = statechart.define(function () {
            this.state("Shown", function () {
                this.event("toggle", function () {
                    this.goto("../Hidden");
                });
                this.class = "pure-menu suite-navigator-menu";
            });
            this.state("Hidden", function () {
                this.event("toggle", function () {
                    this.goto("../Shown");
                });
                this.class = "pure-menu suite-navigator-menu suite-navigator-menu-hidden";
            });
        });
        vm.state(state);
        state.goto();

        return vm;
    };

    // Define navigator component
    navigator.component = {
        oninit: function (vnode) {
            var vm = vnode.attrs.viewModel || navigator.viewModel(vnode.attrs);
            this.viewModel = vm;
        },

        view: function () {
            var menuItems, itemStyle, itemClass,
                    vm = this.viewModel,
                    workbooks = vm.workbooks();

            function items(key) {
                itemClass = "pure-menu-item suite-navigator-item";

                if (vm.mouseoverKey() === key) {
                    itemClass += " suite-navigator-item-mouseover";
                }

                return m("li", {
                    class: itemClass,
                    onclick: vm.goto.bind(workbooks[key]),
                    onmouseover: vm.mouseover.bind(key),
                    onmouseout: vm.mouseout
                }, [
                    m("i", {
                        class: "fa fa-" + workbooks[key].data.launchConfig().icon,
                        style: itemStyle
                    })
                ], workbooks[key].data.name());
            }

            itemStyle = {
                margin: "8px",
                minWidth: "18px"
            };

            menuItems = Object.keys(workbooks).map(items);

            itemClass = "pure-menu-item suite-navigator-item";
            if (vm.mouseoverKey() === "home") {
                itemClass += " suite-navigator-item-mouseover";
            }

            menuItems.unshift(
                m("li", {
                    class: itemClass,
                    onclick: vm.goHome,
                    onmouseover: vm.mouseover.bind("home"),
                    onmouseout: vm.mouseout
                }, [
                    m("i", {
                        class: "fa fa-home",
                        style: itemStyle
                    })
                ], "Home")
            );

            return m("div", {
                class: vm.class()
            }, "Suite Sheets", [
                m("ul", {
                    class: "pure-menu-list"
                }, menuItems)
            ]);
        }
    };

    module.exports = navigator;

}());