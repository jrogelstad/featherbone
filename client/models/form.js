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
/*global require, module*/
/*jslint browser*/
(function () {
    "use strict";

    const catalog = require("catalog");
    const model = require("model");
    const list = require("list");

    function formModel(data) {
        let that;
        let properties;
        let modules;
        let feathers;
        let feather = catalog.getFeather("Form");

        // ..........................................................
        // PUBLIC
        //

        that = model(data, feather);

        properties = function () {
            let keys;
            let formFeather = that.data.feather();
            let result = [];

            if (!formFeather) {
                return result;
            }
            formFeather = catalog.getFeather(formFeather);
            keys = Object.keys(formFeather.properties || []);
            return keys.map(function (key) {
                return {
                    value: key,
                    label: key
                };
            });
        };

        that.addCalculated({
            name: "properties",
            type: "array",
            function: properties
        });

        feathers = function () {
            let tables = catalog.store().feathers();
            let keys = Object.keys(tables);

            keys = keys.filter(function (key) {
                return !tables[key].isSystem;
            }).sort();

            return keys.map(function (key) {
                return {
                    value: key,
                    label: key
                };
            });
        };

        that.addCalculated({
            name: "feathers",
            type: "array",
            function: feathers
        });

        modules = function () {
            let tables = catalog.store().feathers();
            let keys = Object.keys(tables);
            let ary = [];

            keys.forEach(function (key) {
                let mod = tables[key].module;

                if (mod && ary.indexOf(mod) === -1) {
                    ary.push(mod);
                }
            });

            return ary.map(function (item) {
                return {
                    value: item,
                    label: item
                };
            });
        };

        that.addCalculated({
            name: "modules",
            type: "array",
            function: modules
        });

        return that;
    }

    formModel.list = list("Form");

    catalog.register("models", "form", formModel);

    module.exports = formModel;

}());