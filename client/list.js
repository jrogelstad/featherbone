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

    The model array includes support for the following two functions:

      remave(model): Removes the passed model frome the array.
      fetch (filter): Requeries the server for new results.


    @param {String} Feather name
    @return {Function}
  */
  f.list = function (feather) {
    var fetch,
      plural = f.catalog.getFeather(feather).plural.toSpinalCase(),
      name = feather.toCamelCase(),
      ary = [],
      idx = {},
      value = m.prop(ary);

    fetch = function (filter) {
      filter = Qs.stringify(filter);
      var url = "/data/" + plural + "/" + filter;
      return m.request({
        method: "GET",
        url: url
      }).then(function (data) {
        var id, model,
          len = data.length,
          i = 0;
        while (i < len) {
          id = data[i].id;
          model = f.models[name](data[i]);
          model.state.goto("/Ready/Fetched");
          if (!isNaN(idx[id])) {
            ary.splice(idx[id], 1, model);
          } else {
            idx[id] = ary.length;
            ary.push(model);
          }
          i++;
        }
      });
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

    return function (options) {
      options = options || {};
      ary = options.value || ary;
      var filter = options.filter,
        doFetch = options.fetch === undefined ? true : options.fetch;

      if (options.merge === false) { ary.length = 0; }
      if (doFetch) { fetch(filter); }
      return value;
    };
  };

}(f));
