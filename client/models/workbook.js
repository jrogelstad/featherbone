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
import {f} from "../../common/core-client.js";
import {model} from "./model.js";
import {datasource} from "../datasource.js";
import {catalog} from "./catalog.js";

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
            description: "Workbook name",
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

function resolveConfig(config) {
    config.forEach(function (sheet) {
        if (!sheet.id) {
            sheet.id = f.createId();
        }
        if (typeof sheet.form === "string" && sheet.form.length) {
            sheet.form = catalog.store().forms()[sheet.form];
        }
    });
}

/**
  Model with special rest API handling for Workbook saves.
  @param {Object} Default data
  return {Object}
*/
function workbookModel(data) {
    let that;
    let state;
    let substate;
    let doPut;

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
    that = model(data, workbook);
    that.idProperty("name");

    that.path = function (name, id) {
        let ret = "/" + name.toSpinalCase();

        if (id) {
            ret += "/" + id;
        }
        return ret;
    };

    that.getConfig = function () {
        let d = that.data;
        let config = d.defaultConfig();

        if (d.localConfig().length) {
            config = d.localConfig();
        }
        return config;
    };

    // ..........................................................
    // PRIVATE
    //

    doPut = function (context) {
        let cache = that.toJSON();
        let payload = {
            method: "PUT",
            path: that.path(that.name, that.data.name()),
            data: cache
        };

        function callback(result) {
            if (result) {
                state.send("fetched");
                context.promise.resolve(that.data);
            }
        }

        if (that.isValid()) {
            datasource.request(payload).then(callback);
        }
    };

    // Update statechart for modified behavior
    state = that.state();
    substate = state.resolve("/Busy/Saving");
    delete substate.substateMap.Posting;
    delete substate.substateMap.Patching;
    substate.substates.length = 0;
    substate.enter(doPut);
    substate = state.resolve("/Ready/Fetched/Dirty");
    substate.event("save", function (promise) {
        substate.goto("/Busy/Saving", {
            context: {
                promise: promise
            }
        });
    });

    return that;
}

/**
  Workbook configuration model.

  @param {Object} Default data
  return {Object}
*/
function workbookChild(data) {
    let that = model(data, workbookLocalConfig);

    that.onChanged("feather", function (property) {
        let id;
        let forms;
        let keys;
        let invalid;
        let feather;
        let value = property.newValue();
        let list = that.data.list();
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
            // When feather changes, automatically assign
            // the first available form.
            forms = catalog.store().forms();
            keys = Object.keys(forms).sort(function (a, b) {
                if (forms[a].name < forms[b].name) {
                    return -1;
                }
                return 1;
            });
            id = keys.find(function (key) {
                return value === forms[key].feather;
            });

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

        that.data.form(forms[id]);
    });

    that.onValidate(function () {
        let list = that.data.list();

        if (!list.data.columns().length) {
            throw "List must include at least one column.";
        }
    });

    return that;
}

models = catalog.store().models();
models.workbook = workbookModel;
models.workbookLocalConfig = workbookChild;

export {workbookModel};
