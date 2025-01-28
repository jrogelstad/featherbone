/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

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
  @module Profile
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const db = new Database();
    const f = require("../../common/core");
    const jsonpatch = require("fast-json-patch");
    const conflictErr = new Error(
        "Profile has been changed by another instance. " +
        "Changes will not save until the browser is refereshed."
    );
    conflictErr.statusCode = 409;

    /**
        User's local configuration settings such as column widths, zoom, etc.
        @class Profile
        @constructor
        @namespace Services
    */
    exports.Profile = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Resolves to user profile.

            @method getProfile
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {Object} payload.role Username
            @return {Promise}
        */
        that.getProfile = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = (
                    "SELECT etag, data FROM \"$profiles\" WHERE role = $1;"
                );
                let role = obj.client.currentUser();
                let client = obj.client;

                // Query profile
                client.query(sql, [role], function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    if (resp.rows.length) {
                        resolve(resp.rows[0]);
                    } else {
                        resolve(false);
                    }
                });
            });
        };

        /**
            Save a new user profile.

            @method saveProfile
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {Function} [payload.client.currentUser] Current user
            @param {String} [payload.etag] Version for optimistic locking
            @param {Object} [payload.data] Profile data
            @return {Promise}
        */
        that.saveProfile = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = (
                    "SELECT etag FROM \"$profiles\" WHERE role = $1;"
                );
                let role = obj.client.currentUser();
                let etag = f.createId();
                let client = obj.client;

                // Query profile
                client.query(sql, [role], function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    if (resp.rows.length) {
                        if (obj.etag !== resp.rows[0].etag) {
                            reject(conflictErr);
                            return;
                        }

                        sql = (
                            "UPDATE \"$profiles\" " +
                            "SET etag = $2, data = $3 WHERE role = $1;"
                        );
                    } else {
                        sql = "INSERT INTO \"$profiles\" VALUES ($1, $2, $3);";
                    }

                    client.query(
                        sql,
                        [role, etag, obj.data]
                    ).then(resolve.bind(null, etag)).catch(reject);
                });
            });
        };

        /**
            Update a user profile.
            @method patchProfile
            @param {Object} payload Request payload
            @param {Object} [payload.client] Database client
            @param {String} [payload.etag] Version for optimistic locking
            @param {Object} [payload.data] Profile data
            @return {Promise}
        */
        that.patchProfile = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = (
                    "SELECT etag, data FROM \"$profiles\" WHERE role = $1;"
                );
                let data;
                let role = obj.client.currentUser();
                let etag = f.createId();
                let client = obj.client;

                // Query profile
                client.query(sql, [role], function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    if (resp.rows.length) {
                        if (obj.data.etag !== resp.rows[0].etag) {
                            reject(conflictErr);
                            return;
                        }

                        sql = (
                            "UPDATE \"$profiles\" " +
                            "SET etag = $2, data = $3 WHERE role = $1;"
                        );
                        data = resp.rows[0].data;
                        jsonpatch.applyPatch(data, obj.data.patch);
                        client.query(
                            sql,
                            [role, etag, data]
                        ).then(resolve.bind(null, etag)).catch(reject);
                    } else {
                        reject(
                            new Error("Profile does not exist for " + role)
                        );
                    }
                });
            });
        };

        return that;
    };

}(exports));

