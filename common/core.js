/*global f, window */

// Intialize global object
f = {};

(function (f) {
  "use strict";

  var that,
    State = (typeof require === 'function' ? require('statechart') :
        window.statechart).State;

  that = {

    /**
      Returns the base url used to fetch and post data
      @return {String}
    */
    baseUrl: function () {
      //TODO: Make this configurable
      return "http://localhost:10010/";
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

    formats: {
      "integer": undefined,
      "long": undefined,
      "float": undefined,
      "double": undefined,
      "string": undefined,
      "boolean": undefined,
      "date": undefined,
      "dateTime": undefined,
      "password": undefined
    },

    /*
      TODO: Make this real
    */
    getCurrentUser: function () {
      return "admin";
    },

    /**
      Return a date that is the highest system date.

      @return {Date}
    */
    maxDate: function () {
      return new Date("2100-01-01T00:00:00.000Z");
    },

    /**
      Return a date that is the lowest system date.

      @return {Date}
    */
    minDate: function () {
      return new Date(0);
    },

    /**
      Return a date that is the current time.

      @return {Date}
    */
    now: function () {
      return new Date();
    },

    State: State,

    types: {
      "array": undefined,
      "boolean": undefined,
      "integer": undefined,
      "number": undefined,
      "object": undefined,
      "string": undefined
    }
  };

  Object.keys(that).forEach(function (key) {
    f[key] = that[key];
  });

}(f));

if (typeof exports !== "undefined") {
  Object.keys(f).forEach(function (key) {
    exports[key] = f[key];
  });
}

