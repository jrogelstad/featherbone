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
          Update whether role can log in.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.name] Role name
          @param {Boolean} [payload.data.isLogin] Is Login
          @return {Object} Promise
        */
        that.changeLogin = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "ALTER ROLE %I " + (
                    obj.data.isLogin === true
                    ? "LOGIN"
                    : "NOLOGIN"
                ) + ";";

                sql = sql.format([name]);
                obj.client.query(sql, function (err) {
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
          Update role password.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.name] Role name
          @param {String} [payload.data.password] Password
          @return {Object} Promise
        */
        that.changePassword = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.password;
                let sql = "ALTER ROLE %I PASSWORD %L;";

                sql = sql.format([name, pwd]);
                obj.client.query(sql, function (err) {
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
          @param {Boolean} [payload.data.isLogin] Is Login
          @param {String} [payload.data.password] Password
          @return {Object} Promise
        */
        that.createRole = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let pwd = obj.data.password;
                let sql = (
                    "SELECT * FROM pg_catalog.pg_roles " +
                    "WHERE rolname = $1;"
                );

                obj.client.query(sql, [name]).then(function (resp) {
                    if (!resp.rows.length) {
                        sql = "CREATE ROLE %I " + (
                            obj.data.isLogin === true
                            ? "LOGIN"
                            : "NOLOGIN"
                        ) + (
                            obj.data.isInherit !== false
                            ? " INHERIT "
                            : " NOINHERIT "
                        ) + " PASSWORD %L;";

                        sql = sql.format([name, pwd]);
                        obj.client.query(sql, function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            // Send back result
                            resolve(true);
                        });
                    } else {
                        that.changeLogin(obj).then(
                            that.changePassword.bind(null, obj)
                        ).then(resolve).catch(reject);
                    }
                });
            });
        };

        /**
          Drop role.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.name] Role name
          @return {Object} Promise
        */
        that.drop = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "DROP ROLE %I;";

                sql = sql.format([name]);
                obj.client.query(sql, function (err) {
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
          Grant one user or role privileges to another role.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.fromRole] Child role
          @param {Boolean} [payload.data.toRole] Parent role
          @return {Object} Promise
        */
        that.grantMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "GRANT %I TO %I;";

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                obj.client.query(sql).then(resolve).catch(reject);
            });
        };

        /**
          Revoke one user or role privileges from another role.

          @param {Object} Payload
          @param {Object} [payload.client]
          @param {Object} [payload.data] Data
          @param {String} [payload.data.fromRole] Child role
          @param {Boolean} [payload.data.toRole] Parent role
          @return {Object} Promise
        */
        that.revokeMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "REVOKE %I FROM %I;";

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                obj.client.query(sql).then(resolve).catch(reject);
            });
        };

        return that;
    };

}(exports));

