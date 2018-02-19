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

  var list, createList,
    m = require("mithril"),
    stream = require("stream"),
    qs = require("Qs"),
    catalog = require("catalog"),
    statechart = require("statechartjs"),
    LIMIT = 20;

  /**
    Return a function that when called will return an array of models
    based on the feather name passed. The function accepts an object supporting
    the following options:

      fetch: Boolean flags whether to automatically fetch a list of models.
      filter: A filter object definition

    The model array includes support for the following three functions:

      add(model): Adds the passed model to the array.
      remove(model): Removes the passed model from the array.
      fetch (filter): Requeries the server for new results.

    @param {String} Feather name
    @return {Function}
  */
  list = function (feather) {
    // Instantiate the list, optionally auto fetch
    // and return a property that contains the array.
    return function (options) {
      options = options || {};
      var plural,
        ary = options.value || createList(feather),
        prop = stream(ary);

      if (options.path) { 
        ary.path(options.path);
      } else {
        plural = catalog.getFeather(feather).plural.toSpinalCase();
        ary.path("/data/" + plural + "/");
      }

      if (options.fetch !== false) {
        ary.fetch(options.filter, options.merge);
      } else {
        ary.filter(options.filter || {});
      }

      return prop;
    };
  };

  // ..........................................................
  // PRIVATE
  //

  createList = function (feather) {
    var state, doFetch, doSave, onClean, onDirty, onDelete,
      models = catalog.store().models(),
      name = feather.toCamelCase(),
      ary = [],
      dirty = [];

    // ..........................................................
    // PUBLIC
    //

    // Add a model to the list. Will replace existing
    // if model with same id is already found in array
    ary.add = function (model) {
      var  mstate,
        id = model.id(),
        idx = ary.index(),
        oid = idx[id];

      if (!isNaN(oid)) {
        dirty.remove(ary[oid]);
        ary.splice(oid, 1, model);
      } else {
        idx[id] = ary.length;
        ary.push(model);
      }

      mstate = model.state();
      mstate.resolve("/Delete").enter(onDirty.bind(model));
      mstate.resolve("/Ready/Fetched/Dirty").enter(onDirty.bind(model));
      mstate.resolve("/Ready/Fetched/Clean").enter(onClean.bind(model));
      mstate.resolve("/Deleted").enter(onDelete.bind(model));

      if (model.state().current()[0] === "/Ready/New") {
        dirty.push(model);
        state.send("changed");
      }
    };

    ary.canFilter = stream(true);

    ary.fetch = function (filter, merge) {
      ary.filter(filter || {});
      state.send("fetch", merge);
    };

    ary.filter = stream({});

    ary.index = stream({});

    ary.path = stream();

    /*
      Array of properties to fetch if only a subset required.
      If undefined, then all properties returned.
    */
    ary.properties = stream();

    // Remove a model from the list
    ary.remove = function (model) {
      var id = model.id(),
        idx = ary.index(),
        i = idx[id];

      if (!isNaN(i)) {
        ary.splice(i, 1);
        Object.keys(idx).forEach(function (key) {
          if (idx[key] > i) { idx[key] -= 1; }
        });
        delete idx[id];
      }
      dirty.remove(model);
    };

    ary.reset = function () {
      ary.length = 0;
      dirty.length = 0;
      ary.index({});
    };

    ary.save = function () {
      state.send("save");
    };

    ary.state = function () {
      return state;
    };

    // ..........................................................
    // PRIVATE
    //

    onClean = function () {
      dirty.remove(this);
      state.send("changed");
    };

    onDelete = function () {
      ary.remove(this);
      state.send("changed");
    };

    onDirty = function () {
      dirty.push(this);
      state.send("changed");
    };

    dirty.remove = function (model) {
      var i = dirty.indexOf(model);
      if (i > -1) { dirty.splice(i, 1); }
    };

    doFetch = function (context) {
      var url,
        query = {};

      if (ary.properties()) {
        query.properties = ary.properties();
      }
      if (ary.filter()) {
        query.filter = ary.filter();
        query.filter.limit = query.filter.limit || LIMIT;
      }
      query = qs.stringify(query);
      url = ary.path() + query;

      return m.request({
        method: "GET",
        url: url
      }).then(function (data) {
        if (context.merge === false) { 
          ary.reset();
        }
        data.forEach(function (item) {
          var model = models[name]();
          model.set(item, true, true);
          model.state().goto("/Ready/Fetched");
          ary.add(model);
        });
        state.send("fetched");
      });
    };

    doSave = function () {
      dirty.forEach(function (model) {
        model.save();
      });
    };

    // Define statechart
    state = statechart.define(function () {
      this.state("Unitialized", function () {
        this.event("fetch", function (merge) {
          this.goto("/Busy", {context: {merge: merge}});
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
        });
        this.state("Saving", function () {
          this.enter(doSave);
          this.event("changed", function () {
            this.goto("/Fetched");
          });
          this.canExit = function () {
            return !dirty.length;
          };
        });
        this.event("fetched", function () {
          this.goto("/Fetched");
        });
      });

      this.state("Fetched", function () {
        this.event("changed", function () {
          this.goto("/Fetched", {force: true});
        });
        this.C(function() {
          if (dirty.length) { 
            return "./Dirty";
          }
          return "./Clean";
        });
        this.event("fetch", function (merge) {
          this.goto("/Busy", {context: {merge: merge}});
        });
        this.state("Clean", function () {
          this.enter(function () {
            dirty.length = 0;
          });
        });
        this.state("Dirty", function () {
          this.event("save", function () {
            this.goto("/Busy/Saving");
          });
        });
      });
    });
    state.goto();

    return ary;
  };

  module.exports = list;

}());
