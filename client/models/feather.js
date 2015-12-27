(function () {
  "use strict";

  var feather, featherModel, feathers,
    m = require("mithril"),
    f = require("feather-core"),
    dataSource = require("datasource"),
    model = require("model"),
    list = require("list"),
    catalog = require("catalog");

  feather = {
    name: "Feather",
    plural: "Feathers",
    description: "Persistence class definition",
    properties: {
      name: {
        description: "Feather name",
        type: "string"
      },
      description: {
        description: "Description",
        type: "string"
      },
      plural: {
        description: "Plural name",
        type: "string"
      },
      inherits: {
        description: "Feather inherited from",
        type: "string",
        default: "Object"
      },
      isSystem: {
        description: "Internal sytem object",
        type: "boolean",
        default: true
      },
      properties: {
        description: "Properties",
        type: "array"
      },
      isChild: {
        description: "Indicates child status",
        type: "boolean",
        default: "false"
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
    var that, d, state, substate, doPut, p, toJSON;

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);
    d = that.data;
    that.idProperty("name");

    that.path = function (name, id) {
      var ret = "/feather/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    // ..........................................................
    // PRIVATE
    //

    delete d.id;
    delete d.created;
    delete d.createdBy;
    delete d.updated;
    delete d.updatedBy;
    delete d.isDeleted;
    delete d.objectType;

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

    // Convert properties from array to object
    toJSON = d.properties.toJSON();
    d.properties.toJSON = function () {
      var obj = {},
        ary = toJSON();

      ary.forEach(function (item) {
        var dup = f.copy(item),
          name = dup.name;

        delete dup.name;
        obj[name] = dup;
      });
      return obj;
    };

    // Convert properties from object to array
    p = d.properties;
    d.properties = function (value) {
      var ary;
      if (value === undefined) { return p(); }

      ary = [];
      Object.keys(value).forEach(function (key) {
        var obj = f.copy(value[key]);
        obj.name = key;
        ary.push(obj);
      });

      return p(ary);
    };
    Object.keys(p).forEach(function (key) {
      d.properties[key] = p[key];
    });

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

  featherModel.list = (function () {
    var fn = list("Feather");

    return function (options) {
      options = options || {};
      var prop, ary, opts, state, substate, doFetch,
        models = catalog.store().models();

      opts = {
        path: "/settings/catalog",
        fetch: false
      };
      prop = fn(opts);
      ary = prop();
      state = ary.state();

      doFetch = function (context) {
        var url = ary.path();

        return m.request({
          method: "GET",
          url: url
        }).then(function (data) {
          if (context.merge === false) { 
            ary.reset();
          }
          Object.keys(data).forEach(function (key) {
            var item = data[key],
              obj = models.feather();
            item.name = key;
            obj.set(item, true, true);
            obj.state().goto("/Ready/Fetched");
            ary.add(obj);
          });
          state.send("fetched");
        });
      };

      substate = state.resolve("/Busy/Fetching");
      substate.enters.length = 0;
      substate.enter(doFetch);

      if (options.fetch) { ary.fetch(); }
      return prop;
    };
  }());

  catalog.register("models", "feather", featherModel);
  module.exports = featherModel;

}());
