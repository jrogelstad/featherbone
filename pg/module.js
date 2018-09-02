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
  "strict";

  var catalog = require("catalog"),
    model = require("model"),
    list = require("list");

  function currencyModel (data) {
    var that,
      feather = catalog.getFeather("Currency");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);
    that.data.displayUnit.isReadOnly = function () {
  		return !that.data.hasDisplayUnit();
  	};
  	that.data.displayUnit.isRequired = that.data.hasDisplayUnit;
    that.onChanged("hasDisplayUnit", function (prop) {
      if (!prop()) {
      	that.data.displayUnit(null);
      }
    });

    return that;
  }

  currencyModel.list = list("Currency");

  catalog.register("models", "currency", currencyModel);
  module.exports = currencyModel;

  function currencyUnitConversionModel (data) {
    var that,
      feather = catalog.getFeather("CurrencyUnitConversion");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);
    that.parent.state().substateMap.Changing.exit(function () {
      that.data.fromUnit = that.parent().data.systemUnit;
    });

    return that;
  }

  currencyUnitConversionModel.list = list("CurrencyUnitConversion");

  catalog.register("models", "currencyUnitConversion", currencyUnitConversionModel);
  module.exports = currencyUnitConversionModel;

}());
