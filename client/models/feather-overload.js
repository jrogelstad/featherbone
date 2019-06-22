/*
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
*/
import catalog from "./catalog.js";
import f from "../core.js";

function featherOverload(data, spec) {
    spec = spec || catalog.getFeather("FeatherOverload");
    spec.properties.type.default = "";
    spec.properties.default.default = "";

    let model;
    let d;

    function propertyNames() {
        let parent = model.parent();
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
        names.unshift({
            value: "",
            label: ""
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

    model = f.createModel(data, spec);
    d = model.data;

    model.onChanged("overloadDescription", handleReadOnly);
    model.onChanged("overloadDescription", function () {
        if (!d.overloadDescription()) {
            d.description("");
        }
    });
    model.onChanged("overloadAlias", handleReadOnly);
    model.onChanged("overloadAlias", function () {
        if (!d.overloadAlias()) {
            d.alias("");
        }
    });
    model.onChanged("overloadType", handleReadOnly);
    model.onChanged("overloadType", function () {
        if (!d.overloadType()) {
            d.type("");
        } else {
            d.type({
                type: "relation"
            });
        }
    });
    model.onChanged("overloadDefault", handleReadOnly);
    model.onChanged("overloadDefault", function () {
        if (!d.overloadDefault()) {
            d.default("");
        }
    });
    model.onChanged("overloadDataList", handleReadOnly);
    model.onChanged("overloadDataList", function () {
        if (!d.overloadDataList()) {
            d.dataList("");
        }
    });

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
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

    model.addCalculated({
        name: "propertyNames",
        type: "array",
        function: propertyNames
    });

    return model;
}

catalog.registerModel("FeatherOverload", featherOverload);
