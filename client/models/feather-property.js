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
import f from "../core.js";
import catalog from "./catalog.js";
import model from "./model.js";

function featherProperty(data, spec) {
    spec = spec || catalog.getFeather("FeatherProperty");
    let that;
    let d;
    let types = {
        array: {
            formats: []
        },
        boolean: {
            formats: []
        },
        integer: {
            formats: []
        },
        number: {
            formats: []
        },
        string: {
            formats: [
                "color",
                "date",
                "dateTime",
                "email",
                "password",
                "script",
                "tel",
                "textArea",
                "url"
            ]
        },
        object: {
            formats: [
                "dataType",
                "money"
            ]
        }
    };

    // ..........................................................
    // PUBLIC
    //

    that = model(data, spec);
    d = that.data;

    function formats() {
        let type = that.data.type();
        let ret = [];

        if (types[type] && types[type].formats.length) {
            ret = types[type].formats.map(function (item) {
                return {
                    value: item,
                    label: item
                };
            });
            ret.unshift({
                value: "",
                label: ""
            });
        }

        return ret;
    }

    function handleReadOnly() {
        let isNotNumber = that.data.type() !== "number";

        d.scale.isReadOnly(isNotNumber);
        d.precision.isReadOnly(isNotNumber);
        d.min.isReadOnly(isNotNumber);
        d.max.isReadOnly(isNotNumber);
        d.isNaturalKey.isReadOnly(d.isLabelKey());
        d.isIndexed.isReadOnly(d.isNaturalKey());
        d.isLabelKey.isReadOnly(d.isNaturalKey());
    }

    that.addCalculated({
        name: "formats",
        type: "array",
        function: formats
    });

    that.onChanged("type", handleReadOnly);
    that.onChanged("type", function () {
        if (d.type() === "number") {
            d.scale(f.SCALE_DEFAULT);
            d.precision(f.PRECISION_DEFAULT);
        } else {
            d.scale(-1);
            d.precision(-1);
            d.min(0);
            d.max(0);
        }

        d.format.isReadOnly(formats().length === 0);
        d.format("");
    });
    that.onChanged("isNaturalKey", handleReadOnly);
    that.onChanged("isNaturalKey", function () {
        if (d.isNaturalKey()) {
            d.isIndexed(false);
        }
    });
    that.onChanged("isLabelKey", handleReadOnly);

    that.state().resolve("/Ready/Fetched/Clean").enter(handleReadOnly);

    that.onValidate(function () {
        let type = that.data.type();

        if (typeof type !== "string") {
            if (!type.relation) {
                throw new Error(
                    "Feather name required on relation type \"" +
                    that.data.name() + "\""
                );
            }

            if (
                !type.childOf &&
                !type.parentOf && (
                    !type.properties || !type.properties.length
                )
            ) {
                throw new Error(
                    "One or more properties required on relation type \"" +
                    that.data.name() + "\""
                );
            }
        }
    });

    return that;
}

catalog.registerModel("FeatherProperty", featherProperty);
