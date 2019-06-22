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
/*jslint this*/
import f from "../core.js";
import datasource from "../datasource.js";
import catalog from "./catalog.js";

let models;
let feathers;
let descr = "Parent of \"parent\" on \"WorkbookDefaultConfig\"";

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
        module: {
            description: "Module",
            type: "string"
        },
        icon: {
            description: "Menu icon",
            type: "string",
            default: "folder"
        },
        launchConfig: {
            description: "Launch configuration",
            type: "object"
        },
        defaultConfig: {
            description: descr,
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
            description: "Form layout",
            type: {
                relation: "Form"
            }
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
            description: "Menu actions that can be performed on rows",
            type: "object",
            default: []
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
        }
    }
};

const workbookLocalConfig = f.copy(workbookDefaultConifg);

const workbookAuth = {
    description: "Workbook authorization definition",
    isSystem: true,
    properties: {
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

feathers = catalog.store().feathers();
feathers.Workbook = workbook;
feathers.WorkbookDefaultConfig = workbookDefaultConifg;
feathers.WorkbookLocalConfig = workbookLocalConfig;
feathers.WorkbookList = workbookList;
feathers.WorkbookAuthorization = workbookAuth;

function resolveConfig(config) {
    config.forEach(function (sheet) {
        if (!sheet.id) {
            sheet.id = f.createId();
        }
        if (typeof sheet.form === "string" && sheet.form.length) {
            sheet.form = catalog.store().data().forms().find(
                (form) => sheet.form === form.id
            );
        }
    });
}

/*
    Model with special rest API handling for Workbook saves.

    @class workbook
    @extends model
    @param {Object} Default data
    return {Object}
*/
function workbookModel(data) {
    let model;
    let state;
    let substate;
    let doPut;
    let modules = f.prop(catalog.store().data().modules());
    let canUpdate;
    let profileConfig;

    function save(promise) {
        this.goto("/Busy/Saving", {
            context: {
                promise: promise
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

        profile = catalog.store().data().profile();

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
    model.isAuthorized = function (action) {
        return new Promise(function (resolve, reject) {
            let payload = {
                method: "GET",
                path: "/workbook/is-authorized/" + model.id(),
                data: {
                    action: action
                }
            };

            datasource.request(payload).then(resolve).catch(reject);
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
            data: cache
        };

        function callback() {
            state.send("fetched");
            context.promise.resolve(model.data);
        }

        if (model.isValid()) {
            datasource.request(payload).then(callback).catch(model.error);
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

/*
    Workbook configuration model.

    @class workbookChild
    @extends model
    @param {Object} Default data
    return {Object}
*/
function workbookChild(data) {
    let model = f.createModel(data, workbookLocalConfig);

    model.onChanged("feather", function (property) {
        let id;
        let forms;
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

        // When feather changes, automatically assign
        // the first available form.
        if (value) {
            forms = catalog.store().data().forms();
            // Copy to new array model has regular filter method
            forms = forms.slice(0, forms.length - 1);
            forms = forms.filter(
                (form) => form.feather === value
            ).sort(function (a, b) {
                if (a.data.name() < b.data.name()) {
                    return -1;
                }
                return 1;
            });
            id = (
                forms.length
                ? forms[0].id
                : undefined
            );

            // Remove mismatched columns
            feather = catalog.getFeather(value);
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

        model.data.form(forms.find((row) => row.id === id));
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

function workbookAuthorization(data) {
    let model = f.createModel(data, workbookAuth);

    model.idProperty("role");

    return model;
}
workbookAuthorization.static = f.prop({});
workbookAuthorization.calculated = f.prop({});

workbookModel.list = ("Workbook");
workbookModel.static = f.prop({});
workbookModel.calculated = f.prop({});

models = catalog.store().models();
models.workbook = workbookModel;
models.workbookLocalConfig = workbookChild;
models.workbookAuthorization = workbookAuthorization;
Object.freeze(models.workbookLocalConfig);

