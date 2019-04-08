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

    exports.execute = function (obj) {
        return new Promise(function (resolve, reject) {
            let afterCurrentUser;
            let getEveryone;
            let createEveryone;
            let grantEveryoneGlobal;
            let user;
            let datasource = require("../server/datasource");

            afterCurrentUser = function (err, resp) {
                if (err) {
                    reject(err);
                    return;
                }

                user = resp.rows[0].current_user;
                obj.client.query((
                        "INSERT INTO \"role\" VALUES " +
                        "(nextval('object__pk_seq'), $1, now(), $1, now(), " +
                        "$1, false, null, $1, '', TRUE, TRUE) " +
                        "ON CONFLICT DO NOTHING;"
                    ),
                    [user],
                    getEveryone
                );
            };

            // Create Everyone role
            getEveryone = function (err) {
                if (err) {
                    reject(err);
                    return;
                }

                datasource.request({
                    name: "Role",
                    method: "GET",
                    user: user,
                    id: "everyone",
                    client: obj.client
                }, true).then(createEveryone).catch(reject);
            };

            createEveryone = function (resp) {
                if (!resp) {
                    function createEveryoneRole() {
                        obj.client.query(
                            "CREATE ROLE everyone;",
                            [],
                            grantEveryoneGlobal
                        )
                    };

                    datasource.request({
                        name: "Role",
                        method: "POST",
                        user: user,
                        data: {
                            id: "everyone",
                            name: "Everyone",
                            members: [{
                                member: user
                            }]
                        },
                        client: obj.client
                    }, true).then(
                        createEveryoneRole
                    ).catch(
                        reject
                    );
                    return;
                }

                // Done
                resolve(true);
            };

            grantEveryoneGlobal = function () {
                let req;
                let reqRole;
                let reqLog;
                let reqFeather;
                let reqModule;
                let reqDataService;
                let promises = [];

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
                        client: obj.client
                    };
                };

                /* Grant everyone access to system objects */
                reqRole = req();
                promises.push(datasource.request(reqRole));
                reqLog = req();
                reqLog.data.id = "log";
                promises.push(datasource.request(reqLog));
                reqFeather = req();
                reqFeather.data.id = "feather";
                promises.push(datasource.request(reqFeather));
                reqModule = req();
                reqModule.data.id = "module";
                promises.push(datasource.request(reqModule));
                reqDataService = req();
                reqDataService.data.id = "data_service";
                promises.push(datasource.request(reqDataService));

                Promise.all(promises).then(resolve).catch(reject);
            };

            /* Start */
            obj.client.query("SELECT CURRENT_USER", afterCurrentUser);
        });
    };
}(exports));