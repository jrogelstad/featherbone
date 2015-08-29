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

  var statechart, jsonpatch, isToOne;

  /* private */
  isToOne = function (p) {
    return p.type && typeof p.type === "object" &&
      !p.type.childOf && !p.type.parentOf;
  };

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
        p.state.send("changed");

        newValue = undefined;
        oldValue = newValue;
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
      if (typeof store === "object" && typeof store.toJSON === "function") {
        return store.toJSON();
      }

      return store;
    };

    // Initialize state
    state.goto();

    return p;
  };

  /**
    Returns a base model definition. Can be extended by modifying the return
    object directly.

    @param {Object} Default data.
    @param {Object} "My" definition for subclass
    @param {Array} [model.name] the class name of the object
    @param {Array} [model.properties] the properties to set on the data object
    return {Object}
  */
  f.object = function (data, model) {
    data = data || {};
    model = model || {};

    var  doClear, doDelete, doError, doFetch, doInit, doPatch, doPost,
      lastError, lastFetched, path, state,
      that = {data: {}, name: model.name || "Object", plural: model.plural},
      d = that.data,
      errHandlers = [],
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
    */
    that.delete = function () {
      state.send("delete");
    };

    /*
      Send event to fetch data based on the current id from the server.
    */
    that.fetch = function () {
      state.send("fetch");
    };

    /*
      Property that indicates object is a feather (i.e. object class).
    */
    that.isFeather = true;

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
      Add a change event binding to a property. Pass a callback in
      and the property will be passed to the callback.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

          // Add a change event to a property
          that.onChange("first", function (prop) {
            console.log("First name changed from " +
              (prop.oldValue() || "nothing") + " to " + prop.newValue() + "!");
          });
        }

      @param {String} Property name to call on cahnge
      @param {Function} Callback function to call on change
      @return Reciever
    */
    that.onChange = function (name, callback) {
      var func = function () { callback(this); };

      stateMap[name].substateMap.Changing.enter(func.bind(d[name]));

      return this;
    };

    /*
      Add an error handler binding to the object. Pass a callback
      in and the error will be passed as an argument.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

          // Add an error handler
          that.onError(function (err) {
            console.log("Error->", err);
          });
        }

      @param {Function} Callback to execute on error
      @return Reciever
    */
    that.onError = function (callback) {
      errHandlers.push(callback);

      return this;
    };

    /*
      Add a fetched event binding to the object. Pass a callback
      in and the object will be passed as an argument.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

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

    /*
      Add a validator to execute when the `isValid` function is
      called, which is also called after saving events. Errors thrown
      by the validator will be caught and passed through `onError`
      callback(s). The most recent error may also be access via
      `lastError`.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

          // Add a fetched event
          that.onValidate(function (validator) {
            if (!that.data.first()) {
              throw "First name must not be empty.";
            }
          });
        }

      @seealso isValid
      @seealso onError
      @param {Function} Callback to execute when validating
      @return Reciever
    */
    that.onValidate = function (callback) {
      validators.push(callback);

      return this;
    };


    /*
      Send the save event to persist current data to the server.
      Only results in action in the "/ready/fetched/dirty" and
      "/ready/new" states.
    */
    that.save = function () {
      state.send("save");
    };

    /*
      Send an event to all properties.

      @param {String} event name.
      @returns receiver
    */
    that.sendToProperties = function (str) {
      var keys = Object.keys(d);

      keys.forEach(function (key) {
        d[key].state.send(str);
      });

      return this;
    };

    /*
      Set properties to the values of a passed object

      @param {Object} Data to set
      @param {Boolean} Silence change events
      @returns reciever
    */
    that.set = function (data, silent) {
      var keys;

      if (typeof data === "object") {
        keys = Object.keys(data);

        // Silence events if applicable
        if (silent) { that.sendToProperties("silence"); }

        // Loop through each attribute and assign
        keys.forEach(function (key) {
          if (typeof d[key] === "function") {
            d[key](data[key]);
          }
        });

        that.sendToProperties("report"); // TODO: History?
      }

      return this;
    };

    that.toJSON = function () {
      var keys = Object.keys(d),
        result = {};

      keys.forEach(function (key) {
        var value = d[key]();

        // If to-one relation only id is necessary
        if (isToOne(d[key])) {
          result[key] = value ? value.toJSON() : {};
          return;
        }
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

    doDelete = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        payload = {method: "DELETE", path: path(that.name, that.id)},
        callback = function () {
          lastFetched = result();
          that.set(result(), true);
          state.send('deleted');
        };

      ds.request(payload).then(result).then(callback);
    };

    doError = function (err) {
      lastError = err;
      errHandlers.forEach(function (handler) {
        handler(err);
      });
      state.send("error");
    };

    doFetch = function () {
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
        };

      ds.request(payload).then(result, handleErr).then(callback);
    };

    doPatch = function () {
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
        };

      if (that.isValid()) {
        ds.request(payload).then(result).then(callback);
      }
    };

    doPost = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        cache = that.toJSON(),
        payload = {method: "POST", path: path(that.plural),
          data: {data: cache}},
        callback = function () {
          jsonpatch.apply(cache, result());
          that.set(cache, true);
          state.send('fetched');
        };

      if (that.isValid()) {
        ds.request(payload).then(result).then(callback);
      }
    };

    doInit = function () {
      var props = model.properties,
        keys = Object.keys(props || {});

      keys.forEach(function (key) {
        var prop, func, defaultValue, name, cModel, cKeys, relation,
          p = props[key],
          type = p.type,
          value = data[key],
          formatter = {};

        // Define format for to-one
        if (isToOne(p)) {
          relation = type.relation;
          name = relation.slice(0, 1).toLowerCase() + relation.slice(1);

          // Need to to make sure transform knows to remove inapplicable props
          if (type.properties && type.properties.length) {
            cModel = JSON.parse(JSON.stringify(f.catalog.getModel(relation)));
            cKeys = Object.keys(cModel.properties);
            cKeys.forEach(function (key) {
              if (type.properties.indexOf(key) === -1 && key !== "id") {
                delete cModel.properties[key];
              }
            });
          }

          // Create a feather instance if not already
          formatter.toType = function (value) {
            if (value && value.isFeather) { value = value.toJSON(); }
            return f.feathers[name](value, cModel);
          };

          p.default = {};

        // Resolve formatter to standard type
        } else {
          formatter = f.formats[p.format] || f.types[p.type] || {};
        }

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

        // Carry other property definitions forward
        prop.description = props[key].description;
        prop.type = props[key].type;
        prop.default = func || defaultValue;

        // Report property changed event up to model
        prop.state.substateMap.Changing.exit(function () {
          state.send("changed");
        });

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

        d[key] = prop;
      });
    };

    path = function (name, id) {
      var ret = "/data/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    state = statechart.State.define(function () {
      this.enter(doInit);

      this.state("Ready", {H: "*"}, function () {
        this.event("fetch",  function () {
          this.goto("/Busy");
        });

        this.state("New", function () {
          this.enter(doClear);

          this.event("clear",  function () {
            this.goto("/Ready/New", {force: true});
          });
          this.event("save", function () {
            this.goto("/Busy/Saving");
          });
          this.event("delete", function () {
            this.goto("/Deleted");
          });
        });

        this.state("Fetched", function () {
          this.event("clear",  function () {
            this.goto("/Ready/New");
          });
          this.event("delete",  function () {
            this.goto("/Busy/Deleting");
          });

          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
          });

          this.state("Dirty", function () {
            this.event("save", function () {
              this.goto("/Busy/Saving/Patching");
            });
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
        });
        this.state("Saving", function () {
          this.state("Posting", function () {
            this.enter(doPost);
          });
          this.state("Patching", function () {
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
        this.event("clear",  function () {
          this.goto("/Ready/New");
        });
      });

      this.state("Deleting", function () {
        this.enter(doDelete);

        this.event("deleted",  function () {
          this.goto("/Deleted");
        });
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

}(f));

