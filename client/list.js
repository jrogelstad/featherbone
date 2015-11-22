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

/*global f, m, Qs */
(function (f) {
  "use strict";

  /**
    Return a function that when called will return an array of models
    based on the feather name passed. The function accepts an object supporting
    the following options:

      fetch: Boolean flags whether to automatically fetch a list of models.
      filter: A filter object definition

    The model array includes support for the following three functions:

      add(model): Adds the passed model to the array.
      remave(model): Removes the passed model from the array.
      fetch (filter): Requeries the server for new results.


    @param {String} Feather name
    @return {Function}
  */
  f.list = function (feather) {
    var state, doFetch, doSave,
      plural = f.catalog.getFeather(feather).plural.toSpinalCase(),
      name = feather.toCamelCase(),
      ary = [],
      idx = {},
      prop = m.prop(ary);

    ary.fetch = function (filter, merge) {
      ary.filter(filter || {});
      state.send("fetch", merge);
    };

    ary.filter = m.prop({});

    // Add a model to the list. Will replace existing
    // if model with same id is already found in array
    ary.add = function (model) {
      var id = model.data.id();
      if (!isNaN(idx[id])) {
        ary.splice(idx[id], 1, model);
      } else {
        idx[id] = ary.length;
        ary.push(model);
      }
    };

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

    ary.save = function () {
      state.send("fetch");
    };

    ary.state = function () {
      return state;
    };

    // ..........................................................
    // PRIVATE
    //

    doFetch = function (context) {
      var filter = Qs.stringify(ary.filter()),
        url = "/data/" + plural + "/" + filter;

      return m.request({
        method: "GET",
        url: url
      }).then(function (data) {
        var model,
          len = data.length,
          i = 0;
        if (context.merge === false) { 
          ary.length = 0;
          idx = {};
        }
        while (i < len) {
          model = f.models[name]();
          model.set(data[i], true, true);
          model.state().goto("/Ready/Fetched");
          ary.add(model);
          i += 1;
        }
      });
    };

    doSave = function () {

    };

    // Define statechart
    state = f.statechart.State.define(function () {
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
        });

        this.event("fetched", function () {
          this.goto("/Fetched");
        });
      });

      this.state("Fetched", function () {
        this.event("fetch", function (merge) {
          this.goto("/Busy", {context: {merge: merge}});
        });
        this.state("Clean", function () {
          this.event("changed", function () {
            this.goto("../Dirty");
          });
        });

        this.state("Dirty", function () {
          this.event("save", function () {
            this.goto("/Busy/Saving");
          });
        });
      });
    });

    return function (options) {
      options = options || {};
      ary = options.value || ary;
      ary.filter(options.filter || {});

      // Initialize state
      ary.state().goto();

      if (options.fetch !== false) {
        ary.fetch(options.merge);
      }

      return prop;
    };
  };

}(f));
