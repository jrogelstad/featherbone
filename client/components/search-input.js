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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    @module SearchInput
*/

const searchInput = {};

/**
    @class SearchInput
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {Function} [options.refresh] Refresh function
*/
searchInput.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};

    /**
        Clear search box.
        @method clear
    */
    vm.clear = function () {
        vm.text("");
        vm.end();
    };
    /**
        Turn search off.
        @method end
    */
    vm.end = function () {
        state.send("end");
    };
    /**
        @method id
        @param {String} id
        @return {String}
    */
    vm.id = f.prop(f.createId());
    /**
        @method onkeydown
        @param {Event} event
    */
    vm.onkeydown = function (e) {
        let key = e.key || e.keyIdentifier;
        if (key === "Enter") {
            vm.refresh();
        }
    };
    /**
        Excute refresh function passed in via options.
        @method refresh
    */
    vm.refresh = function () {
        if (options.refresh) {
            options.refresh();
        }
    };
    /**
        Turn search on.
        @method start
    */
    vm.start = function () {
        state.send("start");
    };

    /**
        Statechart.
        @method state
        @return {State}
    */
    vm.state = function () {
        return state;
    };

    /**
        @method style
        @param {Object} id
        @return {Object}
    */
    vm.style = function () {
        return state.resolve(state.current()[0]).style();
    };

    /**
        Search text
        @method text
        @param {String} text
        @return {String}
    */
    vm.text = f.prop();

    /**
        Search value (dependent on state).
        @method value
        @return {String}
    */
    vm.value = function () {
        return state.resolve(state.current()[0]).value();
    };

    // ..........................................................
    // PRIVATE
    //

    // Define statechart
    state = f.State.define(function () {
        this.state("Search", function () {
            this.state("Off", function () {
                this.enter(function () {
                    vm.text("Search");
                });
                this.event("start", function () {
                    this.goto("../On");
                });
                this.style = function () {
                    return {
                        color: "LightGrey",
                        margin: "2px"
                    };
                };
                this.value = function () {
                    return "";
                };
            });
            this.state("On", function () {
                this.enter(function () {
                    vm.text("");
                });
                this.exit(function () {
                    vm.refresh();
                });
                this.canExit = function () {
                    return !vm.text();
                };
                this.event("end", function () {
                    this.goto("../Off");
                });
                this.style = function () {
                    return {
                        color: "Black",
                        margin: "2px"
                    };
                };
                this.value = function () {
                    return vm.text();
                };
            });
        });
    });
    state.goto();

    return vm;
};

f.catalog().register("viewModels", "searchInput", searchInput.viewModel);

/**
    Search component.
    @class SearchInput
    @static
    @namespace Components
*/
searchInput.component = {
    /**
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs Options]
        @param {ViewModels.SearchInput} [vnode.attrs.viewModel]
        @param {Function} [vnode.attrs.refresh]
    */
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || searchInput.viewModel(vnode.attrs)
        );
    },
    /**
        @method view
        @return {Object} View
    */
    view: function () {
        let vm = this.viewModel;

        return m("input", {
            id: vm.id(),
            value: vm.text(),
            class: "fb-search-input",
            style: vm.style(),
            onfocus: vm.start,
            onblur: vm.end,
            oninput: (e) => vm.text(e.target.value),
            onkeydown: vm.onkeydown,
            autocomplete: "off"
        });
    }
};

f.catalog().register("components", "searchInput", searchInput.component);

