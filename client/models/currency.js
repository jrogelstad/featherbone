/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
*/
/*jslint browser unordered*/
/*global f*/

function currency(data, feather) {
    feather = feather || f.catalog().getFeather("Currency");
    let model = f.createModel(data, feather);

    model.data.displayUnit.isReadOnly = function () {
        return !model.data.hasDisplayUnit();
    };

    model.data.displayUnit.isRequired = model.data.hasDisplayUnit;

    model.onChanged("hasDisplayUnit", function (prop) {
        if (!prop()) {
            model.data.displayUnit(null);
        }
    });

    model.onLoad(function () {
        model.data.code.isReadOnly(true);
    });

    model.onValidate(function () {
        let id;
        let displayUnit = model.data.displayUnit();
        let conversions = model.data.conversions().filter(
            (item) => item.state().current()[0] !== "/Delete"
        );

        function containsDisplayUnit(model) {
            return model.data.toUnit().id() === id;
        }

        if (displayUnit) {
            id = displayUnit.id();
            if (!conversions.some(containsDisplayUnit)) {
                throw "A conversion must exist for the display unit.";
            }
        }

        if (model.data.code().length > 4) {
            throw "code may not be more than 4 characters";
        }
    });

    return model;
}

f.catalog().registerModel("Currency", currency);

function currencyConversion(data, feather) {
    feather = feather || f.catalog().getFeather("CurrencyConversion");
    let model = f.createModel(data, feather);

    model.onValidate(function () {
        if (model.data.fromCurrency().id() === model.data.toCurrency().id()) {
            throw "'From' currency cannot be the same as 'to' currency.";
        }

        if (model.data.ratio() < 0) {
            throw "The conversion ratio nust be a positive number.";
        }
    });

    return model;
}

f.catalog().registerModel("CurrencyConversion", currencyConversion);

function currencyUnit(data, feather) {
    feather = feather || f.catalog().getFeather("CurrencyUnit");
    let model = f.createModel(data, feather);

    model.onValidate(function () {
        if (model.data.code().length > 4) {
            throw "code may not be more than 4 characters";
        }
    });

    return model;
}

f.catalog().registerModel("CurrencyUnit", currencyUnit);
