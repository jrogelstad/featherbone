(function () {
  "use strict";

  var model, isChild, isToOne, isToMany,
    f = require("feather-core"),
    m = require("mithril"),
    catalog = require("catalog"),
    dataSource = require("datasource"),
    jsonpatch = require("fast-json-patch"),
    statechart = require("statechartjs");

  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.

    @param {Object} Default data
    @param {Object} Feather
    @param {Array} [feather.name] the class name of the object
    @param {Array} [feather.properties] the properties to set on the data object
    return {Object}
  */
  model = function (data, feather) {
    data = data || {};
    feather = feather || {};

    var  doClear, doDelete, doError, doFetch, doInit, doPatch, doPost, doSend,
      doFreeze, doThaw, doRevert, validator, lastError, state,
      that = {data: {}, name: feather.name || "Object", plural: feather.plural},
      d = that.data,
      errHandlers = [],
      validators = [],
      stateMap = {},
      lastFetched = {},
      freezeCache = {};

    // ..........................................................
    // PUBLIC
    //

    that.canSave = function () {
      return state.resolve(state.current()[0]).canSave();
    };

    that.canUndo = function () {
      return state.resolve(state.current()[0]).canUndo();
    };

    that.canDelete = function () {
      return state.resolve(state.current()[0]).canDelete();
    };

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

      @param {Boolean} Automatically commit. Default false.
    */
    that.delete = function (autoSave) {
      var result = m.deferred();
      state.send("delete");
      if (autoSave) {
        result = doSend("save");
      }
      return result;
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
      Return the unique identifier value for the model.

      @returns {String}
    */
    that.id = function () {
      return d[that.idProperty()]();
    };

    /*
      The data property that is the unique identifier for the model.
      Default is "id".

      @param {String}
      @returns {String}
    */
    that.idProperty = m.prop("id");

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

      lastError = "";
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
      Add an event binding to a property that will be triggered before a
      property change. Pass a callback in and the property will be passed
      to the callback. The property will be passed to the callback as the
      first argument.

        var contact,
          catalog = require("catalog"),
          model = require("model");

        contact = function (data, feather) {
          var shared = feather || catalog.getFeather("Contact"),
            that = model(data, shared);
          // Add a change event to a property
          that.onChange("first", function (prop) {
            console.log("First name changing from " +
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
      Add an event binding to a property that will be triggered after a property
      change. Pass a callback in and the property will be passed to the
      callback. The property will be passed to the callback as the first
      argument.
        var contact,
          catalog = require("catalog"),
          model = require("model");

        contact = function (data, feather) {
          var shared = feather || catalog.getFeather("Contact"),
            that = model(data, shared);
          // Add a changed event to a property
          that.onChanged("first", function (prop) {
            console.log("First name is now " + prop() + "!");
          });
        }
      @param {String} Property name to call on cahnge
      @param {Function} Callback function to call on change
      @return Reciever
    */
    that.onChanged = function (name, callback) {
      var func = function () { callback(this); };

      stateMap[name].substateMap.Changing.exit(func.bind(d[name]));

      return this;
    };

    /*
      Add an error handler binding to the object. Pass a callback
      in and the error will be passed as an argument.
        var contact,
          catalog = require("catalog"),
          model = require("model");

        contact = function (data, feather) {
          var shared = feather || catalog.getFeather("Contact"),
            that = model(data, shared);
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
      Add a validator to execute when the `isValid` function is
      called, which is also called after saving events. Errors thrown
      by the validator will be caught and passed through `onError`
      callback(s). The most recent error may also be access via
      `lastError`.

        var contact,
          catalog = require("catalog"),
          model = require("model");

        contact = function (data, feather) {
          var shared = feather || catalog.getFeather("Contact"),
            that = model(data, shared),
            validator function () {
              if (!that.data.first()) {
                throw "First name must not be empty.";
              }
            };
          // Add a validator
          that.onValidate(validator);
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
      Returns a path to execute server requests.

      @param {String} Name
      @param {String} Id (Optional)
      @returns {String}
    */
    that.path = function (name, id) {
      var ret = "/data/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
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
      Send an event to all properties.
      @param {String} event name.
      @returns receiver
    */
    that.sendToProperties = function (str) {
      var keys = Object.keys(d);

      keys.forEach(function (key) {
        d[key].state().send(str);
      });

      return this;
    };

    /*
      Set properties to the values of a passed object
      @param {Object} Data to set
      @param {Boolean} Silence change events
      @returns reciever
    */
    that.set = function (data, silent, islastFetched) {
      var keys;

      if (islastFetched) {
        lastFetched = data;
      }

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

        that.sendToProperties("report");
      }

      return this;
    };

    that.state = function () {
      return state;
    };

    that.toJSON = function () {
      var keys = Object.keys(d),
        result = {};

      keys.forEach(function (key) {
        result[key] = d[key].toJSON();
      });

      return result;
    };

    that.undo = function () {
      state.send("undo");
    };

    // ..........................................................
    // PRIVATE
    //

    doClear = function (context) {
      var keys = Object.keys(that.data),
        values = {};

      // Bail if event that sent us here doesn't want to clear
      if (context && context.clear === false) { return; }

      // If first entry here with user data, clear for next time and bail
      if (data) {
        context.clear = false;
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
      var result = f.prop({}),
        id = that.idProperty(),
        payload = {method: "DELETE", path: that.path(that.name, d[id]())},
        callback = function () {
          that.set(result(), true, true);
          state.send('deleted');
          context.deferred.resolve(true);
        };

      dataSource.request(payload).then(result).then(callback);
    };

    doError = function (err) {
      lastError = err;
      errHandlers.forEach(function (handler) {
        handler(err);
      });
      state.send("error");
    };

    doFetch = function (context) {
      var result = f.prop({}),
        id = that.idProperty(),
        payload = {method: "GET", path: that.path(that.name, that.data[id]())},
        handleErr = function (err) {
          console.log(err);
        },
        callback = function () {
          that.set(result(), true, true);
          state.send('fetched');
          context.deferred.resolve(d);
        };

      dataSource.request(payload).then(result, handleErr).then(callback);
    };

    doFreeze = function () {
      var keys = Object.keys(d);

      // Make all props read only, but remember previous state
      keys.forEach(function(key) {
        var prop = d[key];
        freezeCache[key] = {};
        freezeCache[key].isReadOnly = prop.isReadOnly();
        prop.isReadOnly(true);
        if (prop.state().current()[0] !== "/Disabled") {
          prop.state().send("disable");
          prop.isDisabled = true;
        }
      });
    };

    doPatch = function (context) {
      var ds = dataSource,
        result = f.prop({}),
        patch = jsonpatch.compare(lastFetched, that.toJSON()),
        id = that.idProperty(),
        payload = {method: "PATCH", path: that.path(that.name, that.data[id]()),
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
      var ds = dataSource,
        result = f.prop({}),
        cache = that.toJSON(),
        payload = {method: "POST", path: that.path(that.plural),
          data: {data: cache}},
        callback = function () {
          jsonpatch.apply(cache, result());
          that.set(cache, true, true);
          state.send('fetched');
          context.deferred.resolve(d);
        };

      if (that.isValid()) {
        ds.request(payload).then(result).then(callback);
      }
    };

    doRevert = function () {
      that.set(lastFetched, true);
      this.goto("/Ready/Fetched/Clean");
    };

    doSend = function (evt) {
      var deferred = m.deferred();
      state.send(evt, deferred);
      return deferred.promise;
    };

    doThaw = function () {
      var keys = Object.keys(d);

      // Return read only props to previous state
      keys.forEach(function(key) {
        var prop = d[key];
        prop.state().send("enable");
        prop.isReadOnly(freezeCache[key].isReadOnly);
        if (freezeCache[key].isDisabled) {
          prop.state().send("enable");
        }
      });

      freezeCache = {};
    };

    doInit = function () {
      var onFetching, onFetched, extendArray,
        props = feather.properties,
        keys = Object.keys(props || {});

      onFetching = function () {
        state.goto("/Busy/Fetching");
      };
      onFetched = function () {
        state.goto("/Ready/Fetched");
      };

      // Function to extend child array if applicable
      extendArray = function (prop, name) {
        var isNew = true,
          cache = [],
          ary = prop();

        // Bind parent events to array
        state.resolve("/Ready/New").enter(function (context) {
          if (context && context.clear === false) { return; }
          isNew = true;
          ary.clear();
        });

        state.resolve("/Ready/Fetched").enter(function () {
          isNew = false;
        });

        // Extend array
        ary.add = function (value) {
          prop.state().send("change");
          if (value && value.isModel) { value = value.toJSON(); }

          // Create an instance
          value = catalog.store().models()[name](value);

          // Synchronize statechart
          state.resolve("/Busy/Fetching").enter(onFetching.bind(value));
          state.resolve("/Ready/Fetched").enter(onFetched.bind(value));

          // Disable save event on children
          value.state().resolve("/Ready/New").event("save");
          value.state().resolve("/Ready/Fetched/Dirty").event("save");

          // Notify parent if child becomes dirty
          value.state().resolve("/Ready/Fetched/Dirty").enter(function () {
            state.send("changed");
          });

          // Notify parent properties changed
          ary.push(value);
          cache.push(value);
          prop.state().send("changed");

          return value;
        };

        ary.clear = function () {
          prop.state().send("change");
          ary.length = 0;
          cache.length = 0;
          prop.state().send("changed");
        };

        ary.remove = function (value) {
          var result, idx, find,
            id = that.idProperty();

          find = function (item, i) {
            if (value.data[id]() === item.data[id]()) {
              idx = i;
              return true;
            }
          };

          if (ary.some(find)) {
            prop.state().send("change");
            result = ary.splice(idx, 1)[0];
            cache.some(find); // Find index on cache
            if (isNew) {
              cache.splice(idx, 1);
            } else {
              delete cache[idx];
            }
            state.send("changed");
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
            i += 1;
          }

          return result;
        };
      };

      // Loop through each model property and instantiate a data property
      keys.forEach(function (key) {
        var prop, func, defaultValue, name, cFeather, cKeys, cArray, relation,
          toType, scale,
          p = props[key],
          type = p.type,
          value = data[key],
          formatter = {};

        // Create properties for relations
        if (typeof p.type === "object") {
          if (isChild(p)) { return; } // Ignore child properties on client level

          relation = type.relation;
          name = relation.toCamelCase();

          if (isToOne(p)) {

            // Need to to make sure transform knows to ignore inapplicable props
            if (type.properties && type.properties.length) {
              cFeather = f.copy(catalog.getFeather(relation));
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
              result =  catalog.store().models()[name](value, cFeather);

              // Synchronize statechart
              state.resolve("/Busy/Fetching").enter(onFetching.bind(result));
              state.resolve("/Ready/Fetched").enter(onFetched.bind(result));

              // Disable save event on children
              result.state().resolve("/Ready/New").event("save");
              result.state().resolve("/Ready/Fetched/Dirty").event("save");

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

          if (p.type === "number") {
            scale = p.scale === undefined ? f.SCALE_DEFAULT : p.scale;
            toType = formatter.toType;
            formatter.fromType = function (value) {
              return value.toLocaleString(undefined, {
                maximumFractionDigits: scale
              });
            };
            formatter.toType = function (value) {
              var result = toType(value);
              return f.round(result, scale);
            };
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
        }

        // Carry other property definitions forward
        prop.key = key; // Use of 'name' property is not allowed here
        prop.description = props[key].description;
        prop.type = props[key].type;
        prop.format = props[key].format;
        prop.default = func || defaultValue;
        prop.isRequired(props[key].isRequired);
        prop.isReadOnly(props[key].isReadOnly);

        // Limit public access to state
        stateMap[key] = prop.state();
        prop.state = function () {
          return {
            current: function () {
              return stateMap[key].current();
            },
            send: function (str) {
              return stateMap[key].send(str);
            }
          };
        };

        // Report property changed event up to model
        that.onChanged(key, function () { state.send("changed"); });

        d[key] = prop;
      });
    };

    // Define state
    state = statechart.define(function () {
      this.enter(doInit);

      this.state("Ready", {H: "*"}, function () {
        this.event("fetch",  function (deferred) {
          this.goto("/Busy", {
            context: {deferred: deferred}
          });
        });

        this.state("New", function () {
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
          this.canDelete = m.prop(true);
          this.canSave = that.isValid;
          this.canUndo = m.prop(false);
        });

        this.state("Fetched", function () {
          this.event("clear",  function () {
            this.goto("/Ready/New");
          });
          this.event("delete",  function () {
            this.goto("/Delete");
          });

          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
            this.canDelete = m.prop(true);
            this.canSave = m.prop(false);
            this.canUndo = m.prop(false);
          });

          this.state("Dirty", function () {
            this.event("undo", doRevert);
            this.event("save", function (deferred) {
              this.goto("/Busy/Saving/Patching", {
                context: {deferred: deferred}
              });
            });
            this.canDelete = m.prop(false);
            this.canSave = that.isValid;
            this.canUndo = m.prop(true);
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
          this.canDelete = m.prop(false);
          this.canUndo = m.prop(false);
        });
        this.state("Saving", function () {
          this.state("Posting", function () {
            this.enter(doPost);
            this.canDelete = m.prop(false);
            this.canSave = m.prop(false);
            this.canUndo = m.prop(false);
          });
          this.state("Patching", function () {
            this.enter(doPatch);
            this.canDelete = m.prop(false);
            this.canUndo = m.prop(false);
          });
          this.canDelete = m.prop(false);
          this.canSave = m.prop(false);
          this.canUndo = m.prop(false);
        });
        this.state("Deleting", function () {
          this.enter(doDelete);

          this.event("deleted", function () {
            this.goto("/Deleted");
          });
          this.canDelete = m.prop(false);
          this.canSave = m.prop(false);
          this.canUndo = m.prop(false);
        });

        this.event("fetched", function () {
          this.goto("/Ready/Fetched/Clean");
        });
        this.event("error", function () {
          this.goto("/Ready", {
            context: {clear: false}
          });
        });
      });

      this.state("Delete", function () {
        this.enter(doFreeze);

        this.event("save",  function (deferred) {
          this.goto("/Busy/Deleting", {
            context: {deferred: deferred}
          });
        });

        this.event("undo",  function () {
          doThaw();
          this.goto("/Ready");
        });
        this.canDelete = m.prop(false);
        this.canSave = m.prop(false);
        this.canUndo = m.prop(true);
      });

      this.state("Deleted", function () {
        this.event("clear",  function () {
          this.goto("/Ready/New");
        });
        this.canDelete = m.prop(false);
        this.canSave = m.prop(false);
        this.canUndo = m.prop(false);
      });

      this.state("Deleting", function () {
        this.enter(doDelete);

        this.event("deleted",  function () {
          this.goto("/Deleted");
        });
        this.canDelete = m.prop(false);
        this.canSave = m.prop(false);
        this.canUndo = m.prop(false);
      });
    });

    // Add standard validator
    validator = function () {
      var name,
        keys = Object.keys(d),
        requiredIsNull = function (key) {
          if (d[key].isRequired() && d[key]() === null) {
            name = key;
            return true;
          }
        };

      // Validate required values
      if (keys.some(requiredIsNull)) {
        throw "\"" + name + "\" is required";
      }

    };
    that.onValidate(validator);

    // Initialize
    state.goto({context: {}});

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

  module.exports = model;

}());
