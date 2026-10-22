/*
    Framework for building object relational database apps
    Copyright (C) 2026  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public
    License along with this program.  If not, see
    <http://www.gnu.org/licenses/>.
*/
/*
    What a signed-in identity may do before it has chosen an instance
    (tenant plan G.1).

    Everything here reads the manager and only the manager. The manager
    is not routable, so none of it is reachable through an instance's
    routes: the server serves it at paths with no database in them, from
    a session that was established against the manager alone.
*/
/*jslint node*/
"use strict";

(function (exports) {
    "use strict";

    const {Config} = require("../config");
    const {Manager} = require("./manager");
    const f = require("../../common/core");

    const config = new Config();
    const manager = new Manager();

    /**
        Platform services: what an identity may reach, and what a
        platform administrator may do across organizations.

        @class Platform
        @constructor
        @namespace Services
    */
    exports.Platform = function () {
        let that = {};

        /**
            Run a function against a connection to the manager and
            release it afterwards, as
            {{#crossLink "Services.Manager/run:method"}}{{/crossLink}}
            does. Platform work only ever touches the manager, so this
            is the only connection any of it needs.

            @method run
            @param {Function} callback Receives the manager client
            @return {Promise}
        */
        that.run = manager.run;

        /**
            The instances this identity may reach, each with enough to
            decide whether to open it. Read from the grants, so it is
            the same boundary sign-in uses rather than a second opinion
            of it.

            An instance that is closed or in maintenance is listed and
            marked rather than hidden: somebody who was working in it
            yesterday should be told why it will not open.

            Across organizations, because a grant is the whole of the
            boundary now (John, Oct 2026: "a VAR who might be given
            access to multiple orgs that are their accounts"). It used
            to list only instances belonging to the identity's own
            organization, which made an account per organization the
            only way to hold several -- so each instance says which
            organization it belongs to, there now being more than one
            answer.

            @method instancesFor
            @param {Client} client Manager client
            @param {String} username
            @return {Promise} Array of instances
        */
        that.instancesFor = async function (client, username) {
            let maint = (
                await that.hasMaintenance(client)
                ? "t.is_maintenance"
                : "false AS is_maintenance"
            );
            let resp = await client.query(
                (
                    "SELECT t.id, t.name, t.pg_database, t.is_active, " +
                    "  t.is_demo, t.expiration, " + maint + ", " +
                    "  o.id AS organization_id, o.name AS organization " +
                    "FROM access_grant g " +
                    "JOIN tenant t ON t._pk = g._tenant_tenant_pk " +
                    "JOIN identity i ON i._pk = g._identity_identity_pk " +
                    "LEFT JOIN organization o " +
                    "  ON o._pk = t._organization_organization_pk " +
                    "WHERE lower(i.username) = lower($1) " +
                    "  AND i.status = 'active' AND NOT i.is_deleted " +
                    "  AND g.is_active AND NOT g.is_deleted " +
                    "  AND NOT t.is_deleted " +
                    "ORDER BY lower(o.name), lower(t.name)"
                ),
                [username]
            );

            return resp.rows.map(function (row) {
                return {
                    database: row.pg_database,
                    expiration: row.expiration,
                    id: row.id,
                    isActive: row.is_active === true,
                    isDemo: row.is_demo === true,
                    isMaintenance: row.is_maintenance === true,
                    name: row.name,
                    organization: row.organization,
                    organizationId: row.organization_id
                };
            });
        };

        /**
            Whether this manager carries the maintenance state at all.
            A manager that has not been through
            `node install.js --manager` has no such column, and reading
            it would fail rather than report nothing held (ADR-002
            question 7).

            @method hasMaintenance
            @param {Client} client Manager client
            @return {Promise} Boolean
        */
        that.hasMaintenance = async function (client) {
            let resp = await client.query(
                (
                    "SELECT 1 FROM information_schema.columns " +
                    "WHERE table_name = 'tenant' " +
                    "  AND column_name = 'is_maintenance'"
                )
            );

            return resp.rows.length > 0;
        };

        /**
            Whether this identity may still enter this instance, asked
            of the manager at the moment it tries to.

            The picker makes one sign-in reach several instances, so the
            grant cannot be checked only at sign-in the way it was when
            a session belonged to one instance from the start: a session
            made at the picker has to prove itself against each instance
            it enters.

            @method mayEnter
            @param {Client} client Manager client
            @param {String} username
            @param {String} instanceId
            @param {Boolean} [isPlatformAdmin]
            @return {Promise} Object, `ok` with a `reason` when not
        */
        that.mayEnter = async function (
            client,
            username,
            instanceId,
            isPlatformAdmin
        ) {
            let instances = await that.instancesFor(client, username);
            let instance = instances.find((i) => i.id === instanceId);

            if (!instance) {
                return {
                    ok: false,
                    reason: "You have no access to this instance"
                };
            }
            if (!instance.isActive) {
                return {
                    ok: false,
                    reason: (
                        "Instance " + instance.name +
                        " is closed to sign-in"
                    )
                };
            }

            /*
                A deployment is running (ADR-002 question 7). The same
                rule sign-in follows: everyone out but a platform
                administrator, who has to be able to get in to end it.
            */
            if (instance.isMaintenance && isPlatformAdmin !== true) {
                return {
                    ok: false,
                    reason: (
                        "Instance " + instance.name +
                        " is down for maintenance"
                    )
                };
            }

            return {instance, ok: true};
        };

        /*
            Everything below is the platform console (tenant plan G.2
            and G.3): organizations, and every instance on the
            installation. One organization's administrator has no
            business here, so each one proves the actor is a platform
            administrator by reading the identity rather than by
            trusting what the session says about it.
        */
        function forbidden(message) {
            let err = new Error(message);

            err.statusCode = 401;
            return err;
        }

        /*
            The organization on a session identity, which carries both
            its id and its name for the screen to show. Either shape is
            accepted so a caller that already has the id can pass it.
        */
        function organizationIdOf(identity) {
            let organization = (identity || {}).organization;

            if (organization && typeof organization === "object") {
                return organization.id;
            }
            return organization;
        }

        that.organizationIdOf = organizationIdOf;

        function invalid(message) {
            let err = new Error(message);

            err.statusCode = 400;
            return err;
        }

        /**
            The acting identity, once it is established that it is a
            platform administrator. Rejects otherwise.

            @method actor
            @param {Client} client Manager client
            @param {Object} identity Session identity
            @return {Promise} Identity row
        */
        that.actor = async function (client, identity) {
            let home = await manager.organizationById(
                client,
                organizationIdOf(identity)
            );
            let actor = (
                home
                ? await manager.identity(
                    client,
                    (identity || {}).username || ""
                )
                : undefined
            );

            if (!actor || !actor.is_platform_admin) {
                throw forbidden(
                    "Only a platform administrator may administer the " +
                    "platform"
                );
            }

            return actor;
        };

        /**
            Whether this identity is a platform administrator of the
            installation, asked from inside an instance: the database
            says which organization, and the organization says which
            identity (tenant plan D.5).

            Used where a decision belongs to the platform rather than
            to the instance it is being made in -- the edition an
            instance runs, for one.

            @method isPlatformAdminOf
            @param {Client} client Manager client
            @param {String} database Instance database name
            @param {String} username
            @return {Promise} Boolean
        */
        /**
            Which organization owns an instance database, as its
            primary key, or undefined when the database is not a
            registered instance or belongs to nobody.

            The organization is where anything shared by every
            instance a customer owns belongs -- their letterhead and
            their mail account, for two (John, 2026-10-18: "move the
            global settings from the database to the ... organization
            record that manages all the instances").

            @method organizationOf
            @param {Client} client Manager client
            @param {String} database Instance database name
            @return {Promise} Number or undefined
        */
        that.organizationOf = async function (client, database) {
            let resp = await client.query(
                (
                    "SELECT _organization_organization_pk AS org " +
                    "FROM tenant " +
                    "WHERE pg_database = $1 AND NOT is_deleted"
                ),
                [database]
            );

            if (!resp.rows.length || resp.rows[0].org === null) {
                return undefined;
            }

            return resp.rows[0].org;
        };

        that.isPlatformAdminOf = async function (client, database, username) {
            let resp = await client.query(
                (
                    "SELECT _organization_organization_pk AS org " +
                    "FROM tenant " +
                    "WHERE pg_database = $1 AND NOT is_deleted"
                ),
                [database]
            );

            if (!resp.rows.length || resp.rows[0].org === null) {
                return false;
            }

            let actor = await manager.identity(client, username || "");

            return Boolean(actor && actor.is_platform_admin);
        };

        /**
            Everyone who can sign in, with the organization that owns
            the account: who a platform administrator may appoint as an
            administrator rather than making somebody new. A username
            is global, so the name alone is enough to appoint by.

            @method people
            @param {Client} client Manager client
            @return {Promise} [{username, fullName, email, organization}]
        */
        that.people = async function (client) {
            let sql = (
                "SELECT i.username, i.full_name, i.email, " +
                "  o.name AS organization " +
                "FROM identity i " +
                "LEFT JOIN organization o " +
                "  ON o._pk = i._organization_organization_pk " +
                "WHERE i.status = 'active' AND NOT i.is_deleted " +
                "ORDER BY lower(i.username)"
            );
            let resp = await client.query(sql);

            return resp.rows.map(function (row) {
                return {
                    email: row.email,
                    fullName: row.full_name,
                    organization: row.organization,
                    username: row.username
                };
            });
        };

        /**
            Every organization, with what it owns: how many instances
            and identities, and whether anybody can administer it. An
            organization with no administrator is the state onboarding
            leaves behind, so the screen says so rather than leaving it
            to be discovered.

            @method organizations
            @param {Client} client Manager client
            @return {Promise} Array of organizations
        */
        that.organizations = async function (client) {
            let resp = await client.query(
                (
                    "SELECT o.id, o.name, o.is_active, " +
                    "  o.authentication, o.is_two_factor_required, " +
                    "  (SELECT count(*) FROM tenant t " +
                    "    WHERE t._organization_organization_pk = o._pk " +
                    "      AND NOT t.is_deleted)::int AS instances, " +
                    "  (SELECT count(*) FROM identity i " +
                    "    WHERE i._organization_organization_pk = o._pk " +
                    "      AND NOT i.is_deleted)::int AS identities, " +
                    "  (SELECT count(*) FROM organization_admin a " +
                    "    JOIN identity i " +
                    "      ON i._pk = a._identity_identity_pk " +
                    "    WHERE a._organization_organization_pk = o._pk " +
                    "      AND a.is_active AND NOT a.is_deleted " +
                    "      AND i.status = 'active' " +
                    "      AND NOT i.is_deleted)::int AS administrators " +
                    "FROM organization o " +
                    "WHERE NOT o.is_deleted ORDER BY lower(o.name)"
                )
            );

            // Who they are, for the count's tooltip
            let named = await client.query(
                "SELECT o.id AS organization, i.username, i.full_name " +
                "FROM organization_admin a " +
                "JOIN organization o " +
                "  ON o._pk = a._organization_organization_pk " +
                "JOIN identity i ON i._pk = a._identity_identity_pk " +
                "WHERE a.is_active AND NOT a.is_deleted " +
                "  AND i.status = 'active' AND NOT i.is_deleted " +
                "ORDER BY lower(i.username)"
            );

            return resp.rows.map(function (row) {
                return {
                    administratorNames: named.rows.filter(
                        (one) => one.organization === row.id
                    ).map(function (one) {
                        let label = one.username;

                        if (one.full_name && one.full_name !== label) {
                            label += " -- " + one.full_name;
                        }

                        return label;
                    }),
                    administrators: row.administrators,
                    authentication: row.authentication,
                    id: row.id,
                    identities: row.identities,
                    instances: row.instances,
                    isActive: row.is_active === true,
                    isTwoFactorRequired: row.is_two_factor_required === true,
                    name: row.name
                };
            });
        };

        /**
            Every instance on the installation, whoever owns it (tenant
            plan G.3). The Instances screen shows one organization's,
            because that is all an organization administrator may see;
            this is the same list without that boundary, which only a
            platform administrator is given.

            @method fleet
            @param {Client} client Manager client
            @return {Promise} Array of instances
        */
        that.fleet = async function (client) {
            let maint = (
                await that.hasMaintenance(client)
                ? "t.is_maintenance"
                : "false AS is_maintenance"
            );
            let resp = await client.query(
                (
                    "SELECT t.id, t.name, t.pg_database, t.is_active, " +
                    "  t.is_demo, t.expiration, t.modules, " + maint + ", " +
                    "  o.id AS organization_id, o.name AS organization, " +
                    "  s.name AS service_name, " +
                    "  (SELECT count(*) FROM access_grant g " +
                    "    WHERE g._tenant_tenant_pk = t._pk " +
                    "      AND g.is_active AND NOT g.is_deleted" +
                    "  )::int AS users " +
                    "FROM tenant t " +
                    "LEFT OUTER JOIN organization o " +
                    "  ON o._pk = t._organization_organization_pk " +
                    "LEFT OUTER JOIN tenant_service s " +
                    "  ON s._pk = t._pg_service_tenant_service_pk " +
                    "WHERE NOT t.is_deleted " +
                    "ORDER BY lower(coalesce(o.name, '')), lower(t.name)"
                )
            );

            /*
                Builds that stopped partway, so the console can offer
                to pick them up. The per-instance screen has had this
                since D.1; without it the console shows a half-built
                instance as an ordinary closed one and nothing says
                there is a build waiting.
            */
            let pending = {};
            let hasProv = await client.query(
                "SELECT to_regclass('\"$provision\"') AS t"
            );

            if (hasProv.rows[0].t) {
                let stopped = await client.query(
                    (
                        "SELECT t.id, p.state, p.detail " +
                        "FROM \"$provision\" p " +
                        "JOIN tenant t ON t._pk = p.tenant_pk " +
                        "WHERE NOT t.is_deleted AND p.state <> 'active'"
                    )
                );

                stopped.rows.forEach(function (row) {
                    pending[row.id] = {
                        detail: row.detail,
                        state: row.state
                    };
                });
            }

            return resp.rows.map(function (row) {
                return {
                    database: row.pg_database,
                    expiration: row.expiration,
                    id: row.id,
                    isActive: row.is_active === true,
                    isDemo: row.is_demo === true,
                    isMaintenance: row.is_maintenance === true,
                    name: row.name,
                    organization: row.organization,
                    organizationId: row.organization_id,
                    pending: pending[row.id],
                    service: row.service_name,
                    users: row.users
                };
            });
        };

        /**
            What a new instance can be built on: the connections
            registered on this installation, and the databases the
            cluster marks as templates. The Instances screen reads the
            same two things; the console needs them before it has an
            instance to read them from.

            @method buildOptions
            @param {Client} client Manager client
            @return {Promise} {services, templates}
        */
        that.buildOptions = async function (client) {
            let services = await manager.services(client);
            let marked = await client.query(
                (
                    "SELECT datname FROM pg_database " +
                    "WHERE datistemplate " +
                    "  AND datname NOT IN ('template0', 'template1') " +
                    "ORDER BY datname"
                )
            );

            return {
                services: services.map(function (row) {
                    return {
                        host: row.pg_host,
                        id: row.id,
                        name: row.name
                    };
                }),
                templates: marked.rows.map((row) => row.datname)
            };
        };

        /**
            Create an organization. The name is its natural key, so a
            second one by the same name is refused rather than made
            quietly.

            @method addOrganization
            @param {Client} client Manager client
            @param {Object} data
            @param {String} data.name
            @param {String} [data.authentication] password, sso or both
            @param {Boolean} [data.isTwoFactorRequired]
            @return {Promise} The organization
        */
        that.addOrganization = async function (client, data) {
            let name = String((data || {}).name || "").trim();

            if (!name) {
                throw invalid("A name is required");
            }

            let found = await client.query(
                (
                    "SELECT 1 FROM organization " +
                    "WHERE lower(name) = lower($1) AND NOT is_deleted"
                ),
                [name]
            );

            if (found.rows.length) {
                throw invalid(
                    "An organization named \"" + name + "\" already exists"
                );
            }

            let auth = data.authentication || "password";

            if (["password", "sso", "both"].indexOf(auth) === -1) {
                throw invalid(
                    "Authentication must be password, sso or both"
                );
            }

            let id = f.createId();

            await client.query(
                (
                    "INSERT INTO organization (_pk,id,created," +
                    "created_by,updated,updated_by,is_deleted,owner," +
                    "etag,name,is_active,authentication," +
                    "is_two_factor_required) VALUES (" +
                    "nextval('object__pk_seq'),$1,now(),$2,now(),$2," +
                    "false,$2,$1,$3,true,$4,$5)"
                ),
                [
                    id,
                    data.by || "system",
                    name,
                    auth,
                    data.isTwoFactorRequired === true
                ]
            );

            return {id, isActive: true, name};
        };

        /**
            Rename an organization, or change how it signs in.

            @method updateOrganization
            @param {Client} client Manager client
            @param {Object} data
            @param {String} data.id
            @param {String} [data.name]
            @param {String} [data.authentication]
            @param {Boolean} [data.isTwoFactorRequired]
            @return {Promise} The organization as it now stands
        */
        that.updateOrganization = async function (client, data) {
            let organization = await manager.organizationById(
                client,
                (data || {}).id
            );

            if (!organization) {
                throw invalid("No such organization");
            }

            let name = (
                data.name === undefined
                ? organization.name
                : String(data.name).trim()
            );

            if (!name) {
                throw invalid("A name is required");
            }

            if (name.toLowerCase() !== organization.name.toLowerCase()) {
                let taken = await client.query(
                    (
                        "SELECT 1 FROM organization " +
                        "WHERE lower(name) = lower($1) " +
                        "  AND _pk <> $2 AND NOT is_deleted"
                    ),
                    [name, organization._pk]
                );

                if (taken.rows.length) {
                    throw invalid(
                        "An organization named \"" + name +
                        "\" already exists"
                    );
                }
            }

            let current = await manager.organization(
                client,
                organization._pk
            );
            let auth = data.authentication || current.authentication;

            if (["password", "sso", "both"].indexOf(auth) === -1) {
                throw invalid(
                    "Authentication must be password, sso or both"
                );
            }

            let twoFactor = (
                data.isTwoFactorRequired === undefined
                ? current.is_two_factor_required
                : data.isTwoFactorRequired === true
            );

            await client.query(
                (
                    "UPDATE organization SET name = $2, " +
                    "  authentication = $3, is_two_factor_required = $4, " +
                    "  updated = now(), updated_by = $5 WHERE _pk = $1"
                ),
                [
                    organization._pk,
                    name,
                    auth,
                    twoFactor,
                    data.by || "system"
                ]
            );

            return {
                authentication: auth,
                id: organization.id,
                isActive: organization.is_active === true,
                isTwoFactorRequired: twoFactor,
                name
            };
        };

        /**
            Close an organization, or open it again. Closing stops its
            identities signing in anywhere -- the picker reads the
            organization as well as the identity -- and touches neither
            its instances nor its data.

            @method setOrganizationActive
            @param {Client} client Manager client
            @param {Object} data
            @param {String} data.id
            @param {Boolean} data.isActive
            @return {Promise} Boolean, what it now is
        */
        that.setOrganizationActive = async function (client, data) {
            let organization = await manager.organizationById(
                client,
                (data || {}).id
            );
            let isActive = (data || {}).isActive !== false;

            if (!organization) {
                throw invalid("No such organization");
            }

            await client.query(
                (
                    "UPDATE organization SET is_active = $2, " +
                    "  updated = now(), updated_by = $3 WHERE _pk = $1"
                ),
                [organization._pk, isActive, data.by || "system"]
            );

            return isActive;
        };

        /**
            Give an organization its first administrator, which is what
            onboarding needs and nothing else does (tenant plan G.2).
            Before this, a new organization's administrator was the
            service account the installer had borrowed.

            Appoints whoever that username names. A username names one
            person across the installation (John, Oct 2026), so the
            person may well exist already -- the platform's own staff,
            or a reseller who administers several organizations -- and
            an existing account is appointed as it stands, password and
            all. A password is wanted only for somebody being created.

            It grants no instance: who reaches what is the organization
            administrator's to say from the Users screen.

            @method appointAdministrator
            @param {Client} client Manager client
            @param {Object} data
            @param {String} data.organization Organization id
            @param {String} data.username
            @param {String} [data.password] For an account being made
            @param {String} [data.fullName]
            @param {String} [data.email]
            @return {Promise} {created, username}
        */
        that.appointAdministrator = async function (client, data) {
            let organization = await manager.organizationById(
                client,
                (data || {}).organization
            );
            let username = String((data || {}).username || "").trim();
            let password = (data || {}).password || "";

            if (!organization) {
                throw invalid("No such organization");
            }
            if (!username) {
                throw invalid("A user name is required");
            }

            let existing = await manager.identity(client, username);

            if (!existing && password.length < 8) {
                throw invalid(
                    "Password must be at least 8 characters"
                );
            }

            let made = await manager.addIdentity(client, {
                by: data.by,
                email: data.email,
                fullName: data.fullName,
                organizationPk: organization._pk,
                password,
                username
            });

            await manager.setOrgAdmin(
                client,
                made.identityPk,
                organization._pk,
                true,
                data.by
            );

            return {
                created: made.created,
                username: (
                    existing
                    ? existing.username
                    : username
                )
            };
        };

        /**
            The identity providers configured on this installation,
            without their secrets: the console shows which
            organizations sign in through one, and never shows a
            secret back (ADR-001 C.3).

            @method providers
            @param {Client} client Manager client
            @return {Promise} Array
        */
        that.providers = async function (client) {
            let resp = await client.query(
                (
                    "SELECT p.id, p.name, p.kind, p.issuer, " +
                    "  p.client_id, p.is_active, p.is_just_in_time, " +
                    "  p.default_instances, p.username_claim, " +
                    "  p.admin_group, " +
                    "  (p.client_secret IS NOT NULL AND " +
                    "   p.client_secret <> '') AS has_secret, " +
                    "  o.id AS organization_id " +
                    "FROM identity_provider p " +
                    "JOIN organization o " +
                    "  ON o._pk = p._organization_organization_pk " +
                    "WHERE NOT p.is_deleted"
                )
            ).catch(function () {
                /*
                    A manager that has not been through
                    `node install.js --manager` since C.3 has no such
                    table. Nothing configured is the honest answer.
                */
                return {rows: []};
            });

            return resp.rows.map(function (row) {
                return {
                    adminGroup: row.admin_group || "",
                    clientId: row.client_id,
                    defaultInstances: row.default_instances || [],
                    hasSecret: row.has_secret === true,
                    id: row.id,
                    isActive: row.is_active === true,
                    isJustInTime: row.is_just_in_time === true,
                    issuer: row.issuer,
                    kind: row.kind,
                    name: row.name,
                    organizationId: row.organization_id,
                    usernameClaim: row.username_claim
                };
            });
        };

        /**
            Create or replace an organization's identity provider. The
            secret is encrypted with the installation's key, the way
            the service account's password is, and is never read back
            out to a screen.

            Leaving the secret empty on a provider that has one keeps
            the one it has, so the form can be saved without retyping
            it.

            @method saveProvider
            @param {Client} client Manager client
            @param {Object} data
            @return {Promise} The provider, without its secret
        */
        that.saveProvider = async function (client, data) {
            let conf = await config.read();
            let organization = await manager.organizationById(
                client,
                (data || {}).organization
            );

            if (!organization) {
                throw invalid("No such organization");
            }

            let issuer = String(data.issuer || "").trim();
            let clientId = String(data.clientId || "").trim();
            let kind = data.kind || "azure-ad";

            if (!issuer || !clientId) {
                throw invalid(
                    "An issuer and a client id are required"
                );
            }
            if (["azure-ad", "oidc"].indexOf(kind) === -1) {
                throw invalid("Kind must be azure-ad or oidc");
            }
            try {
                let url = new URL(issuer);

                if (url.protocol !== "https:") {
                    throw invalid("The issuer must be an https address");
                }
            } catch (ignore) {
                throw invalid("The issuer must be a URL");
            }

            let found = await client.query(
                (
                    "SELECT _pk, client_secret FROM identity_provider " +
                    "WHERE _organization_organization_pk = $1 " +
                    "  AND NOT is_deleted"
                ),
                [organization._pk]
            );
            let secret = String(data.clientSecret || "");
            let instances = (
                Array.isArray(data.defaultInstances)
                ? data.defaultInstances
                : []
            );
            let shared = [
                data.name || "Microsoft",
                kind,
                issuer,
                clientId,
                data.isActive !== false,
                data.isJustInTime === true,
                JSON.stringify(instances),
                data.usernameClaim || "preferred_username",
                data.adminGroup || "",
                data.by || "system"
            ];

            if (found.rows.length) {
                await client.query(
                    (
                        "UPDATE identity_provider SET name = $2, " +
                        "  kind = $3, issuer = $4, client_id = $5, " +
                        "  is_active = $6, is_just_in_time = $7, " +
                        "  default_instances = $8, username_claim = $9, " +
                        "  admin_group = $10, updated_by = $11, " +
                        "  updated = now()" + (
                            secret
                            ? ", client_secret = " +
                                "pgp_sym_encrypt($12, $13)::text"
                            : ""
                        ) + " WHERE _pk = $1"
                    ),
                    [found.rows[0]._pk].concat(shared).concat(
                        secret
                        ? [secret, conf.pgCryptoKey]
                        : []
                    )
                );
            } else {
                if (!secret) {
                    throw invalid("A client secret is required");
                }
                await client.query(
                    (
                        "INSERT INTO identity_provider (_pk,id,created," +
                        "created_by,updated,updated_by,is_deleted,owner," +
                        "etag,_organization_organization_pk,name,kind," +
                        "issuer,client_id,is_active,is_just_in_time," +
                        "default_instances,username_claim,admin_group," +
                        "client_secret) VALUES (" +
                        "nextval('object__pk_seq'),$1,now(),$11,now()," +
                        "$11,false,$11,$1,$12,$2,$3,$4,$5,$6,$7,$8,$9," +
                        "$10,pgp_sym_encrypt($13, $14)::text)"
                    ),
                    [f.createId()].concat(shared).concat([
                        organization._pk,
                        secret,
                        conf.pgCryptoKey
                    ])
                );
            }

            return {
                issuer,
                kind,
                name: shared[0],
                organization: organization.id
            };
        };

        return that;
    };

}(exports));
