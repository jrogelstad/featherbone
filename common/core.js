/*global window */

var f = (function () {
  "use strict";

  var that,
    dateToString = function (value) {
      return value instanceof Date ? value.toJSON() : value;
    };

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
      "integer": {
        default: 0,
        toType: function (value) { return parseInt(value, 10); }
      },
      "long": {
        default: 0,
        toType: Number
      },
      "float": {
        default: 0,
        toType: Number
      },
      "double": {
        default: 0,
        toType: Number
      },
      "string": {
        default: "",
        toType: function (value) { return value.toString(); }
      },
      "boolean": {
        default: false,
        toType: function (value) { return !!value; }
      },
      "date": {
        default: function () { return that.today(); },
        toType: dateToString,
        fromType: function (value) { return that.midnight(new Date(value)); }
      },
      "dateTime": {
        default: function () { return that.now(); },
        fromType: function (value) { return new Date(value); },
        toType: dateToString
      },
      "password": {
        default: "",
        fromType: function (value) { return "*****"; }
      }
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
      Return a date with the time set to midnight.
    */
    midnight: function (date) {
      date.setHours(0);
      date.setMinutes(0);
      date.setMilliseconds(0);

      return date;
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

    /**
      Return a date that is the current date at midnight.

      @return {Date}
    */
    today: function () {
      return that.midnight(that.now());
    },

    types: {
      "array": { default: function () {return []; } },
      "boolean": {
        default: false,
        toType: function (value) { return !!value; }
      },
      "integer": {
        default: 0,
        toType: function (value) { return parseInt(value, 10); }
      },
      "number": {
        default: 0,
        toType: Number
      },
      "object": { default: function () { return {}; } },
      "string": {
        default: "",
        toType: function (value) { return value.toString(); }
      },
    }
  };

  return that;
}());

if (typeof exports !== "undefined") {
  module.exports = f;
} else if (typeof window !== "undefined") {
  window.f = f;
}
