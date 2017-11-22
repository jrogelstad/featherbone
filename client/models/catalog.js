/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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

  var store = {},
    m = require("mithril"),
    settings = require("settings");

  store.data = m.prop({});

  // Invoke catalog settings as an object
  module.exports = (function () {
    var that = settings("catalog");

    /**
      Return a model specification (feather) including inherited properties.

      @param {String} Feather
      @param {Boolean} Include inherited or not. Defult = true.
      @return {String}
    */
    that.getFeather = function (feather, includeInherited) {
      var resultProps, modelProps, appendParent,
        catalog = that.data(),
        result = {name: feather, inherits: "Object"};

      appendParent = function (child, parent) {
        var model = catalog[parent],
          parentProps = model.properties,
          childProps = child.properties,
          keys = Object.keys(parentProps);

        if (parent !== "Object") {
          appendParent(child, model.inherits || "Object");
        }

        keys.forEach(function (key) {
          if (childProps[key] === undefined) {
            childProps[key] = parentProps[key];
            childProps[key].inheritedFrom = parent;
          }
        });

        return child;
      };

      if (!catalog[feather]) { return false; }

      // Add other attributes after nam
      Object.keys(catalog[feather]).forEach(function (key) {
        result[key] = catalog[feather][key];
      });

      // Want inherited properites before class properties
      if (includeInherited !== false && feather !== "Object") {
        result.properties = {};
        result = appendParent(result, result.inherits);
      } else {
        delete result.inherits;
      }

      // Now add local properties back in
      modelProps = catalog[feather].properties;
      resultProps = result.properties;
      Object.keys(modelProps).forEach(function (key) {
        resultProps[key] = modelProps[key];
      });

      return result;
    };

    that.register = function (property, name, value) {
      if (!store[property]) {
        store[property] = m.prop({});
      }
      if (arguments.length > 1) {
        store[property]()[name] = value;
      }
      return store[property]();
    };

    that.data = store.data;

    // Expose global store data
    that.store = function () {
      return store;
    };

    that.settings = function () {
      return settings;
    }

    return that;
  }());

}());
