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

  var feather, featherProperty, featherModel,
    featherPropertyModel, feathers, deleteObjectProperties,
    m = require("mithril"),
    f = require("feather-core"),
    dataSource = require("datasource"),
    model = require("model"),
    list = require("list"),
    catalog = require("catalog");

  deleteObjectProperties = function (d) {
    delete d.id;
    delete d.created;
    delete d.createdBy;
    delete d.updated;
    delete d.updatedBy;
    delete d.isDeleted;
    delete d.objectType;
  };

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
      module: {
        description: "Module name",
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
      isChild: {
        description: "Indicates child status",
        type: "boolean",
        default: "false"
      },
      properties: {
        description: "Parent of \"parent\" of \"Feather Properties\"",
        type: {
          parentOf: "parent",
          relation: "FeatherProperty"
        }
      }
    }
  };

  featherProperty = {
    name: "FeatherProperty",
    description: "Persistence class property definition",
    isChild: true,
    properties: {
      parent: {
        description: "Parent feather",
        type: {
          relation: "Feather",
          childOf: "properties"
        }
      },
      name: {
        description: "Feather name",
        type: "string"
      },
      description: {
        description: "Description",
        type: "string"
      },
      type: {
        description: "JSON data type",
        type: "object",
        default: "string"
      },
      format: {
        description: "Data format",
        type: "string"
      },
      default: {
        description: "Default value or function",
        type: "string"
      },
      isRequired: {
        description: "Flags whether attribute is required",
        type: "boolean",
        default: false
      },
      isReadOnly: {
        description: "Flags whether attribute is read only by default",
        type: "boolean",
        default: false
      },
      inheritedFrom: {
        description: "Feather property is inherited from",
        type: "string"
      }
    }
  };

  feathers = catalog.data();
  feathers.Feather = feather;
  feathers.featherProperty = featherProperty;

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

    that = model(null, feather);
    d = that.data;
    that.idProperty("name");

    that.path = function (name, id) {
      var ret = "/" + name.toSpinalCase();
      if (id) { ret += "/" + id; }
      return ret;
    };

    // ..........................................................
    // PRIVATE
    //

    deleteObjectProperties(d);

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
    toJSON = d.properties.toJSON;
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
    // Reapply previous property's properties
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

    // Update catalog feather locally when specification updated
    state.resolve("/Ready/Fetched/Clean").enter(function () {
      var name = that.id(),
        value = catalog.data()[name] || {},
        json = that.toJSON();

      // Change properties iteratively so anything pointing to
      // the feather gets the changes.
      Object.keys(value).forEach(function (key) {
        delete value[key];
      });
      Object.keys(json).forEach(function (key) {
        value[key] = json[key];
      });

      // Reset catalog in case this is new
      catalog.data()[name] = value;
    });

    if (data) { that.set(data); }

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
      ary.canFilter(false);
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

      if (options.fetch !== false) { ary.fetch(); }
      return prop;
    };
  }());

  /**
    Feather property model.

    @param {Object} Default data
    return {Object}
  */
  featherPropertyModel = function (data) {
    var that = model(data, featherProperty);

    that.idProperty("name");
    deleteObjectProperties(that.data);

    return that;
  };

  catalog.register("models", "feather", featherModel);
  catalog.register("models", "featherProperty", featherPropertyModel);
  module.exports = featherModel;

}());
