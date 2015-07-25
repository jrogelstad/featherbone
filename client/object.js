/*global m, f */

(function (f) {
  "use strict";

  f.format = function (value) {
    // TO DO
  };

  /**
    Creates a property getter setter function with a default value.
    Includes state...

    @param {Any} Initial 
    @param {String} Format. Optional
    @return {Function}
  */
  f.prop = function (store, format) {
    var newValue, oldValue, p, state, revert;

    // Initialize state
    state = f.State.define(function () {
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
        newValue = value;
        oldValue = store;

        p.state.send("change");
        store = newValue;
        p.state.send("changed");

        newValue = undefined;
        oldValue = newValue;
      }

      return store;
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
      return oldValue;
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
    @param {Array} [my.name] the class name of the object
    @param {Array} [my.properties] the properties to set on the data object
    return {Object}
  */
  f.object = function (data, my) {
    data = data || {};
    my = my || {};

    var  state, doDelete, doFetch, doInit, doPatch, doPost, doProperties,
      that = {data: {}, name: my.name || "Object"},
      d = that.data,
      stateMap = {};

    // ..........................................................
    // PUBLIC
    //

    /*
      Send event to delete the current object from the server.
      Only executes in "/ready/clean" and "/ready/new" states.
    */
    that.delete = function () {
      state.send("delete");
    };

    /*
      Send event to fetch data based on the current id from the server.
      Only results in action in the "/ready" state.
    */
    that.fetch = function () {
      state.send("fetch");
    };

    /*
      Add a change event binding to a property or this object.

        f.contact = function (data, my) {
          var shared = {
              name: my.name || "Contact",
              properties: my.properties ||
                f.catalog.getModel("Contact").properties
            },
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

    doDelete = function () {
      that.state.goto("/Busy/Saving");
    };

    doFetch = function () {
      var result = m.prop({}),
        callback = function () {
          that.set(result(), true);
          state.send('fetched');
        },
        url = f.baseUrl() + my.name.toSpinalCase() + "/" + that.data.id();

      state.goto("/Busy");
      m.request({method: "GET", url: url})
        .then(result)
        .then(callback);
    };

    doInit = function () {
      doProperties(my.properties);
    };

    doPatch = function () {
      state.goto("/Busy/Saving");
    };

    doPost = function () {
      state.goto("/Busy/Saving");
    };

    doProperties = function (props) {
      var keys = Object.keys(props || {});

      keys.forEach(function (key) {
        var prop, func, defaultValue,
          value = data[key];

        // Handle default
        if (value === undefined && props[key].default !== undefined) {
          defaultValue = props[key].default;

          // Handle default that is a function
          if (typeof defaultValue === "string" &&
              defaultValue.match(/\(\)$/)) {
            func = f[defaultValue.replace(/\(\)$/, "")];
            value = func();
          } else {
            value = defaultValue;
          }
        }

        // Create property
        prop = f.prop(value);

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

    state = f.State.define(function () {
      this.state("Ready", function () {
        this.state("New", function () {
          this.enter(doInit);
          this.event("fetch", doFetch);
          this.event("save", doPost);
          this.event("delete", function () { this.goto("/Ready/Deleted"); });
        });

        this.state("Fetched", function () {
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
        // Prevent exiting from this state
        this.canExit = function () { return false; };
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

