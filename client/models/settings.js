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
    f = require("common-core"),
    stream = require("stream"),
    dataSource = require("datasource"),
    statechart = require("statechartjs"),
    jsonpatch = require("fast-json-patch");

  /*
    Model for handling settings.

    @param {String} Name
    @param {Object} [definition] Definition
    @param {Object} [definition.properties] Properties of definition
    @return {Object}
  */
  settings = function (name, definition) {
    var that, state, doInit, doFetch, doPut, doSend,
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

    that.canSave = function () {
      return state.resolve(state.current()[0]).canSave();
    };

    that.etag = stream();

    // Send event to fetch data based on the current id from the server.
    that.fetch = function () {
      return doSend("fetch");
    };

    that.id = function () {
      return name;
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

    that.save = function () {
      return doSend("save");
    };

    that.set = function (data) {
      Object.keys(props).forEach(function (key) {
        if (typeof props[key].type === "object") {
          that.data[key]().data.id(data[key].id);
          props[key].type.properties.forEach(function (prop) {
            that.data[key]().data[prop](data[key][prop]);
          });
          return;
        }
        that.data[key](data[key]);
      });
    };

    that.toJSON = function () {
      var keys = Object.keys(props),
        result = {};

      keys.forEach(function (key) {
        result[key] = d[key].toJSON();
      });

      return result;
    };

    doError = function (err) {
      lastError = err;
      errHandlers.forEach(function (handler) {
        handler(err);
      });
      state.send("error");
    };

    doFetch = function (context) {
      var payload = {method: "GET", path: "/settings/" + name},
        callback = function (result) {
          var data = result || {};
          that.set(data.data);
          that.etag(data.etag);
          state.send('fetched');
          context.resolve(d);
        };

      state.goto("/Busy");
      dataSource.request(payload).then(callback);
    };

    // If we have a formal definition, then set up each property as
    // a featherbone property
    doInit = function () {
      var keys = Object.keys(props);

      keys.forEach(function (key) {
        var rel, 
          isToOne = false,
          prop = f.prop();
          if (typeof props[key].type === "object") {
            rel = {data: {id: f.prop()}};
            props[key].type.properties.forEach(function (p) {
              rel.data[p] = f.prop();
            });
            prop(rel);
            isToOne = true;

            // Only include specified properties on relations
            prop.toJSON = function () {
              var val = {id: d[key]().data.id()};
              props[key].type.properties.forEach(function (pkey) {
                val[pkey] = d[key]().data[pkey].toJSON();
              });
              return val;
            };
          }
          prop.key = key; // Use of 'name' property is not allowed here
          prop.description = props[key].description;
          prop.type = props[key].type;
          prop.format = props[key].format;
          prop.isRequired(props[key].isRequired);
          prop.isReadOnly(props[key].isReadOnly);
          prop.isToOne = stream(isToOne);
          prop.isToMany = stream(false);
          prop.isCalculated = false;

          // Add state to map for event helper functions
          stateMap[key] = prop.state();

          // Report property changed event up to model
          that.onChanged(key, function () { state.send("changed"); });

          that.data[key] = prop;
      });
    };

    doPut = function (context) {
      var ds = dataSource,
        cache = {etag: that.etag(), data: that.toJSON()},
        payload = {method: "PUT", path: "/settings/" + name,
          data: cache},
        callback = function (result) {
          jsonpatch.apply(cache, result);
          that.set(cache.data);
          state.send('fetched');
          context.resolve(d);
        };

      if (that.isValid()) {
        ds.request(payload).then(callback);
      }
    };

    doSend = function (evt) {
      return new Promise (function (resolve) {
        state.send(evt, resolve);
      });
    };

    state = statechart.define(function () {
      this.enter(doInit);
      this.state("Ready", function () {
        this.event("fetch", function (resolve) {
          this.goto("/Busy", {
            context: {resolve: resolve}
          });
        });

        this.state("New", function () {
          this.canSave = stream(false);
        });

        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
            this.canSave = stream(false);
          });

          this.state("Dirty", function () {
            this.event("save", function (resolve) {
              this.goto("/Busy/Saving", {
                context: {resolve: resolve}
              });
            });
            this.canSave = that.isValid;
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
          this.canSave = stream(false);
        });
        this.state("Saving", function () {
          this.enter(doPut);
          this.canSave = stream(false);
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
        this.canSave = stream(false);
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

    // Initialize
    state.goto();

    return that;
  };

  module.exports = settings;

}());
