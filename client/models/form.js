/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
    @module Core
*/

function form(data, feather) {
    let model;
    let props;

    function properties() {
        if (!props) {
            let keys;
            let formFeather = model.data.feather();
            let result = [];

            if (!formFeather) {
                return result;
            }
            formFeather = f.catalog().getFeather(formFeather);
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

    feather = feather || f.catalog().getFeather("Form");
    model = f.createModel(data, feather);

    /**
        Feathers datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.feathers
        @for Models.Form
        @type Property
    */
    model.addCalculated({
        name: "feathers",
        type: "array",
        function: f.feathers
    });

    /**
        Modules datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.modules
        @for Models.Form
        @type Property
    */
    model.addCalculated({
        name: "modules",
        type: "array",
        function: f.catalog().store().data().modules
    });

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.Form
        @type Property
    */
    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("feather", handleProperties);
    model.onLoad(handleProperties);
    model.onValidate(function () {
        if (model.data.isDefault() && !model.data.isActive()) {
            throw "Default form must be active";
        }
    });

    return model;
}

f.catalog().registerModel("Form", form);

function formAction(data, feather) {
    let model;
    feather = feather || f.catalog().getFeather("FormAction");
    model = f.createModel(data, feather);

    /**
        List of available static methods on model.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.methodList
        @for Models.FormAction
        @type Property
    */
    model.addCalculated({
        name: "methodList",
        type: "array",
        function: function () {
            let ary = [];
            let parent = model.parent();
            let name = parent.data.feather().toCamelCase();
            let fn;

            if (!name) {
                return ary;
            }
            fn = f.catalog().store().models()[name];
            ary = Object.keys(fn.static());
            ary.sort();
            return ary.map(function (key) {
                return {label: key, value: key};
            });
        }
    });

    return model;
}

f.catalog().registerModel("FormAction", formAction);

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

        formFeather = f.catalog().getFeather(formFeather);
        if (formFeather) {
            fprop = formFeather.properties[attr()];

            readOnly = validator(fprop);
            prop.isReadOnly(readOnly);
        }

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
                f.isMoney(fprop.format)
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
        formFeather = f.catalog().getFeather(formFeather);
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

    feather = feather || f.catalog().getFeather("FormAttr");
    model = f.createModel(data, feather);

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.FormAttr
        @type Property
    */
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

f.catalog().registerModel("FormAttr", formAttr);

function formAttrAction(data, feather) {
    let model;
    feather = feather || f.catalog().getFeather("FormAttrAction");
    model = f.createModel(data, feather);

    /**
        List of available static methods on model.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.methodList
        @for Models.FormAttrAction
        @type Property
    */
    model.addCalculated({
        name: "methodList",
        type: "array",
        function: function () {
            let ary = [];
            let parent = model.parent();
            let name = parent.parent().data.feather();
            let formFeather;
            let prop;
            let rel;
            let fn;

            if (!name) {
                return ary;
            }

            formFeather = f.catalog().getFeather(name);
            prop = formFeather.properties[parent.data.attr()];
            if (typeof prop.type !== "object") {
                return ary;
            }

            rel = prop.type.relation.toCamelCase();
            fn = f.catalog().store().models()[rel];
            ary = Object.keys(fn.static());
            ary.sort();
            return ary.map(function (key) {
                return {label: key, value: key};
            });
        }
    });

    return model;
}
f.catalog().registerModel("FormAttrAction", formAttrAction);

function formAttrColumn(data, feather) {
    let model;
    let stateClean;

    function getChildFeather() {
        let formFeather = model.parent().parent().data.feather();
        let parentAttr = model.parent().data.attr();
        let childFeather;

        if (!formFeather || !parentAttr) {
            return;
        }

        formFeather = f.catalog().getFeather(formFeather);
        if (
            formFeather &&
            formFeather.properties[parentAttr]
        ) {
            childFeather = f.catalog().getFeather(
                formFeather.properties[parentAttr].type.relation
            );
        }

        return childFeather;
    }

    function resolveProperties(feather, properties, ary, prefix) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = f.catalog().getFeather(prop.type.relation);
                resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + "."
                );
            }

            if (
                isObject && (
                    prop.type.childOf ||
                    prop.type.parentOf ||
                    prop.type.isChild
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    }

    function handleProp(name, validator) {
        let attr = model.data.attr;
        let prop = model.data[name];
        let childFeather = getChildFeather();
        let fprop;
        let readOnly;

        if (!attr() || !childFeather) {
            prop.isReadOnly(true);
            return;
        }

        fprop = childFeather.properties[attr()];

        readOnly = validator(fprop);
        prop.isReadOnly(readOnly);
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

    function handleShowCurrency() {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                f.isMoney(fprop.format)
            );
        }

        handleProp("showCurrency", validator);
    }

    function properties() {
        let keys;
        let childFeather = getChildFeather();
        let result = [];

        if (!childFeather) {
            return result;
        }

        keys = Object.keys(childFeather.properties || []).sort();
        keys = resolveProperties(childFeather, keys).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || f.catalog().getFeather("FormAttrColumn");
    model = f.createModel(data, feather);

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.FormAttrColumn
        @type Property
    */
    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("attr", handleDataList);
    model.onChanged("attr", handleShowCurrency);
    stateClean = model.state().resolve("/Ready/Fetched/Clean");
    stateClean.enter(handleDataList);
    stateClean.enter(handleShowCurrency);

    model.onValidate(function () {
        let childFeather;

        if (!model.data.properties().some(
            (p) => model.data.attr() === p.value
        )) {
            childFeather = getChildFeather();
            if (childFeather) {
                throw (
                    "Attribute '" + model.data.attr() + "' not in feather '" +
                    getChildFeather().name + "'"
                );
            } else {
                throw "Feather must be selected to set attributes";
            }
        }
    });

    return model;
}

f.catalog().registerModel("FormAttrColumn", formAttrColumn);

function printOverlay(data, feather) {
    let model;
    let props;

    function properties() {
        if (!props) {
            let keys;
            let formFeather = model.data.feather();
            let result = [];

            if (!formFeather) {
                return result;
            }
            formFeather = f.catalog().getFeather(formFeather);
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

    feather = feather || f.catalog().getFeather("PrintOverlay");
    model = f.createModel(data, feather);

    /**
        Feathers datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.feathers
        @for Models.PrintOverlay
        @type Property
    */
    model.addCalculated({
        name: "feathers",
        type: "array",
        function: f.feathers
    });

    /**
        Modules datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.modules
        @for Models.PrintOverlay
        @type Property
    */
    model.addCalculated({
        name: "modules",
        type: "array",
        function: f.catalog().store().data().modules
    });

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.PrintOverlay
        @type Property
    */
    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("feather", handleProperties);
    model.onLoad(handleProperties);

    return model;
}

f.catalog().registerModel("PrintOverlay", printOverlay);

function printOverlayAttr(data, feather) {
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

        formFeather = f.catalog().getFeather(formFeather);
        if (formFeather) {
            fprop = formFeather.properties[attr()];

            readOnly = validator(fprop);
            prop.isReadOnly(readOnly);
        }

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

    function properties() {
        let keys;
        let formFeather = model.parent().data.feather();
        let result = [];

        if (!formFeather) {
            return result;
        }
        formFeather = f.catalog().getFeather(formFeather);
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

    feather = feather || f.catalog().getFeather("PrintOverlayAttr");
    model = f.createModel(data, feather);

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.PrintOverlay
        @type Property
    */
    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onChanged("attr", handleColumns);
    model.onLoad(handleColumns);

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

f.catalog().registerModel("PrintOverlayAttr", printOverlayAttr);

function printOverlayAttrColumn(data, feather) {
    let model;

    function getChildFeather() {
        let formFeather = model.parent().parent().data.feather();
        let parentAttr = model.parent().data.attr();
        let childFeather;

        if (!formFeather || !parentAttr) {
            return;
        }

        formFeather = f.catalog().getFeather(formFeather);
        if (
            formFeather &&
            formFeather.properties[parentAttr]
        ) {
            childFeather = f.catalog().getFeather(
                formFeather.properties[parentAttr].type.relation
            );
        }

        return childFeather;
    }

    function resolveProperties(feather, properties, ary, prefix) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = f.catalog().getFeather(prop.type.relation);
                resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + "."
                );
            }

            if (
                isObject && (
                    prop.type.childOf ||
                    prop.type.parentOf ||
                    prop.type.isChild
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    }

    function properties() {
        let keys;
        let childFeather = getChildFeather();
        let result = [];

        if (!childFeather) {
            return result;
        }

        keys = Object.keys(childFeather.properties || []).sort();
        keys = resolveProperties(childFeather, keys).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || f.catalog().getFeather("PrintOverlayAttrColumn");
    model = f.createModel(data, feather);

    /**
        Feather properties datalist.

        __Type:__ `Array`

        __Is Calculated__

        __Read Only__

        @property data.properties
        @for Models.PrintOverlayAttrColumn
        @type Property
    */
    model.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    model.onValidate(function () {
        let childFeather;

        if (!model.data.properties().some(
            (p) => model.data.attr() === p.value
        )) {
            childFeather = getChildFeather();
            if (childFeather) {
                throw (
                    "Attribute '" + model.data.attr() + "' not in feather '" +
                    getChildFeather().name + "'"
                );
            } else {
                throw "Feather must be selected to set attributes";
            }
        }
    });

    return model;
}

f.catalog().registerModel("PrintOverlayAttrColumn", printOverlayAttrColumn);

function prform(data, feather) {
    feather = feather || f.catalog().getFeather("PrintForm");
    let model = f.createModel(data, feather);
    if (model.data.module) {
        model.data.module.isReadOnly(true);
    }

    // Hack: list can't differentiate types
    model.onCanDelete(function () {
        return (
            f.currentUser().isSuper ||
            model.data.objectType() !== "SystemPrintForm"
        );
    });

    model.addCalculated({
        name: "statusIcon",
        type: "string",
        format: "icon",
        function: function () {
            if (
                !f.currentUser().isSuper &&
                model.data.objectType() === "SystemPrintForm"
            ) {
                return "lock";
            }
            return "lock_open";
        },
        style: "EMPHASIS"
    });

    model.data.statusIcon.title = function () {
        if (
            !f.currentUser().isSuper &&
            model.data.objectType() === "SystemPrintForm"
        ) {
            return "System form. Copy to make your own edits";
        }
        return "Local copy, editing allowed";
    };

    return model;
}

f.catalog().registerModel("PrintForm", prform);

prform.calculated().statusIcon = {
    type: "string",
    description: "Status indicator",
    format: "icon"
};

function sysprform(data, feather) {
    feather = feather || f.catalog().getFeather("SystemPrintForm");
    let model = f.createModel(data, feather);
    let state = model.state();

    model.onLoad(function () {
        if (!f.currentUser().isSuper) {
            state.send("freeze");
            model.onCopy(function () {
                model.name = "PrintForm";
                model.data.module("");
                model.data.module.isReadOnly(true);
            });
        } else {
            model.data.module.isReadOnly(false);
        }
    });

    return model;
}

f.catalog().registerModel("SystemPrintForm", sysprform);
