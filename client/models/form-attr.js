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
import {catalog} from "./catalog.js";
import {model} from "./model.js";

function formAttr(data, feather) {
    let that;
    let stateClean;

    function handleProp(...args) {
        let name = args[0];
        let validator = args[1];
        let value = args[2];
        let attr = that.data.attr;
        let formFeather = that.parent().data.feather();
        let prop = that.data[name];
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
        if (readOnly && args.length === 3) {
            prop(value);
        }

        return readOnly;
    }

    function handleColumns(setDefault) {
        let columns = that.data.columns();

        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                !fprop.type.parentOf
            );
        }

        // Can't just pass a scalar value in, so handle reset after
        if (setDefault) {
            if (handleProp("columns", validator)) {
                columns.canAdd(false);
                columns.forEach((model) => model.delete());
            } else {
                columns.canAdd(true);
            }
        }
    }

    function handleDataList(setDefault) {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type === "object" ||
                fprop.type === "boolean"
            );
        }

        if (setDefault) {
            handleProp("dataList", validator, "");
        } else {
            handleProp("dataList", validator);
        }
    }

    function handleDisableCurrency(setDefault) {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                fprop.format !== "money"
            );
        }

        if (setDefault) {
            handleProp("dataList", validator, "");
        } else {
            handleProp("disableCurrency", validator, false);
        }
    }

    function handleRelationWidget(setDefault) {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                fprop.type.parentOf
            );
        }

        if (setDefault) {
            handleProp("relationWidget", validator, undefined);
        } else {
            handleProp("relationWidget", validator);
        }
    }

    function properties() {
        let keys;
        let formFeather = that.parent().data.feather();
        let result = [];

        if (!formFeather) {
            return result;
        }
        formFeather = catalog.getFeather(formFeather);
        keys = Object.keys(formFeather.properties || []).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || catalog.getFeather("FormAttr");
    that = model(data, feather);

    that.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    that.onChanged("attr", handleColumns.bind(null, true));
    that.onChanged("attr", handleDataList.bind(null, true));
    that.onChanged("attr", handleDisableCurrency.bind(null, true));
    that.onChanged("attr", handleRelationWidget.bind(null, true));
    stateClean = that.state().resolve("/Ready/Fetched/Clean");
    stateClean.enter(handleColumns);
    stateClean.enter(handleDataList);
    stateClean.enter(handleDisableCurrency);
    stateClean.enter(handleRelationWidget);


    that.data.columns().canAdd(false);

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

    return that;
}

catalog.register("models", "formAttr", formAttr);

export {formAttr};