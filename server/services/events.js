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
    @module Events
*/
(function (exports) {
    "use strict";

    const {Tools} = require("./tools");
    const tools = new Tools();
    const f = require("../../common/core");

    /**
        Event management services.

        @class Events
        @constructor
        @namespace Services
    */
    exports.Events = function () {
        // ..........................................................
        // PRIVATE
        //

        let events = {};

        // ..........................................................
        // PUBLIC
        //
        /**
            Initialize listener.

            @method listen
            @param {Object} client Database client connection
            @param {String} channel Node server id
            @param {Function} callback Responds to events
            @return {Promise}
        */
        events.listen = function (client, channel, callback) {
            return new Promise(function (resolve, reject) {
                let tenant = f.copy(client.tenant());
                client.on("notification", function (msg) {
                    msg.payload = JSON.parse(msg.payload);
                    msg.payload = tools.sanitize(msg.payload);
                    callback(msg, tenant);
                });

                client.query("LISTEN " + channel).then(resolve).catch(reject);
            });
        };

        /**
            Subscribe to changes against objects with matching ids. If merge is
            true then previous subscription objects continue to listen,
            otherwise previous subscription unsubscribed to.

            @method subscribe
            @param {Object} client Database client connection
            @param {Object} [subscription] If empty promise just resolves
                without change.
            @param {String} subscription.nodeId Node server id.
            @param {String} subscription.eventKey Client event key.
            @param {String} subscription.id Subscription id.
            @param {Boolean} [subscription.merge] Merge previous subscription.
                Default false.
            @param {Array} ids Ids to listen to
            @param {String | Array} tablenames Feather(s) or table name(s)
            to listen for inserts.
            @return {Promise}
        */
        events.subscribe = function (client, subscription, ids, tablenames) {
            if (tablenames && typeof tablenames === "string") {
                tablenames = [tablenames];
            }

            return new Promise(function (resolve, reject) {
                if (!subscription) {
                    resolve();
                    return;
                }

                if (!subscription.nodeId) {
                    throw new Error("Subscription requires a nodeId.");
                }

                if (!subscription.eventKey) {
                    throw new Error("Subscription requires a eventKey.");
                }

                if (!subscription.id) {
                    throw new Error("Subscription requires an id.");
                }

                function doSubscribe() {
                    return new Promise(function (resolve, reject) {
                        let queries = [];
                        let sql = "";
                        let tparams;

                        ids.forEach(function (id) {
                            let params = [
                                subscription.nodeId,
                                subscription.eventKey,
                                subscription.id,
                                id
                            ];

                            sql = (
                                "INSERT INTO \"$subscription\" VALUES " +
                                "($1, $2, $3, $4) ON CONFLICT DO NOTHING;"
                            );
                            queries.push(client.query(sql, params));
                        });

                        if (tablenames && tablenames.length) {
                            tablenames.forEach(function (tablename) {
                                tablename = tablename.toSnakeCase();
                                tparams = [
                                    subscription.nodeId,
                                    subscription.eventKey,
                                    subscription.id,
                                    tablename
                                ];
                                sql = (
                                    "INSERT INTO \"$subscription\" VALUES " +
                                    "($1, $2, $3, $4) ON CONFLICT DO NOTHING;"
                                );

                                queries.push(client.query(sql, tparams));
                            });
                        }

                        Promise.all(queries).then(resolve).catch(reject);
                    });
                }

                if (subscription.merge) {
                    doSubscribe().then(resolve).catch(reject);
                } else {
                    events.unsubscribe(
                        client,
                        subscription.id
                    ).then(
                        doSubscribe
                    ).then(
                        resolve
                    ).catch(
                        reject
                    );
                }
            });
        };

        /**
            Unsubscribe to event notifications by type.

            @method unsubscribe
            @param {Object} client Database client connection
            @param {String} [id] Id to unsubscribe to.
            @param {String} [type] Unsubscribe by 'subscription',
                'instance' or 'node'. Default 'subscription'
            @return {Promise}
        */
        events.unsubscribe = function (client, id, type) {
            return new Promise(function (resolve, reject) {
                type = type || "subscription";
                let sql;
                let param = [id];
                let msg;
                let col;

                if (!id) {
                    resolve();
                    return;
                }

                if (
                    type !== "subscription" &&
                    type !== "instance" &&
                    type !== "node"
                ) {
                    msg = type + " is not a valid type for unsubscribe.";
                    throw new Error(msg);
                }

                if (type === "instance") {
                    col = "eventkey";
                } else {
                    col = type + "id";
                }

                sql = "DELETE FROM \"$subscription\" WHERE ";
                sql += col + " = $1";

                client.query(sql, param).then(resolve).catch(reject);
            });
        };

        return events;
    };

}(exports));

