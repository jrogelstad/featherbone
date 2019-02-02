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
import catalog from "./catalog.js";
import model from "./model.js";

/*
  Currency Model
*/
function currency(data, feather) {
    feather = feather || catalog.getFeather("Currency");
    let that = model(data, feather);

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
        let id;
        let displayUnit = that.data.displayUnit();
        let conversions = that.data.conversions().filter(
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

        if (that.data.code().length > 4) {
            throw "code may not be more than 4 characters";
        }
    });

    return that;
}

catalog.registerModel("Currency", currency, true);
