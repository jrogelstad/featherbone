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

  var settings,
    store = {},
    f = require("component-core"),
    m = require("mithril"),
    dataSource = require("datasource"),
    statechart = require("statechartjs");

  /*
    Model for handling settings.

    @param {String} Name
    @param {Object} [definition] Definition
    @param {Object} [definition.properties] Properties of definition
    @return {Object}
  */
  settings = function (name, definition) {
    var that, state, init, doFetch, doPost, 
      lastError, doError, validator, d,
      errHandlers = [],
      stateMap = {},
      validators = [],
      props = definition.properties;

    if (!name) { throw "Settings name is required"; }
    store[name] = store[name] || {};
    that = store[name];
    that.data = store[name].data || {};
    d = that.data;

    // If we have a formal definition, then set up each property as
    // a featherbone property
    init = function () {
      var keys = Object.keys(props);

      keys.forEach(function (key) {
        var rel,
          prop = f.prop();
          if (typeof props[key].type === "object") {
            rel = {data: {id: f.prop()}};
            props[key].type.properties.forEach(function (p) {
              rel.data[p] = f.prop();
            });
            prop(rel);
          }
          prop.key = key; // Use of 'name' property is not allowed here
          prop.description = props[key].description;
          prop.type = props[key].type;
          prop.format = props[key].format;
          prop.isRequired(props[key].isRequired);
          prop.isReadOnly(props[key].isReadOnly);
          prop.isCalculated = false;

          // Add state to map for event helper functions
          stateMap[key] = prop.state();

          // Report property changed event up to model
          that.onChanged(key, function () { state.send("changed"); });

          that.data[key] = prop;
      });
    };

    // Send event to fetch data based on the current id from the server.
    that.fetch = function (merge) {
      var deferred = m.deferred();
      state.send("fetch", {deferred: deferred, merge: merge});
      return deferred.promise;
    };

    that.id = function () {
      return name;
    };

    that.canSave = function () {
      return state.resolve(state.current()[0]).canSave();
    };

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

    that.onChange = function (name, callback) {
      var func = function () { callback(this); };

      stateMap[name].substateMap.Changing.enter(func.bind(d[name]));

      return this;
    };

    that.onChanged = function (name, callback) {
      var func = function () { callback(this); };

      stateMap[name].substateMap.Changing.exit(func.bind(d[name]));

      return this;
    };

    that.onValidate = function (callback) {
      validators.push(callback);

      return this;
    };

    doError = function (err) {
      lastError = err;
      errHandlers.forEach(function (handler) {
        handler(err);
      });
      state.send("error");
    };

    doFetch = function (context) {
      var result = m.prop(),
        payload = {method: "GET", path: "/settings/" + name},
        callback = function () {
          var data = result() || {};

          Object.keys(props).forEach(function (key) {
            if (typeof props[key].type === "object") {
              props[key].type.properties.forEach(function (prop) {
                that.data[key]().data[prop](data[key][prop]);
              });
              return;
            }
            that.data[key](data[key]);
          });

          state.send('fetched');
          context.deferred.resolve(that.data);
        };

      state.goto("/Busy");
      dataSource.request(payload).then(result).then(callback);
    };


    doPost = function () {}; // TODO

    state = statechart.define(function () {
      this.state("Ready", function () {
        this.event("fetch", function (context) {
          this.goto("/Busy", {
            context: context
          });
        });

        this.state("New", function () {
          this.canSave = m.prop(false);
        });

        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
            this.canSave = m.prop(false);
          });

          this.state("Dirty", function () {
            this.event("save", function (context) {
              this.goto("/Busy/Saving", {
                context: context
              });
            });
            this.canSave = that.isValid;
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
          this.canSave = m.prop(false);
        });
        this.state("Saving", function () {
          this.enter(doPost);
          this.canSave = m.prop(false);
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
        this.canSave = m.prop(false);
      });
    });

    // Add standard validator that checks required properties
    validator = function () {
      var pname,
        keys = Object.keys(d),
        requiredIsNull = function (key) {
          var prop = d[key];
          if (prop.isRequired() && (prop() === null ||
            (prop.type === "string" && !prop()))) {
            pname = key;
            return true;
          }
        };

      // Validate required values
      if (keys.some(requiredIsNull)) {
        throw "\"" + pname.toName() + "\" is required";
      }

    };
    that.onValidate(validator);

    init();

    // Initialize
    state.goto();

    return that;
  };

  module.exports = settings;

}());
