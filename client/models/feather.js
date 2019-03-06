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
/*jslint browser*/
import catalog from "./catalog.js";
import model from "./model.js";
import list from "./list.js";

const f = window.f;

function feather(data, spec) {
    spec = spec || catalog.getFeather("Feather");
    let that;
    let modules;
    let inheritedProperties = f.prop([]);

    inheritedProperties().canAdd = f.prop(false);

    // ..........................................................
    // PUBLIC
    //

    that = model(data, spec);

    function featherList() {
        let feathers = catalog.store().feathers();
        let keys = Object.keys(feathers);

        keys = keys.filter(function (key) {
            return !feathers[key].isSystem;
        }).sort();

        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    function calculateInherited() {
        let parent = that.data.inherits();
        let featherProperty;
        let props = inheritedProperties();

        if (parent) {
            parent = catalog.getFeather(parent);
            featherProperty = catalog.store().models().featherProperty;
            props.length = 0;

            Object.keys(parent.properties).forEach(function (key) {
                let prop = parent.properties[key];
                let instance;

                if (prop.default === undefined) {
                    prop.default = "";
                }
                prop.name = key;
                instance = featherProperty(prop);
                instance.state().goto("/Ready/Fetched/ReadOnly");
                instance.parent(that);
                props.push(instance);
            });
        }
    }

    function handleReadOnly() {
        that.data.properties().forEach((prop) => prop.handleReadOnly());
    }

    that.addCalculated({
        name: "feathers",
        type: "array",
        function: featherList
    });

    that.addCalculated({
        name: "inheritedProperties",
        type: {
            relation: "FeatherProperty",
            parentOf: "inheritedProperties"
        },
        isReadOnly: true,
        function: inheritedProperties
    });

    modules = function () {
        let feathers = catalog.store().feathers();
        let keys = Object.keys(feathers);
        let ary = [];

        keys.forEach(function (key) {
            let mod = feathers[key].module;

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


    that.onChanged("properties.isNaturalKey", handleReadOnly);
    that.onChanged("properties.isLabelKey", handleReadOnly);
    that.onChanged("inherits", calculateInherited);
    that.state().resolve("/Ready/Fetched/Clean").enter(calculateInherited);

    return that;
}

feather.list = list("Feather");
feather.static = f.prop({});
feather.calculated = f.prop({
    inheritedProperties: {
        description: "Properties inherited from parent feather",
        type: {
            relation: "FeatherProperty",
            parentOf: "inheritedProperties"
        },
        isReadOnly: true
    }
});

catalog.register("models", "feather", feather);


