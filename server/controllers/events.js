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
/*jslint node, es6*/
(function (exports) {
    "strict";

    exports.Events = function () {
        // ..........................................................
        // PRIVATE
        //

        var n, params,
                events = {};

         // Helper for registerSubscription
        function buildValues(item) {
            n = n + 1;
            params.push(item.id);

            return "($1, $2, $3, $" + n + ")";
        }

        // ..........................................................
        // PUBLIC
        //

        /**
          Subscribe to changes against objects with matching ids. If merge is true
          then previous subscription objects continue to listen, otherwise previous
          subscription unsubscribed to.

          @param {Object} Database client connection
          @param {Object} Subscription. If empty promise just resolves without change.
          @param {String} [subscription.nodeId] Node server id. Required.
          @param {String} [subscription.sessionId] Client session id. Required.
          @param {String} [subscription.id] Subscription id. Required.
          @param {Boolean} [subscription.merg] Merge previous subscription. Default false.
          @return {Object} Promise
        */
        events.subscribe = function (client, subscription, ids) {
            return new Promise(function (resolve, reject) {
                var sql;

                if (!subscription) {
                    resolve();
                    return;
                }

                if (!subscription.nodeId) {
                    throw new Error('Subscription requires a nodeId.');
                }

                if (!subscription.sessionId) {
                    throw new Error('Subscription requires a sessionId.');
                }

                if (!subscription.id) {
                    throw new Error('Subscription requires an id.');
                }

                function doSubscribe() {
                    return new Promise(function (resolve, reject) {
                        params = [
                            subscription.nodeId,
                            subscription.sessionId,
                            subscription.id
                        ];

                        n = 3;
                        sql = 'INSERT INTO "$subscription" VALUES ' +
                                ids.map(buildValues).toString();

                        client.query(sql, params)
                            .then(resolve)
                            .catch(reject);
                    });
                }

                if (subscription.merge) {
                    doSubscribe()
                        .then(resolve)
                        .catch(reject);
                } else {
                    events.unsubscribe(client, subscription.id)
                        .then(doSubscribe)
                        .then(resolve)
                        .catch(reject);
                }
            });
        };

        /**
          Unsubscribe to event notifications by type.

          @param {Object} Database client connection
          @param {String} Id to unsubscribe to.
          @param {String} Unsubscribe id is by 'subscription', 'session' or 'node'. Default 'subscription'
          @return {Object} Promise
        */
        events.unsubscribe = function (client, id, type) {
            return new Promise(function (resolve, reject) {
                type = type || 'subscription';
                var sql,
                    param = [id];

                if (type !== 'subscription' && type !== 'session' && type !== 'node') {
                    throw new Error(type + ' is not a valid type for unsubscribe.');
                }

                sql = 'DELETE FROM "$subscription" WHERE ' + type + 'id = $1';

                client.query(sql, param)
                    .then(resolve)
                    .catch(reject);
            });
        };

        return events;
    };

}(exports));

