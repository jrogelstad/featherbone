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
/**
    @module Core
*/
import catalog from "./catalog.js";
import createModel from "./model.js";
import list from "./list.js";

const f = window.f;

function capsValid(str) {
    let re = new RegExp("[A-Z]{2,}");
    return !Boolean(re.exec(str));
}

function alphaNumValid(str) {
    let re = new RegExp("^[a-zA-Z0-9]+$");
    return Boolean(re.exec(str));
}

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
        if (spec.properties.properties) {
            model.data.properties().forEach((prop) => prop.handleReadOnly());
        }
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
                let prop = f.copy(parent.properties[key]);
                let instance;

                if (prop.default === undefined) {
                    prop.default = "";
                }
                if (!prop.inheritedFrom) {
                    prop.inheritedFrom = (
                        typeof parent === "object"
                        ? parent.name
                        : parent
                    );
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

    function sanitize(prop) {
        let value = prop.newValue();

        value = value.replace(re, "");
        value = value.slice(0, 1).toUpperCase() + value.slice(1);
        prop.newValue(value);
    }

    /**
        Feathers datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.feathers
        @for Models.Feather
        @type Property
    */
    model.addCalculated({
        name: "feathers",
        type: "array",
        function: featherList
    });

    /**
        Inherited properties child records.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.inheritedProperties
        @for Models.Feather
        @type Property
    */
    model.addCalculated({
        name: "inheritedProperties",
        type: {
            relation: "FeatherProperty",
            parentOf: "inheritedProperties"
        },
        isReadOnly: true,
        function: inheritedProperties
    });

    /**
        Modules datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.modules
        @for Models.Feather
        @type Property
    */
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

    if (spec.properties.properties) {
        model.onChanged("properties", handleReadOnlyProps);
        model.onChanged("properties.isNaturalKey", handleReadOnlyProps);
        model.onChanged("properties.isLabelKey", handleReadOnlyProps);
    }

    model.onChanged("inherits", calculateInherited);
    model.onLoad(calculateInherited);
    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let authRoles = [];
        let auths = (
            model.data.authorizations
            ? model.data.authorizations()
            : []
        );

        if (!capsValid(model.data.name())) {
            throw new Error(
                "Feather name may not have consecutive capital letters"
            );
        }

        if (!alphaNumValid(model.data.name())) {
            throw new Error(
                "Feather name must only be alpha numeric characters"
            );
        }

        if (!capsValid(model.data.plural())) {
            throw new Error(
                "Feather plural may not have consecutive capital letters"
            );
        }

        if (!alphaNumValid(model.data.plural())) {
            throw new Error(
                "Feather plural must only be alpha numeric characters"
            );
        }

        if (model.data.name() === model.data.plural()) {
            throw new Error(
                "Name and plural may not be the same"
            );
        }

        auths.forEach(function (auth) {
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

    model.onCopy(function () {
        model.data.name.isReadOnly(false);
        model.data.plural.isReadOnly(false);
        model.data.inherits.isReadOnly(false);
        model.data.properties().forEach(function (p) {
            p.type.isReadOnly(false);
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

function featherOverload(data, spec) {
    spec = spec || catalog.getFeather("FeatherOverload");
    spec.properties.type.default = "";
    spec.properties.default.default = "";

    let model;
    let d;

    function propertyNames() {
        let parent = model.parent();
        let names = parent.data.properties().map((prop) => prop.data.name());
        let inherits = parent.data.inherits();
        let inheritFeather;

        if (inherits) {
            inheritFeather = catalog.getFeather(inherits);
            names = names.concat(Object.keys(inheritFeather.properties));
        }

        names.sort();
        names = names.map(function (name) {
            return {
                value: name,
                label: name
            };
        });
        names.unshift({
            value: "",
            label: ""
        });

        return names;
    }

    function handleReadOnly() {
        d.description.isReadOnly(!d.overloadDescription());
        d.alias.isReadOnly(!d.overloadAlias());
        d.type.isReadOnly(!d.overloadType());
        d.default.isReadOnly(!d.overloadDefault());
        d.dataList.isReadOnly(!d.overloadDataList());
        d.autonumber.isReadOnly(!d.overloadAutonumber());
    }

    model = f.createModel(data, spec);
    d = model.data;

    model.onChanged("overloadDescription", handleReadOnly);
    model.onChanged("overloadDescription", function () {
        if (!d.overloadDescription()) {
            d.description("");
        }
    });
    model.onChanged("overloadAlias", handleReadOnly);
    model.onChanged("overloadAlias", function () {
        if (!d.overloadAlias()) {
            d.alias("");
        }
    });
    model.onChanged("overloadType", handleReadOnly);
    model.onChanged("overloadType", function () {
        if (!d.overloadType()) {
            d.type("");
        } else {
            d.type({
                type: "relation"
            });
        }
    });
    model.onChanged("overloadDefault", handleReadOnly);
    model.onChanged("overloadDefault", function () {
        if (!d.overloadDefault()) {
            d.default("");
        }
    });
    model.onChanged("overloadDataList", handleReadOnly);
    model.onChanged("overloadDataList", function () {
        if (!d.overloadDataList()) {
            d.dataList("");
        }
    });
    model.onChanged("overloadAutonumber", handleReadOnly);
    model.onChanged("overloadAutonumber", function () {
        if (!d.overloadAutonumber()) {
            d.autonumber(null);
        }
    });

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let names = propertyNames().map((item) => item.value);

        if (names.indexOf(d.name()) === -1) {
            throw new Error(
                "Property \"" + d.name() +
                "\" referenced in overload does not exist on this feather."
            );
        }

        if (d.overloadType()) {
            if (!d.type().relation) {
                throw new Error(
                    "Feather name required on relation type \"" +
                    d.name() + "\""
                );
            }
        }

        if (d.overloadDescription() && !d.description()) {
            throw new Error("Overload description is empty");
        }

        if (d.overloadAlias() && !d.alias()) {
            throw new Error("Overload alias is empty");
        }

        if (d.overloadAutonumber() && !d.autonumber()) {
            throw new Error("Overload auto number sequence is not defined");
        }
    });

    handleReadOnly();

    // ..........................................................
    // PUBLIC
    //

    /**
        Property names datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.propertyNames
        @for Models.FeatherOverload
        @type Property
    */
    model.addCalculated({
        name: "propertyNames",
        type: "array",
        function: propertyNames
    });

    return model;
}

catalog.registerModel("FeatherOverload", featherOverload);

function featherProperty(data, spec) {
    spec = spec || catalog.getFeather("FeatherProperty");
    spec.properties.type.default = "string";
    spec.properties.default.default = "";

    let model;
    let d;
    let types = [
        "array",
        "boolean",
        "integer",
        "number",
        "string",
        "object"
    ];

    // ..........................................................
    // PUBLIC
    //

    model = f.createModel(data, spec);
    d = model.data;

    function formats() {
        let type = model.data.type();
        let ret = [];
        let fmts = f.formats();

        if (types.indexOf(type)) {
            ret = Object.keys(fmts).filter(
                (key) => fmts[key].type === type
            );
            ret = ret.map(function (key) {
                return {
                    value: key,
                    label: key
                };
            });
        }

        return ret;
    }

    function handleReadOnly() {
        let isNotNumber = d.type() !== "number";
        let pd = model.parent().data;
        let parentHasNaturalKey = (
            pd.properties().some(
                (prop) => prop !== model && prop.data.isNaturalKey()
            ) ||
            pd.inheritedProperties().some((prop) => prop.data.isNaturalKey())
        );
        let parentHasLabelKey = (
            pd.properties().some(
                (prop) => prop !== model && prop.data.isLabelKey()
            ) ||
            pd.inheritedProperties().some((prop) => prop.data.isLabelKey())
        );
        let type = d.type();

        d.scale.isReadOnly(isNotNumber);
        d.precision.isReadOnly(isNotNumber);
        d.min.isReadOnly(isNotNumber && d.type() !== "integer");
        d.max.isReadOnly(isNotNumber && d.type() !== "integer");
        d.isNaturalKey.isReadOnly(d.isLabelKey() || parentHasNaturalKey);
        d.isIndexed.isReadOnly(d.isNaturalKey());
        d.isLabelKey.isReadOnly(d.isNaturalKey() || parentHasLabelKey);
        d.autonumber.isReadOnly(!d.isNaturalKey());

        if (
            type === "array" ||
            type === "object" ||
            typeof type === "object"
        ) {
            d.default.isReadOnly(true);
        } else {
            d.default.isReadOnly(false);
        }

        d.isEncrypted.isReadOnly(type !== "string");
    }

    /**
        Formats datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.formats
        @for Models.FeatherProperty
        @type Property
    */
    model.addCalculated({
        name: "formats",
        type: "array",
        function: formats
    });

    model.onChange("name", function (prop) {
        let re = new RegExp(" ", "g");
        let value = prop.newValue().toSnakeCase().toCamelCase().replace(
            re,
            ""
        );

        prop.newValue(value);
    });
    model.onChanged("type", handleReadOnly);
    model.onChanged("type", function () {
        let type = d.type();

        if (type === "number") {
            d.scale(f.SCALE_DEFAULT);
            d.precision(f.PRECISION_DEFAULT);
        } else {
            d.scale(-1);
            d.precision(-1);
            d.min(0);
            d.max(0);
        }

        if (
            type === "array" ||
            type === "object" ||
            typeof type === "object"
        ) {
            d.default("");
        }

        d.format.isReadOnly(formats().length === 0);
        d.format("");
    });
    model.onChanged("isNaturalKey", handleReadOnly);
    model.onChanged("isNaturalKey", function () {
        if (d.isNaturalKey()) {
            d.isIndexed(false);
        }
    });
    model.onChanged("isLabelKey", handleReadOnly);

    model.onLoad(handleReadOnly);

    model.onValidate(function () {
        let type = model.data.type();
        let defaultValue = model.data.default();
        let name = model.data.name();

        if (typeof type !== "string") {
            if (!type.relation) {
                throw new Error(
                    "Feather name required on relation type \"" +
                    name + "\""
                );
            }

            if (
                !type.childOf &&
                !type.parentOf && (
                    !type.properties || !type.properties.length
                )
            ) {
                throw new Error(
                    "One or more properties required on relation type \"" +
                    name + "\""
                );
            }
        }

        switch (type) {
        case "integer":
        case "number":
            if (Number.isNaN(Number(defaultValue))) {
                throw new Error(
                    "Default for \"" + name +
                    "\" must be a number or blank"
                );
            }
            break;
        case "boolean":
            if (
                defaultValue !== null &&
                defaultValue !== "" &&
                defaultValue !== true &&
                defaultValue !== false &&
                defaultValue.toLowerCase() !== "true" &&
                defaultValue.toLowerCase() !== "false"
            ) {
                throw new Error(
                    "Default for \"" + name +
                    "\" must be  \"true\", \"false\" or blank"
                );
            }
            break;
        }
    });

    model.handleReadOnly = handleReadOnly;

    model.data.default.toJSON = function () {
        let type = model.data.type();
        let defaultValue = model.data.default();

        switch (type) {
        case "integer":
        case "number":
            return Number(defaultValue);
        case "boolean":
            if (defaultValue === null || defaultValue === "") {
                return null;
            }

            if (defaultValue === true || defaultValue === false) {
                return defaultValue;
            }

            if (defaultValue.toLowerCase() === "true") {
                return true;
            }

            return false;
        default:
            return defaultValue;
        }
    };

    return model;
}

catalog.registerModel("FeatherProperty", featherProperty);
