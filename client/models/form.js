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

  var formModel,
    catalog = require("catalog"),
    model = require("model");


  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.
    @param {Object} Default data
    return {Object}
  */
  formModel = function (data) {
    var that, fn,
      feather = catalog.getFeather("Form");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);

    fn = function () {
      var keys,
        formFeather = that.data.feather(),
        result = [];
      if (!formFeather) { return result; }
      formFeather = catalog.getFeather(formFeather);
      keys = Object.keys(formFeather.properties);
      return keys.map(function (key) {
        return {value: key, label: key};
      });
    };
    that.addCalculated({
      name: "properties",
      type: "array",
      function: fn
    });

    return that;
  };

  catalog.register("models", "form", formModel);
  module.exports = formModel;

}());
