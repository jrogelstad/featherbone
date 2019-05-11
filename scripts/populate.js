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
            let getEveryone;
            let createEveryone;
            let grantEveryoneGlobal;
            let user;
            let id;
            let datasource = require("../server/datasource");

            function member() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        (
                            "INSERT INTO \"role_membership\" VALUES " +
                            "(nextval('object__pk_seq'), '48jc3ewrtmp', now(), $1, " +
                            "now(), $1, false, null, $2, 'everyone');"
                        ),
                        [user, id]
                    ).then(resolve).catch(reject);
                });
            }

            function grant() {
                return new Promise(function (resolve, reject) {
                    let sql = "GRANT everyone TO %I;";
                    sql = sql.format([user]);
                    obj.client.query(sql).then(resolve).catch(reject);
                });
            }

            function checkEveryone() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        "SELECT * FROM pg_roles WHERE rolname = 'everyone';"
                    ).then(createRoleEveryone).then(resolve).catch(reject);
                });
            }

            function createRoleEveryone(resp) {
                return new Promise(function (resolve, reject) {
                    if (resp.rows.length) {
                        resolve();
                        return;
                    }

                    obj.client.query(
                        "CREATE ROLE everyone;"
                    ).then(resolve).catch(reject);
                });
            }

            function insertCurrentUser(resp) {
                return new Promise(function (resolve, reject) {
                    user = resp.rows[0].current_user;
                    id = resp.rows[0].id;
                    obj.client.query(
                        (
                            "INSERT INTO \"user_account\" VALUES " +
                            "($2, 'e54y397l4arw', now(), $1, now(), " +
                            "$1, false, null, $1, '', TRUE);"
                        ),
                        [user, id]
                    ).then(resolve).catch(reject);
                });
            }

            // Create admin user manually since we can't run any usual crud
            // logic until this guy exists
            function afterGetUserAccount(err, resp) {
                if (err) {
                    reject(err);
                    return;
                }

                if (resp.rows.length) {
                    getEveryone();
                    return;
                }

                obj.client.query(
                    "SELECT CURRENT_USER AS current_user, nextval('object__pk_seq') AS id"
                ).then(
                    insertCurrentUser
                ).then(
                    member
                ).then(
                    checkEveryone
                ).then(
                    grant
                ).then(
                    getEveryone
                ).catch(reject);
            }

            // Create Everyone role
            getEveryone = function () {
                datasource.request({
                    name: "Role",
                    method: "GET",
                    user: user,
                    id: "everyone",
                    client: obj.client
                }, true).then(createEveryone).catch(reject);
            };

            createEveryone = function (resp) {
                function createEveryoneRole() {
                    let sql = (
                        "SELECT * FROM pg_catalog.pg_roles " +
                        "WHERE rolname = 'everyone';"
                    );

                    obj.client.query(sql).then(function (resp) {
                        if (!resp.rows.length) {
                            obj.client.query(
                                "CREATE ROLE everyone;",
                                [],
                                grantEveryoneGlobal
                            );
                            return;
                        }

                        grantEveryoneGlobal();
                    });
                }

                if (!resp) {
                    datasource.request({
                        name: "Role",
                        method: "POST",
                        user: user,
                        data: {
                            id: "frem61h1sh1d",
                            name: "everyone"
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
                let reqHonorific;
                let reqAddress;
                let reqContact;
                let reqUserAccount;
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
                reqHonorific = req();
                reqHonorific.data.id = "honorific";
                promises.push(datasource.request(reqHonorific));
                reqAddress = req();
                reqAddress.data.id = "address";
                promises.push(datasource.request(reqAddress));
                reqContact = req();
                reqContact.data.id = "contact";
                promises.push(datasource.request(reqContact));
                reqUserAccount = req();
                reqUserAccount.data.id = "user_account";
                promises.push(datasource.request(reqUserAccount));

                Promise.all(promises).then(resolve).catch(reject);
            };

            /* Start */
            obj.client.query(
                "SELECT * FROM user_account WHERE name = CURRENT_USER",
                afterGetUserAccount
            );
        });
    };
}(exports));