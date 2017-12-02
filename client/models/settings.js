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
    f = require("feather-core"),
    m = require("mithril"),
    dataSource = require("datasource"),
    statechart = require("statechartjs");

  settings = function (name) {
    var that, state, doFetch, doPost;

    if (!name) { throw "Settings name is required"; }
    store[name] = store[name] || {};
    that = store[name];
    that.data = that.data || f.prop({});

    // Send event to fetch data based on the current id from the server.
    that.fetch = function (merge) {
      var deferred = m.deferred();
      state.send("fetch", {deferred: deferred, merge: merge});
      return deferred.promise;
    };

    doFetch = function (context) {
      var result = m.prop(),
        payload = {method: "GET", path: "/settings/" + name},
        callback = function () {
          var merge,
            data = result() || {};
          if (context.merge) {
            merge = that.data();
            Object.keys(data).forEach(function (key) {
              merge[key] = data[key];
            });
            data = merge;
          }
          that.data(data);
          state.send('fetched');
          context.deferred.resolve(that.data);
        };

      state.goto("/Busy");
      dataSource.request(payload).then(result).then(callback);
    };

    doPost = function () {
      // TODO
    };

    state = statechart.define(function () {
      this.state("Ready", function () {
        this.event("fetch", function (context) {
          this.goto("/Busy", {
            context: context
          });
        });

        this.state("New");
        this.state("Fetched", function () {
          this.state("Clean", function () {
            this.event("changed", function () {
              this.goto("../Dirty");
            });
          });

          this.state("Dirty", function () {
            this.event("save", function (context) {
              this.goto("/Busy/Saving", {
                context: context
              });
            });
          });
        });
      });

      this.state("Busy", function () {
        this.state("Fetching", function () {
          this.enter(doFetch);
        });
        this.state("Saving", function () {
          this.enter(doPost);
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

  module.exports = settings;

}());
