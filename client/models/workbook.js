(function () {
  "use strict";

  var workbook, workbookModel, workbookDefaultConifg, workbookLocalConfig, feathers,
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
        description: "Sheet name",
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
      },
      zoom: {
        description: "Zoom level",
        type: "string",
        default: "100"
      }
    }
  };

  workbookLocalConfig = f.copy(workbookDefaultConifg);
  workbookLocalConfig.description = "Workbook local sheet definition";
  workbookLocalConfig.properties.parent.type.childOf = "localConfig";
  feathers = catalog.data();
  feathers.Workbook = workbook;
  feathers.WorkbookDefaultConfig = workbookDefaultConifg;
  feathers.WorkbookLocalConfig = workbookLocalConfig;

  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.
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

  catalog.register("models", "workbook", workbookModel);
  module.exports = workbookModel;

}());
