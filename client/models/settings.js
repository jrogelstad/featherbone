/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
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

/*global window, f, m, Qs */
(function (f) {
  "use strict";

  var statechart = typeof require === 'function' ? require('statechart') :
      window.statechart;

  f.settings = function (name) {
    var state, doFetch, doPost,
      that = {};

    if (!name) { throw "Settings name is required"; }

    that.data = f.prop({});

    /*
      Send event to fetch data based on the current id from the server.
    */
    that.fetch = function (merge) {
      var deferred = m.deferred();
      state.send("fetch", {deferred: deferred, merge: merge});
      return deferred.promise;
    };

    doFetch = function (context) {
      var ds = f.dataSource,
        result = m.prop(),
        payload = {method: "GET", path: "/settings/" + name},
        callback = function () {
          var merge,
            data = result() || {};
          if (context.merge) {
            merge = that.data();
            Object.keys(data).forEach(function (key) {
              merge[key] = data[key];
            });
            data = merge;
          }
          that.data(data);
          state.send('fetched');
          context.deferred.resolve(that.data);
        };

      state.goto("/Busy");
      ds.request(payload).then(result).then(callback);
    };

    doPost = function () {
      // TODO: Finish this
      console.error("Save settings not implemented yet.");
    };

    state = statechart.State.define(function () {
      this.state("Ready", function () {
        this.event("fetch", function (context) {
          this.goto("/Busy", {
            context: context
          });
        });

        this.state("New");
        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
          });

          this.state("Dirty", function () {
            this.event("save", function (context) {
              this.goto("/Busy/Saving", {
                context: context
              });
            });
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
        });
        this.state("Saving", function () {
          this.enter(doPost);
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

    // Expose specific state capabilities users can see and manipulate
    that.state = {
      send: function (str) {
        return state.send(str);
      },
      current: function () {
        return state.current();
      }
    };

    // Initialize
    state.goto();

    return that;
  };

  // Invoke catalog settings as an object
  f.catalog = (function () {
    var that = f.settings("catalog");

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

    return that;
  }());

}(f));
