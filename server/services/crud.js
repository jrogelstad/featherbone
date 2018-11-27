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

    exports.CRUD = function () {
        // ..........................................................
        // PRIVATE
        //

        var crud = {};

        // ..........................................................
        // PUBLIC
        //

        /**
          Lock a record to prevent others from editing.

          @param {Object} Database client connection
          @param {String} Node id.
          @param {String} Object id.
          @param {String} User name.
          @param {String} Session id.
          @return {Object} Promise
        */
        crud.lock = function (client, nodeid, id, username, sessionid) {
            return new Promise(function (resolve, reject) {
                if (!nodeid) {
                    throw new Error('Lock requires a node id.');
                }

                if (!sessionid) {
                    throw new Error('Lock requires a sessionid.');
                }

                if (!id) {
                    throw new Error('Lock requires an object id.');
                }

                if (!username) {
                    throw new Error('Lock requires a username.');
                }

                function checkLock() {
                    return new Promise(function (resolve, reject) {
                        var sql = "SELECT lock FROM object WHERE id = $1";

                        function callback(resp) {
                            if (!resp.rows.length) {
                                throw new Error("Record " + id + " not found.");
                            }

                            if (resp.rows[0].lock) {
                                throw new Error("Record " + id + " is already locked.");
                            }

                            resolve();
                        }

                        client.query(sql, [id])
                            .then(callback)
                            .catch(reject);
                    });
                }

                function doLock() {
                    return new Promise(function (resolve, reject) {
                        var params,
                            sql = "UPDATE object SET lock = ROW($1, now(), $2, $3) WHERE id = $4";

                        function callback() {
                            resolve(true);
                        }

                        params = [
                            username,
                            nodeid,
                            sessionid,
                            id
                        ];

                        client.query(sql, params)
                            .then(callback)
                            .catch(reject);
                    });
                }

                Promise.resolve()
                    .then(checkLock)
                    .then(doLock)
                    .then(resolve)
                    .catch(reject);

            });
        };

        /**
          Unlock object(s) by type.

          @param {Object} Database client connection
          @param {Object} Criteria for what to unlock.
          @param {String} [criteria.id] Object id.
          @param {String} [criteria.username] User name.
          @param {String} [criteria.sessionId] Session id.
          @param {String} [criteria.nodeId] Node id.
          @return {Object} Promise
        */
        crud.unlock = function (client, criteria) {
            return new Promise(function (resolve, reject) {
                var sql,
                    params = [];
                
                function callback(resp) {
                  resolve(resp.rows);
                }

                sql = 'UPDATE object SET lock = NULL ' +
                        'WHERE true ';

                if (criteria.id) {
                    params.push(criteria.id);
                    sql += ' AND object.id = $1';
                }

                if (criteria.username) {
                    params.push(criteria.username);
                    sql += ' AND username(lock) = $' + params.length;
                }

                if (criteria.sessionId) {
                    params.push(criteria.sessionId);
                    sql += ' AND _sessionid(lock) = $' + params.length;
                }

                if (criteria.nodeId) {
                    params.push(criteria.nodeId);
                    sql += ' AND _nodeid(lock) = $' + params.length;
                }

                if (!params.length) {
                    throw new Error("No lock criteria defined.");
                }

                sql += " RETURNING id; ";

                client.query(sql, params)
                    .then(callback)
                    .catch(reject);
            });
        };

        return crud;
    };

}(exports));

