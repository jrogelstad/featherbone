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
/*jslint this, devel, bitwise, browser*/
/*global window, require, module*/

(function () {
    "use strict";
    /**
        Core module

        @module Core
    */
    /**
        JSON object that defines filter criteria that can be passed to the
        server to define result sets to return in a query.

        __Example__

            // Filter to return records with
            // * Age of 10, name starts with "T"
            // * Sort by name ascending
            // * Return records 60-90
            let filter = {
                criteria: [{
                    property: "age"
                    value: 10
                }, {
                    property: "name",
                    operator: "~*",
                    value: "^T"
                ]
                sort: [{
                    property: "name"
                }],
                offset: 60,
                limit: 30
            }
        @class Filter
        @static
    */
    /**
        Filter criteria that is array of objects with `property`, `value`
        and optional `operator` which, if left out, defaults to `=`.
        Supported operators are:
        * __=__: Equals
        * __!=__: Not equals
        * __~__: Matches, case sensitive
        * __!~__: Not matches, case sensitive
        * __~*__: Matches, regular expressions supported
        * __!~*__: Not matches, regular expressions supported
        * __>__: Greater than
        * __<__: Less than,
        * __>=__: Greater than or equals
        * __<=__: Less than or equals
        * __IN__: In array

        @example
            // Criteria for age equals 10 and name starts with "T"
            let criteria = [{
                property: "age"
                value: 10
            }, {
                property: "name",
                operator: "~*",
                value: "^T"
            }];
        @property criteria
        @type Array
    */
    /**
        Number of records to return.
        @property limit
        @type integer
    */
    /**
        Offset number to start returning records for pagination.
        @property offset
        @type integer
        @optional
    */
    /**
        Filter sort that is array of objects with `property` and optional
        `order` of `ASC` (ascending) or `DESC` (descending) which defaults
        to `ASC`.
        @example
            // Sort by age descending, name ascending
            let sort = [{
                property: "age",
                order: "DESC"
            }, {
                property: "name"
            }];
        @property sort
        @type Array
        @optional
    */
    /**
        Featherbone global object.

        @class f
        @static
    */
    const that = {
        PRECISION_DEFAULT: 18,
        SCALE_DEFAULT: 8,

        /**
            Make a deep copy of an object.

            @method copy
            @param {Object} Object
            @return {Object}
        */
        copy: function (obj) {
            return JSON.parse(JSON.stringify(obj));
        },

        /**
            Return a unique identifier string.

            Modified from https://github.com/google/closure-library
            @author arv@google.com (Erik Arvidsson)
            http://www.apache.org/licenses/LICENSE-2.0

            @method createId
            @return {String}
        */
        createId: function () {
            let x = 2147483648;
            let d = new Date();
            let result;

            result = Math.floor(Math.random() * x).toString(36);
            result += Math.abs(Math.floor(Math.random() * x) ^ d).toString(36);

            return result;
        },

        dateOptions: [
            "TODAY",
            "BEFORE_TODAY",
            "ON_OR_BEFORE_TODAY",
            "ON_OR_AFTER_TODAY",
            "THIS_WEEK",
            "ON_OR_BEFORE_THIS_WEEK",
            "ON_OR_AFTER_THIS_WEEK",
            "THIS_MONTH",
            "ON_OR_BEFORE_THIS_MONTH",
            "ON_OR_AFTER_THIS_MONTH",
            "THIS_YEAR",
            "ON_OR_BEFORE_THIS_YEAR",
            "ON_OR_AFTER_THIS_YEAR",
            "YESTERDAY",
            "LAST_WEEK",
            "LAST_MONTH",
            "LAST_YEAR",
            "TOMORROW",
            "NEXT_WEEK",
            "NEXT_MONTH",
            "NEXT_YEAR"
        ],

        /**
            Returns date string "2100-12-31".

            @method endOfTime
            @return {String}
        */
        endOfTime: function () {
            return "2100-12-31";
        },

        /**
            Return Date object that accepts a ISO formatted "YYYY-MM-DD" string
            as the argument.

            @method ISODate
            @param {String}
            @return {Date}
            @deprecated This is identical to `parseDate`
        */
        isoDateToDate: function (str) {
            let year = str.slice(0, 4);
            let month = str.slice(5, 7) - 1;
            let day = str.slice(8, 10);
            return new Date(year, month, day);
        },

        /**
            Difference in calendar days between two dates
            excluding weekends.

            @method newWorkDays
            @param {Date|String} Start date
            @param {Date|String} End date
            @return {Integer}
        */
        netWorkDays: function (startDate, endDate) {
            startDate = (
                typeof startDate === "object"
                ? startDate
                : that.parseDate(startDate)
            );

            endDate = (
                typeof endDate === "object"
                ? endDate
                : that.parseDate(endDate)
            );

            if (endDate > startDate) {
                let days = Math.ceil(
                    (
                        endDate.setHours(23, 59, 59, 999) -
                        startDate.setHours(0, 0, 0, 1)
                    ) /
                    (86400 * 1000)
                );
                let weeks = Math.floor(
                    Math.ceil(
                        (
                            endDate.setHours(23, 59, 59, 999) -
                            startDate.setHours(0, 0, 0, 1)
                        ) /
                        (86400 * 1000)
                    ) / 7
                );

                days = days - (weeks * 2);
                days = (
                    startDate.getDay() - endDate.getDay() > 1
                    ? days - 2
                    : days
                );
                days = (
                    (startDate.getDay() === 0 && endDate.getDay() !== 6)
                    ? days - 1
                    : days
                );
                days = (
                    (endDate.getDay() === 6 && startDate.getDay() !== 0)
                    ? days - 1
                    : days
                );

                return days;
            }

            return null;
        },

        /**
            Return a time in string format that is the current UTC time
            returned in ISO format.

            If Local flag passed, returns in "yyyy-MM-ddThh:mm" format.

            @method now
            @param {Boolean} Local
            @return {String}
        */
        now: function (local) {
            if (local) {
                return (new Date()).toLocalDateTime();
            }
            return (new Date()).toISOString();
        },

        /**
            Allowable filter operators.

            @property operators
            @type Object
        */
        operators: {
            "=": "equals",
            "!=": "not equals",
            "~": "matches (case sensitive)",
            "!~": "not matches (case sensitive)",
            "~*": "matches",
            "!~*": "not matches",
            ">": "greater than",
            "<": "less than",
            ">=": "greater than or equals",
            "<=": "less than or equals",
            IN: "is one of",
            IS: "is"
        },

        /**
            Parse date string "YYYY-MM-DD" to a date in a sensical way because
            https://stackoverflow.com/questions/2587345

            @method parseDate
            @param {String} Date string
            @return {Date}
        */
        parseDate: function parseDate(input) {
            let parts = input.split("-");

            return new Date(parts[0], parts[1] - 1, parts[2]);
        },

        /**
          Return a date in string format that is the current date.

            @method today
            @return {String}
        */
        today: function () {
            return new Date().toDate().toLocalDate();
        },

        /**
            Returns date string "1970-01-01".

            @method startOfTime
            @return {String}
        */
        startOfTime: function () {
            return "1970-01-01";
        },

        /**
            Allowed data types.

            @property types
            @type Object
        */
        types: {
            array: {
                default: function () {
                    return [];
                }
            },
            boolean: {
                default: false,
                toType: function (value) {
                    return Boolean(value);
                }
            },
            integer: {
                default: 0,
                toType: function (value) {
                    return parseInt(value, 10);
                }
            },
            number: {
                default: 0,
                fromType: function (value) {
                    return (
                        value === null
                        ? null
                        : value.toLocaleString()
                    );
                },
                toType: function (value) {
                    let result;

                    if (typeof value === "string") {
                        result = Number(value.replace(/[^\d.\-eE+]/g, ""));
                    } else {
                        result = Number(value);
                    }
                    return (
                        Number.isNaN(result)
                        ? 0
                        : result
                    );
                }
            },
            object: {
                default: function () {
                    return {};
                }
            },
            string: {
                default: "",
                toType: function (value) {
                    return (
                        value === null
                        ? null
                        : value.toString()
                    );
                }
            }
        }
    };

    let test = typeof module;

    if (test !== "undefined") {
        module.exports = that;
    } else {
        window.f = that;
    }
}());