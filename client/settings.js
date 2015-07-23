/*global m, f */


(function (f) {
  "use strict";

  f.settings = function (name) {
    var state, doFetch, doPost,
      that = {};

    if (!name) { throw "Settings name is required"; }

    that.data = f.prop();

    doFetch = function () {
      var callback = function () {
          state.send('fetched');
        },
        url = "http://localhost:10010/settings/" + name;

      state.goto("/Busy");
      m.request({method: "GET", url: url})
        .then(that.data)
        .then(callback);
    };

    doPost = function () {
      state.goto("/Busy/Saving");
    };

    state = f.State.define(function () {
      this.state("Ready", function () {
        this.state("New", function () {
          this.event("fetch", doFetch);
          this.enter(function () { state.send("fetch"); });
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
    var that = f.settings("catalog");

    /**
      Return a model definition, including inherited properties.

      @param {String} Model name
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    that.getModel = function (name, includeInherited) {
      var catalog = that.data(),
        appendParent = function (child, parent) {
          var model = catalog[parent],
            modelProps = model.properties,
            childProps = child.properties,
            keys = Object.keys(modelProps);

          if (parent !== "Object") {
            appendParent(child, model.inherits || "Object");
          }

          keys.forEach(function (key) {
            if (childProps[key] === undefined) {
              childProps[key] = modelProps[key];
              childProps[key].inheritedFrom = parent;
            }
          });

          return child;
        },
        result = {name: name, inherits: "Object"},
        resultProps,
        modelProps,
        key;

      if (!catalog[name]) { return false; }

      /* Add other attributes after name */
      for (key in catalog[name]) {
        if (catalog[name].hasOwnProperty(key)) {
          result[key] = catalog[name][key];
        }
      }

      /* Want inherited properites before class properties */
      if (includeInherited !== false && name !== "Object") {
        result.properties = {};
        result = appendParent(result, result.inherits);
      } else {
        delete result.inherits;
      }

      /* Now add local properties back in */
      modelProps = catalog[name].properties;
      resultProps = result.properties;
      for (key in modelProps) {
        if (modelProps.hasOwnProperty(key)) {
          resultProps[key] = modelProps[key];
        }
      }

      return result;
    };

    return that;
  }());

}(f));
