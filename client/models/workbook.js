/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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

(function () {
  "use strict";

  var workbook, workbookModel, workbookChild,
    workbookDefaultConifg, workbookLocalConfig,
    workbookList, models, feathers,
    f = require("common-core"),
    model = require("model"),
    dataSource = require("datasource"),
    catalog = require("catalog");

  workbook = {
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
        description: "Parent of \"parent\" on \"WorkbookDefaultConfig\"",
        type: "object"
      },
      localConfig: {
        description: "Parent of \"parent\" on \"WorkbookLocalConfig\"",
        type: "object"
      }
    }
  };

  workbookDefaultConifg = {
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
      }
    }
  };

  workbookList = {
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

  workbookLocalConfig = f.copy(workbookDefaultConifg);
  workbookLocalConfig.description = "Workbook local sheet definition";
  workbookLocalConfig.properties.parent.type.childOf = "localConfig";
  workbookLocalConfig.properties.list = {
    description: "Parent of \"parent\" on \"WorkbookList\"",
    type: {relation: "WorkbookList"}
  };

  feathers = catalog.store().feathers();
  feathers.Workbook = workbook;
  feathers.WorkbookDefaultConfig = workbookDefaultConifg;
  feathers.WorkbookLocalConfig = workbookLocalConfig;
  feathers.WorkbookList = workbookList;

  var resolveConfig = function (config) {
    config.forEach(function(sheet){
      if (!sheet.id) { sheet.id = f.createId(); }
      if (typeof sheet.form === "string" && sheet.form.length) {
        sheet.form = catalog.store().forms()[sheet.form];
      }
    });
  };

  /**
    Model with special rest API handling for Workbook saves.
    @param {Object} Default data
    return {Object}
  */
  workbookModel = function (data) {
    var that, state, substate, doPut;

    // ..........................................................
    // PUBLIC
    //

    data = data || {};
    if (data.localConfig) { resolveConfig(data.localConfig); }
    if (data.defaultConfig) { resolveConfig(data.defaultConfig); }
    that = model(data, workbook);
    that.idProperty("name");

    that.path = function (name, id) {
      var ret = "/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    that.getConfig = function () {
      var d = that.data,
        config = d.defaultConfig();
      if (d.localConfig().length) {
        config = d.localConfig();
      }
      return config;  
    };

    // ..........................................................
    // PRIVATE
    //

    doPut = function (context) {
      var cache = that.toJSON(),
        payload = {method: "PUT", path: that.path(that.name, that.data.name()),
          data: cache},
        callback = function (result) {
          if (result) {
            state.send('fetched');
            context.promise.resolve(that.data);
          }
        };

      if (that.isValid()) {
        dataSource.request(payload).then(callback);
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
        context: {promise: promise}
      });
    });

    return that;
  };

  /**
    Workbook configuration model.

    @param {Object} Default data
    return {Object}
  */
  workbookChild = function (data) {
    var that = model(data, workbookLocalConfig);

    that.onChanged("feather", function (property) {
      var id, forms, keys, invalid, feather,
        value = property.newValue(),
        list = that.data.list(),
        columns = list.data.columns(),
        filter = list.data.filter(),
        sort = filter ? filter.sort : false,
        criteria = filter ? filter.criteria : false;

      if (value) {
        // When feather changes, automatically assign
        // the first available form.
        forms = catalog.store().forms();
        keys = Object.keys(forms).sort(function (a, b) {
          if (forms[a].name < forms[b].name) { return -1; }
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
          var idx = columns.indexOf(item);
          columns.splice(idx, 1);
        });

        // Remove mismatched sort
        if (sort) {
          invalid = sort.filter(function (item) {
            return !feather.properties[item.property];
          });
          invalid.forEach(function (item) {
            var idx = sort.indexOf(item);
            sort.splice(idx, 1);
          });
        }

        // Remove mismatched criteria
        if (criteria) {
          invalid = criteria.filter(function (item) {
            return !feather.properties[item.property];
          });
          invalid.forEach(function (item) {
            var idx = criteria.indexOf(item);
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
      var list = that.data.list();

      if (!list.data.columns().length) {
        throw "List must include at least one column.";
      }
    });

    return that;
  };

  models = catalog.store().models();
  models.workbook = workbookModel;
  models.workbookLocalConfig = workbookChild;
  module.exports = workbookModel;

}());
