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

/*global window, f, m */
(function (f) {
  "use strict";

  var statechart, jsonpatch, isChild, isToOne, isToMany;

  if (typeof require === 'function') {
    statechart = require("statechart");
    jsonpatch = require("fast-json-patch");
  } else {
    statechart = window.statechart;
    jsonpatch = window.jsonpatch;
  }

  /**
    Creates a property getter setter function with a default value.
    Includes state...

    @param {Any} Initial 
    @param {Object} Formatter. Optional
    @param {Any} [formatter.default] Function or value returned by default.
    @param {Function} [formatter.toType] Converts input to internal type.
    @param {Function} [formatter.fromType] Formats internal value for output.
    @event {Function} changing. Passes property as context.
    @event {Function} changed. Passes property as context.
    @return {Function}
  */
  f.prop = function (store, formatter) {
    formatter = formatter || {};

    var newValue, oldValue, p, state, revert,
      defaultTransform = function (value) { return value; };

    formatter.toType = formatter.toType || defaultTransform;
    formatter.fromType = formatter.fromType || defaultTransform;

    // Initialize state
    state = statechart.State.define(function () {
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
        this.enter(function () {
          p.emit("changing", p);
        });
        this.exit(function () {
          p.emit("changed", p);
        });
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
      var proposed;

      if (arguments.length) {
        proposed = formatter.toType(value);

        if (proposed === store) { return; }

        newValue = value;
        oldValue = store;

        p.state.send("change");
        store = value === newValue ? proposed : formatter.toType(newValue);
        newValue = undefined;
        oldValue = newValue;
        p.state.send("changed");
      }

      return formatter.fromType(store);
    };

    /*
      Getter setter for the new value

      @param {Any} New value
      @return {Any}
    */
    p.newValue = function (value) {
      if (arguments.length && p.state.current() === "/Changing") {
        newValue = value;
      }

      return newValue;
    };

    p.oldValue = function () {
      return formatter.fromType(oldValue);
    };

    p.state = state;

    p.toJSON = function () {
      if (typeof store === "object" && store !== null &&
          typeof store.toJSON === "function") {
        return store.toJSON();
      }

      return store;
    };

    // Make property observable
    p = f.observable(p);

    store = formatter.toType(store);
    state.goto();

    return p;
  };

  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.

    Model properties are observable and emit "changing" when a property is
    being set and "changed" after the set is complete. Use this to extend
    business logic on properties as required. Example:

        contact = function (data, feather) {
          var shared = feather || f.catalog.getFeather("Contact"),
            that = f.model(data, shared);

          // Add a change event to a property
          that.data.name.connect("changing", function (prop) {
            console.log("First name changing from " +
              (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
          });

          return that;
        }

    @param {Object} Default data
    @param {Object} Feather
    @param {Array} [feather.name] the class name of the object
    @param {Array} [feather.properties] the properties to set on the data object
    @event {Object} error. Passes error as context
    @event {Object} stateChanged. Passes model as context
    return {Object}
  */
  f.model = function (data, feather) {
    data = data || {};
    feather = feather || {};

    var  doClear, doDelete, doError, doFetch, doInit, doPatch, doPost, doSend,
      lastError, lastFetched, path, state,
      that = f.observable({data: {}, name: feather.name || "Object",
        plural: feather.plural}),
      d = that.data,
      validators = [],
      stateMap = {};

    // ..........................................................
    // PUBLIC
    //

    /*
      Send event to clear properties on the object and set it to
      "/Ready/New" state.
    */
    that.clear = function () {
      state.send("clear");
    };

    /*
      Send event to delete the current object from the server.

      Returns a deferred promise with a boolean passed back as the value.
    */
    that.delete = function () {
      return doSend("delete");
    };

    /*
      Send event to fetch data based on the current id from the server.

      Returns a deferred promise with model.data passed back as the value.

      @return {Object} Deferred promise
    */
    that.fetch = function () {
      return doSend("fetch");
    };

    /*
      Property that indicates object is a model (i.e. class).
    */
    that.isModel = true;

    /*
      Returns whether the object is in a valid state to save.

      @return {Boolean}
    */
    that.isValid = function () {
      try {
        validators.forEach(function (validator) {
          validator();
        });
      } catch (e) {
        doError(e);
        return false;
      }

      return true;
    };

    /*
      Return the last error raised.

      @return {String}
    */
    that.lastError = function () {
      return lastError;
    };

    /*
      Add a validator to execute when the `isValid` function is
      called, which is also called after saving events. Errors thrown
      by the validator will be caught and passed through `onError`
      callback(s). The most recent error may also be access via
      `lastError`.

        contact = function (data, feather) {
          var shared = feather || f.catalog.getFeather("Contact"),
            that = f.model(data, shared);

          // Add a fetched event
          that.onValidate(function (validator) {
            if (!that.data.first()) {
              throw "First name must not be empty.";
            }
          });
        }

      @seealso isValid
      @param {Function} Callback to execute when validating
      @return Reciever
    */
    that.onValidate = function (callback) {
      validators.push(callback);

      return this;
    };

    /*
      Send the save event to persist current data to the server.
      Only results in action in the "/Ready/Fetched/Dirty" and
      "/Ready/New" states.

      Returns a deferred promise with model.data as the value.

      @return {Object} Deferred promise
    */
    that.save = function () {
      return doSend("save");
    };

    /*
      Set properties to the values of a passed object

      @param {Object} Data to set
      @param {Boolean} Silence change events
      @returns reciever
    */
    that.set = function (data, silent) {
      var keys, sendToProperties;

      sendToProperties = function (str) {
        var dkeys = Object.keys(d);

        dkeys.forEach(function (key) {
          d[key].state.send(str);
        });

        return this;
      };

      if (typeof data === "object") {
        keys = Object.keys(data);

        // Silence events if applicable
        if (silent) { sendToProperties("silence"); }

        // Loop through each attribute and assign
        keys.forEach(function (key) {
          if (typeof d[key] === "function") {
            d[key](data[key]);
          }
        });

        sendToProperties("report"); // TODO: History?
      }

      return this;
    };

    that.toJSON = function () {
      var keys = Object.keys(d),
        result = {};

      keys.forEach(function (key) {
        result[key] = d[key].toJSON();
      });

      return result;
    };

    // ..........................................................
    // PRIVATE
    //

    doClear = function () {
      var keys = Object.keys(that.data),
        values = {};

      // If first entry here with user data, clear for next time and bail
      if (data) {
        data = undefined;
        return;
      }

      keys.forEach(function (key) {
        var value = that.data[key].default;

        values[key] = typeof value === "function" ? value() : value;
      });

      that.set(values, true); // Uses silent option
    };

    doDelete = function (context) {
      var ds = f.dataSource,
        result = f.prop({}),
        payload = {method: "DELETE", path: path(that.name, d.id())},
        callback = function () {
          lastFetched = result();
          that.set(result(), true);
          state.send('deleted');
          context.deferred.resolve(true);
        };

      ds.request(payload).then(result).then(callback);
    };

    doError = function (err) {
      lastError = err;
      state.send("error");
      that.emit("error", err);
    };

    doFetch = function (context) {
      var ds = f.dataSource,
        result = f.prop({}),
        payload = {method: "GET", path: path(that.name, that.data.id())},
        handleErr = function (err) {
          console.log(err);
        },
        callback = function () {
          lastFetched = result();
          that.set(result(), true);
          state.send('fetched');
          context.deferred.resolve(d);
        };

      ds.request(payload).then(result, handleErr).then(callback);
    };

    doPatch = function (context) {
      var ds = f.dataSource,
        result = f.prop({}),
        patch = jsonpatch.compare(lastFetched, that.toJSON()),
        payload = {method: "PATCH", path: path(that.name, that.data.id()),
          data: {data: patch}},
        callback = function () {
          jsonpatch.apply(lastFetched, patch); // Update to sent changes
          jsonpatch.apply(lastFetched, result()); // Update server side changes
          that.set(lastFetched, true);
          state.send('fetched');
          context.deferred.resolve(d);
        };

      if (that.isValid()) {
        ds.request(payload).then(result).then(callback);
      }
    };

    doPost = function (context) {
      var ds = f.dataSource,
        result = f.prop({}),
        cache = that.toJSON(),
        payload = {method: "POST", path: path(that.plural),
          data: {data: cache}},
        callback = function () {
          jsonpatch.apply(cache, result());
          lastFetched = cache;
          that.set(cache, true);
          state.send('fetched');
          context.deferred.resolve(d);
        };

      if (that.isValid()) {
        ds.request(payload).then(result).then(callback);
      }
    };

    doSend = function (evt) {
      var deferred = m.deferred();
      state.send(evt, deferred);
      return deferred.promise;
    };

    doInit = function () {
      var onFetching, onFetched, extendArray,
        props = feather.properties,
        keys = Object.keys(props || {});

      onFetching = function () {
        this.state.goto("/Busy/Fetching");
      };
      onFetched = function () {
        this.state.goto("/Ready/Fetched");
      };

      // Function to extend child array if applicable
      extendArray = function (prop, name) {
        var isNew = true,
          cache = [],
          ary = prop();

        // Bind parent events to array
        state.resolve("/Ready/New").enter(function () {
          isNew = true;
          ary.clear();
        });

        state.resolve("/Ready/Fetched").enter(function () {
          isNew = false;
        });

        // Extend array
        ary.add = function (value) {
          prop.state.send("change");
          if (value && value.isModel) { value = value.toJSON(); }

          // Create an instance
          value = f.models[name](value);

          // Synchronize statechart
          state.resolve("/Busy/Fetching").enter(onFetching.bind(value));
          state.resolve("/Ready/Fetched").enter(onFetched.bind(value));

          // Disable save event on children
          value.state.resolve("/Ready/New").event("save");
          value.state.resolve("/Ready/Fetched/Dirty").event("save");

          // Notify parent if child becomes dirty
          value.state.resolve("/Ready/Fetched/Dirty").enter(function () {
            state.send("changed");
          });

          // Notify parent properties changed
          ary.push(value);
          cache.push(value);
          prop.state.send("changed");

          return value;
        };

        ary.clear = function () {
          prop.state.send("change");
          ary.length = 0;
          cache.length = 0;
          prop.state.send("changed");
        };

        ary.remove = function (value) {
          var result, idx, find;

          find = function (item, i) {
            if (value.data.id() === item.data.id()) {
              idx = i;
              return true;
            }
          };

          if (ary.some(find)) {
            prop.state.send("change");
            result = ary.splice(idx, 1)[0];
            cache.some(find); // Find index on cache
            if (isNew) {
              cache.splice(idx, 1);
            } else {
              delete cache[idx];
            }
            that.state.send("changed");
          }

          return result;
        };

        ary.toJSON = function () {
          var item, value,
            result = [],
            len = cache.length,
            i = 0;

          while (i < len) {
            item = cache[i];
            value = item ? item.toJSON() : undefined;
            result.push(value);
            i++;
          }

          return result;
        };
      };

      // Loop through each model property and instantiate a data property
      keys.forEach(function (key) {
        var prop, func, defaultValue, name, cFeather, cKeys, cArray, relation,
          p = props[key],
          type = p.type,
          value = data[key],
          formatter = {};

        // Create properties for relations
        if (typeof p.type === "object") {
          if (isChild(p)) { return; } // Ignore child properties on client level

          relation = type.relation;
          name = relation.slice(0, 1).toLowerCase() + relation.slice(1);

          if (isToOne(p)) {

            // Need to to make sure transform knows to ignore inapplicable props
            if (type.properties && type.properties.length) {
              cFeather = JSON.parse(JSON.stringify(
                f.catalog.getFeather(relation)
              ));
              cKeys = Object.keys(cFeather.properties);
              cKeys.forEach(function (key) {
                if (type.properties.indexOf(key) === -1 && key !== "id") {
                  delete cFeather.properties[key];
                }
              });
            }

            // Create a model instance if not already
            formatter.toType = function (value) {
              var result;

              if (value === undefined || value === null) { return null; }
              if (value && value.isModel) { value = value.toJSON(); }
              result =  f.models[name](value, cFeather);

              // Synchronize statechart
              state.resolve("/Busy/Fetching").enter(onFetching.bind(result));
              state.resolve("/Ready/Fetched").enter(onFetched.bind(result));

              // Disable save event on children
              result.state.resolve("/Ready/New").event("save");
              result.state.resolve("/Ready/Fetched/Dirty").event("save");

              return result;
            };

            // Create property
            prop = f.prop(value, formatter);

          // Define format for to-many
          } else if (isToMany(p)) {
            cArray = [];

            // Create an instance for each relation if not already
            formatter.toType = function (value) {
              value = value || [];

              if (!Array.isArray(value)) {
                throw "Value assignment for " + key + " must be an array.";
              }

              if (value !== cArray) {
                cArray.clear();
                value.forEach(function (item) {
                  cArray.add(item);
                });
              }

              return cArray;
            };

            // Create property
            prop = f.prop(cArray, formatter);
            extendArray(prop, name);
            prop(value);
          }

        // Resolve formatter to standard type
        } else {
          formatter = f.formats[p.format] || f.types[p.type] || {};

          // Handle default
          if (p.default !== undefined) {
            defaultValue = p.default;
          } else if (typeof formatter.default === "function") {
            defaultValue = formatter.default();
          } else {
            defaultValue = formatter.default;
          }

          // Handle default that is a function
          if (typeof defaultValue === "string" &&
              defaultValue.match(/\(\)$/)) {
            func = f[defaultValue.replace(/\(\)$/, "")];
          }

          if (value === undefined) {
            value = func ? func() : defaultValue;
          }

          // Create property
          prop = f.prop(value, formatter);
        }

        // Carry other property definitions forward
        prop.key = key; // Use of 'name' property is not allow here
        prop.description = props[key].description;
        prop.type = props[key].type;
        prop.default = func || defaultValue;

        // Limit public access to state
        stateMap[key] = prop.state;
        prop.state = {
          current: function () {
            return stateMap[key].current();
          },
          send: function (str) {
            return stateMap[key].send(str);
          }
        };

        // Report property changed event up to model
        prop.connect("changed", function () { state.send("changed"); });

        d[key] = prop;
      });
    };

    path = function (name, id) {
      var ret = "/data/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    state = statechart.State.define(function () {
      var stateChanged = function () {
          that.emit("stateChanged", that);
          that.emit(state.current(), that);
        };

      this.enter(doInit);
      this.enter(stateChanged);

      this.state("Ready", {H: "*"}, function () {
        this.enter(stateChanged);
        this.event("fetch",  function (deferred) {
          this.goto("/Busy", {
            context: {deferred: deferred}
          });
        });

        this.state("New", function () {
          this.enter(stateChanged);
          this.enter(doClear);
          this.event("clear",  function () {
            this.goto("/Ready/New", {force: true});
          });
          this.event("save", function (deferred) {
            this.goto("/Busy/Saving", {
              context: {deferred: deferred}
            });
          });
          this.event("delete", function () {
            this.goto("/Deleted");
          });
        });

        this.state("Fetched", function () {
          this.enter(stateChanged);
          this.event("clear",  function () {
            this.goto("/Ready/New");
          });
          this.event("delete",  function (deferred) {
            this.goto("/Busy/Deleting", {
              context: {deferred: deferred}
            });
          });

          this.state("Clean", function () {
            this.enter(stateChanged);
            this.event("changed", function () {
              this.goto("../Dirty");
            });
          });

          this.state("Dirty", function () {
            this.enter(stateChanged);
            this.event("save", function (deferred) {
              this.goto("/Busy/Saving/Patching", {
                context: {deferred: deferred}
              });
            });
          });
        });
      });

      this.state("Busy", function () {
        this.enter(stateChanged);
        this.state("Fetching", function () {
          this.enter(stateChanged);
          this.enter(doFetch);
        });
        this.state("Saving", function () {
          this.enter(stateChanged);
          this.state("Posting", function () {
            this.enter(stateChanged);
            this.enter(doPost);
          });
          this.state("Patching", function () {
            this.enter(stateChanged);
            this.enter(doPatch);
          });
        });
        this.state("Deleting", function () {
          this.enter(doDelete);
          this.event("deleted", function () {
            this.goto("/Deleted");
          });
        });

        this.event("fetched", function () {
          this.goto("/Ready/Fetched/Clean");
        });
        this.event("error", function () {
          this.goto("/Ready");
        });
      });

      this.state("Deleted", function () {
        this.enter(stateChanged);
        this.event("clear",  function () {
          this.goto("/Ready/New");
        });
      });

      this.state("Deleting", function () {
        this.enter(stateChanged);
        this.enter(doDelete);

        this.event("deleted",  function () {
          this.goto("/Deleted");
        });
      });
    });

    // Expose state
    that.state = state;

    // Initialize
    state.goto();

    return that;
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

}(f));

