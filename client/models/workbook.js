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
/*jslint this, browser, unordered*/
/*global f*/

const Qs = window.Qs;

let wbModels;
let wbFeathers;
let wbDescr = "Parent of \"parent\" on \"WorkbookDefaultConfig\"";

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
                (
                    prop.type.childOf && (
                        !prop.type.properties ||
                        !prop.type.properties.length
                    )
                ) ||
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

/**
    @module Workbook
*/
const workbook = {
    name: "Workbook",
    plural: "Workbooks",
    description: "System workbook definition",
    isSystem: true,
    properties: {
        name: {
            description: "Workbook name",
            type: "string"
        },
        description: {
            description: "Description",
            type: "string"
        },
        label: {
            description: "Menu label",
            type: "string"
        },
        module: {
            description: "Module",
            type: "string"
        },
        icon: {
            description: "Menu icon",
            type: "string",
            format: "icon",
            default: "folder"
        },
        sequence: {
            description: "Presentation order",
            type: "integer"
        },
        actions: {
            description: "Menu actions",
            type: "object"
        },
        launchConfig: {
            description: "Launch configuration",
            type: "object"
        },
        defaultConfig: {
            description: wbDescr,
            type: "object"
        },
        localConfig: {
            description: "Parent of \"parent\" on \"WorkbookLocalConfig\"",
            type: "object"
        },
        authorizations: {
            description: "Parent of \"parent\" on \"WorkbookAuthorization\"",
            type: {
                parentOf: "parent",
                relation: "WorkbookAuthorization"
            }
        },
        isTemplate: {
            description: "Template for creating new workbooks",
            type: "boolean",
            default: false
        }
    }
};

const workbookDefaultConifg = {
    description: "Workbook default sheet definition",
    isSystem: true,
    isChild: true,
    properties: {
        id: {
            description: "Unique identifier",
            type: "string",
            default: "createId"
        },
        parent: {
            description: "Workbook parent",
            type: {
                relation: "Workbook",
                childOf: "defaultConfig"
            }
        },
        name: {
            description: "Sheet name",
            type: "string",
            isRequired: true
        },
        feather: {
            description: "Description",
            type: "string",
            isRequired: true
        },
        form: {
            default: "D",
            description: "Form layout for drill down",
            type: "string"
        },
        drawerForm: {
            default: "N",
            description: "Form layout for in list drawer",
            type: "string"
        },
        list: {
            description: "List layout",
            type: "object"
        },
        zoom: {
            description: "Zoom level",
            type: "string",
            default: "100"
        },
        isClearOnNoSearch: {
            description: "Show no results unless search or filter applied",
            type: "boolean",
            default: false
        },
        isEditModeEnabled: {
            description: "Flags whether inline editing is allowed",
            type: "boolean",
            default: true
        },
        openInNewWindow: {
            description: "Open record in a new tab window",
            type: "boolean",
            default: false
        },
        actions: {
            description: "Menu actions that can be performed",
            type: "object",
            default: []
        },
        isEditMode: {
            description: "Flags whether in edit mode",
            type: "boolean",
            default: false
        },
        helpLink: {
            description: "Link to help file",
            type: {
                relation: "HelpLink"
            }
        }
    }
};

const workbookList = {
    description: "Workbook list definition",
    isSystem: true,
    isChild: true,
    properties: {
        columns: {
            description: "Columns",
            type: "object"
        },
        filter: {
            description: "Filter",
            type: "object"
        },
        aggregates: {
            description: "Aggregates",
            type: "array"
        }
    }
};

const workbookLocalConfig = f.copy(workbookDefaultConifg);

const workbookAuth = {
    description: "Workbook authorization definition",
    isSystem: true,
    properties: {
        id: {
            description: "Unique id",
            type: "string",
            default: "createId()"
        },
        isDeleted: {
            description: "Boilerplate",
            type: "boolean",
            default: false
        },
        parent: {
            description: "Workbook parent",
            type: {
                relation: "Workbook",
                childOf: "authorizations"
            }
        },
        role: {
            description: "Role",
            type: "string",
            format: "role"
        },
        canRead: {
            description: "User can use workbook",
            type: "boolean",
            default: true
        },
        canUpdate: {
            description: (
                "User can update definition and " +
                "share workbook changes"
            ),
            type: "boolean",
            default: false
        }
    }
};

workbookLocalConfig.description = "Workbook local sheet definition";
workbookLocalConfig.properties.parent.type.childOf = "localConfig";
workbookLocalConfig.properties.list = {
    description: "Parent of \"parent\" on \"WorkbookList\"",
    type: {
        relation: "WorkbookList"
    }
};

wbFeathers = f.catalog().store().feathers();
wbFeathers.Workbook = workbook;
wbFeathers.WorkbookDefaultConfig = workbookDefaultConifg;
wbFeathers.WorkbookLocalConfig = workbookLocalConfig;
wbFeathers.WorkbookList = workbookList;
wbFeathers.WorkbookAuthorization = workbookAuth;

function resolveConfig(config) {
    config.forEach(function (sheet) {
        if (!sheet.id) {
            sheet.id = f.createId();
        }
    });
}

/**
    Model with special rest API handling for Workbook saves.

    @class Workbook
    @static
    @namespace Models
    @extends Model
*/
function workbookModel(data) {
    let model;
    let state;
    let substate;
    let doPut;
    let modules = f.prop(f.catalog().store().data().modules());
    let canUpdate;
    let profileConfig;

    function save(pPromise) {
        this.goto("/Busy/Saving", {
            context: {
                promise: pPromise
            }
        });
    }

    // ..........................................................
    // PUBLIC
    //

    data = data || {};
    if (data.localConfig) {
        resolveConfig(data.localConfig);
    }
    if (data.defaultConfig) {
        resolveConfig(data.defaultConfig);
    }
    model = f.createModel(data, workbook);
    model.idProperty("name");

    model.path = function (name, id) {
        let ret = "/" + name.toSpinalCase();

        if (id) {
            ret += "/" + id;
        }
        return ret;
    };

    model.getConfig = function () {
        let d = model.data;
        let profile;

        if (profileConfig) {
            return profileConfig;
        }

        profile = f.catalog().store().data().profile();

        if (
            profile &&
            profile.data &&
            profile.data.workbooks &&
            profile.data.workbooks[d.name()]
        ) {
            profileConfig = f.copy(profile.data.workbooks[d.name()]);
            return profileConfig;
        }

        if (d.localConfig().length) {
            return d.localConfig();
        }

        return d.defaultConfig();
    };

    /**
        Datalist array of available modules.

        __Type:__ `Array`

        @property data.modules
        @type {Property}
    */
    model.addCalculated({
        name: "modules",
        type: "array",
        function: modules
    });

    model.canUpdate = () => canUpdate;

    model.checkUpdate = function () {
        if (model.state().current()[0] !== "/Ready/Fetched/Clean") {
            return;
        }

        if (canUpdate === undefined) {
            model.state().goto("/Ready/Fetched/ReadOnly");
            model.isAuthorized("canUpdate").then(function (resp) {
                canUpdate = resp;

                if (canUpdate) {
                    model.state().goto("/Ready/Fetched/Clean");
                }
            });
        }
    };

    /**
        Check whether workbook is authorized to perform an action.

        Allowable actions: `canRead`, `canUpdate`

        @method isAuthorized
        @param {String} Action name
        @return {Object} Promise
    */
    model.isAuthorized = function (pAction) {
        return new Promise(function (resolve, reject) {
            let query = Qs.stringify({
                action: pAction
            });
            let payload = {
                method: "GET",
                path: "/workbook/is-authorized/" + model.id() + "?" + query
            };

            f.datasource().request(payload).then(resolve).catch(reject);
        });
    };

    // ..........................................................
    // PRIVATE
    //

    doPut = function (context) {
        let cache = model.toJSON();
        let payload = {
            method: "PUT",
            path: model.path(model.name, model.data.name()),
            body: cache
        };

        function callback() {
            state.send("fetched");
            context.promise.resolve(model.data);
        }

        if (model.isValid()) {
            f.datasource().request(payload).then(callback).catch(model.error);
        }
    };

    // Update statechart for modified behavior
    state = model.state();
    substate = state.resolve("/Busy/Saving");
    delete substate.substateMap.Posting;
    delete substate.substateMap.Patching;
    substate.substates.length = 0;
    substate.enter(doPut);
    substate = state.resolve("/Ready/New");
    substate.event("save", save.bind(substate));
    substate = state.resolve("/Ready/Fetched/Dirty");
    substate.event("save", save.bind(substate));
    substate = state.resolve("/Ready/Fetched/Clean");
    substate.event("changed", function () {
        this.goto("../Dirty");
    });
    substate = state.resolve("/Delete");
    substate.enters.shift();

    model.onLoad(function () {
        model.data.name.isReadOnly(true);
    });

    return model;
}
/**
    Unique identifier.

    __Type:__ `String`

    @property data.id
    @type Property
*/
/**
    Workbook name.

    __Type:__ `String`

    @property data.name
    @type Property
*/
/**
    Description.

    __Type:__ `String`

    @property data.description
    @type Property
*/
/**
    Icon.

    __Type:__ `String`

    @property data.icon
    @type Property
*/
/**
    Launch configuration.

    __Type:__ `Object`

    @property data.launchConfig
    @type Property
*/
/**
    Parent of `parent` on `WorkbookDefaultConfig`.

    __Type:__ `WorkbookDefaultConfig`

    @property data.defaultConfig
    @type Property
*/
/**
    Parent of `parent` on `WorkbookLocalConfig`.

    __Type:__ `WorkboookLocalConfig`

    @property data.localConfig
    @type Property
*/
/**
    Module.

    __Type:__ `String`

    @property data.module
    @type Property
*/

/**
    Workbook child configuration model.

    @class WorkbookChild
    @static
    @extends Model
*/
function workbookChild(data) {
    let model = f.createModel(data, workbookLocalConfig);

    model.onChanged("feather", function (property) {
        let invalid;
        let feather;
        let value = property.newValue();
        let list = model.data.list();
        let columns = list.data.columns();
        let filter = list.data.filter();
        let sort = (
            filter
            ? filter.sort
            : false
        );
        let criteria = (
            filter
            ? filter.criteria
            : false
        );

        if (value) {
            // Remove mismatched columns
            feather = f.catalog().getFeather(value);
            invalid = columns.filter(function (column) {
                return !feather.properties[column.attr];
            });
            invalid.forEach(function (item) {
                let idx = columns.indexOf(item);
                columns.splice(idx, 1);
            });

            // Remove mismatched sort
            if (sort) {
                invalid = sort.filter(function (item) {
                    return !feather.properties[item.property];
                });
                invalid.forEach(function (item) {
                    let idx = sort.indexOf(item);
                    sort.splice(idx, 1);
                });
            }

            // Remove mismatched criteria
            if (criteria) {
                invalid = criteria.filter(function (item) {
                    return !feather.properties[item.property];
                });
                invalid.forEach(function (item) {
                    let idx = criteria.indexOf(item);
                    criteria.splice(idx, 1);
                });
            }
        } else {
            columns.length = 0;
            Object.keys(filter).forEach(function (key) {
                delete filter[key];
            });
        }
    });

    model.onValidate(function () {
        let list = model.data.list();

        if (!list.data.columns().length) {
            throw "List must include at least one column.";
        }
    });

    return model;
}
workbookChild.static = f.prop({});
workbookChild.calculated = f.prop({});
/**
    Workbook parent.

    __Type:__ `String`

    @property data.parent
    @type Property
*/
/**
    Sheet name.

    __Type:__ `String`

    @property data.names
    @type Property
*/
/**
    Feather.

    __Type:__ `String`

    @property data.feather
    @type Property
*/
/**
    Form layout.

    __Type:__ `String`

    @property data.form
    @type Property
*/
/**
    List layout.

    __Type:__ `Object`

    @property data.list
    @type Property
*/
/**
    Zooom level.

    __Type:__ `Integer`

    @property data.zoom
    @type Property
*/
/**
    Parent of `parent` on `WorkbookLocalConfig`.

    __Type:__ `WorkboookLocalConfig`

    @property data.localConfig
    @type Property
*/
/**
    Module.

    __Type:__ `String`

    @property data.module
    @type Property
*/
/**
    Flags whether inline editing is allowed.

    __Type:__ `Boolean`

    @property data.ModeEnabled
    @type Property
*/
/**
    Open record in a new tab window.

    __Type:__ `Boolean`

    @property data.openInNewWindow
    @type Property
*/
/**
    Help file link.

    __Type:__ `HelpLink`

    @property data.helpLink
    @type Property
*/
/**
    Menu actions that can be performed on rows.

    __Type:__ `Object`

    @property data.actions
    @type Property
*/
/**
    @class WorkbookDefaultConfig
    @extends Models.WorkbookChild
*/
/**
    @class WorkbookLocalConfig
    @extends Models.WorkbookChild
*/

/**
    Workbook authorization definition.

    @class WorkbookAuthorization
    @static
    @extends Model
*/
function workbookAuthorization(data) {
    return f.createModel(data, workbookAuth);
}
workbookAuthorization.static = f.prop({});
workbookAuthorization.calculated = f.prop({});
/**
    Workbook parent.

    __Type:__ `Models.Workbook`

    @property data.parent
    @type Property
*/
/**
    Role.

    __Type:__ `Models.Role`

    @property data.Role
    @type Property
*/
/**
    User can read workbook.

    __Type:__ `Boolean`

    @property data.canRead
    @type Property
*/
/**
    User can update definition share workbook changes.

    __Type:__ `Boolean`

    @property data.canUpdate
    @type Property
*/

workbookModel.static = f.prop({});
workbookModel.calculated = f.prop({});

wbModels = f.catalog().store().models();
wbModels.workbook = workbookModel;
wbModels.workbookLocalConfig = workbookChild;
wbModels.workbookAuthorization = workbookAuthorization;
Object.freeze(wbModels.workbookLocalConfig);

const worksheet = {
    name: "Worksheet",
    plural: "Worksheets",
    description: "System worksheet definition",
    isSystem: true,
    properties: {
        id: {
            description: "Unique Id",
            type: "string"
        },
        name: {
            description: "Worksheet name",
            type: "string"
        },
        feather: {
            description: "Feather definition",
            type: "string",
            dataList: "feathers"
        },
        form: {
            description: "Default editing form",
            type: "string",
            dataList: "forms"
        },
        drawerForm: {
            description: "Default drawer form",
            type: "string",
            dataList: "drawerForms"
        },
        isClearOnNoSearch: {
            description: "Show no results unless search or filter applied",
            type: "boolean",
            default: false
        },
        isEditModeEnabled: {
            description: "ALlow inline editing",
            type: "boolean"
        },
        openInNewWindow: {
            description: "Open worksheet in new tab",
            type: "boolean"
        },
        columns: {
            description: "Parent of \"parent\" on \"WorksheetColumn\"",
            type: {
                parentOf: "parent",
                relation: "WorksheetColumn"
            }
        },
        actions: {
            description: "Parent of \"parent\" on \"WorksheetAction\"",
            type: {
                parentOf: "parent",
                relation: "WorksheetAction"
            }
        },
        helpLink: {
            description: "Link to help file",
            type: {
                relation: "HelpLink"
            }
        }
    }
};

const worksheetColumn = {
    inherits: "Object",
    description: "Worksheet column",
    isSystem: true,
    properties: {
        attr: {
            description: "Column name",
            type: "string",
            dataList: "properties"
        },
        label: {
            description: "Column label",
            type: "string"
        },
        width: {
            description: "Width",
            type: "integer"
        }
    }
};

const worksheetAction = {
    description: "Worksheet action",
    isSystem: true,
    properties: {
        name: {
            description: "Name",
            type: "string",
            isRequired: true
        },
        title: {
            description: "Title",
            type: "string",
            isRequired: true
        },
        icon: {
            description: "Icon name",
            type: "string",
            format: "icon",
            isRequired: true
        },
        method: {
            description: "Method to execute for action",
            type: "string",
            isRequired: true
        },
        validator: {
            description: "Selection validation check",
            type: "string"
        },
        hasSeparator: {
            description: "Precede action with separator",
            type: "boolean",
            isRequired: true
        }
    }
};

wbFeathers.Worksheet = worksheet;
wbFeathers.WorksheetColumn = worksheetColumn;
wbFeathers.WorksheetAction = worksheetAction;

function worksheetModel(data) {
    let model = f.createModel(data, worksheet);
    let d = model.data;
    let state;
    let substate;

    function handleReadOnly() {
        d.isEditModeEnabled.isReadOnly(
            d.drawerForm() && d.drawerForm() !== "N"
        );
    }

    function thefeathers() {
        let df = f.hiddenFeathers();
        if (f.currentUser().isSuper) {
            return Object.keys(
                f.catalog().feathers()
            ).sort().map(function (key) {
                return {value: key, label: key};
            });
        }

        return Object.keys(f.catalog().feathers()).filter(
            (fthr) => df.indexOf(fthr) === -1
        ).sort().map(function (key) {
            return {value: key, label: key};
        });
    }

    function theforms(isDrawer) {
        let forms = f.catalog().store().data().forms();
        let feather = model.data.feather();

        // Only forms that have matching feather
        let ret = forms.filter(function (form) {
            return (
                form.feather === feather &&
                form.isActive
            );
        }).map(function (form) {
            return {value: form.name, label: form.name};
        });

        ret.unshift({
            value: "D",
            label: "Default"
        });

        if (isDrawer) {
            ret.unshift({
                value: "N",
                label: "None"
            });
        }
        return ret;
    }

    model.addCalculated({
        name: "feathers",
        type: "array",
        function: thefeathers
    });

    model.addCalculated({
        name: "forms",
        type: "array",
        function: theforms
    });

    model.addCalculated({
        name: "drawerForms",
        type: "array",
        function: theforms.bind(null, true)
    });

    model.onChanged("feather", function () {
        let props = f.catalog().getFeather(d.feather()).properties;
        let pkeys = Object.keys(props);
        let cols = d.columns().slice();
        let ckeys = cols.map((c) => c.data.attr());
        let idx = 0;

        ckeys.forEach(function (col) {
            if (pkeys.indexOf(col) === -1) {
                d.columns().remove(cols[idx]);
            }
            idx += 1;
        });
    });
    model.onChanged("drawerForm", function () {
        if (d.drawerForm() !== "N") {
            d.isEditModeEnabled(false);
        }
        handleReadOnly();
    });

    // Update statechart for modified behavior
    state = model.state();
    substate = state.resolve("/Ready/New");
    substate.event("fetched", function () {
        handleReadOnly();
        this.goto("/Ready/Fetched/Clean");
    });
    substate = state.resolve("/Busy/Saving");
    delete substate.substateMap.Posting;
    delete substate.substateMap.Patching;
    substate.substates.length = 0;
    substate = state.resolve("/Ready/Fetched/Clean");
    substate.event("changed", function () {
        this.goto("../Dirty");
    });
    substate = state.resolve("/Delete");
    substate.enters.shift();
    handleReadOnly();

    return model;
}
worksheetModel.static = f.prop({});
worksheetModel.calculated = f.prop({});
wbModels.worksheet = worksheetModel;

function worksheetActionModel(data) {
    let model = f.createModel(data, f.catalog().getFeather("WorksheetAction"));

    model.addCalculated({
        name: "methodList",
        type: "array",
        function: function () {
            let ary = [];
            let name = model.parent().data.feather().toCamelCase();
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
worksheetActionModel.static = f.prop({});
worksheetActionModel.calculated = f.prop({});
wbModels.worksheetAction = worksheetActionModel;

function worksheetColumnModel(data) {
    let model = f.createModel(data, f.catalog().getFeather("WorksheetColumn"));

    function theprops() {
        let name = model.parent().data.feather();
        let feather = f.catalog().getFeather(name);
        let keys = (
            feather
            ? Object.keys(feather.properties)
            : false
        );

        keys = (
            keys
            ? resolveProperties(feather, keys).sort()
            : []
        );

        return keys.map(function (key) {
            return {value: key, label: key.toName()};
        });
    }

    model.addCalculated({
        name: "properties",
        type: "array",
        function: theprops
    });

    return model;
}
worksheetColumnModel.static = f.prop({});
worksheetColumnModel.calculated = f.prop({});
wbModels.worksheetColumn = worksheetColumnModel;
