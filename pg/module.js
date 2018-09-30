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
    list = require("list"),
    f = require("common-core");

  // Add support for money format
  f.formats.money = {
    default: function () { return f.money(); },
    fromType: function (value) {
      var curr = catalog.store().data().currencies().find(function (curr) {
          return curr.data.code() === value.currency;
        }),
        minorUnit = curr.data.minorUnit(),
        style = {
          minimumFractionDigits: minorUnit,
          maximumFractionDigits: minorUnit
        };

      return {
        amount: value.amount.toLocaleString(undefined, style),
        currency: value.currency,
        effective: f.formats.dateTime.fromType(value.effective),
        ratio: f.types.number.fromType(value.ratio)
      };
    },
    toType: function (value) {
      return {
        amount: f.types.number.toType(value.amount),
        currency: f.formats.string.toType(value.currency),
        effective: f.formats.dateTime.toType(value.effective),
        ratio: f.types.number.toType(value.ratio)
      };
    }
  };

  /*
    Currency Model
  */
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

    that.onValidate(function () {
      var id,
        displayUnit = that.data.displayUnit(),
        conversions = that.data.conversions(),
        containsDisplayUnit = function (model) {
          return model.data.toUnit().id() === id;
        };

      if (displayUnit) {
        id = displayUnit.id();
        if (!conversions.some(containsDisplayUnit)) {
          throw "A conversion must exist for the display unit.";
        }
      }

      if (that.data.code().length > 4) {
        throw "code may not be more than 4 characters";
      }
    });

    return that;
  }

  currencyModel.list = list("Currency");

  catalog.register("models", "currency", currencyModel);
  module.exports = currencyModel;

  /*
    Currency Unit model
  */
  function currencyUnitModel (data) {
    var that,
      feather = catalog.getFeather("CurrencyUnit");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);

    that.onValidate(function () {
      if (that.data.code().length > 4) {
        throw "code may not be more than 4 characters";
      }
    });

    return that;
  }

  currencyUnitModel.list = list("CurrencyUnit");

  catalog.register("models", "currencyUnit", currencyUnitModel);
  module.exports = currencyUnitModel;

  /*
    Currency Unit Conversion model
  */
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
