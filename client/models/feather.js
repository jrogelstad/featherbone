(function () {
  "use strict";

  var feather, featherModel, feathers,
    f = require("feather-core"),
    model = require("model"),
    dataSource = require("datasource"),
    catalog = require("catalog");

  feather = {
    name: "Feather",
    plural: "Feathers",
    description: "Persistence class definition",
    isSystem: true,
    properties: {
      name: {
        description: "Feather name",
        type: "string"
      },
      description: {
        description: "Description",
        type: "string"
      },
      properties: {
        description: "Properties",
        type: "string"
      },
      isChild: {
        description: "Indicates child status",
        type: "boolean"
      }
    }
  };

  feathers = catalog.data();
  feathers.Feather = feather;

  /**
    A factory that returns a persisting object based on a definition call a
    `feather`. Can be extended by modifying the return object directly.
    @param {Object} Default data
    return {Object}
  */
  featherModel = function (data) {
    var that, state, substate, doPut;

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);
    that.idProperty("name");

    that.path = function (name, id) {
      var ret = "/feather/" + name.toSpinalCase();
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

  catalog.register("models", "feather", featherModel);
  module.exports = featherModel;

}());
