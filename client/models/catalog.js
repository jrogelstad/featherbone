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

(function () {
  "use strict";

  var settings, store = {},
    f = require("common-core"),
    stream = require("stream"),
    dataSource = require("datasource"),
    statechart = require("statechartjs");

  store.data = stream({});

  settings = function () {
    var state, doFetch,
      that = {};

    that.data = f.prop({});

    // Send event to fetch feather data from the server.
    that.fetch = function (merge) {
      return new Promise (function (resolve) {
        state.send("fetch", {resolve: resolve, merge: merge});
      });
    };

    doFetch = function (context) {
      var payload = {method: "GET", path: "/settings/catalog"},
        callback = function (result) {
          var merge,
            data = result || {};
          data = data.data;
          if (context.merge) {
            merge = that.data();
            Object.keys(data).forEach(function (key) {
              merge[key] = data[key];
            });
            data = merge;
          }
          that.data(data);
          state.send('fetched');
          context.resolve(data);
        };

      state.goto("/Busy");
      dataSource.request(payload).then(callback);
    };

    state = statechart.define(function () {
      this.state("Ready", function () {
        this.event("fetch", function (context) {
          this.goto("/Busy", {
            context: context
          });
        });
        this.state("New");
        this.state("Fetched", function () {
          this.state("Clean");
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
        });
        this.event("fetched", function () {
          this.goto("/Ready/Fetched");
        });
        this.event("error", function () {
          this.goto("/Error");
        });
      });

      this.state("Error", function () {
        // Prevent exiting from this state
        this.canExit = function () { return false; };
      });
    });

    // Initialize
    state.goto();

    return that;
  };

  // Invoke catalog settings as an object
  module.exports = (function () {
    var that = settings();

    /**
      Return a model specification (feather) including inherited properties.

      @param {String} Feather
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    that.getFeather = function (feather, includeInherited) {
      var resultProps, modelProps, appendParent,
        catalog = that.data(),
        result = {name: feather, inherits: "Object"};

      appendParent = function (child, parent) {
        var model = catalog[parent],
          parentProps = model.properties,
          childProps = child.properties,
          keys = Object.keys(parentProps);

        if (parent !== "Object") {
          appendParent(child, model.inherits || "Object");
        }

        keys.forEach(function (key) {
          if (childProps[key] === undefined) {
            childProps[key] = parentProps[key];
            childProps[key].inheritedFrom = parent;
          }
        });

        return child;
      };

      if (!catalog[feather]) { return false; }

      // Add other attributes after nam
      Object.keys(catalog[feather]).forEach(function (key) {
        result[key] = catalog[feather][key];
      });

      // Want inherited properites before class properties
      if (includeInherited !== false && feather !== "Object") {
        result.properties = {};
        result = appendParent(result, result.inherits);
      } else {
        delete result.inherits;
      }

      // Now add local properties back in
      modelProps = catalog[feather].properties;
      resultProps = result.properties;
      Object.keys(modelProps).forEach(function (key) {
        resultProps[key] = modelProps[key];
      });

      return result;
    };

    that.register = function (property, name, value) {
      if (!store[property]) {
        store[property] = stream({});
      }
      if (arguments.length > 1) {
        store[property]()[name] = value;
      }
      return store[property]();
    };

    that.data = store.data;

    // Expose global store data
    that.store = function () {
      return store;
    };

    return that;
  }());

}());
