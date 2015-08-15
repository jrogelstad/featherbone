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

/*global plv8 */
(function (exports) {

  var client, done,
    pg = require("pg"),
    controller = require("./controller"),
    readPgConfig = require("./pgconfig"),
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
    @param {Boolean} Bypass authorization checks. Default = false.
    @return receiver
  */
  that.request = function (obj, isSuperUser) {
    isSuperUser = isSuperUser === undefined ? false : isSuperUser;

    var transaction, afterTransaction, afterRequest,
      callback = obj.callback;

    controller.setCurrentUser(obj.user);

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

    if (transaction) {
      obj.callback = afterTransaction;
      obj.client.query("BEGIN;", function (err, resp) {
        if (err) {
          obj.callback(err);
        }

        transaction(obj, false, isSuperUser);
      });
    }

    return this;
  };

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

}(exports));


