/**
    Featherbone is a JavaScript based persistence framework for building object
    relational database applications
    
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

(function (exports) {

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
    that = {};

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
    @param {String} [payload.name] Name of model or function
    @param {String} [payload.method] Method to perform: "GET", "POST",
      "PUT", "PATCH" or "DELETE"
    @param {String} [payload.id] Identifier for "GET", "PATCH" ond "DELETE"
    @param {String} [payload.data] Data for "POST" and "PATCH" or functions
    @param {Object} [payload.client] Database client. If undefined one will
      be intialized by default and wrapped in a transaction if necessary.
    @param {String} [payload.callback] Callback  
    @param {Boolean} Bypass authorization checks. Default = false.
    @return receiver
  */
  that.request = function (obj, isSuperUser) {
    isSuperUser = isSuperUser === undefined ? false : isSuperUser;

    var client, done, transaction, connect,
      doRequest, afterTransaction, afterRequest,
      callback = obj.callback;

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

    doRequest = function (err) {
      if (err) {
        afterRequest(err);
        return;
      }

      // If registered function, execute it
      if (typeof registered[obj.method][obj.name] === "function") {
        obj.data.client = client;
        callback = obj.data.callback;
        transaction = registered[obj.method][obj.name];
        obj = obj.data;

      // Otherwise handle as model
      } else {
        obj.client = client;

        switch (obj.method) {
        case "GET":
          obj.callback = afterRequest;
          controller.doSelect(obj, false, isSuperUser);
          break;
        case "POST":
          transaction = controller.doInsert;
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
      }

      // Wrap transactions
      if (transaction && !obj.client) {
        obj.callback = afterTransaction;
        obj.client.query("BEGIN;", function (err, resp) {
          if (err) {
            obj.callback(err);
          }

          transaction(obj, false, isSuperUser);
        });
        return;
      }

      // Passed client must handle its own transaction wrapping
      transaction(obj, false, isSuperUser);
    };

    afterTransaction = function (err, resp) {
      if (err) {
        obj.client.query("ROLLBACK;", function (e, resp) {
          afterRequest(err);
        });

        return;
      }

      obj.client.query("COMMIT;", function (err) {
        if (err) {
          afterRequest(err);
          return;
        }

        afterRequest(null, resp);
      });
    };

    afterRequest = function (err, resp) {
      controller.setCurrentUser(undefined);
      // Passed client will handle it's own connection
      if (!obj.client) { done(); }

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

    controller.setCurrentUser(obj.user);

    if (obj.client) {
      client = obj.client;
      doRequest();
    } else if (conn) {
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

    The data object should include a callback to forward a response on
    completion. The callback should accept an error as the first
    argument and a response as the second.

    The request will automatically append an active client to the object
    to use for executing queries.

      var fn, callback, datasource = require(./datasource);

      // Create a function that queries something
      fn = function (obj) {
        var sql = "SELECT foo FROM bar WHERE id=$1;",
          params = [obj.id];

        obj.client.query(sql, params, function (err, resp) {
          if (err) {
            obj.callback(err);
            return;
          }

          obj.callback(null, resp.rows);
        })
      }

      // Register the function
      datasource.registerFunction("GET", "myQuery", fn);

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
        name: "myQuery",
        data: {
          id: "HTJ28n",
          callback: callback
        }
      });

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

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

  // Register certain functions
  that.registerFunction("GET", "getSettings", controller.getSettings);
  that.registerFunction("GET", "getModel", controller.getModel);
  that.registerFunction("PUT", "saveModel", controller.saveModel);
  that.registerFunction("DELETE", "deleteModel", controller.deleteModel);

}(exports));


