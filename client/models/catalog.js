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
    }

    return that;
  }());

}());
