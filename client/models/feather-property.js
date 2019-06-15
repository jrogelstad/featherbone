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
import f from "../core.js";
import catalog from "./catalog.js";
import model from "./model.js";

function featherProperty(data, spec) {
    spec = spec || catalog.getFeather("FeatherProperty");
    spec.properties.type.default = "string";
    spec.properties.default.default = "";

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
        let isNotNumber = d.type() !== "number";
        let pd = that.parent().data;
        let parentHasNaturalKey = (
            pd.properties().some(
                (prop) => prop !== that && prop.data.isNaturalKey()
            ) ||
            pd.inheritedProperties().some((prop) => prop.data.isNaturalKey())
        );
        let parentHasLabelKey = (
            pd.properties().some(
                (prop) => prop !== that && prop.data.isLabelKey()
            ) ||
            pd.inheritedProperties().some((prop) => prop.data.isLabelKey())
        );
        let type = d.type();

        d.scale.isReadOnly(isNotNumber);
        d.precision.isReadOnly(isNotNumber);
        d.min.isReadOnly(isNotNumber);
        d.max.isReadOnly(isNotNumber);
        d.isNaturalKey.isReadOnly(d.isLabelKey() || parentHasNaturalKey);
        d.isIndexed.isReadOnly(d.isNaturalKey());
        d.isLabelKey.isReadOnly(d.isNaturalKey() || parentHasLabelKey);
        d.autonumber.isReadOnly(!d.isNaturalKey());

        if (
            type === "array" ||
            type === "object" ||
            typeof type === "object"
        ) {
            d.default.isReadOnly(true);
        } else {
            d.default.isReadOnly(false);
        }
    }

    that.addCalculated({
        name: "formats",
        type: "array",
        function: formats
    });

    that.onChange("name", function (prop) {
        let re = new RegExp(" ", "g");
        let value = prop.newValue().toCamelCase().replace(re, "");

        prop.newValue(value);
    });
    that.onChanged("type", handleReadOnly);
    that.onChanged("type", function () {
        let type = d.type();

        if (type === "number") {
            d.scale(f.SCALE_DEFAULT);
            d.precision(f.PRECISION_DEFAULT);
        } else {
            d.scale(-1);
            d.precision(-1);
            d.min(0);
            d.max(0);
        }

        if (
            type === "array" ||
            type === "object" ||
            typeof type === "object"
        ) {
            d.default("");
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

    that.onLoad(handleReadOnly);

    that.onValidate(function () {
        let type = that.data.type();
        let defaultValue = that.data.default();
        let name = that.data.name();

        if (typeof type !== "string") {
            if (!type.relation) {
                throw new Error(
                    "Feather name required on relation type \"" +
                    name + "\""
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
                    name + "\""
                );
            }
        }

        switch (type) {
        case "integer":
        case "number":
            if (Number.isNaN(Number(defaultValue))) {
                throw new Error(
                    "Default for \"" + name +
                    "\" must be a number or blank"
                );
            }
            break;
        case "boolean":
            if (
                defaultValue !== null &&
                defaultValue !== "" &&
                defaultValue !== true &&
                defaultValue !== false &&
                defaultValue.toLowerCase() !== "true" &&
                defaultValue.toLowerCase() !== "false"
            ) {
                throw new Error(
                    "Default for \"" + name +
                    "\" must be  \"true\", \"false\" or blank"
                );
            }
            break;
        }
    });

    that.handleReadOnly = handleReadOnly;

    that.data.default.toJSON = function () {
        let type = that.data.type();
        let defaultValue = that.data.default();

        switch (type) {
        case "integer":
        case "number":
            return Number(defaultValue);
        case "boolean":
            if (defaultValue === null || defaultValue === "") {
                return null;
            }

            if (defaultValue === true || defaultValue === false) {
                return defaultValue;
            }

            if (defaultValue.toLowerCase() === "true") {
                return true;
            }

            return false;
        default:
            return defaultValue;
        }
    };

    return that;
}

catalog.registerModel("FeatherProperty", featherProperty);
