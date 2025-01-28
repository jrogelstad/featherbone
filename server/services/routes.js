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
    @module Routes
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const db = new Database();

    /**
        Routes define URLs for custom data service functions to be called.
        @class Routes
        @constructor
        @namespace Services
    */
    exports.Routes = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Fetch all routes from the database and resolve in promise.
            @method getRoutes
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @return {Promise}
        */
        that.getRoutes = function (obj) {
            return new Promise(function (resolve, reject) {
                let sql = (
                    "SELECT module, path, function FROM \"_route\" " +
                    "WHERE NOT is_deleted;"
                );
                let client = obj.client;

                // Query routes
                client.query(sql, function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(resp.rows);
                });
            });
        };

        return that;
    };

}(exports));

