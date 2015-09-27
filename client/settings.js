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

    that.data = f.prop();

    /*
      Send event to fetch data based on the current id from the server.
    */
    that.fetch = function () {
      var deferred = m.deferred();
      state.send("fetch", deferred);
      return deferred.promise;
    };

    doFetch = function (context) {
      var ds = f.dataSource,
        payload = {method: "GET", path: "/settings/" + name},
        callback = function () {
          state.send('fetched');
          context.deferred.resolve(that.data);
        };

      state.goto("/Busy");
      ds.request(payload).then(that.data).then(callback);
    };

    doPost = function () {
      // TODO: Finish this
      console.error("Save settings not implemented yet.");
    };

    state = statechart.State.define(function () {
      this.state("Ready", function () {
        this.event("fetch", function (deferred) {
          this.goto("/Busy", {
            context: {deferred: deferred}
          });
        });

        this.state("New");
        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
          });

          this.state("Dirty", function (deferred) {
            this.event("save", function (deferred) {
              this.goto("/Busy/Saving", {
                context: {deferred: deferred}
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
    var processModels,
      that = f.settings("catalog");

    /**
      Return a model specification (feather) including inherited properties.

      @param {String} Model name
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    that.getFeather = function (name, includeInherited) {
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
    processModels = function (data) {
      var keys;

      keys = Object.keys(data());
      keys.forEach(function (key) {
        var ary, idx,
          prop = key.toCamelCase(),
          plural = f.catalog.getFeather(key, false).plural;

        // Implement generic function to object from model
        if (typeof f.models[prop] !== "function") {
          // Model instance
          f.models[prop] = function (data, model) {
            var shared = model || that.getFeather(key),
              obj = f.model(data, shared);

            return obj;
          };

          // List instance
          if (plural) {
            ary = [];
            idx = {};

            // Remove a model from the list
            ary.remove = function (model) {
              var id = model.data.id(),
                i = idx[id];
              if (!isNaN(i)) {
                ary.splice(i, 1);
                Object.keys(idx).forEach(function (key) {
                  if (idx[key] > i) { idx[key] -= 1; }
                });
                delete idx[id];
              }
            };
            // TODO: Make data do something. Options? Filter?
            f.models[prop].list = function (filter) {
              console.log(filter);
              filter = Qs.stringify(filter);
              var name = plural.toSpinalCase(),
                url = "/data/" + name + "/" + filter;
              console.log(url);
              return m.request({
                method: "GET",
                url: url
              }).then(function (data) {
                var id, model,
                  len = data.length,
                  i = 0;
                while (i < len) {
                  id = data[i].id;
                  model = f.models[prop](data[i]);
                  model.state.goto("/Ready/Fetched");
                  if (!isNaN(idx[id])) {
                    ary.splice(idx[id], 1, model);
                  } else {
                    idx[id] = ary.length;
                    ary.push(model);
                  }
                  i++;
                }
                return ary;
              });
            };
          }
        }
      });

      return true;
    };


    // Load catalog and process
    f.init(function () {
      return that.fetch().then(processModels);
    });

    return that;
  }());

}(f));
