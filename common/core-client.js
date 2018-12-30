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
import { State as statechart } from "./state.js";

// ..........................................................
// PRIVATE
//

/** private */
function isChild(p) {
    return p.type && typeof p.type === "object" && p.type.childOf;
}

/** private */
function isToOne(p) {
    return (
        p.type && typeof p.type === "object" &&
        !p.type.childOf && !p.type.parentOf
    );
}

/** private */
function isToMany(p) {
    return p.type && typeof p.type === "object" && p.type.parentOf;
}

const f = {
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
        money: {
            default: function () {
                return that.money();
            }
        },
        enum: {
            default: ""
        },
        lock: {}
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
      Creates a property getter setter function with a default value.
      Includes state...
      @param {Any} Initial
      @param {Object} Formatter. Optional
      @param {Any} [formatter.default] Function or value returned
            by default.
      @param {Function} [formatter.toType] Converts input to internal type.
      @param {Function} [formatter.fromType] Formats internal
            value for output.
      @return {Function}
    */
    prop: function (store, formatter) {
        formatter = formatter || {};

        let newValue;
        let oldValue;
        let proposed;
        let p;
        let state;
        let alias;
        let isReadOnly = false;
        let isRequired = false;

        function defaultTransform(value) {
            return value;
        }

        function revert() {
            store = oldValue;
        }

        formatter.toType = formatter.toType || defaultTransform;
        formatter.fromType = formatter.fromType || defaultTransform;

        // Define state
        state = statechart.define(function () {
            this.state("Ready", function () {
                this.event("change", function () {
                    this.goto("../Changing");
                });
                this.event("silence", function () {
                    this.goto("../Silent");
                });
                this.event("disable", function () {
                    this.goto("../Disabled");
                });
            });
            this.state("Changing", function () {
                this.event("changed", function () {
                    this.goto("../Ready");
                });
            });
            this.state("Silent", function () {
                this.event("report", function () {
                    this.goto("../Ready");
                });
                this.event("disable", function () {
                    this.goto("../Disabled");
                });
            });
            this.state("Disabled", function () {
                // Attempts to make changes from disabled mode revert back
                this.event("changed", revert);
                this.event("enable", function () {
                    this.goto("../Ready");
                });
            });
        });

        // Private function that will be returned
        p = function (...args) {
            let value = args[0];

            if (args.length) {
                if (p.state().current()[0] === "/Changing") {
                    return p.newValue(value);
                }

                proposed = formatter.toType(value);

                if (proposed === store) {
                    return;
                }

                newValue = value;
                oldValue = store;

                p.state().send("change");
                store = (
                    value === newValue
                    ? proposed
                    : formatter.toType(newValue)
                );
                p.state().send("changed");
                newValue = undefined;
                oldValue = undefined;
                proposed = undefined;
            }

            return formatter.fromType(store);
        };

        p.alias = function (...args) {
            if (args.length) {
                alias = args[0];
            }
            return alias;
        };

        /*
          Getter setter for the new value
          @param {Any} New value
          @return {Any}
        */
        p.newValue = function (...args) {
            if (args.length && p.state().current()[0] === "/Changing") {
                newValue = args[0];
            }

            return newValue;
        };

        p.newValue.toJSON = function () {
            return proposed;
        };

        p.oldValue = function () {
            return formatter.fromType(oldValue);
        };

        p.oldValue.toJSON = function () {
            return oldValue;
        };

        p.state = function () {
            return state;
        };

        p.ignore = 0;

        p.toJSON = function () {
            if (
                typeof store === "object" && store !== null &&
                typeof store.toJSON === "function"
            ) {
                return store.toJSON();
            }

            return store;
        };

        p.newValue.toJSON = function () {
            if (
                typeof newValue === "object" && newValue !== null &&
                typeof newValue.toJSON === "function"
            ) {
                return newValue.toJSON();
            }

            return formatter.toType(newValue);
        };

        /**
          @param {Boolean} Is read only
          @returns {Boolean}
        */
        p.isReadOnly = function (value) {
            if (value !== undefined) {
                isReadOnly = Boolean(value);
            }
            return isReadOnly;
        };
        /**
          @param {Boolean} Is required
          @returns {Boolean}
        */
        p.isRequired = function (value) {
            if (value !== undefined) {
                isRequired = Boolean(value);
            }
            return isRequired;
        };
        p.isToOne = function () {
            return isToOne(p);
        };
        p.isToMany = function () {
            return isToMany(p);
        };
        p.isChild = function () {
            return isChild(p);
        };

        store = formatter.toType(store);
        state.goto();

        return p;
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

export { f };