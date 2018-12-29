/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint browser*/
(function () {
    "use strict";

    let catalog = require("catalog");
    let model = require("model");
    let list = require("list");

    /*
      Currency Conversion model
    */
    function currencyConversionModel(data, feather) {
        feather = feather || catalog.getFeather("CurrencyConversion");
        let that = model(data, feather);

        that.onValidate(function () {
            if (that.data.fromCurrency().id() === that.data.toCurrency().id()) {
                throw "'From' currency cannot be the same as 'to' currency.";
            }

            if (that.data.ratio() < 0) {
                throw "The conversion ratio nust be a positive number.";
            }
        });

        return that;
    }

    currencyConversionModel.list = list("CurrencyConversion");

    catalog.register("models", "currencyConversion", currencyConversionModel);
    module.exports.currencyConversion = currencyConversionModel;

}());