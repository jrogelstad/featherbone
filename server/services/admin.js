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
/*jslint node unordered*/
/**
    Administration of the manager database, from inside an instance.

    The manager is never routable (tenant plan section 9), so there is no
    database to point a browser at to see who may sign in to what. These
    operations run in whatever instance the administrator is already
    signed in to and act on that instance's organization, which is the
    only organization they can see.

    Three tiers, as ADR-001 describes them:

    * **platform** -- `identity.is_platform_admin`. Featherbone's own
      administrators. May do everything these routes offer.
    * **organization** -- `identity.is_org_admin`. May manage every
      identity in their organization and grant any of its instances.
    * **instance** -- a tenant super user (`user_account.is_super`) who
      holds neither flag. May read their organization, and may create,
      password and grant users **for the instance they are signed in
      to** and no other. This is the authority they already have through
      `POST /data/user-account`, named and no wider.

    Anyone else is refused. A reader with no tier at all gets 401 rather
    than an empty screen, because "you may not see this" and "there is
    nothing here" are different answers.

    @module Admin
*/
(function (exports) {
    "use strict";

    const {Config} = require("../config");
    const {Manager} = require("./manager");

    const config = new Config();
    const manager = new Manager();

    const STATUSES = ["active", "disabled"];

    function forbidden(message) {
        return {
            message,
            statusCode: 401
        };
    }

    function notFound(message) {
        return {
            message,
            statusCode: 404
        };
    }

    function invalid(message) {
        return {
            message,
            statusCode: 400
        };
    }

    /**
        @class Admin
        @constructor
        @namespace Services
    */
    exports.Admin = function () {
        let that = {};

        /*
            Who is asking, where from, and how much they may do. Every
            operation starts here, so the tier is decided once and in
            one place.
        */
        async function contextFor(mclient, obj) {
            let instance = await manager.instance(mclient, obj.tenant);
            let actor = await manager.identity(
                mclient,
                instance.organizationPk,
                obj.user || ""
            );
            let tier;

            if (actor && actor.is_platform_admin) {
                tier = "platform";
            } else if (actor && actor.is_org_admin) {
                tier = "organization";
            } else if (obj.isSuper) {
                tier = "instance";
            }

            if (!tier) {
                throw forbidden("Not authorized to administer identities");
            }

            return {
                actor,
                organizationPk: instance.organizationPk,
                tenantPk: instance.tenantPk,
                tier
            };
        }

        function actorPk(ctx) {
            return (
                ctx.actor
                ? ctx.actor._pk
                : null
            );
        }

        /*
            A tier-"instance" administrator may only act on a person who
            can already reach the instance they are signed in to, and
            may not touch administrators.
        */
        async function targetFor(mclient, ctx, id, tenant) {
            let target = await manager.identityById(
                mclient,
                ctx.organizationPk,
                id
            );

            if (!target) {
                throw notFound("No such identity in this organization");
            }

            if (ctx.tier === "instance") {
                if (target.is_platform_admin || target.is_org_admin) {
                    throw forbidden(
                        "Only an organization administrator may change " +
                        "another administrator"
                    );
                }

                let resp = await mclient.query(
                    (
                        "SELECT 1 FROM access_grant " +
                        "WHERE _identity_identity_pk = $1 " +
                        "  AND _tenant_tenant_pk = $2 AND NOT is_deleted"
                    ),
                    [target._pk, ctx.tenantPk]
                );

                if (!resp.rows.length) {
                    throw forbidden(
                        "User " + target.username + " has no access to " +
                        tenant.name + ", so it cannot be changed from here"
                    );
                }
            }

            return target;
        }

        function identityOut(row) {
            return {
                email: row.email,
                failedAttempts: row.failed_attempts,
                fullName: row.full_name,
                grants: row.grants,
                id: row.id,
                isOrgAdmin: row.is_org_admin,
                isPlatformAdmin: row.is_platform_admin,
                lastSignedIn: row.last_signed_in,
                lockedUntil: row.locked_until,
                status: (
                    (
                        row.status === "active" &&
                        row.locked_until &&
                        new Date(row.locked_until) > new Date()
                    )
                    ? "locked"
                    : row.status
                ),
                username: row.username
            };
        }

        /**
            Everything one administration screen needs in one request:
            who the caller is, what they may do, the organization, its
            instances, its identities and the recent audit trail.

            `authStrategy` rides along so the screen can say plainly
            whether what it shows is deciding sign-in yet: under "role"
            these records are real and editable, but the password the
            cluster holds is still the one being checked.

            @method overview
            @param {Object} payload
            @param {Object} payload.tenant Instance of the request
            @param {String} payload.user Signed-in user name
            @param {Boolean} payload.isSuper Local super user
            @return {Promise}
        */
        that.overview = async function (obj) {
            let conf = await config.read();

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let organization = await manager.organization(
                    mclient,
                    ctx.organizationPk
                );
                let identities = await manager.identities(
                    mclient,
                    ctx.organizationPk
                );
                let instances = await manager.instances(
                    mclient,
                    ctx.organizationPk
                );
                let trail = await manager.auditTrail(
                    mclient,
                    ctx.organizationPk,
                    obj.limit
                );

                return {
                    actor: (
                        ctx.actor
                        ? ctx.actor.username
                        : obj.user
                    ),
                    audit: trail.map(function (row) {
                        return {
                            action: row.action,
                            actor: row.actor || row.author,
                            detail: row.detail,
                            id: row.id,
                            occurred: row.occurred,
                            target: row.target
                        };
                    }),
                    authStrategy: config.authStrategy(conf),
                    identities: identities.map(identityOut),
                    instance: obj.tenant.id,
                    instances: instances.map(function (row) {
                        return {
                            database: row.pg_database,
                            id: row.id,
                            isActive: row.is_active,
                            name: row.name
                        };
                    }),
                    organization: {
                        authentication: organization.authentication,
                        id: organization.id,
                        isActive: organization.is_active,
                        isTwoFactorRequired: (
                            organization.is_two_factor_required
                        ),
                        name: organization.name
                    },
                    tier: ctx.tier
                };
            });
        };

        /**
            Create an identity in the caller's organization and grant it
            an instance. Defaults to the instance the caller is signed
            in to, which is the only one a tier-"instance"
            administrator may name.

            @method createIdentity
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.username
            @param {String} [payload.data.fullName]
            @param {String} [payload.data.email]
            @param {String} [payload.data.password]
            @param {String} [payload.data.instance] Instance id to grant
            @return {Promise}
        */
        that.createIdentity = async function (obj) {
            let data = obj.data || {};

            if (!data.username || !data.username.trim()) {
                throw invalid("A user name is required");
            }

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let tenantPk = ctx.tenantPk;

                if (data.instance && data.instance !== obj.tenant.id) {
                    if (ctx.tier === "instance") {
                        throw forbidden(
                            "Only an organization administrator may grant " +
                            "another instance"
                        );
                    }

                    let resp = await mclient.query(
                        (
                            "SELECT _pk FROM tenant " +
                            "WHERE id = $1 " +
                            "  AND _organization_organization_pk = $2 " +
                            "  AND NOT is_deleted"
                        ),
                        [data.instance, ctx.organizationPk]
                    );

                    if (!resp.rows.length) {
                        throw notFound(
                            "No such instance in this organization"
                        );
                    }
                    tenantPk = resp.rows[0]._pk;
                }

                let added = await manager.addIdentity(mclient, {
                    by: obj.user,
                    email: data.email,
                    fullName: data.fullName,
                    organizationPk: ctx.organizationPk,
                    password: data.password,
                    username: data.username.trim()
                });

                await manager.setGrant(mclient, {
                    by: obj.user,
                    grantedByPk: actorPk(ctx),
                    identityPk: added.identityPk,
                    isActive: true,
                    tenantPk
                });
                await manager.audit(mclient, {
                    action: (
                        added.created
                        ? "identity.created"
                        : "grant.added"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: "From the administration screen",
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: added.identityPk
                });

                return {created: added.created};
            });
        };

        /**
            Set an identity's password. One password serves every
            instance the person can reach, so this is not scoped to the
            instance the caller is in -- which is why a tier-"instance"
            administrator may only do it for someone who is already in
            their instance.

            @method setPassword
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {String} payload.data.password
            @return {Promise}
        */
        that.setPassword = async function (obj) {
            let data = obj.data || {};
            let conf = await config.read();
            let plen = conf.passwordLength || 0;

            if (!data.password) {
                throw invalid("A password is required");
            }
            if (data.password.length < plen) {
                throw invalid(
                    "Password must be at least " + plen + " characters"
                );
            }

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target = await targetFor(
                    mclient,
                    ctx,
                    data.id,
                    obj.tenant
                );

                await manager.setPassword(
                    mclient,
                    target._pk,
                    data.password,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "identity.password_set",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: "From the administration screen",
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: target._pk
                });

                return true;
            });
        };

        /**
            Set an identity's status: "active" or "disabled". Active is
            also how a locked account is released, because unlocking is
            exactly a return to active -- the counter and the lock
            expiry go with it.

            @method setStatus
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {String} payload.data.status
            @return {Promise}
        */
        that.setStatus = async function (obj) {
            let data = obj.data || {};

            if (STATUSES.indexOf(data.status) === -1) {
                throw invalid(
                    "Status must be one of: " + STATUSES.join(", ")
                );
            }

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target = await targetFor(
                    mclient,
                    ctx,
                    data.id,
                    obj.tenant
                );
                let was = target.status;

                await manager.setStatus(
                    mclient,
                    target._pk,
                    data.status,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: (
                        (data.status === "active" && was === "locked")
                        ? "identity.unlocked"
                        : "identity." + data.status
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: "Was " + was,
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: target._pk
                });

                return true;
            });
        };

        /**
            Grant or revoke one instance for one identity. A revoke
            keeps the row and deactivates it, so the history of who
            could reach what is not destroyed (tenant plan B.5).

            @method setGrant
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {String} payload.data.instance Instance id
            @param {Boolean} payload.data.isActive
            @return {Promise}
        */
        that.setGrant = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let instanceId = data.instance || obj.tenant.id;
                let tenantPk = ctx.tenantPk;

                if (instanceId !== obj.tenant.id) {
                    if (ctx.tier === "instance") {
                        throw forbidden(
                            "Only an organization administrator may grant " +
                            "another instance"
                        );
                    }

                    let resp = await mclient.query(
                        (
                            "SELECT _pk FROM tenant " +
                            "WHERE id = $1 " +
                            "  AND _organization_organization_pk = $2 " +
                            "  AND NOT is_deleted"
                        ),
                        [instanceId, ctx.organizationPk]
                    );

                    if (!resp.rows.length) {
                        throw notFound(
                            "No such instance in this organization"
                        );
                    }
                    tenantPk = resp.rows[0]._pk;
                }

                let target = await targetFor(
                    mclient,
                    ctx,
                    data.id,
                    obj.tenant
                );

                await manager.setGrant(mclient, {
                    by: obj.user,
                    grantedByPk: actorPk(ctx),
                    identityPk: target._pk,
                    isActive: data.isActive !== false,
                    tenantPk
                });
                await manager.audit(mclient, {
                    action: (
                        data.isActive === false
                        ? "grant.revoked"
                        : "grant.added"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: "From the administration screen",
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: target._pk
                });

                return true;
            });
        };

        /**
            Make an identity an organization administrator, or stop it
            being one. Organization administrators and above only: this
            is the authority to manage everyone else in the
            organization, so it is not an instance administrator's to
            hand out.

            @method setOrgAdmin
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {Boolean} payload.data.isOrgAdmin
            @return {Promise}
        */
        that.setOrgAdmin = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                if (ctx.tier === "instance") {
                    throw forbidden(
                        "Only an organization administrator may appoint " +
                        "administrators"
                    );
                }

                let target = await manager.identityById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such identity in this organization");
                }

                await manager.setOrgAdmin(
                    mclient,
                    target._pk,
                    data.isOrgAdmin,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: (
                        data.isOrgAdmin === true
                        ? "identity.org_admin_granted"
                        : "identity.org_admin_revoked"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: target._pk
                });

                return true;
            });
        };

        /*
            Instance administration (tenant plan D.4). The same three
            tiers decide what a caller may do; an instance-tier super
            user sees the one instance they are signed in to and
            changes nothing, because what a database is registered as
            is not theirs to decide.
        */
        function requireOrgWide(ctx, what) {
            if (ctx.tier !== "platform" && ctx.tier !== "organization") {
                throw forbidden(
                    "Only an organization administrator may " + what
                );
            }
        }

        function instanceOut(row, registry, current) {
            let served = registry || [];
            let live = served.find(
                (entry) => entry.pgDatabase === row.pg_database
            );

            return {
                database: row.pg_database,
                expiration: row.expiration,
                id: row.id,
                isActive: row.is_active,
                isCurrent: row.id === current,
                isDemo: row.is_demo,
                /*
                    Whether this process is serving the instance right
                    now, which is not the same as being registered: a
                    database that was registered a moment ago, or one
                    that cannot be reached, is registered and not
                    served.
                */
                isListening: Boolean(live && live.isListening),
                isServed: Boolean(live),
                name: row.name,
                service: (
                    row.service_id
                    ? {
                        host: row.pg_host,
                        id: row.service_id,
                        name: row.service_name,
                        port: row.pg_port,
                        user: row.pg_user
                    }
                    : undefined
                ),
                users: row.users
            };
        }

        /**
            What the instances screen shows: the organization's
            instances, what this process is serving, the databases in
            the cluster nothing is registered for, the connections
            available to register through, instances that belong to no
            organization, and the recent changes to any of it.

            @method instanceOverview
            @param {Object} payload
            @return {Promise}
        */
        that.instanceOverview = async function (obj) {
            let conf = await config.read();

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let organization = await manager.organization(
                    mclient,
                    ctx.organizationPk
                );
                let rows = await manager.instanceDetail(
                    mclient,
                    ctx.organizationPk
                );
                let orgWide = (
                    ctx.tier === "platform" || ctx.tier === "organization"
                );
                let current = obj.tenant.id;
                let instances = rows.map(
                    (row) => instanceOut(row, obj.registry, current)
                );
                let audit = [];
                let databases = [];
                let orphans = [];
                let services = [];

                if (orgWide) {
                    let trail = await manager.systemAudit(
                        mclient,
                        obj.limit
                    );
                    let unattached = await manager.orphanInstances(mclient);
                    let connections = await manager.services(mclient);

                    let unregistered = await manager.unregisteredDatabases(
                        mclient
                    );

                    /*
                        The manager is not an instance and must never
                        be offered as one.
                    */
                    databases = unregistered.filter(
                        (name) => name !== config.managerDatabase(conf)
                    );
                    audit = trail.map(function (row) {
                        return {
                            action: row.action,
                            author: row.author,
                            detail: row.detail,
                            id: row.id,
                            occurred: row.occurred
                        };
                    });
                    orphans = unattached.map(function (row) {
                        return {
                            database: row.pg_database,
                            id: row.id,
                            isActive: row.is_active,
                            name: row.name
                        };
                    });
                    services = connections.map(function (row) {
                        return {
                            host: row.pg_host,
                            id: row.id,
                            name: row.name,
                            port: row.pg_port,
                            user: row.pg_user
                        };
                    });
                } else {
                    instances = instances.filter((row) => row.isCurrent);
                }

                return {
                    actor: (
                        ctx.actor
                        ? ctx.actor.username
                        : obj.user
                    ),
                    audit,
                    authStrategy: config.authStrategy(conf),
                    databases,
                    instance: current,
                    instances,
                    /*
                        The manager is never routable, so it is named
                        here rather than listed as something to open.
                    */
                    manager: {database: config.managerDatabase(conf)},
                    organization: {
                        id: organization.id,
                        name: organization.name
                    },
                    orphans,
                    services,
                    tier: ctx.tier
                };
            });
        };

        /**
            Register a database that already exists as an instance of
            this organization. The database is not touched: it must
            already be an instance, which `node install.js --instance`
            makes it.

            @method registerInstance
            @param {Object} payload
            @return {Promise}
        */
        that.registerInstance = async function (obj) {
            let data = obj.data || {};
            let name = String(data.name || "").trim();
            let database = String(data.database || "").trim().toLowerCase();

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let available;
                let services;
                let service;
                let tenantPk;

                requireOrgWide(ctx, "register an instance");

                if (!name) {
                    throw invalid("A name is required");
                }

                if (!database) {
                    throw invalid("A database is required");
                }

                available = await manager.unregisteredDatabases(mclient);

                if (available.indexOf(database) === -1) {
                    throw invalid(
                        "\"" + database + "\" is not a database in this " +
                        "cluster that nothing is registered for"
                    );
                }

                services = await manager.services(mclient);
                service = services.find(
                    (row) => row.id === data.service
                );

                if (!service) {
                    throw invalid("Name the connection to reach it through");
                }

                tenantPk = await manager.addInstance(mclient, {
                    by: obj.user,
                    database,
                    name,
                    organizationPk: ctx.organizationPk,
                    servicePk: service._pk
                });
                await manager.audit(mclient, {
                    action: "instance.registered",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: name + " (" + database + ")",
                    organizationPk: ctx.organizationPk
                });

                return {id: tenantPk};
            });
        };

        /**
            Attach an instance that belongs to no organization, as an
            installation that pre-dates ADR-001 has.

            @method attachInstance
            @param {Object} payload
            @return {Promise}
        */
        that.attachInstance = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let orphans;
                let target;

                requireOrgWide(ctx, "attach an instance");
                orphans = await manager.orphanInstances(mclient);
                target = orphans.find((row) => row.id === data.id);

                if (!target) {
                    throw notFound(
                        "No instance without an organization has that id"
                    );
                }

                await manager.attachInstance(
                    mclient,
                    target._pk,
                    ctx.organizationPk,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "instance.attached",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: target.name + " (" + target.pg_database + ")",
                    organizationPk: ctx.organizationPk
                });

                return true;
            });
        };

        /**
            Open an instance for sign-in, or close it. Closing leaves
            the database alone: nobody can enter it, and everything in
            it is still there.

            @method setInstanceActive
            @param {Object} payload
            @return {Promise}
        */
        that.setInstanceActive = async function (obj) {
            let data = obj.data || {};
            let isActive = data.isActive === true;

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target;

                requireOrgWide(ctx, "open or close an instance");
                target = await manager.instanceById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such instance in this organization");
                }

                if (
                    !isActive &&
                    obj.tenant &&
                    target.id === obj.tenant.id
                ) {
                    throw invalid(
                        "This is the instance you are signed in to. " +
                        "Close it from another one, or nobody can open " +
                        "it again from inside it."
                    );
                }

                await manager.setInstanceActive(
                    mclient,
                    target._pk,
                    isActive,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: (
                        isActive
                        ? "instance.opened"
                        : "instance.closed"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: target.name + " (" + target.pg_database + ")",
                    organizationPk: ctx.organizationPk
                });

                return true;
            });
        };

        return that;
    };

}(exports));
