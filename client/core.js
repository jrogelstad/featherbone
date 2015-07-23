/*global f, window */

// Intialize global object
f = {};

(function (f) {
  "use strict";

  var that = {

    /**
      Return a unique identifier string.

      Moddified from https://github.com/google/closure-library
      @author arv@google.com (Erik Arvidsson)
      http://www.apache.org/licenses/LICENSE-2.0

      @return {String}
    */
    createId: function () {
      var x = 2147483648,
        dt = new Date(),
        result = Math.floor(Math.random() * x).toString(36) +
          Math.abs(Math.floor(Math.random() * x) ^ dt).toString(36);

      return result;
    },

    /*
      TODO: Make this real
    */
    getCurrentUser: function () {
      return "admin";
    },

    /**
      Return a date that is the current time.

      @return {Date}
    */
    now: function () {
      return new Date();
    },

    /**
      Creates a property getter setter function with a default value.
      Includes state...

      @param {Any} Initial value
      @return {Function}
    */
    prop: function (store) {
      var newValue, oldValue, p, state, revert;

      // Initialize state
      state = f.State.define(function () {
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
          this.event("Disable", function () {
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

      revert = function () {
        store = oldValue;
      };

      // Private function that will be returned
      p = function (value) {
        if (arguments.length) {
          newValue = value;
          oldValue = store;

          p.state.send("change");
          store = newValue;
          p.state.send("changed");

          newValue = undefined;
          oldValue = newValue;
        }

        return store;
      };

      /*
        Getter setter for the new value

      */
      p.newValue = function (value) {
        if (arguments.length) {
          newValue = value;
        }

        return newValue;
      };
      p.oldValue = function () {
        return oldValue;
      };

      p.state = state;

      p.toJSON = function () {
        return store;
      };

      // Initialize state
      state.goto();

      return p;
    },

    State: (typeof require === 'function' ? require('statechart') :
        window.statechart).State
  };

  Object.keys(that).forEach(function (key) {
    f[key] = that[key];
  });

}(f));
