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
/*global Promise*/
/*jslint node, es6*/
(function (exports) {
    "strict";

    exports.Tools = function () {
        var tools = {};

        // ..........................................................
        // PUBLIC
        //
        /**
          Clear out primmary keys and normalize data

          @param {Object} Data to sanitize
          @returns {Object} Sanitized object
        */
        tools.sanitize = function (obj) {
            var oldObj, newObj, oldKey, ary, len,
                    newKey, keys, klen, n,
                    isArray = Array.isArray(obj),
                    i = 0;

            if (isArray) {
                ary = obj;
            } else {
                ary = [obj];
            }
            len = ary.length;

            while (i < len) {
                if (typeof ary[i] === "string") {
                    i += 1;
                } else {
                    /* Copy to convert dates back to string for accurate comparisons */
                    oldObj = JSON.parse(JSON.stringify(ary[i]));
                    newObj = {};

                    keys = Object.keys(oldObj);
                    klen = keys.length;
                    n = 0;

                    while (n < klen) {
                        oldKey = keys[n];
                        n += 1;

                        /* Remove internal properties */
                        if (oldKey.match("^_")) {
                            delete oldObj[oldKey];
                        } else {
                            /* Make properties camel case */
                            newKey = oldKey.toCamelCase();
                            newObj[newKey] = oldObj[oldKey];

                            /* Recursively sanitize objects */
                            if (typeof newObj[newKey] === "object" && newObj[newKey] !== null) {
                                newObj[newKey] = tools.sanitize(newObj[newKey]);
                            }
                        }
                    }

                    ary[i] = newObj;
                    i += 1;
                }
            }

            return isArray
                ? ary
                : ary[0];
        };

        return tools;
    };

}(exports));

