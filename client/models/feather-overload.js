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

function featherOverload(data, spec) {
    spec = spec || catalog.getFeather("FeatherOverload");
    let that;
    let d;

    function propertyNames() {
        let parent = that.parent();
        let names = parent.data.properties().map((prop) => prop.data.name());
        let inherits = parent.data.inherits();
        let inheritFeather;

        if (inherits) {
            inheritFeather = catalog.getFeather(inherits);
            names = names.concat(Object.keys(inheritFeather.properties));
        }

        names.sort();
        names = names.map(function (name) {
            return {
                value: name,
                label: name
            };
        });

        return names;
    }

    function handleReadOnly() {
        d.description.isReadOnly(!d.overloadDescription());
        d.alias.isReadOnly(!d.overloadAlias());
        d.type.isReadOnly(!d.overloadType());
        d.default.isReadOnly(!d.overloadDefault());
        d.dataList.isReadOnly(!d.overloadDataList());
    }

    that = model(data, spec);
    d = that.data;

    that.onChanged("overloadDescription", handleReadOnly);
    that.onChanged("overloadDescription", function () {
        if (!d.overloadDescription()) {
            d.description("");
        }
    });
    that.onChanged("overloadAlias", handleReadOnly);
    that.onChanged("overloadAlias", function () {
        if (!d.overloadAlias()) {
            d.alias("");
        }
    });
    that.onChanged("overloadType", handleReadOnly);
    that.onChanged("overloadType", function () {
        if (!d.overloadType()) {
            d.type("");
        } else {
            d.type({
                type: "relation"
            });
        }
    });
    that.onChanged("overloadDefault", handleReadOnly);
    that.onChanged("overloadDefault", function () {
        if (!d.overloadDefault()) {
            d.default("");
        }
    });
    that.onChanged("overloadDataList", handleReadOnly);
    that.onChanged("overloadDataList", function () {
        if (!d.overloadDataList()) {
            d.dataList("");
        }
    });

    that.state().resolve("/Ready/Fetched/Clean").enter(handleReadOnly);

    that.onValidate(function () {
        let names = propertyNames().map((item) => item.value);

        if (names.indexOf(d.name()) === -1) {
            throw new Error(
                "Property \"" + d.name() +
                "\" referenced in overload does not exist on this feather."
            );
        }

        if (d.overloadType()) {
            if (!d.type().relation) {
                throw new Error(
                    "Feather name required on relation type \"" +
                    d.name() + "\""
                );
            }
        }

        if (d.overloadDescription() && !d.description()) {
            throw new Error("Overload description is empty");
        }

        if (d.overloadAlias() && !d.alias()) {
            throw new Error("Overload alias is empty");
        }
    });

    // ..........................................................
    // PUBLIC
    //

    that.addCalculated({
        name: "propertyNames",
        type: "array",
        function: propertyNames
    });

    return that;
}

catalog.registerModel("FeatherOverload", featherOverload);
