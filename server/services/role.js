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
    const {Client} = require("pg");
    const config = new Config();
    const db = new Database();
    const manager = new Manager();

    /*
        Which store answers for users (tenant plan B.4).

        Under "role" every user is a Postgres login role on the cluster,
        and these functions are thin wrappers over CREATE ROLE, ALTER
        ROLE and GRANT. Under "identity" the user lives in the manager
        database and nothing here touches the cluster's roles: the same
        calls write identities, grants and the local profile instead, so
        the triggers in scripts/services.js need no knowledge of which
        strategy is in force.

        Group roles are rows in "role" and "role_membership" under both
        strategies. B.3 resolves membership from those rows, so the
        GRANTs that used to mirror them are not needed under "identity".
    */
    async function usesIdentities() {
        return config.authStrategy(await config.read()) === "identity";
    }

    /*
        The identity this call is about, with the instance and
        organization it sits in. Resolves to undefined when there is no
        instance for the request or no such identity -- an operation on
        a user the manager has never heard of has nothing to change.
    */
    async function identityFor(client, name, mclient) {
        let instance = await manager.instance(mclient, client.tenant());
        let found = await manager.identity(
            mclient,
            instance.organizationPk,
            name
        );

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

                db.authenticate(
                    obj.data.request,
                    obj.data.name,
                    obj.data.oldPassword
                ).then(callback).catch(reject);
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
            if (await usesIdentities()) {
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
            }

            return await new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "ALTER ROLE %I " + (
                    obj.data.isLogin === true
                    ? "LOGIN"
                    : "NOLOGIN"
                ) + ";";
                let client = obj.client;

                sql = sql.format([name]);
                client.query(sql, function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Send back result
                    resolve(true);
                });
            });
        };

        /**
            Featherbone super users can create databases. Otherwise
            not.

            @method changeRoleCreateDb
            @param {Object} Payload
            @param {Client} [payload.client]
            @param {Object} [payload.data] Data
            @param {String} [payload.data.name] Role name
            @param {Boolean} [payload.data.isSuper] Is Super
            @return {Promise}
        */
        that.changeRoleCreateDb = async function (obj) {
            /*
                CREATEDB is a privilege of a Postgres role, and under
                "identity" users have none. Creating databases is the
                platform administrator's to do (ADR-001), and the tenant
                super user is user_account.is_super inside its own
                instance, so there is nothing to change here.
            */
            if (await usesIdentities()) {
                return true;
            }

            let name = obj.data.name;
            let sql = "ALTER ROLE %I " + (
                obj.data.isLogin === true
                ? "CREATEDB"
                : "NOCREATEDB"
            ) + ";";

            sql = sql.format([name]);

            try {
                await obj.client.query(sql);
                return true;
            } catch (err) {
                return Promise.reject(err);
            }
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
                let sql = "ALTER ROLE %I PASSWORD %L;";
                let client = obj.client;
                let conf = await config.read();
                let plen = conf.passwordLength || 0;

                if (plen > pwd.length) {
                    return Promise.reject(
                        "Password must be at least " + plen +
                        " characters"
                    );
                }

                if (config.authStrategy(conf) === "identity") {
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
                } else {
                    sql = sql.format([name, pwd]);
                    await client.query(sql);
                }

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
            @param {Boolean} [payload.data.isSuper] Default false
            @param {Boolean} [payload.data.isInherit] Default false
            @return {Promise}
        */
        that.createRole = async function (obj) {
            let name = obj.data.name;
            let pwd = obj.data.password;
            let sql = (
                "SELECT * FROM pg_catalog.pg_roles " +
                "WHERE rolname = $1;"
            );

            if (await usesIdentities()) {
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
                    let actor = await manager.identity(
                        mclient,
                        instance.organizationPk,
                        by || ""
                    );
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
            }

            sql = (
                "SELECT * FROM pg_catalog.pg_roles " +
                "WHERE rolname = $1;"
            );
            let client = obj.client;
            let resp;

            try {
                resp = await client.query(sql, [name]);
                if (!resp.rows.length) {
                    sql = "CREATE ROLE %I " + (
                        obj.data.isLogin === true
                        ? "LOGIN"
                        : "NOLOGIN"
                    ) + (
                        obj.data.isSuper === true
                        ? " CREATEDB"
                        : " NOCREATEDB"
                    ) + (
                        obj.data.isInherit !== false
                        ? " INHERIT "
                        : " NOINHERIT "
                    ) + " PASSWORD %L;";

                    sql = sql.format([name, pwd]);
                    await client.query(sql);
                } else {
                    /*
                        The role already exists on the cluster -- possibly
                        another database's user (plan 1.1). Adopting it
                        used to ALTER its login, password and createdb
                        unconditionally, so any administrator could take
                        over any user on the cluster, and creating a group
                        over a login role set it NOLOGIN with a blank
                        password. Adoption is now allowed only when the
                        caller proves the password: the test-and-production
                        case (the same person, the same password, a second
                        database) still works, a takeover does not.
                    */
                    let existing = resp.rows[0];

                    if (existing.rolcanlogin) {
                        if (obj.data.isLogin !== true) {
                            throw {
                                statusCode: 409,
                                message: (
                                    "Name " + name + " is already in " +
                                    "use by a user and cannot be used"
                                )
                            };
                        }

                        let conf = await config.read();
                        let probe = new Client({
                            database: client.database || conf.pgDatabase,
                            host: conf.pgHost,
                            port: conf.pgPort,
                            user: name,
                            password: pwd
                        });

                        try {
                            await probe.connect();
                        } catch (ignore) {
                            throw {
                                statusCode: 409,
                                message: (
                                    "User name " + name + " is already " +
                                    "in use"
                                )
                            };
                        } finally {
                            probe.end().catch(function () {
                                return;
                            });
                        }
                    } else if (obj.data.isLogin === true) {
                        throw {
                            statusCode: 409,
                            message: (
                                "Name " + name + " is already a " +
                                "reserved role name and cannot be used"
                            )
                        };
                    }

                    await that.changeRoleLogin(obj);
                    await that.changeRolePassword(obj);
                    await that.changeRoleCreateDb(obj);
                }
            } catch (err) {
                return Promise.reject(err);
            }
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
            if (await usesIdentities()) {
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
            }

            return await new Promise(function (resolve, reject) {
                let name = obj.data.name;
                let sql = "DROP ROLE %I;";
                let client = obj.client;

                function callback() {
                    client.query(
                        "DELETE FROM \"$auth\" WHERE role=$1;",
                        [name]
                    ).then(resolve).catch(reject);
                }

                sql = sql.format([name]);
                client.query(sql).then(callback).catch(reject);
            });
        };

        /**
            Grant one user or role privileges to another role.
            @method grantMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.grantMembership = async function (obj) {
            /*
                Membership is the "role_membership" rows the caller has
                already written; the cluster GRANT only ever mirrored
                them, and B.3 reads the rows directly.
            */
            if (await usesIdentities()) {
                return true;
            }

            return await new Promise(function (resolve, reject) {
                let sql = "GRANT %I TO %I;";
                let client = obj.client;

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        /**
            Revoke one user or role privileges from another role.
            @method revokeMembership
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.fromRole
            @param {Boolean} payload.data.toRole
            @return {Promise}
        */
        that.revokeMembership = async function (obj) {
            /*
                Membership is the "role_membership" rows the caller has
                already written; the cluster GRANT only ever mirrored
                them, and B.3 reads the rows directly.
            */
            if (await usesIdentities()) {
                return true;
            }

            return await new Promise(function (resolve, reject) {
                let sql = "REVOKE %I FROM %I;";
                let client = obj.client;

                sql = sql.format([obj.data.fromRole, obj.data.toRole]);
                client.query(sql).then(resolve).catch(reject);
            });
        };

        return that;
    };

}(exports));

