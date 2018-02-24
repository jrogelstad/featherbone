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

(function (exports) {
  "strict";
  var conn,
    pg = require("pg"),
    controller = require("./controller"),
    readPgConfig = require("./pgconfig"),
    registered = {
      GET: {},
      POST: {},
      PUT: {},
      PATCH: {},
      DELETE: {}
    },
    that = {},
    settings = controller.settings();

  /**
    Fetch catalog.

    @returns {Object} promise
  */
  that.getCatalog = function () {
    return new Promise (function (resolve, reject) {
      var payload, after;

      after = function (err, resp) {
        if (err) {
          console.error(err);
          reject(err);
          return;
        }

        resolve(resp);
      };

      payload = {
        method: "GET",
        name: "getSettings",
        user: that.getCurrentUser(),
        callback: after,
        data: {
          name: "catalog"
        }
      };

      that.request(payload);
    });
  };

  /**
    Fetch controllers.

    @returns {Object} promise
  */
  that.getControllers = function () {
    return new Promise (function (resolve, reject) {
      var payload, after;

      after = function (err, resp) {
        if (err) {
          console.error(err);
          reject(err);
          return;
        }

        resolve(resp);
      };

      payload = {
        method: "GET",
        name: "getControllers",
        user: that.getCurrentUser(),
        callback: after
      };

      that.request(payload);
    });
  };

  that.getCurrentUser = function () {
    // TODO: Make this real
    return "postgres";
  };

  /**
    Fetch routes.

    @returns {Object} promise
  */
  that.getRoutes = function () {
    return new Promise (function (resolve, reject) {
      var payload, after;

      after = function (err, resp) {
        if (err) {
          console.error(err);
          reject(err);
          return;
        }

        resolve(resp);
      };

      payload = {
        method: "GET",
        name: "getRoutes",
        user: that.getCurrentUser(),
        callback: after
      };

      that.request(payload);
    });
  };

  /**
    Request.

    Example payload:
        {
           "name": "Contact",
           "method": "POST",
           "data": {
             "id": "1f8c8akkptfe",
             "created": "2015-04-26T12:57:57.896Z",
             "createdBy": "admin",
             "updated": "2015-04-26T12:57:57.896Z",
             "updatedBy": "admin",
             "fullName": "John Doe",
             "birthDate": "1970-01-01T00:00:00.000Z",
             "isMarried": true,
             "dependentes": 2
           }
        }

    @param {Object} Payload
    @param {String} [payload.name] Name of feather or function
    @param {String} [payload.method] Method to perform: "GET", "POST",
      "PUT", "PATCH" or "DELETE"
    @param {String} [payload.id] Identifier for "GET", "PATCH" ond "DELETE"
    @param {String} [payload.data] Data for "POST" and "PATCH" or functions
    @param {Object} [payload.client] Database client. If undefined one will
      be intialized by default and wrapped in a transaction if necessary.
    @param {String} [payload.callback] Callback  
    @param {Boolean} Bypass authorization checks. Default = false.
    @param {Boolean} Ignore registration and treat as data. Default = false.
    @return receiver
  */
  that.request = function (obj, isSuperUser) {
    isSuperUser = isSuperUser === undefined ? false : isSuperUser;

    var client, done, transaction, connect, isChild, isRegistered, doRequest,
      afterTransaction, afterRequest, doExecute, doMethod, doQuery, doTraverse,
      wrapped,
      catalog = settings.catalog || {},
      callback = obj.callback,
      externalClient = false,
      wrap = false;

    catalog = catalog.data || {};

    isRegistered = function (method, name) {
      return typeof registered[method][name] === "function";
    };

    connect = function () {
      pg.connect(conn, function (err, c, d) {
        client = c;
        done = d;

        // handle an error from the connection
        if (err) {
          controller.setCurrentUser(undefined);
          console.error("Could not connect to server", err);
          obj.callback(err);
          return;
        }

        doRequest();
      });
    };

    doExecute = function (options) {
      return new Promise (function (resolve, reject) {
        // Wrap transactions
        options.callback = function (err, resp) {
          if (err) {
            reject(err);
            return;
          }
          resolve(resp);
        };

        if (wrap && !wrapped) {
          client.query("BEGIN;", function (err) {
            if (err) {
              reject(err);
              return;
            }

            wrapped = true;
            transaction(obj, false, isSuperUser);
          });
          return;
        }

        // Passed client must handle its own transaction wrapping
        transaction(obj, isChild, isSuperUser);
      });
    };

    doMethod = function (options) {
      return new Promise (function (resolve, reject) {
        wrap = !options.client;
        options.data = options.data || {};
        options.data.id = options.data.id || options.id;
        obj.client = client;
        transaction = registered[options.method][options.name];
        doExecute(options).then(resolve).catch(reject);
      });
    };

    doQuery = function () {
      obj.client = client;
      isChild = false;

      switch (obj.method) {
      case "GET":
        obj.callback = afterRequest;
        controller.doSelect(obj, false, isSuperUser);
        return;
      case "POST":
        if (obj.id) {
          transaction = controller.doUpsert;
        } else {
          transaction = controller.doInsert;
        }
        break;
      case "PATCH":
        transaction = controller.doUpdate;
        break;
      case "DELETE":
        transaction = controller.doDelete;
        break;
      default:
        obj.callback("method \"" + obj.method + "\" unknown");
      }

      doExecute(obj)   
        .then(function (resp) { afterTransaction(null, resp); })
        .catch(function (err) { afterTransaction(err); });
    };

    doRequest = function (err) {
      if (err) {
        afterRequest(err);
        return;
      }

      if (!client.currentUser && !obj.user) {
        obj.callback("User undefined." + obj.method + obj.name);
        return;
      }

      if (!client.currentUser) {
        client.currentUser = obj.user;
      }

      // If alter data, process it
      if (catalog[obj.name]) {
        doTraverse(obj.method, obj.name, obj.data);

      // If function, execute it
      } else if (isRegistered(obj.method, obj.name)) {
        doMethod(obj)
          .then(function (resp) { afterTransaction(null, resp); })
          .catch(function (err) { afterTransaction(err); });

      // Young fool, now you will die.
      } else {
        obj.callback("Function " + obj.method + " " + obj.name + " is not registered.");
      }
    };

    doTraverse = function (method, name, data) {
      var feather = settings.catalog.data[name],
        parent = feather.inherits || "Object",
        options = {
          method: method,
          name: name,
          client: client,
          data: data
        };

      // If business logic defined, do it
      if (isRegistered(method, name)) {
        doMethod(options, false)
          .then(function(data) {
            if (name === "Object") {
              doQuery();
              return;
            }

            doTraverse(method, parent, data);
          }).
          catch(function (err) {
            callback(err);
          });

      // If traversal done, forward to database
      } else if (name === "Object") {
        doQuery();

      // If no logic, but parent, traverse up the tree
      } else {
        doTraverse(method, parent, data);
      }
    };

    afterTransaction = function (err, resp) {
      if (wrapped) {
        if (err) {
          client.query("ROLLBACK;", function () {
            afterRequest(err);
          });

          return;
        }

        client.query("COMMIT;", function (err) {
          if (err) {
            afterRequest(err);
            return;
          }

          afterRequest(null, resp);
        });
        return;
      }
      
      afterRequest(err, resp);
    };

    afterRequest = function (err, resp) {
      // Passed client will handle it's own connection
      if (!externalClient) { done(); }

      // Format errors into objects that can be handled by server
      if (err) {
        console.error(err);
        if (typeof err === "object") {
          err = {message: err.message, statusCode: err.statusCode || 500};
        } else {
          err = {message: err, statusCode: 500};
        }
        err.isError = true;
        callback(err);
        return;
      }

      // Otherwise return response
      callback(null, resp);
    };

    if (obj.client) {
      externalClient = true;
      client = obj.client;
      doRequest();
      return;
    }

    if (conn) {
      connect();
      return;
    }

    // Read configuration if necessary
    readPgConfig(function (config) {
      conn = "postgres://" +
        config.user + ":" +
        config.password + "@" +
        config.server + "/" +
        config.database;
      connect();
    });

    return this;
  };

  /**
    Register a function that can be called by a method type. Use
    this to expose function calls via `request`. As a rule, all
    functions must accept an object as an argument whose properties
    can be used to calculate the result. The object should be passed
    as `data` on the request.

    The object should include a callback to forward a response on
    completion. The callback should accept an error as the first
    argument and a response as the second.

    The request will automatically append an active client to the object
    to use for executing queries.

      var fn, callback, datasource = require(./datasource);

      // Create a function that updates something specific
      fn = function (obj) {
        var sql = "UPDATE foo SET bar = false WHERE id=$1;",
          params = [obj.id];

        obj.client.query(sql, params, function (err, resp) {
          obj.callback(err, resp.rows);
        })
      }

      // Register the function
      datasource.registerFunction("POST", "myUpdate", fn);

      // Define a callback to use when calling our function
      callback = function (err, resp) {
        if (err) {
          console.error(err);
          return;
        }

        console.log("Query rows->", resp);
      }

      // Execute a request that calls our function and sends a response
      // via the callback
      datasource.request({
        method: "GET",
        name: "myUpdate",
        callback: callback,
        data: {
          id: "HTJ28n"
        }
      });

    @seealso requestFunction
    @param {String} Function name
    @param {String} Method. "GET", "POST", "PUT", "PATCH", or "DELETE"
    @param {Function} Function
    @return receiver
  */
  that.registerFunction = function (method, name, func) {
    registered[method][name] = func;
    return this;
  };

  /**
    @return {Object} Object listing register functions
  */
  that.registeredFunctions = function () {
    var keys = Object.keys(registered),
      result = {};

    keys.forEach(function (key) {
      result[key] = Object.keys(registered[key]);
    });

    return result;
  };

  /**
    @return {Object} Internal settings object maintained by controller
  */
  that.settings = function () {
    return settings;
  };

  /**
    Helper to expose a registered function to the public API. Use by binding
    the name of the registered function to be called. The function will transform
    the data on a routed requset to the proper format to make a `POST` request
    on the registered function.

      // Expose the example function described on `registerFunction` to a router.
      (function (app, datasource) {
        "strict";

        // Register route to the public
        var express = require("express");
          router = express.Router(),
          func = datasource.postFunction.bind("myUpdate");

        router.route("/my-update").post(func);
        app.use('/my-app', router);

      }(app, datasource));

    @param {Object} Request
    @param {Object} Response
    @seealso registerFunction
    @return receiver
  */
  that.postFunction = function (req, res) {
   var payload, callback,
      args = req.body;

    callback = function (err, resp) {
      if (err) {
        res.status(err.statusCode).json(err.message);
        return;
      }

      if (resp === undefined) {
        res.statusCode = 204;
      }

      // No caching... ever
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
      res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
      res.setHeader("Expires", "0"); //
      res.json(resp);
    };

    payload = {
      method: "POST",
      name: this,
      user: "postgres", //getCurrentUser(),
      callback: callback,
      data: args
    };

    console.log(JSON.stringify(payload, null, 2));
    that.request(payload);
  };

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

  // Transformation helper for crud functions
  var proxy = function (obj) {
    obj.data.client = obj.client;
    obj.data.callback = obj.callback;
    controller[this](obj.data);
  };

  // Register certain functions
  that.registerFunction("GET", "getControllers", controller.getControllers);
  that.registerFunction("GET", "getFeather", controller.getFeather);
  that.registerFunction("GET", "getModules", controller.getModules);
  that.registerFunction("GET", "getRoutes", controller.getRoutes);
  that.registerFunction("GET", "getSettings", controller.getSettings);
  that.registerFunction("GET", "getSettingsRow", controller.getSettingsRow);
  that.registerFunction("GET", "getSettingsDefinition", 
    controller.getSettingsDefinition);
  that.registerFunction("GET", "getWorkbook", controller.getWorkbook);
  that.registerFunction("GET", "getWorkbooks", controller.getWorkbooks);
  that.registerFunction("GET", "isAuthorized", controller.isAuthorized);
  that.registerFunction("POST", "doDelete", proxy.bind("doDelete"));
  that.registerFunction("POST", "doInsert", proxy.bind("doInsert"));
  that.registerFunction("POST", "doUpdate", proxy.bind("doUpdate"));
  that.registerFunction("POST", "doUpsert", proxy.bind("doUpsert"));
  that.registerFunction("PUT", "saveAuthorization",
    controller.saveAuthorization);
  that.registerFunction("PUT", "saveFeather", controller.saveFeather);
  that.registerFunction("PUT", "saveSettings", controller.saveSettings);
  that.registerFunction("PUT", "saveWorkbook", controller.saveWorkbook);
  that.registerFunction("DELETE", "deleteFeather", controller.deleteFeather);
  that.registerFunction("DELETE", "deleteWorkbook", controller.deleteWorkbook);

}(exports));


