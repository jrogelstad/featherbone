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
/*jslint browser*/
import catalog from "./catalog.js";
import createModel from "./model.js";
import list from "./list.js";

const f = window.f;

function feather(data, spec) {
    spec = spec || catalog.getFeather("Feather");
    if (data === undefined) {
        data = {
            authorizations: [{
                role: "everyone",
                canCreate: true,
                canRead: true,
                canUpdate: true,
                canDelete: true
            }]
        };
    }
    let model;
    let inheritedProperties = f.prop([]);
    let re = new RegExp(" ", "g");

    inheritedProperties().canAdd = f.prop(false);

    model = createModel(data, spec);

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

    function handleReadOnly() {
        model.data.name.isReadOnly(true);
        model.data.plural.isReadOnly(true);
        model.data.inherits.isReadOnly(true);
    }

    function handleReadOnlyProps() {
        model.data.properties().forEach((prop) => prop.handleReadOnly());
    }

    function calculateInherited() {
        let parent = model.data.inherits();
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
                instance.parent(model);
                props.push(instance);
            });
        }
        handleReadOnlyProps();
    }

    function isChild(p) {
        let type = p.data.type();

        return typeof type === "object" && type.childOf;
    }

    function sanitize(prop) {
        let value = prop.newValue();

        value = value.replace(re, "");
        value = value.slice(0, 1).toUpperCase() + value.slice(1);
        prop.newValue(value);
    }

    model.addCalculated({
        name: "feathers",
        type: "array",
        function: featherList
    });

    model.addCalculated({
        name: "inheritedProperties",
        type: {
            relation: "FeatherProperty",
            parentOf: "inheritedProperties"
        },
        isReadOnly: true,
        function: inheritedProperties
    });

    model.addCalculated({
        name: "modules",
        type: "array",
        function: catalog.store().data().modules
    });

    model.onChange("name", sanitize);
    model.onChanged("name", function (prop) {
        if (prop() && !model.data.plural()) {
            model.data.plural(prop() + "s");
        }
    });
    model.onChange("plural", sanitize);

    model.onChanged("properties", handleReadOnlyProps);
    model.onChanged("properties.isNaturalKey", handleReadOnlyProps);
    model.onChanged("properties.isLabelKey", handleReadOnlyProps);
    model.onChanged("inherits", calculateInherited);
    model.onLoad(calculateInherited);
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let authRoles = [];

        if (
            !model.data.authorizations().length &&
            !model.data.isChild() &&
            !model.data.properties().some(isChild)
        ) {
            throw new Error("Feather must have at least one authorization.");
        }

        model.data.authorizations().forEach(function (auth) {
            let role = auth.data.role();

            if (authRoles.indexOf(role) !== -1) {
                throw new Error(
                    "Role '" + role +
                    "' must only be in one authorization per feather."
                );
            }
            authRoles.push(role);
        });
    });

    return model;
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


