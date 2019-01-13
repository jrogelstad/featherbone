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
import {f} from "../core.js";
import {catalog} from "./catalog.js";
import {model} from "./model.js";

function formAttrColumn(data, feather) {
    let that;
    let stateClean;

    function handleProp(name, validator, value) {
        let attr = that.data.attr;
        let formFeather = that.parent().parent().data.feather();
        let parentAttr = that.parent().data.attr();
        let prop = that.data[name];
        let fprop;
        let readOnly;
        let childFeather;

        if (!formFeather || !attr() || !parentAttr) {
            prop.isReadOnly(true);
            return;
        }

        formFeather = catalog.getFeather(formFeather);
        childFeather = catalog.getFeather(
            formFeather.properties[parentAttr].type.relation
        );
        fprop = childFeather.properties[attr()];

        readOnly = validator(fprop);
        prop.isReadOnly(readOnly);
        if (readOnly) {
            prop(value);
        }

        return readOnly;
    }

    function handleDataList() {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type === "object" ||
                fprop.type === "boolean"
            );
        }

        handleProp("dataList", validator, "");
    }

    function handleShowCurrency() {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                fprop.format !== "money"
            );
        }

        handleProp("showCurrency", validator, false);
    }

    function properties() {
        let keys;
        let formFeather = that.parent().parent().data.feather();
        let parentAttr = that.parent().data.attr();
        let childFeather;
        let result = [];

        if (!formFeather || !parentAttr) {
            return result;
        }
        formFeather = catalog.getFeather(formFeather);
        childFeather = catalog.getFeather(
            formFeather.properties[parentAttr].type.relation
        );
        keys = Object.keys(childFeather.properties || []).sort();
        keys = f.resolveProperties(childFeather, keys).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || catalog.getFeather("FormAttrColumn");
    that = model(data, feather);

    that.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    that.onChanged("attr", handleDataList);
    that.onChanged("attr", handleShowCurrency);
    stateClean = that.state().resolve("/Ready/Fetched/Clean");
    stateClean.enter(handleDataList);
    stateClean.enter(handleShowCurrency);
/*
    that.onValidate(function () {
        let found = that.parent().data.properties().find(
            (p) => that.data.attr() === p.value
        );

        if (!found) {
            throw (
                "Attribute '" + that.data.attr() + "' not in feather '" +
                that.parent().data.feather() + "'"
            );
        }
    });
*/
    return that;
}

catalog.register("models", "formAttrColumn", formAttrColumn);

export {formAttrColumn};