/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
*/
/*jslint node*/
/**
    @module Role
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const {Config} = require("../config");
    const config = new Config();
    const db = new Database();

    /**
        @class Role
        @constructor
        @namespace Services
    */
    exports.Role = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Used for user to update their own password. Requires both
            old password and new password.
            @method changeOwnPassword
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Data
            @param {String} payload.data.name Role name
            @param {String} payload.data.oldPassword Old password
            @param {String} payload.data.newPassword New password
            @param {Object} payload.data.request Request object
            @return {Promise}
        */
        that.changeOwnPassword = function (obj) {
            return new Promise(function (resolve, reject) {
                function callback() {
                    that.changeRolePassword({
                        client: obj.client,
                        data: {
                            name: obj.data.name,
                            password: obj.data.newPassword
                        }
                    }).then(resolve).catch(reject);
                }

                if (obj.data.oldPassword === obj.data.newPassword) {
                    throw new Error(
                        "New password can not be the same as old password"
                    );
                }

                if (!obj.data.newPassword) {
                    throw new Error("New password can not be blank");
                }

                db.authenticate(
                    obj.data.request,
                    obj.data.name,
                    obj.data.oldPassword
                ).then(callback).catch(reject);
            });
        };

        /**
            Update whether role can log in.
            @method changeRoleLogin
            @param {Object} Payload
            @param {Client} [payload.client]
            @param {Object} [payload.data] Data
            @param {String} [payload.data.name] Role name
            @param {Boolean} [payload.data.isLogin] Is Login
            @return {Promise}
        */
        that.changeRoleLogin = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "ALTER ROLE %I " + (
                    obj.data.isLogin === true
                    ? "LOGIN"
                    : "NOLOGIN"
                ) + ";";
                let client = obj.client;

                sql = sql.format([name]);
                client.query(sql, function (err) {
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
            Featherbone super users can create databases. Otherwise
            not.

            @method changeRoleCreateDb
            @param {Object} Payload
            @param {Client} [payload.client]
            @param {Object} [payload.data] Data
            @param {String} [payload.data.name] Role name
            @param {Boolean} [payload.data.isSuper] Is Super
            @return {Promise}
        */
        that.changeRoleCreateDb = async function (obj) {
            let name = obj.data.name;
            let sql = "ALTER ROLE %I " + (
                obj.data.isLogin === true
                ? "CREATEDB"
                : "NOCREATEDB"
            ) + ";";

            sql = sql.format([name]);

            try {
                await obj.client.query(sql);
                return true;
            } catch (err) {
                return Promise.reject(err);
            }
        };

        /**
            Update role password.
            @method changeRolePassword
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Data
            @param {String} payload.data.name Role name
            @param {String} payload.data.password Password
            @return {Promise}
        */
        that.changeRolePassword = async function (obj) {
            try {
                let name = obj.data.name;
                let pwd = obj.data.password || "";
                let sql = "ALTER ROLE %I PASSWORD %L;";
                let client = obj.client;
                let conf = await config.read();
                let plen = conf.passwordLength || 0;

                if (plen > pwd.length) {
                    return Promise.reject(
                        "Password must be at least " + plen +
                        " characters"
                    );
                }

                sql = sql.format([name, pwd]);
                await client.query(sql);
                await client.query((
                    "UPDATE user_account SET " +
                    "change_password = false WHERE name = $1;"
                ), [name]);

                // Send back result
                return true;
            } catch (e) {
                return Promise.reject(e);
            }
        };

        /**
            Create role with password.
            @method createRole
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Role name
            @param {String} payload.data.password Password
            @param {Boolean} [payload.data.isLogin] Default false
            @param {Boolean} [payload.data.isSuper] Default false
            @param {Boolean} [payload.data.isInherit] Default false
            @return {Promise}
        */
        that.createRole = async function (obj) {
            let name = obj.data.name;
            let pwd = obj.data.password;
            let sql = (
                "SELECT * FROM pg_catalog.pg_roles " +
                "WHERE rolname = $1;"
            );
            let client = obj.client;
            let resp;

            try {
                resp = await client.query(sql, [name]);
                if (!resp.rows.length) {
                    sql = "CREATE ROLE %I " + (
                        obj.data.isLogin === true
                        ? "LOGIN"
                        : "NOLOGIN"
                    ) + (
                        obj.data.isSuper === true
                        ? " CREATEDB"
                        : " NOCREATEDB"
                    ) + (
                        obj.data.isInherit !== false
                        ? " INHERIT "
                        : " NOINHERIT "
                    ) + " PASSWORD %L;";

                    sql = sql.format([name, pwd]);
                    await client.query(sql);
                } else {
                    await that.changeRoleLogin(obj);
                    await that.changeRolePassword(obj);
                    await that.changeRoleCreateDb(obj);
                }
            } catch (err) {
                return Promise.reject(err);
            }
        };

        /**
            Drop role.
            @method dropRole
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.name Role name
            @return {Promise}
        */
        that.dropRole = function (obj) {
            return new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "DROP ROLE %I;";
                let client = obj.client;

                function callback() {
                    client.query(
                        "DELETE FROM \"$auth\" WHERE role=$1;",
                        [name]
                    ).then(resolve).catch(reject);
                }

                sql = sql.format([name]);
                client.query(sql).then(callback).catch(reject);
            });
        };

        /**
            Grant one user or role privileges to another role.
            @method grantMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.grantMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "GRANT %I TO %I;";
                let client = obj.client;

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        /**
            Revoke one user or role privileges from another role.
            @method revokeMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.revokeMembership = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = "REVOKE %I FROM %I;";
                let client = obj.client;

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        return that;
    };

}(exports));

