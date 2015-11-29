/**
    Framework for building object relational database apps
    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global window, f, m */
(function (f) {
  "use strict";

  var workbook, workbookDefaultConifg, workbookLocalConfig, feathers;

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
    isSystem: true,
    properties: {
      parent: {
        description: "Workbook name",
        type: {
          relation: "Workbook",
          childOf: "defaultConfig"
        }
      },
      name: {
        description: "Workbook name",
        type: "string"
      },
      feather: {
        description: "Description",
        type: "string"
      },
      form: {
        description: "Form layout",
        type: "object"
      },
      list: {
        description: "List layout",
        type: "object"
      }
    }
  };

  workbookLocalConfig = JSON.parse(JSON.stringify(workbookDefaultConifg));
  workbookLocalConfig.description = "Workbook local sheet definition";
  workbookLocalConfig.properties.parent.type.childOf = "localConfig";
  feathers = f.catalog.data();
  feathers.Workbook = workbook;
  feathers.WorkbookDefaultConfig = workbookDefaultConifg;
  feathers.WorkbookLocalConfig = workbookLocalConfig;

  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.
    @param {Object} Default data
    return {Object}
  */
  f.models.workbook = function (data) {
    var that, state, substate, doPut;

    // ..........................................................
    // PUBLIC
    //

    that = f.model(data, workbook);
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
      var ds = f.dataSource,
        result = f.prop(),
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
        ds.request(payload).then(result).then(callback);
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

}(f));
