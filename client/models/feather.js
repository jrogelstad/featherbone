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
    let that;
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
        that.data.name.isReadOnly(true);
        that.data.inherits.isReadOnly(true);
    }

    function handleReadOnlyProps() {
        that.data.properties().forEach((prop) => prop.handleReadOnly());
    }

    function isChild(p) {
        let type = p.data.type();

        return typeof type === "object" && type.childOf;
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

    that.addCalculated({
        name: "modules",
        type: "array",
        function: catalog.store().data().modules
    });

    that.onChanged("properties.isNaturalKey", handleReadOnlyProps);
    that.onChanged("properties.isLabelKey", handleReadOnlyProps);
    that.onChanged("inherits", calculateInherited);
    that.onLoad(calculateInherited);
    that.onLoad(handleReadOnly);

    that.onValidate(function () {
        let authRoles = [];

        if (
            !that.data.authorizations().length &&
            !that.data.isChild() &&
            !that.data.properties().some(isChild)
        ) {
            throw new Error("Feather must have at least one authorization.");
        }

        that.data.authorizations().forEach(function (auth) {
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


