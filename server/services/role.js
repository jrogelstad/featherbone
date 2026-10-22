/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
    const {Manager} = require("./manager");
    const config = new Config();
    const db = new Database();
    const manager = new Manager();

    /*
        Users live in the manager database (ADR-001): a user is an
        identity in the instance's organization plus an access grant
        on the instance, and nothing here touches the cluster's roles.
        The triggers in scripts/services.js call these by their old
        names; the names stayed, the bodies write identities and
        grants.

        Group roles are rows in "role" and "role_membership" and
        membership is resolved from those rows (B.3), so no cluster
        GRANT mirrors them.
    */

    /*
        The identity this call is about, with the instance and
        organization it sits in. Resolves to undefined when there is no
        instance for the request or no such identity -- an operation on
        a user the manager has never heard of has nothing to change.
    */
    async function identityFor(client, name, mclient) {
        let instance = await manager.instance(mclient, client.tenant());
        let found = await manager.identity(mclient, name);

        if (!found) {
            return;
        }

        return {
            identityPk: found._pk,
            organizationPk: instance.organizationPk,
            row: found,
            tenantPk: instance.tenantPk
        };
    }

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

                /*
                    A wrong old password is the caller's mistake, not
                    the server's: answer it as a client error with the
                    generic sign-in message, never the authenticator's
                    own words (improvement plan 0.3). Before this it
                    came back as a 500.
                */
                db.authenticate(
                    obj.data.request,
                    obj.data.name,
                    obj.data.oldPassword
                ).then(callback).catch(function () {
                    let err = new Error("Invalid sign in credentials.");

                    err.statusCode = 401;
                    reject(err);
                });
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
        that.changeRoleLogin = async function (obj) {
            /*
                Whether a user may sign in to THIS instance is the
                access grant, not a property of the identity: the same
                person may be active in one instance and not in another.
            */
            return await manager.run(async function (mclient) {
                let ctx = await identityFor(
                    obj.client,
                    obj.data.name,
                    mclient
                );

                if (!ctx) {
                    return true;
                }

                await manager.setGrant(mclient, {
                    by: obj.client.currentUser(),
                    identityPk: ctx.identityPk,
                    isActive: obj.data.isLogin === true,
                    tenantPk: ctx.tenantPk
                });
                await manager.audit(mclient, {
                    action: (
                        obj.data.isLogin === true
                        ? "grant.activated"
                        : "grant.deactivated"
                    ),
                    by: obj.client.currentUser(),
                    detail: (
                        "Instance " + obj.client.tenant().name
                    ),
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: ctx.identityPk
                });

                return true;
            });
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
                let client = obj.client;
                let conf = await config.read();
                let plen = conf.passwordLength || 0;

                if (plen > pwd.length) {
                    return Promise.reject(
                        "Password must be at least " + plen +
                        " characters"
                    );
                }

                /*
                    The password belongs to the identity, so it
                    changes once for every instance the person can
                    reach. The hash never leaves manager.js.
                */
                await manager.run(async function (mclient) {
                    let ctx = await identityFor(client, name, mclient);

                    if (!ctx) {
                        throw new Error(
                            "No user account " + name + " found"
                        );
                    }

                    await manager.setPassword(
                        mclient,
                        ctx.identityPk,
                        pwd,
                        client.currentUser()
                    );
                    await manager.audit(mclient, {
                        action: "identity.password_set",
                        by: client.currentUser(),
                        organizationPk: ctx.organizationPk,
                        targetIdentityPk: ctx.identityPk
                    });
                });

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
            @return {Promise}
        */
        that.createRole = async function (obj) {
            let name = obj.data.name;
            let pwd = obj.data.password;

            /*
                A group role is a row in "role" and needs nothing
                here (B.3 resolves membership from those rows). A
                user becomes an identity in this instance's
                organization, with a grant to this instance.
            */
            if (obj.data.isLogin !== true) {
                return;
            }

                let claimed = await obj.client.query(
                    (
                        "SELECT name FROM role " +
                        "WHERE lower(name) = lower($1) AND NOT is_deleted"
                    ),
                    [name]
                );

                if (claimed.rows.length) {
                    throw {
                        message: (
                            "Name " + name + " is already a role name " +
                            "and cannot be used"
                        ),
                        statusCode: 409
                    };
                }

            return await manager.run(async function (mclient) {
                let instance = await manager.instance(
                    mclient,
                    obj.client.tenant()
                );
                let by = obj.client.currentUser();
                let actor = await manager.identity(mclient, by || "");
                let added = await manager.addIdentity(mclient, {
                    by,
                    email: obj.data.email,
                    fullName: obj.data.fullName,
                    organizationPk: instance.organizationPk,
                    password: pwd,
                    username: name
                });

                await manager.setGrant(mclient, {
                    by,
                    grantedByPk: (
                        actor
                        ? actor._pk
                        : null
                    ),
                    identityPk: added.identityPk,
                    isActive: true,
                    tenantPk: instance.tenantPk
                });
                await manager.audit(mclient, {
                    action: (
                        added.created
                        ? "identity.created"
                        : "grant.added"
                    ),
                    actorPk: (
                        actor
                        ? actor._pk
                        : null
                    ),
                    by,
                    detail: (
                        added.created
                        ? "Instance " + obj.client.tenant().name
                        : (
                            "Existing identity granted instance " +
                            obj.client.tenant().name +
                            "; password unchanged"
                        )
                    ),
                    organizationPk: instance.organizationPk,
                    targetIdentityPk: added.identityPk
                });
            });
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
        that.dropRole = async function (obj) {
            /*
                Deleting a user in one instance revokes its access
                there. The identity itself and the grant row stay,
                so the record of who could reach what survives
                (B.5), and the same person keeps any other instance.
            */
            await obj.client.query(
                "DELETE FROM \"$auth\" WHERE role=$1;",
                [obj.data.name]
            );

            return await manager.run(async function (mclient) {
                let ctx = await identityFor(
                    obj.client,
                    obj.data.name,
                    mclient
                );

                if (!ctx) {
                    return true;
                }

                await manager.setGrant(mclient, {
                    by: obj.client.currentUser(),
                    identityPk: ctx.identityPk,
                    isActive: false,
                    tenantPk: ctx.tenantPk
                });
                await manager.audit(mclient, {
                    action: "grant.revoked",
                    by: obj.client.currentUser(),
                    detail: (
                        "User deleted in instance " +
                        obj.client.tenant().name
                    ),
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: ctx.identityPk
                });

                return true;
            });
        };

        return that;
    };

}(exports));

