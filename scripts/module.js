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
/*global require, module*/
/*jslint*/
(function () {
    "strict";

    var catalog = require("catalog"),
        model = require("model"),
        list = require("list");

    /*
      Contact Model
    */
    function contactModel(data, feather) {
        feather = feather || catalog.getFeather("Contact");
        var that = model(data, feather),
            d = that.data;

        function handleName() {
            if (d.firstName()) {
                d.fullName(d.firstName() + " " + d.lastName());
            } else {
                d.fullName(d.lastName());
            }
        }

        that.onChanged("firstName", handleName);
        that.onChanged("lastName", handleName);

        return that;
    }

    contactModel.list = list("Contact");

    catalog.register("models", "contact", contactModel);
    module.exports = contactModel;

    /*
      Currency Model
    */
    function currencyModel(data, feather) {
        feather = feather || catalog.getFeather("Currency");
        var that = model(data, feather);

        // To-one relations don't have or need all the attributes
        if (that.data.displayUnit) {
            that.data.displayUnit.isReadOnly = function () {
                return !that.data.hasDisplayUnit();
            };

            that.data.displayUnit.isRequired = that.data.hasDisplayUnit;

            that.onChanged("hasDisplayUnit", function (prop) {
                if (!prop()) {
                    that.data.displayUnit(null);
                }
            });
        }

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
      Currency Conversion model
    */
    function currencyConversionModel(data, feather) {
        feather = feather || catalog.getFeather("CurrencyConversion");
        var that = model(data, feather);

        that.onValidate(function () {
            if (that.data.fromCurrency().id() === that.data.toCurrency().id()) {
                throw "'From' currency cannot be the same as the 'to' currency.";
            }

            if (that.data.ratio() < 0) {
                throw "The conversion ratio nust be a positive number.";
            }
        });

        return that;
    }

    currencyConversionModel.list = list("CurrencyConversion");

    catalog.register("models", "currencyConversion", currencyConversionModel);
    module.exports = currencyConversionModel;

    /*
      Currency Unit model
    */
    function currencyUnitModel(data, feather) {
        feather = feather || catalog.getFeather("CurrencyUnit");
        var that = model(data, feather);

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

}());