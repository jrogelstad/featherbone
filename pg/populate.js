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

(function (exports) {
  exports.execute = function (obj) {
    var afterCurrentUser, getEveryone,
      createEveryone, grantEveryoneGlobal, doneGrants, user,
      datasource = require("../server/datasource"),
      c = 0;

    afterCurrentUser = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      user = resp.rows[0].current_user;
      getEveryone();
    };

    // Create Everyone role
    getEveryone = function (err) {
      if (err) {
        obj.callback(err);
        return;
      }

      datasource.request({
        name: "Role",
        method: "GET",
        user: user,
        id: "everyone",
        client: obj.client,
        callback: createEveryone
      }, true);
    };

    createEveryone = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (!resp) {
        datasource.request({
          name: "Role",
          method: "POST",
          user: user,
          data: {
            id: "everyone",
            name: "Everyone",
            description: "All users",
            members: [
              {member: user}
            ]
          },
          client: obj.client,
          callback: grantEveryoneGlobal
        }, true);
        return;
      }

      // Done
      obj.callback(null, true);
    };

    grantEveryoneGlobal = function (err) {
      var req, reqRole, reqLog, reqForm;

      req = function () {
        return {
          method: "PUT",
          name: "saveAuthorization",
          user: user,
          data: {
            id: "role",
            role: "everyone",
            actions: {
              canCreate: true,
              canRead: true,
              canUpdate: true,
              canDelete: true
            }
          },
          client: obj.client,
          callback: doneGrants
        };
      };

      if (err) {
        obj.callback(err);
        return;
      }

      /* Grant everyone access to system objects */
      reqRole = req();
      datasource.request(reqRole);
      reqLog = req();
      reqLog.data.id = "log";
      datasource.request(reqLog);
      reqForm = req();
      reqForm.data.id = "form";
      datasource.request(reqForm);
    };

    doneGrants = function (err) {
      if (err) {
        obj.callback(err);
        return;
      }

      c += 1;
      if (c < 3) { return; }

      obj.callback(null, true);
    };

    obj.client.query("SELECT CURRENT_USER", afterCurrentUser);
  };
}(exports));
