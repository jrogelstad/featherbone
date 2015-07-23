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

    State: (typeof require === 'function' ? require('statechart') :
        window.statechart).State
  };

  Object.keys(that).forEach(function (key) {
    f[key] = that[key];
  });

}(f));
