/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*global Promise*/
/*jslint node, this, es6, for*/
(function (exports) {
    "strict";

    const {
        Events
    } = require("./services/events");
    const {
        Settings
    } = require("./services/settings");

    const events = new Events();
    const settings = new Settings();
    var that;

    // ..........................................................
    // PRIVATE
    //

    function promiseWrapper(name) {
        return function (...args) {
            return new Promise(function (resolve, reject) {
                args[0].callback = function (err, resp) {
                    if (err) {
                        if (typeof err === "string") {
                            err = {
                                message: err,
                                statusCode: 500
                            };
                        } else if (err instanceof Error) {
                            err.statusCode = 500;
                        }

                        reject(err);
                        return;
                    }

                    resolve(resp);
                };

                that[name].apply(null, args);
            });
        };
    }

    // ..........................................................
    // PUBLIC
    //

    that = {

        /**
          Return services.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getServices: function (obj) {
            var sql = "SELECT * FROM \"$service\" ";

            // Query modules
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        /**
          Return modules.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getModules: function (obj) {
            var sql = "SELECT * FROM \"$module\" ";

            // Query modules
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        /**
          Return routes.

          @param {Object} Request payload
          @param {Object} [payload.client] Database client
          @param {Function} [payload.callback] callback
          @return {Object}
        */
        getRoutes: function (obj) {
            var sql = "SELECT * FROM \"$route\";";

            // Query routes
            obj.client.query(sql, function (err, resp) {
                if (err) {
                    obj.callback(err);
                    return;
                }

                // Send back result
                obj.callback(null, resp.rows);
            });
        },

        subscribe: function (obj) {
            events.subscribe(obj.client, obj.subscription, [obj.id])
                .then(function () {
                    obj.callback(null, true);
                })
                .catch(obj.callback);
        },

        unsubscribe: function (obj) {
            events.unsubscribe(obj.client, obj.subscription.id)
                .then(function () {
                    obj.callback(null, true);
                })
                .catch(obj.callback);
        }
    };

    /**
      Returns settings object used internally by service.

      @returns {Object} Settings
    */
    exports.settings = function () {
        return settings;
    };

    // Set properties on exports
    Object.keys(that).forEach(function (key) {
        exports[key] = promiseWrapper(key);
    });

}(exports));