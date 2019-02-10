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
/*jslint this, devel, bitwise, browser*/
/*global window, require, module*/
(function () {
    "use strict";

    const that = {
        PRECISION_DEFAULT: 18,
        SCALE_DEFAULT: 8,

        /**
          Make a deep copy of an object.

          @param {Object} Object
          @return {Object}
        */
        copy: function (obj) {
            return JSON.parse(JSON.stringify(obj));
        },

        /**
          Return a unique identifier string.

          Moddified from https://github.com/google/closure-library
          @author arv@google.com (Erik Arvidsson)
          http://www.apache.org/licenses/LICENSE-2.0

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

        /**
          Objects for performing data manipulation.
        */
        models: {},

        formats: {
            integer: {
                default: 0,
                toType: function (value) {
                    return parseInt(value, 10);
                }
            },
            string: {
                default: "",
                toType: function (value) {
                    return value.toString();
                }
            },
            boolean: {
                default: false,
                toType: function (value) {
                    return Boolean(value);
                }
            },
            date: {
                toType: function (value) {
                    let month;
                    let ret = "";

                    if (
                        value &&
                        value.constructor.name === "Date"
                    ) {
                        month = value.getUTCMonth() + 1;
                        ret += value.getUTCFullYear() + "-";
                        ret += month.pad(2, "0") + "-";
                        ret += value.getUTCDate().pad(2, "0");
                    } else {
                        ret = value;
                    }
                    return ret;
                },
                default: function () {
                    return that.today();
                }
            },
            dateTime: {
                default: function () {
                    return that.now();
                },
                fromType: function (value) {
                    return new Date(value).toLocalDateTime();
                },
                toType: function (value) {
                    if (
                        value &&
                        value.constructor.name === "Date"
                    ) {
                        return new Date(value).toISOString();
                    }
                    return value;
                }
            },
            password: {
                default: "",
                fromType: function () {
                    return "*****";
                }
            },
            tel: {
                default: ""
            },
            email: {
                default: ""
            },
            url: {
                default: ""
            },
            color: {
                default: "#000000"
            },
            textArea: {
                default: ""
            },
            script: {
                default: ""
            },
            money: {
                default: function () {
                    return that.money();
                }
            },
            enum: {
                default: ""
            },
            lock: {},
            dataType: {},
            icon: {
                default: ""
            }
        },

        /*
          TODO: Make this real
        */
        getCurrentUser: function () {
            return "admin";
        },

        /**
          Return a time in string format that is the current UTC time.

          @return {String}
        */
        now: function () {
            return (new Date()).toISOString();
        },

        /**
          Allowable filter operators.
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
            IN: "in list"
        },

        /**
            Parse date string "YYYY-MM-DD" to a date in a sensical way because
            https://stackoverflow.com/questions/2587345

            @param {String} Date string
            @return {Date}
        */
        parseDate: function parseDate(input) {
            let parts = input.split("-");

            return new Date(parts[0], parts[1] - 1, parts[2]);
        },

        /**
          Return a date in string format that is the current date.

          @return {String}
        */
        today: function () {
            return new Date().toDate().toLocalDate();
        },

        startOfTime: function () {
            return "1970-01-01";
        },

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
                        ? null
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