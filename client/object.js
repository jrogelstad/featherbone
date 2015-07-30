/*global window, f */

(function (f) {
  "use strict";

  var statechart, jsonpatch;

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
      if (arguments.length) {
        if (formatter.toType(value) === store) { return; }

        newValue = value;
        oldValue = store;

        p.state.send("change");
        store = formatter.toType(newValue);
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

    var  doClear, doDelete, doFetch, doInit, doPatch, doPost,
      lastFetched, state,
      that = {data: {}, name: model.name || "Object", plural: model.plural},
      d = that.data,
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
      Add a change event binding to a property.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

          // Add a change event to a property
          that.onChange("first", function () {
            console.log("First name changed from " +
              this.oldValue() + " to " + this.newValue() + "!");
          });
        }

      @param {String} Property name to call on cahnge
      @param {Function} Function to call on change
      @return Reciever
    */
    that.onChange = function (name, func) {
      stateMap[name].substateMap.Changing.enter(func.bind(d[name]));

      return this;
    };

    /*
      Add a fetched event binding to the object.

        contact = function (data, model) {
          var shared = model || f.catalog.getModel("Contact"),
            that = f.object(data, shared);

          // Add a fetched event
          that.onFetched(function () {
            console.log("Data fetched!");
          });
        }

      @param {Function} Function to call on change
      @return Reciever
    */
    that.onFetched = function (func) {
      state.substateMap.Ready.substateMap.Fetched.enter(func.bind(that));

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

      keys.forEach(function (key) {
        var value = that.data[key].default;

        values[key] = typeof value === "function" ? value() : value;
      });

      that.set(values, true); // Uses silent option
      state.goto("/Ready/New");
    };

    doDelete = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        payload = {method: "DELETE", name: that.name, id: that.data.id()},
        callback = function () {
          lastFetched = result();
          that.set(result(), true);
          state.send('deleted');
        };

      state.goto("/Busy");
      ds.request(payload).then(result).then(callback);
    };

    doFetch = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        payload = {method: "GET", name: that.name, id: that.data.id()},
        callback = function () {
          lastFetched = result();
          that.set(result(), true);
          state.send('fetched');
        };

      state.goto("/Busy");
      ds.request(payload).then(result).then(callback);
    };

    doPatch = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        patch = jsonpatch.compare(lastFetched, that.toJSON()),
        payload = {method: "PATCH", name: that.name, id: that.data.id(),
          data: {data: patch}},
        callback = function () {
          jsonpatch.apply(lastFetched, patch); // Update to sent changes
          jsonpatch.apply(lastFetched, result()); // Update server side changes
          that.set(lastFetched, true);
          state.send('fetched');
        };

      state.goto("/Busy/Saving");
      ds.request(payload).then(result).then(callback);
    };

    doPost = function () {
      var ds = f.dataSource,
        result = f.prop({}),
        cache = that.toJSON(),
        payload = {method: "POST", name: that.plural, data: {data: cache}},
        callback = function () {
          jsonpatch.apply(cache, result());
          that.set(cache, true);
          state.send('fetched');
        };

      state.goto("/Busy/Saving");
      ds.request(payload).then(result).then(callback);
    };

    doInit = function () {
      var props = model.properties,
        keys = Object.keys(props || {});

      keys.forEach(function (key) {
        var prop, func, defaultValue, formatter,
          p = props[key],
          value = data[key];

        // Resolve formatter
        formatter = f.formats[p.format] || f.types[p.type] || {};

        // Handle default
        if (props[key].default !== undefined) {
          defaultValue = props[key].default;
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

    state = statechart.State.define(function () {
      this.enter(doInit);
      this.state("Ready", function () {
        this.state("New", function () {
          this.event("clear", doClear);
          this.event("fetch", doFetch);
          this.event("save", doPost);
          this.event("delete", function () { this.goto("/Ready/Deleted"); });
        });

        this.state("Fetched", function () {
          this.event("clear", doClear);
          this.state("Clean", function () {
            this.event("changed", function () { this.goto("../Dirty"); });
            this.event("delete", doDelete);
          });

          this.state("Dirty", function () {
            this.event("save", doPatch);
          });

          this.event("fetch", doFetch);
        });
      });

      this.state("Busy", function () {
        this.state("Fetching");
        this.state("Saving");

        this.event("fetched", function () { this.goto("/Ready/Fetched"); });
        this.event("deleted", function () { this.goto("/Deleted"); });
        this.event("error", function () { this.goto("/Error"); });
      });

      this.state("Deleted", function () {
        this.event("clear", doClear);
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

}(f));

