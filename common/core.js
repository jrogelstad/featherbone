/**
    Framework for building object relational database apps

    Copyright (C) 2016  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global m, window*/
(function () {
  "use strict";

  var that, waiting, isToMany, isToOne, isChild,
    callbacks = [], queue = [], thenables = [],
    statechart = require("statechartjs"),
    i = 0;

  that = {
    PRECISION_DEFAULT: 18,
    SCALE_DEFAULT: 6,

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
      var x = 2147483648,
        d = new Date(),
        result = Math.floor(Math.random() * x).toString(36) +
          Math.abs(Math.floor(Math.random() * x) ^ d).toString(36);

      return result;
    },

    /**
      Objects for performing data manipulation.
    */
    models: {},

    formats: {
      integer: {
        default: 0,
        toType: function (value) { return parseInt(value, 10); }
      },
      string: {
        default: "",
        toType: function (value) { return value.toString(); }
      },
      boolean: {
        default: false,
        toType: function (value) { return !!value; }
      },
      date: {
        default: function () {
          return that.today();
        }
      },
      dateTime: {
        default: function () {
          return that.now();
        },
        fromType: function (value) {
          var dt = new Date(value).toISOString().replace('Z', '');
          return dt;
        }
      },
      password: {
        default: "",
        fromType: function () { return "*****"; }
      },
      tel: {
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
      Add an asynchronous function call that should 
      be executed when the application is intialized.
      Functions are executed serially such that the
      most recent isn't executed until all preceding
      callbacks are executed.

      Functions passed in should return a value using
      deferred promises to ensure proper completion of the
      queue.

      Init itself returns a deferred promise that will be
      resolved when all queued callbacks are complete.
      As such  `init` can be called passing no callback
      followed by `then` and another function to
      be executed when the application is completetly
      initialized.

        var myAsync, reportProgress, reportFinish;

        // Define an async function
        myAsync = function(msec) {
          var deferred = m.deferred();
          setTimeout(function() {
            deferred.resolve(true);
          }, msec || 1000);
          return deferred.promise;
        };

        // A function that reports back incremental progress
        reportProgress = function () {
          var n = f.initCount(),
            i = n - f.initRemaining();
          console.log("myAsync completed " + i + " of " + n + " calls.");
        };

        // A function that reports back end results
        reportFinish = function () {
          console.log("myAsync complete!");
        };

        // Attached progress report
        f.initEach(reportProgress);

        // Kick off first async (no argument)
        f.init(myAsync);

        // Kick off second async (includes argument)
        f.init(myAsync.bind(this, 500));

        // Report results after all are initializations are complete
        f.init().then(reportFinish);  

        // "myAsync completed 1 of 2 calls."
        // "myAsync completed 2 of 2 calls."
        // "myAsync complete!"

      @seealso initCount
      @seealso initEach
      @seealso initRemaining
      @param {Function} Callback
      returns {Object} Deferred promise
    */
    init: function (callback) {
      var func, next,
        deferred = m.deferred();

      thenables.push(deferred);

      if (typeof callback === "function") {
        i += 1;
        queue.push(callback);
      }
      if (waiting) {
        return deferred.promise;
      }
      if (!queue.length) {
        while (thenables.length) {
          thenables.shift().resolve(true);
        }
        return deferred.promise;
      }

      waiting = true;
      func = queue.shift();

      next = function () {
        waiting = false;
        callbacks.forEach(function (callback) {
          callback();
        });
        return true;
      };

      func().then(next).then(that.init);

      return deferred.promise;
    },

    /**
      Return the total number of functions queued to
      initialize.

      @return {Number}
    */
    initCount: function () {
      return i;
    },

    /*
      Add a callback to be executed when each
      initialization is complete.
    */
    initEach: function (callback) {
      callbacks.push(callback);
    },

    /**
      Return the remaining functions queued to
      initialize.

      @return {Number}
    */
    initRemaining: function () {
      return queue.length;
    },

    /**
      Return a time in string format that is the current time.

      @return {String}
    */
    now: function () {
      return (new Date()).toISOString().replace('Z', '');
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
      @param {Any} [formatter.default] Function or value returned by default.
      @param {Function} [formatter.toType] Converts input to internal type.
      @param {Function} [formatter.fromType] Formats internal value for output.
      @return {Function}
    */
    prop: function (store, formatter) {
      formatter = formatter || {};

      var newValue, oldValue, p, state, revert,
        isReadOnly = false,
        isRequired = false,
        defaultTransform = function (value) { return value; };

      formatter.toType = formatter.toType || defaultTransform;
      formatter.fromType = formatter.fromType || defaultTransform;

      revert = function () {
        store = oldValue;
      };

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
      p = function (value) {
        var proposed;

        if (arguments.length) {
          proposed = formatter.toType(value);

          if (proposed === store) { return; }

          newValue = value;
          oldValue = store;

          p.state().send("change");
          store = value === newValue ? proposed : formatter.toType(newValue);
          p.state().send("changed");
          newValue = undefined;
          oldValue = undefined;
        }

        return formatter.fromType(store);
      };

      /*
        Getter setter for the new value
        @param {Any} New value
        @return {Any}
      */
      p.newValue = function (value) {
        if (arguments.length && p.state().current() === "/Changing") {
          newValue = value;
        }

        return newValue;
      };

      p.oldValue = function () {
        return formatter.fromType(oldValue);
      };

      p.state = function () {
        return state;
      };

      p.ignore = 0;

      p.toJSON = function () {
        if (typeof store === "object" && store !== null &&
            typeof store.toJSON === "function") {
          return store.toJSON();
        }

        return store;
      };
      /**
        @param {Boolean} Is read only
        @returns {Boolean}
      */
      p.isReadOnly = function (value) {
        if (value !== undefined) {
          isReadOnly = !!value;
        }
        return isReadOnly;
      };
      /**
        @param {Boolean} Is required
        @returns {Boolean}
      */
      p.isRequired = function (value) {
        if (value !== undefined) {
          isRequired = !!value;
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
      Round

      @param {Number} Number
      @param {Number} Scale
      @returns {Number}
    */
    round: function (value, scale) {
      scale =  scale || 0;
      var power = Math.pow(10, scale);
      return Math.round(value * power) / power;
    },

    /**
      Return a date in string format that is the current date.

      @return {String}
    */
    today: function () {
      var d = new Date();
      d.setHours(0);
      d.setMinutes(0);
      d.setMilliseconds(0);

      return d.toISOString().slice(0, 10);
    },

    types: {
      array: { default: function () {return []; } },
      boolean: {
        default: false,
        toType: function (value) { return !!value; }
      },
      integer: {
        default: 0,
        toType: function (value) { return parseInt(value, 10); }
      },
      number: {
        default: 0,
        fromType: function (value) {
          return value === null ? null : value.toLocaleString();
        },
        toType: function (value) {
          var result;
          if (typeof value === "string") {
            result = Number(value.replace(/[^\d\.\-eE+]/g, ""));
          } else {
            result = Number(value);
          }
          return isNaN(result) ? null : result;
        }
      },
      object: { default: function () { return {}; } },
      string: {
        default: "",
        toType: function (value) {
          return value === null ? null : value.toString();
        }
      }
    }
  };

  // ..........................................................
  // PRIVATE
  //

  /** private */
  isChild = function (p) {
    return p.type && typeof p.type === "object" && p.type.childOf;
  };

  /** private */
  isToOne = function (p) {
    return p.type && typeof p.type === "object" &&
      !p.type.childOf && !p.type.parentOf;
  };

  /** private */
  isToMany = function (p) {
    return p.type && typeof p.type === "object" && p.type.parentOf;
  };

  module.exports = that;
}());

