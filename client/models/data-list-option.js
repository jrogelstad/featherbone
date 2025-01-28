/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
/*jslint browser unordered*/
/*global f*/
/**
    @module DataList
*/

let dloFeathers;

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

dloFeathers = f.catalog().store().feathers();
dloFeathers.DataListOption = dataListOption;

/**
    Options for data list.

    @class DataListOption
    @static
    @namespace Models
    @extends Model
*/
function dataListOptionModel(data) {
    let model;

    data = data || {};
    model = f.createModel(data, f.catalog().getFeather("DataListOption"));

    model.state().resolve("/Ready/Fetched/Clean").event(
        "changed",
        () => model.state().goto("/Ready/Fetched/Dirty")
    );

    return model;
}

/**
    Internal key.

    __Type:__ `String`

    @property data.value
    @type Property
*/
/**
    Display value.

    __Type:__ `String`

    @property data.label
    @type Property
*/

f.catalog().registerModel("DataListOption", dataListOptionModel);
