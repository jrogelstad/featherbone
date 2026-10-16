/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
/*jslint node, unordered*/
/**
    @module Serialize
*/
(function (exports) {
    "use strict";

    /**
        Wrap an async function so that calls run one at a time, in the
        order they arrive, each getting its own result (or its own
        error). A failure does not stop the calls behind it.

        Used where a step is "look at shared state, wait on something,
        then change it": run twice at once, both calls look before
        either has changed anything, and both go on to make the same
        thing. Reading the registry is that kind of step -- a new
        instance is looked for, connected to, then added, and the
        registry is read again by the route that registered it and by
        the change event that registering raised, at the same moment.

        @method serialize
        @param {Function} fn Async function
        @return {Function} Same signature, one at a time
    */
    exports.serialize = function (fn) {
        let tail = Promise.resolve();

        return function () {
            let args = arguments;
            let self = this;
            let run = tail.then(function () {
                return fn.apply(self, args);
            });

            tail = run.then(
                () => undefined,
                () => undefined
            );

            return run;
        };
    };

}(exports));
