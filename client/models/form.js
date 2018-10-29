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

  var formModel,
    catalog = require("catalog"),
    model = require("model");

  formModel = function (data) {
    var that, properties, modules, feathers,
      feather = catalog.getFeather("Form");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);

    properties = function () {
      var keys,
        formFeather = that.data.feather(),
        result = [];
      if (!formFeather) { return result; }
      formFeather = catalog.getFeather(formFeather);
      keys = Object.keys(formFeather.properties || []);
      return keys.map(function (key) {
        return {value: key, label: key};
      });
    };

    that.addCalculated({
      name: "properties",
      type: "array",
      function: properties
    });

    feathers = function () {
      var tables = catalog.store().feathers(),
        keys = Object.keys(tables);

      keys = keys.filter(function (key) {
        return !tables[key].isSystem;
      }).sort();

      return keys.map(function (key) {
        return {value: key, label: key};
      });
    };

    that.addCalculated({
      name: "feathers",
      type: "array",
      function: feathers
    });

    modules = function () {
      var tables = catalog.store().feathers(),
        keys = Object.keys(tables),
        ary = [];

      keys.forEach(function (key) {
        var mod = tables[key].module;
        if (mod && ary.indexOf(mod) === -1) {
          ary.push(mod);
        }
      });

      return ary.map(function (item) {
        return {value: item, label: item};
      });
    };

    that.addCalculated({
      name: "modules",
      type: "array",
      function: modules
    });

    return that;
  };

  catalog.register("models", "form", formModel);
  module.exports = formModel;

}());
