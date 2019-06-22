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

function formAttrColumn(data, feather) {
    let model;
    let stateClean;

    function getChildFeather() {
        let formFeather = model.parent().parent().data.feather();
        let parentAttr = model.parent().data.attr();
        let childFeather;

        if (!formFeather || !parentAttr) {
            return;
        }

        formFeather = catalog.getFeather(formFeather);
        childFeather = catalog.getFeather(
            formFeather.properties[parentAttr].type.relation
        );

        return childFeather;
    }

    function resolveProperties(feather, properties, ary, prefix) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = catalog.getFeather(prop.type.relation);
                resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + "."
                );
            }

            if (
                isObject && (
                    prop.type.childOf ||
                    prop.type.parentOf ||
                    prop.type.isChild
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    }

    function handleProp(name, validator) {
        let attr = model.data.attr;
        let prop = model.data[name];
        let childFeather = getChildFeather();
        let fprop;
        let readOnly;

        if (!attr() || !childFeather) {
            prop.isReadOnly(true);
            return;
        }

        fprop = childFeather.properties[attr()];

        readOnly = validator(fprop);
        prop.isReadOnly(readOnly);
    }

    function handleDataList() {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type === "object" ||
                fprop.type === "boolean"
            );
        }

        handleProp("dataList", validator);
    }

    function handleShowCurrency() {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                fprop.format !== "money"
            );
        }

        handleProp("showCurrency", validator);
    }

    function properties() {
        let keys;
        let childFeather = getChildFeather();
        let result = [];

        if (!childFeather) {
            return result;
        }

        keys = Object.keys(childFeather.properties || []).sort();
        keys = resolveProperties(childFeather, keys).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || catalog.getFeather("FormAttrColumn");
    model = f.createModel(data, feather);

    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("attr", handleDataList);
    model.onChanged("attr", handleShowCurrency);
    stateClean = model.state().resolve("/Ready/Fetched/Clean");
    stateClean.enter(handleDataList);
    stateClean.enter(handleShowCurrency);

    model.onValidate(function () {
        let childFeather;

        if (!model.data.properties().some(
            (p) => model.data.attr() === p.value
        )) {
            childFeather = getChildFeather();
            if (childFeather) {
                throw (
                    "Attribute '" + model.data.attr() + "' not in feather '" +
                    getChildFeather().name + "'"
                );
            } else {
                throw "Feather must be selected to set attributes";
            }
        }
    });

    return model;
}

catalog.registerModel("FormAttrColumn", formAttrColumn);
