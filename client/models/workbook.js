/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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
    f = require("feather-core"),
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
        type: {
          parentOf: "parent",
          relation: "WorkbookDefaultConfig"
        }
      },
      localConfig: {
        description: "Parent of \"parent\" on \"WorkbookLocalConfig\"",
        type: {
          parentOf: "parent",
          relation: "WorkbookLocalConfig"
        }
      }
    }
  };

  workbookDefaultConifg = {
    description: "Workbook default sheet definition",
    isChild: true,
    properties: {
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

  feathers = catalog.data();
  feathers.Workbook = workbook;
  feathers.WorkbookDefaultConfig = workbookDefaultConifg;
  feathers.WorkbookLocalConfig = workbookLocalConfig;
  feathers.WorkbookList = workbookList;

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

    that = model(data, workbook);
    that.idProperty("name");

    that.path = function (name, id) {
      var ret = "/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    // ..........................................................
    // PRIVATE
    //

    doPut = function (context) {
      var result = f.prop(),
        cache = that.toJSON(),
        payload = {method: "PUT", path: that.path(that.name, that.data.name()),
          data: cache},
        callback = function () {
          if (result()) {
            state.send('fetched');
            context.deferred.resolve(that.data);
          }
        };

      if (that.isValid()) {
        dataSource.request(payload).then(result).then(callback);
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
    substate.event("save", function (deferred) {
      substate.goto("/Busy/Saving", {
        context: {deferred: deferred}
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
        columns = that.data.list().data.columns();

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
      } else {
        columns.length = 0;
      }

      that.data.form(forms[id]);
    });

    that.onValidate(function () {
      var list = that.data.list();

      if (!that.data.name()) {
        throw "A worksheet name is required.";
      }

      if (!that.data.form()) {
        throw "A form selection is required.";
      }

      if (!list.data.columns().length) {
        throw "List must include at least one column.";
      }
    });

    return that;
  };

  models = catalog.register("models");
  models.workbook = workbookModel;
  models.workbookLocalConfig = workbookChild;
  module.exports = workbookModel;

}());
