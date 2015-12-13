(function () {
  "use strict";

  var list,
    m = require("mithril"),
    qs = require("Qs"),
    catalog = require("catalog"),
    statechart = require("statechartjs");

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
  list = function (feather) {
    var state, doFetch, doSave, onClean, onDirty,
      plural = catalog.getFeather(feather).plural.toSpinalCase(),
      name = feather.toCamelCase(),
      models = catalog.store().models(),
      ary = [],
      idx = {},
      dirty = [],
      prop = m.prop(ary);

    onClean = function () {
      dirty.remove(this);
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

    ary.fetch = function (filter, merge) {
      ary.filter(filter || {});
      state.send("fetch", merge);
    };

    ary.filter = m.prop({});

    // Add a model to the list. Will replace existing
    // if model with same id is already found in array
    ary.add = function (model) {
      var  mstate,
        idProperty = model.idProperty(),
        id = model.data[idProperty](),
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

      if (model.state().current()[0] === "/Ready/New") {
        dirty.push(model);
        state.send("changed");
      }
    };

    // Remove a model from the list
    ary.remove = function (model) {
      var idProperty = model.idProperty(),
        id = model.data[idProperty](),
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

    ary.save = function () {
      state.send("save");
    };

    ary.state = function () {
      return state;
    };

    // ..........................................................
    // PRIVATE
    //

    doFetch = function (context) {
      var filter = qs.stringify(ary.filter()),
        url = "/data/" + plural + "/" + filter;

      return m.request({
        method: "GET",
        url: url
      }).then(function (data) {
        if (context.merge === false) { 
          ary.length = 0;
          dirty.length = 0;
          idx = {};
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
        model.save().then(function() {
          if (model.state().current()[0] === "/Deleted") {
            ary.remove(model);
          }
        });
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

    return function (options) {
      options = options || {};
      ary = options.value || ary;

      if (options.fetch !== false) {
        ary.fetch(options.filter, options.merge);
      } else {
        ary.filter(options.filter || {});
      }

      return prop;
    };
  };

  module.exports = list;

}());
