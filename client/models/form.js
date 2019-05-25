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

function form(data, feather) {
    let that;
    let props;

    function properties() {
        if (!props) {
            let keys;
            let formFeather = that.data.feather();
            let result = [];

            if (!formFeather) {
                return result;
            }
            formFeather = catalog.getFeather(formFeather);
            keys = Object.keys(formFeather.properties || []).sort();
            keys.unshift("");
            props = keys.map(function (key) {
                return {
                    value: key,
                    label: key
                };
            });
        }
        return props;
    }

    function handleProperties() {
        props = undefined;
    }

    feather = feather || catalog.getFeather("Form");
    that = model(data, feather);

    that.addCalculated({
        name: "feathers",
        type: "array",
        function: f.feathers
    });

    that.addCalculated({
        name: "modules",
        type: "array",
        function: catalog.store().data().modules
    });

    that.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    that.onChanged("feather", handleProperties);
    that.onLoad(handleProperties);

    return that;
}

catalog.registerModel("Form", form, true);
