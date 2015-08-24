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

/*global window, f */
(function (f) {
  "use strict";

  var statechart = typeof require === 'function' ? require('statechart') :
      window.statechart;

  f.settings = function (name) {
    var state, doFetch, doPost,
      that = {};

    if (!name) { throw "Settings name is required"; }

    that.data = f.prop();

    /*
      Send event to fetch data based on the current id from the server.
    */
    that.fetch = function () {
      state.send("fetch");
    };

    /*
      Add a fetched event binding to the object. Pass a callback
      in and the object will be passed as an argument.

        mySettings = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.settings(data, shared);

          // Add a fetched event
          that.onFetched(function (obj) {
            console.log("Data fetched for this " + obj.name + "!");
          });
        }

      @param {Function} Callback to execute on fetch
      @return Reciever
    */
    that.onFetched = function (callback) {
      var func = function () { callback(that); };

      state.substateMap.Ready.substateMap.Fetched.enter(func);

      return this;
    };

    doFetch = function () {
      var ds = f.dataSource,
        payload = {method: "GET", path: "/settings/" + name},
        callback = function () {
          state.send('fetched');
        };

      state.goto("/Busy");
      ds.request(payload).then(that.data).then(callback);
    };

    doPost = function () {
      state.goto("/Busy/Saving");
    };

    state = statechart.State.define(function () {
      this.state("Ready", function () {
        this.state("New", function () {
          this.event("fetch", doFetch);
        });

        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () { this.goto("../Dirty"); });
          });

          this.state("Dirty", function () {
            this.event("save", doPost);
          });

          this.event("fetch", doFetch);
        });
      });

      this.state("Busy", function () {
        this.state("Fetching");
        this.state("Saving");

        this.event("fetched", function () { this.goto("/Ready/Fetched"); });
        this.event("error", function () { this.goto("/Error"); });
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
    var processModels,
      that = f.settings("catalog");

    /**
      Return a model definition, including inherited properties.

      @param {String} Model name
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    that.getModel = function (name, includeInherited) {
      var resultProps, modelProps, key, appendParent,
        catalog = that.data(),
        result = {name: name, inherits: "Object"};

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

      if (!catalog[name]) { return false; }

      // Add other attributes after name
      for (key in catalog[name]) {
        if (catalog[name].hasOwnProperty(key)) {
          result[key] = catalog[name][key];
        }
      }

      // Want inherited properites before class properties
      if (includeInherited !== false && name !== "Object") {
        result.properties = {};
        result = appendParent(result, result.inherits);
      } else {
        delete result.inherits;
      }

      // Now add local properties back in
      modelProps = catalog[name].properties;
      resultProps = result.properties;
      for (key in modelProps) {
        if (modelProps.hasOwnProperty(key)) {
          resultProps[key] = modelProps[key];
        }
      }

      return result;
    };

    // ..........................................................
    // PRIVATE
    //

    // Create an object for each model
    processModels = function (obj) {
      var keys,
        data = obj.data();

      keys = Object.keys(data);
      keys.forEach(function (key) {
        var prop = key.slice(0, 1).toLowerCase() + key.slice(1);

        // Implement generic function to object from model
        if (typeof f.feathers[prop] !== "function") {
          f.feathers[prop] = function (data, model) {
            var shared = model || that.getModel(key),
              feather = f.object(data, shared);

            return feather;
          };
        }
      });
    };


    // Bind fetchh to model handling
    that.onFetched(processModels);
    that.fetch();

    return that;
  }());

}(f));
