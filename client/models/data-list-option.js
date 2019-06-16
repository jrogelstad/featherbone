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
import model from "./model.js";
import catalog from "./catalog.js";

let feathers;

const dataListOption = {
    name: "DataListOption",
    plural: "DataListOptions",
    description: "Object for data list",
    inherits: "Object",
    isSystem: true,
    properties: {
        value: {
            description: "Internal key",
            type: "string"
        },
        label: {
            description: "Display value",
            type: "string"
        }
    }
};

feathers = catalog.store().feathers();
feathers.DataListOption = dataListOption;

/*
    Model for creating data list options.

    @class dataListOptionModel
    @extends model
    @param {Object} Default data
    @return {Object}
*/
function dataListOptionModel(data) {
    let that;

    data = data || {};
    that = model(data, catalog.getFeather("DataListOption"));

    that.state().resolve("/Ready/Fetched/Clean").event(
        "changed",
        () => that.state().goto("/Ready/Fetched/Dirty")
    );

    return that;
}

catalog.registerModel("DataListOption", dataListOptionModel);

Object.freeze(dataListOptionModel);
