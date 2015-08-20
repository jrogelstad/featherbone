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
  exports.execute = function (obj) {
    var afterCurrentUser, getGlobalFolder, createGlobalFolder, getEveryone,
      createEveryone, grantEveryoneGlobal, doneGrants, user,
      datasource = require("../server/datasource"),
      c = 0;

    afterCurrentUser = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      user = resp.rows[0].current_user;
      getGlobalFolder();
    };

    getGlobalFolder = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      datasource.request({
        name: "Folder",
        method: "GET",
        user: user,
        id: "global",
        client: obj.client,
        callback: createGlobalFolder
      }, true);
    };

    // Create default global folder
    createGlobalFolder = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      if (!resp) {
        datasource.request({
          name: "Folder",
          method: "POST",
          user: user,
          folder: false,
          data: {
            id: "global",
            name: "Global folder",
            description: "Root folder for all objects"
          },
          client: obj.client,
          callback: getEveryone
        }, true);
        return;
      }
      getEveryone();
    };

    // Create Everyone role
    getEveryone = function (err, resp) {
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
          folder: "global",
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

    grantEveryoneGlobal = function (err, resp) {
      var req;

      if (err) {
        obj.callback(err);
        return;
      }

      // Grant everyone access to global folder
      req = {
        method: "POST",
        name: "saveAuthorization",
        user: user,
        data: {
          id: "global",
          role: "everyone",
          isMember: true,
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

      /* Access to folder contents */
      datasource.request(req);

      /* Access to folder itself */
      delete req.data.isMember;
      datasource.request(req);

      /* Grant everyone access to other objects */
      req.data.id = "role";
      datasource.request(req);
      req.data.id = "folder";
      datasource.request(req);
      req.data.id = "log";
      datasource.request(req);
    };

    doneGrants = function (err, resp) {
      if (err) {
        obj.callback(err);
        return;
      }

      c++;
      if (c < 5) { return; }

      obj.callback(null, true);
    };

    obj.client.query("SELECT CURRENT_USER", afterCurrentUser);
  };
}(exports));
