/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint node*/
(function (exports) {
    "use strict";

    exports.Role = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Update user account password.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.name] Role name
          @param {String} [payload.data.password] Password
          @return {Boolean}
        */
        that.changePassword = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.pwd;
                let sql = "ALTER ROLE $1 WITH PASSWORD $2;";

                obj.client.query(sql, [name, pwd], function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(true);
                });
            });
        };

        /**
          Create role with password.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.name] Role name
          @param {String} [payload.data.password] Password
          @return {Boolean}
        */
        that.createRole = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.pwd;
                let sql = "CREATE ROLE $1 WITH PASSWORD $2;";

                obj.client.query(sql, [name, pwd], function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(true);
                });
            });
        };

        return that;
    };

}(exports));

