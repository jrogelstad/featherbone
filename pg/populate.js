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
      var reqRole, reqLog,
        req;

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
    };

    doneGrants = function (err) {
      if (err) {
        obj.callback(err);
        return;
      }

      c += 1;
      if (c < 2) { return; }

      obj.callback(null, true);
    };

    obj.client.query("SELECT CURRENT_USER", afterCurrentUser);
  };
}(exports));
