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
import {f} from "../core.js";
import {stream} from "../../common/stream.js";
import {State} from "../../common/state.js";

const searchInput = {};
const m = window.m;

/**
  @param {Object} Options
  @param {Object} [options.style] Style
  @param {String} [options.icon] Icon name
  @param {Function} [options.onclick] On click function
*/
searchInput.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.clear = function () {
        vm.text("");
        vm.end();
    };
    vm.end = function () {
        state.send("end");
    };
    vm.id = stream(f.createId());
    vm.onkeydown = function (e) {
        let key = e.key || e.keyIdentifier;
        if (key === "Enter") {
            vm.refresh();
        }
    };
    vm.refresh = function () {
        if (options.refresh) {
            options.refresh();
        }
    };
    vm.start = function () {
        state.send("start");
    };
    vm.state = function () {
        return state;
    };
    vm.style = function () {
        return state.resolve(state.current()[0]).style();
    };
    vm.text = stream();
    vm.value = function () {
        return state.resolve(state.current()[0]).value();
    };

    // ..........................................................
    // PRIVATE
    //

    // Define statechart
    state = State.define(function () {
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

// Define dialog component
searchInput.component = {
    oninit: function (vnode) {
        this.viewModel = (
            vnode.attrs.viewModel || searchInput.viewModel(vnode.attrs)
        );
    },

    view: function () {
        let vm = this.viewModel;

        return m("input", {
            id: vm.id(),
            value: vm.text(),
            style: vm.style(),
            onfocus: vm.start,
            onblur: vm.end,
            oninput: (e) => vm.text(e.target.value),
            onkeydown: vm.onkeydown
        });
    }
};

export {searchInput};