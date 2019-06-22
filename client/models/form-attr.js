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

function formAttr(data, feather) {
    let model;

    function handleProp(name, validator) {
        let attr = model.data.attr;
        let formFeather = model.parent().data.feather();
        let prop = model.data[name];
        let fprop;
        let readOnly;

        if (!formFeather || !attr()) {
            prop.isReadOnly(true);
            return;
        }

        formFeather = catalog.getFeather(formFeather);
        fprop = formFeather.properties[attr()];

        readOnly = validator(fprop);
        prop.isReadOnly(readOnly);

        return readOnly;
    }

    function handleColumns() {
        let columns = model.data.columns();

        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                !fprop.type.parentOf
            );
        }

        if (handleProp("columns", validator)) {
            columns.canAdd(false);
        } else {
            columns.canAdd(true);
        }
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

    function handleDisableCurrency() {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                fprop.format !== "money"
            );
        }

        handleProp("disableCurrency", validator);
    }

    function handleRelationWidget() {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                fprop.type.parentOf
            );
        }

        handleProp("relationWidget", validator);
    }

    function properties() {
        let keys;
        let formFeather = model.parent().data.feather();
        let result = [];

        if (!formFeather) {
            return result;
        }
        formFeather = catalog.getFeather(formFeather);
        keys = Object.keys(formFeather.properties || []).sort();
        result = keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
        result.unshift({
            value: "",
            label: ""
        });

        return result;
    }

    feather = feather || catalog.getFeather("FormAttr");
    model = f.createModel(data, feather);

    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("attr", handleColumns);
    model.onChanged("attr", handleDataList);
    model.onChanged("attr", handleDisableCurrency);
    model.onChanged("attr", handleRelationWidget);
    model.onLoad(handleColumns);
    model.onLoad(handleDataList);
    model.onLoad(handleDisableCurrency);
    model.onLoad(handleRelationWidget);

    model.data.columns().canAdd(false);

    model.onValidate(function () {
        let found = model.parent().data.properties().find(
            (p) => model.data.attr() === p.value
        );

        if (!found) {
            throw (
                "Attribute '" + model.data.attr() + "' not in feather '" +
                model.parent().data.feather() + "'"
            );
        }
    });

    return model;
}

catalog.registerModel("FormAttr", formAttr);
