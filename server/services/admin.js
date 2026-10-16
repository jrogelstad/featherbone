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
    const {Database} = require("../database");
    const datasource = require("../datasource");
    const f = require("../../common/core");

    const config = new Config();
    const manager = new Manager();
    const db = new Database();

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

            /*
                The break-glass path (ADR-001 requirement 3, tenant plan
                A.4). Sign-in is organization-scoped, so a platform
                administrator can never be signed in to another
                organization's instance; instead they may name the
                organization to act on. Everything downstream keys on
                ctx.organizationPk, so the whole screen and every write
                follows, and the audit rows record the organization
                acted on.
            */
            let organizationPk = instance.organizationPk;
            let reach = obj.organization || (obj.data || {}).organization;

            if (reach) {
                let other = await manager.organizationById(mclient, reach);

                if (!other) {
                    throw notFound("No such organization");
                }

                if (other._pk !== organizationPk) {
                    if (tier !== "platform") {
                        throw forbidden(
                            "Only a platform administrator may " +
                            "administer another organization"
                        );
                    }
                    organizationPk = other._pk;
                }
            }

            return {
                actor,
                homeOrganizationPk: instance.organizationPk,
                organizationPk,
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

            @method overview
            @param {Object} payload
            @param {Object} payload.tenant Instance of the request
            @param {String} payload.user Signed-in user name
            @param {Boolean} payload.isSuper Local super user
            @return {Promise}
        */
        that.overview = async function (obj) {
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
                    /*
                        Every organization, so a platform administrator
                        can reach one that has lost its administrator
                        (the break-glass picker). Only for them: what
                        other organizations exist is not an
                        organization administrator's to see.
                    */
                    organizations: (
                        ctx.tier === "platform"
                        ? (await manager.organizations(mclient)).map(
                            function (row) {
                                return {
                                    id: row.id,
                                    isActive: row.is_active,
                                    name: row.name
                                };
                            }
                        )
                        : undefined
                    ),
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
                let templates = [];
                let provisioning = {};

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

                    /*
                        What a new instance may be built from (D.1):
                        databases marked as templates on the cluster.
                        A registered instance database also works when
                        it is quiet -- the guarded clone refuses a busy
                        source -- so the screen offers both.
                    */
                    let marked = await mclient.query(
                        (
                            "SELECT datname FROM pg_database " +
                            "WHERE datistemplate " +
                            "  AND datname NOT IN " +
                            "  ('template0', 'template1') " +
                            "ORDER BY datname"
                        )
                    );

                    templates = marked.rows.map((row) => row.datname);

                    /*
                        Unfinished builds, so the screen can say where
                        each one stopped and offer to resume it.
                    */
                    let hasProv = await mclient.query(
                        "SELECT to_regclass('\"$provision\"') AS t"
                    );

                    if (hasProv.rows[0].t) {
                        let pending = await mclient.query(
                            (
                                "SELECT t.id, p.state, p.detail " +
                                "FROM \"$provision\" p " +
                                "JOIN tenant t ON t._pk = p.tenant_pk " +
                                "WHERE NOT t.is_deleted " +
                                "  AND p.state <> 'active' " +
                                "  AND t._organization_organization_pk = $1"
                            ),
                            [ctx.organizationPk]
                        );

                        pending.rows.forEach(function (row) {
                            provisioning[row.id] = {
                                detail: row.detail,
                                state: row.state
                            };
                        });
                    }
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
                    provisioning,
                    services,
                    templates,
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

                /*
                    The "$db" marker check (tenant plan D.1/D.4): a
                    database registered by mistake used to show as
                    loaded and answer nothing. Only a database that
                    says it is an instance may be registered; the
                    manager says "manager" and a stray database says
                    nothing, and both are refused with the reason.
                */
                let conf = await config.read();
                let probe;

                try {
                    probe = await db.connect({
                        pgDatabase: database,
                        pgService: {
                            pgHost: conf.pgHost,
                            pgPort: conf.pgPort,
                            pgUser: conf.pgUser,
                            pgPassword: conf.pgPassword
                        }
                    });
                } catch (ignore) {
                    throw invalid(
                        "\"" + database + "\" could not be reached to " +
                        "verify it is an instance, so it was not " +
                        "registered"
                    );
                }

                try {
                    let marker = await probe.client.query(
                        "SELECT kind FROM \"$db\""
                    ).catch(function () {
                        return {rows: []};
                    });

                    if (
                        !marker.rows.length ||
                        marker.rows[0].kind !== "instance"
                    ) {
                        throw invalid(
                            "\"" + database + "\" is not a Featherbone " +
                            "instance (its \"$db\" marker says \"" + (
                                marker.rows.length
                                ? marker.rows[0].kind
                                : "nothing"
                            ) + "\"), so it was not registered"
                        );
                    }
                } finally {
                    probe.done();
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

        // ..................................................................
        // PROVISIONING (tenant plan D.1)
        //

        /*
            Provisioning state, kept in its own bare table in the
            manager rather than on the Tenant feather, so an existing
            manager needs no reinstall to carry it. Made on first use.
            One row per tenant being built; the row is the resumable
            record the plan asks for, and `FOR UPDATE SKIP LOCKED` on it
            is what stops two nodes building the same tenant twice.
        */
        async function provisionTable(mclient) {
            await mclient.query(
                "CREATE TABLE IF NOT EXISTS \"$provision\" (" +
                "  tenant_pk bigint PRIMARY KEY," +
                "  state text NOT NULL," +
                "  template text NOT NULL," +
                "  detail text NOT NULL DEFAULT ''," +
                "  requested_by text NOT NULL," +
                "  updated timestamp with time zone NOT NULL DEFAULT now()" +
                ")"
            );
        }

        function requirePlatform(ctx, what) {
            if (ctx.tier !== "platform") {
                throw forbidden(
                    "Only a platform administrator may " + what
                );
            }
        }

        /*
            A client on the calling instance for the guarded database
            API, which asks databaseActor who the caller is.
        */
        async function callerClient(obj) {
            let conn = await db.connect(obj.tenant);

            conn.client.currentUser = () => obj.user;
            return conn;
        }

        /*
            One provisioning step. Each step is claimed, run and
            committed on its own, so killing the process at any point
            leaves the last completed step durable, a resume re-enters
            where it left off, and a rival node's claim finds the row
            locked and reports busy instead of building twice.

            States: requested -> created -> configured -> seeded ->
            active. Every step is idempotent: "created" skips a
            database that already exists (the crash-after-create case),
            "seeded" re-grants without changing passwords, and a resume
            of an already active tenant is a no-op. The plan's
            "notified" state is folded into activation: the audit row is
            the hook, and notifying anyone is commerce (D.4), not
            lifecycle.
        */
        async function provisionStep(obj, mclient) {
            let tenantPk = obj.tenantPk;
            let resp;
            let row;

            await mclient.query("BEGIN");

            try {
                resp = await mclient.query(
                    (
                        "SELECT p.state, p.template, p.requested_by, " +
                        "  t.name, t.pg_database, " +
                        "  t._organization_organization_pk AS org_pk " +
                        "FROM \"$provision\" p " +
                        "JOIN tenant t ON t._pk = p.tenant_pk " +
                        "WHERE p.tenant_pk = $1 AND NOT t.is_deleted " +
                        "FOR UPDATE OF p SKIP LOCKED"
                    ),
                    [tenantPk]
                );

                if (!resp.rows.length) {
                    await mclient.query("COMMIT");
                    return "busy";
                }

                row = resp.rows[0];

                if (row.state === "active") {
                    await mclient.query("COMMIT");
                    return "active";
                }

                let conf = await config.read();
                let next;

                if (row.state === "requested") {
                    /*
                        The database. Already there means a process died
                        between CREATE DATABASE and the commit below;
                        the clone is atomic, so it is complete.
                    */
                    let there = await mclient.query(
                        "SELECT 1 FROM pg_database WHERE datname = $1",
                        [row.pg_database]
                    );

                    if (!there.rows.length) {
                        let conn = await callerClient(obj);

                        try {
                            await datasource.createDatabase(
                                conn.client,
                                row.pg_database,
                                row.template
                            );
                        } finally {
                            conn.done();
                        }
                    }
                    next = "created";
                } else if (row.state === "created") {
                    /*
                        The marker: the clone must say it is an
                        instance, or the template was not one.
                    */
                    let conn = await db.connect({
                        pgDatabase: row.pg_database,
                        pgService: {
                            pgHost: conf.pgHost,
                            pgPort: conf.pgPort,
                            pgUser: conf.pgUser,
                            pgPassword: conf.pgPassword
                        }
                    });

                    try {
                        let marker = await conn.client.query(
                            "SELECT kind FROM \"$db\""
                        );

                        if (
                            !marker.rows.length ||
                            marker.rows[0].kind !== "instance"
                        ) {
                            throw new Error(
                                "Template \"" + row.template +
                                "\" did not yield an instance database"
                            );
                        }
                    } finally {
                        conn.done();
                    }
                    next = "configured";
                } else if (row.state === "configured") {
                    /*
                        The administrators: every active organization
                        administrator gets a grant on the new instance
                        and a tenant-super-user profile in it, so
                        somebody can sign in to what was just built.
                        Grants are set-or-reactivate and the profile
                        insert is ON CONFLICT DO NOTHING, so a re-run
                        changes nothing.
                    */
                    let admins = await mclient.query(
                        (
                            "SELECT _pk, username FROM identity " +
                            "WHERE _organization_organization_pk = $1 " +
                            "  AND is_org_admin AND status = 'active' " +
                            "  AND NOT is_deleted"
                        ),
                        [row.org_pk]
                    );
                    let conn = await db.connect({
                        pgDatabase: row.pg_database,
                        pgService: {
                            pgHost: conf.pgHost,
                            pgPort: conf.pgPort,
                            pgUser: conf.pgUser,
                            pgPassword: conf.pgPassword
                        }
                    });

                    try {
                        let a = 0;

                        while (a < admins.rows.length) {
                            let who = admins.rows[a];

                            a += 1;
                            await manager.setGrant(mclient, {
                                by: row.requested_by,
                                identityPk: who._pk,
                                isActive: true,
                                tenantPk
                            });

                            let made = await conn.client.query(
                                (
                                    "INSERT INTO user_account (" +
                                    "  _pk, id, created, created_by, " +
                                    "  updated, updated_by, is_deleted, " +
                                    "  owner, etag, name, is_login, " +
                                    "  is_super, is_active, " +
                                    "  change_password, " +
                                    "  sign_in_attempts, is_locked" +
                                    ") VALUES (" +
                                    "  nextval('object__pk_seq'), $1, " +
                                    "  now(), 'system', now(), 'system', " +
                                    "  false, $2, $1, $2, true, true, " +
                                    "  true, false, 0, false" +
                                    ") ON CONFLICT DO NOTHING " +
                                    "RETURNING _pk"
                                ),
                                [f.createId(), who.username]
                            );

                            if (made.rows.length) {
                                await conn.client.query(
                                    (
                                        "INSERT INTO role_membership (" +
                                        "  _pk, id, created, created_by, " +
                                        "  updated, updated_by, " +
                                        "  is_deleted, _parent_role_pk, " +
                                        "  role) VALUES (" +
                                        "  nextval('object__pk_seq'), " +
                                        "  $1, now(), 'system', now(), " +
                                        "  'system', false, $2, " +
                                        "  'everyone')"
                                    ),
                                    [f.createId(), made.rows[0]._pk]
                                );
                            }
                        }
                    } finally {
                        conn.done();
                    }
                    next = "seeded";
                } else if (row.state === "seeded") {
                    await mclient.query(
                        (
                            "UPDATE tenant SET is_active = true, " +
                            "updated = now(), updated_by = $2 " +
                            "WHERE _pk = $1"
                        ),
                        [tenantPk, row.requested_by]
                    );
                    await manager.audit(mclient, {
                        action: "instance.provision_completed",
                        by: row.requested_by,
                        detail: row.name + " (" + row.pg_database + ")",
                        organizationPk: row.org_pk
                    });
                    next = "active";
                }

                await mclient.query(
                    (
                        "UPDATE \"$provision\" SET state = $2, " +
                        "detail = '', updated = now() WHERE tenant_pk = $1"
                    ),
                    [tenantPk, next]
                );
                await mclient.query("COMMIT");
                return next;
            } catch (err) {
                await mclient.query("ROLLBACK");
                await mclient.query(
                    (
                        "UPDATE \"$provision\" SET detail = $2, " +
                        "updated = now() WHERE tenant_pk = $1"
                    ),
                    [tenantPk, String(err.message || err)]
                );
                throw err;
            }
        }

        async function provisionRun(obj, mclient, tenantPk) {
            let state;

            obj.tenantPk = tenantPk;

            do {
                state = await provisionStep(obj, mclient);
            } while (state !== "active" && state !== "busy");

            let resp = await mclient.query(
                (
                    "SELECT p.state, p.detail, t.id " +
                    "FROM \"$provision\" p " +
                    "JOIN tenant t ON t._pk = p.tenant_pk " +
                    "WHERE p.tenant_pk = $1"
                ),
                [tenantPk]
            );

            return {
                busy: state === "busy",
                detail: (
                    resp.rows.length
                    ? resp.rows[0].detail
                    : ""
                ),
                id: (
                    resp.rows.length
                    ? resp.rows[0].id
                    : undefined
                ),
                state: (
                    resp.rows.length
                    ? resp.rows[0].state
                    : undefined
                )
            };
        }

        /**
            Build a new instance from a template, as a resumable state
            machine (tenant plan D.1): the tenant row and its
            provisioning record are written first, then each step is
            claimed, run and committed on its own. Killing the process
            at any point leaves a record `provisionResume` finishes
            from, and a second node's attempt finds the row locked.

            Platform administrators only: it creates a database.

            @method provisionInstance
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.name Instance name
            @param {String} payload.data.database Database to create
            @param {String} payload.data.template Template database
            @param {String} payload.data.service Connection id
            @return {Promise} {id, state, detail, busy}
        */
        that.provisionInstance = async function (obj) {
            let data = obj.data || {};
            let name = String(data.name || "").trim();
            let database = String(data.database || "").trim().toLowerCase();
            let template = String(data.template || "").trim().toLowerCase();

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "create an instance");

                if (!name) {
                    throw invalid("A name is required");
                }
                if (!database) {
                    throw invalid("A database name is required");
                }
                if (!template) {
                    throw invalid("A template is required");
                }

                let services = await manager.services(mclient);
                let service = services.find(
                    (row) => row.id === data.service
                );

                if (!service) {
                    throw invalid("Name the connection to reach it through");
                }

                let taken = await mclient.query(
                    (
                        "SELECT 1 FROM pg_database WHERE datname = $1 " +
                        "UNION SELECT 1 FROM tenant " +
                        "WHERE pg_database = $1 AND NOT is_deleted"
                    ),
                    [database]
                );

                if (taken.rows.length) {
                    throw invalid(
                        "\"" + database + "\" already exists or is " +
                        "already registered"
                    );
                }

                await provisionTable(mclient);

                let tenantPk = await manager.addInstance(mclient, {
                    by: obj.user,
                    database,
                    isActive: false,
                    name,
                    organizationPk: ctx.organizationPk,
                    servicePk: service._pk
                });

                await mclient.query(
                    (
                        "INSERT INTO \"$provision\" (" +
                        "  tenant_pk, state, template, requested_by" +
                        ") VALUES ($1, 'requested', $2, $3)"
                    ),
                    [tenantPk, template, obj.user]
                );
                await manager.audit(mclient, {
                    action: "instance.provision_requested",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        name + " (" + database + ") from template " +
                        template
                    ),
                    organizationPk: ctx.organizationPk
                });

                return await provisionRun(obj, mclient, tenantPk);
            });
        };

        /**
            Pick a provisioning run back up from whatever step it
            reached. Re-running a finished one is a no-op that answers
            with its state.

            @method provisionResume
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance id
            @return {Promise} {id, state, detail, busy}
        */
        that.provisionResume = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "resume provisioning");
                await provisionTable(mclient);

                let resp = await mclient.query(
                    (
                        "SELECT t._pk FROM tenant t " +
                        "JOIN \"$provision\" p ON p.tenant_pk = t._pk " +
                        "WHERE t.id = $1 AND NOT t.is_deleted " +
                        "  AND t._organization_organization_pk = $2"
                    ),
                    [data.id, ctx.organizationPk]
                );

                if (!resp.rows.length) {
                    throw notFound("No provisioning record for that id");
                }

                return await provisionRun(obj, mclient, resp.rows[0]._pk);
            });
        };

        /**
            Drop an instance: the database through the guarded D.2 API,
            then the registration. The instance the caller is signed in
            to is refused, as is everything deleteDatabase refuses (the
            manager, the cluster's own databases).

            @method dropInstance
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance id
            @return {Promise}
        */
        that.dropInstance = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "drop an instance");

                let resp = await mclient.query(
                    (
                        "SELECT _pk, id, name, pg_database FROM tenant " +
                        "WHERE id = $1 AND NOT is_deleted " +
                        "  AND _organization_organization_pk = $2"
                    ),
                    [data.id, ctx.organizationPk]
                );

                if (!resp.rows.length) {
                    throw notFound("No instance in this organization " +
                            "has that id");
                }

                let target = resp.rows[0];

                if (obj.tenant && target.id === obj.tenant.id) {
                    throw invalid(
                        "You are signed in to " + target.name +
                        "; it cannot be dropped from inside itself"
                    );
                }

                let conn = await callerClient(obj);

                try {
                    await datasource.deleteDatabase(
                        conn.client,
                        target.pg_database
                    );
                } finally {
                    conn.done();
                }

                await mclient.query(
                    (
                        "UPDATE tenant SET is_deleted = true, " +
                        "updated = now(), updated_by = $2 WHERE _pk = $1"
                    ),
                    [target._pk, obj.user]
                );
                await provisionTable(mclient);
                await mclient.query(
                    "DELETE FROM \"$provision\" WHERE tenant_pk = $1",
                    [target._pk]
                );
                await manager.audit(mclient, {
                    action: "instance.dropped",
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
