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
/*jslint node unordered*/
const f = require("../common/core");

(function (exports) {
    "use strict";

    exports.execute = function (obj) {
        return new Promise(function (resolve, reject) {
            let grantEveryoneGlobal;
            let usr;
            let id;
            let datasource = require("../server/datasource");

            function insertMember() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        (
                            "INSERT INTO \"role_membership\" VALUES " +
                            "(nextval('object__pk_seq'), '48jc3ewrtmp', " +
                            "now(), $1, " +
                            "now(), $1, false, null, $2, 'everyone');"
                        ),
                        [usr, id]
                    ).then(resolve).catch(reject);
                });
            }

            function grantMembership() {
                return new Promise(function (resolve, reject) {
                    let sql = "GRANT everyone TO %I;";
                    sql = sql.format([usr]);
                    obj.client.query(sql).then(resolve).catch(reject);
                });
            }

            function createEveryone() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        "INSERT INTO \"role\" VALUES " +
                        "(nextval('object__pk_seq'), " +
                        "'z6obwieygb0', now(), $1, now(), " +
                        "$1, false, null, $1, $2, 'everyone');",
                        [usr, f.createId()]
                    ).then(resolve).catch(reject);
                });
            }

            function checkEveryone() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        "SELECT * FROM \"role\" WHERE name = 'everyone';"
                    ).then(createEveryone).then(resolve).catch(reject);
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

            function checkRoleEveryone() {
                return new Promise(function (resolve, reject) {
                    obj.client.query(
                        "SELECT * FROM pg_roles WHERE rolname = 'everyone';"
                    ).then(createRoleEveryone).then(resolve).catch(reject);
                });
            }

            function insertCurrentUser(resp) {
                return new Promise(function (resolve, reject) {
                    usr = resp.rows[0].current_user;
                    id = resp.rows[0].id;
                    obj.client.query(
                        (
                            "INSERT INTO user_account " +
                            "(_pk, id, created, created_by, updated, " +
                            " updated_by, is_deleted, lock, owner, etag, " +
                            " name, password, is_super, " +
                            "_contact_contact_pk, is_active, " +
                            " change_password, last_password_change, " +
                            " last_sign_in, sign_in_attempts, is_locked)  " +
                            " VALUES " +
                            "($2, 'e54y397l4arw', now(), $1, now(), " +
                            "$1, false, null, $1, $3, $1, '', true, -1, " +
                            "true, false, null, null, 0, false);"
                        ),
                        [usr, id, f.createId()]
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
                    grantEveryoneGlobal();
                    return;
                }

                obj.client.query(
                    "SELECT CURRENT_USER AS current_user, " +
                    "nextval('object__pk_seq') AS id"
                ).then(
                    insertCurrentUser
                ).then(
                    insertMember
                ).then(
                    checkRoleEveryone
                ).then(
                    checkEveryone
                ).then(
                    grantMembership
                ).then(
                    grantEveryoneGlobal
                ).catch(reject);
            }

            grantEveryoneGlobal = function () {
                let req;
                let reqRole;
                let reqHonorific;
                let reqContact;
                let promises = [];

                req = function () {
                    return {
                        method: "PUT",
                        name: "saveAuthorization",
                        user: usr,
                        data: {
                            feather: "Honorific",
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

                /* Grant everyone access to low security system objects */
                reqHonorific = req();
                promises.push(datasource.request(reqHonorific));
                reqContact = req();
                reqContact.data.feather = "Contact";
                promises.push(datasource.request(reqContact));
                reqRole = req();
                reqRole.data.feather = "Role";
                reqRole.data.actions.canCreate = false;
                reqRole.data.actions.canUpdate = false;
                reqRole.data.actions.canDelete = false;
                promises.push(datasource.request(reqRole));

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