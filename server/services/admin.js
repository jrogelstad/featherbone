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
    * **organization** -- an appointment over the organization being
      acted on (`organization_admin`). May manage every identity in
      that organization and grant any of its instances. One person may
      hold appointments over several organizations, which is how a
      reseller administers their accounts without an account apiece.
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
    const {Platform} = require("./platform");
    const {Database} = require("../database");
    const {Upgrade} = require("./upgrade");
    const datasource = require("../datasource");
    const f = require("../../common/core");

    const config = new Config();
    const manager = new Manager();
    const platform = new Platform();
    const db = new Database();
    const upgrade = new Upgrade();

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
        /*
            The instance the caller is signed in to, if any. The
            platform console runs with none (tenant plan G.2): it is
            served at a path with no database in it, so every method
            reached from there names the instance it means.
        */
        function homeInstanceId(obj) {
            return (
                obj.tenant
                ? obj.tenant.id
                : undefined
            );
        }

        async function contextFor(mclient, obj) {
            let actor;
            let instance;
            let tier;

            if (obj.tenant) {
                instance = await manager.instance(mclient, obj.tenant);
                actor = await manager.identity(mclient, obj.user || "");
            } else {
                /*
                    No instance: the platform console, whose session was
                    established against the manager alone (G.1). The
                    organization the caller signed in to is the one on
                    the session, and the authority is read here rather
                    than taken from it -- a session says who, never
                    what they may do.
                */
                let home = await manager.organizationById(
                    mclient,
                    platform.organizationIdOf(obj.identity)
                );

                if (!home) {
                    throw forbidden("Not authorized to administer");
                }
                instance = {organizationPk: home._pk};
                actor = await manager.identity(mclient, obj.user || "");

                if (!actor || !actor.is_platform_admin) {
                    throw forbidden(
                        "Only a platform administrator may administer " +
                        "without an instance"
                    );
                }
            }

            /*
                Administering an organization is an appointment over
                that organization, not a rank the person carries about
                with them (John, Oct 2026), so it is asked of the
                organization being acted on -- which, for the reach
                below, is settled further down and asked again there.
            */
            let isOrgAdmin = Boolean(
                actor &&
                await manager.isOrgAdminOf(
                    mclient,
                    actor._pk,
                    instance.organizationPk
                )
            );

            if (actor && actor.is_platform_admin) {
                tier = "platform";
            } else if (isOrgAdmin) {
                tier = "organization";
            } else if (obj.isSuper) {
                tier = "instance";
            }

            if (!tier) {
                throw forbidden("Not authorized to administer identities");
            }

            /*
                Acting on another organization than the one whose
                instance this request came through (ADR-001 requirement
                3, tenant plan A.4). A session is established against
                one instance, so somebody who answers for several
                organizations -- the platform administrator, and now the
                reseller appointed over their customers -- names the one
                they mean. Everything downstream keys on
                ctx.organizationPk, so the whole screen and every write
                follows, and the audit rows record the organization
                acted on.

                A platform administrator may name any; everybody else
                may name only an organization they are appointed over,
                and is an organization administrator there whatever
                they are here.
            */
            let organizationPk = instance.organizationPk;
            let reach = obj.organization || (obj.data || {}).organization;

            if (reach) {
                let other = await manager.organizationById(mclient, reach);

                if (!other) {
                    throw notFound("No such organization");
                }

                if (other._pk !== organizationPk) {
                    let appointed = Boolean(
                        actor &&
                        await manager.isOrgAdminOf(
                            mclient,
                            actor._pk,
                            other._pk
                        )
                    );

                    if (tier !== "platform" && !appointed) {
                        throw forbidden(
                            "You do not administer that organization"
                        );
                    }
                    if (tier !== "platform") {
                        tier = "organization";
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
            Who an administrator may act on. An identity exists
            installation-wide now, so being able to find one says
            nothing about whether it is any of this organization's
            business: what makes somebody theirs is the organization
            owning the account, holding one of its instances, or
            administering it -- the same three answers that put a
            person on their Users screen. Anyone else is "no such
            identity" rather than a refusal, which would confirm the
            name exists somewhere.

            A tier-"instance" administrator is narrower still: only a
            person who can already reach the instance they are signed
            in to, and never another administrator.
        */
        async function belongsHere(mclient, ctx, target) {
            if (target.organization_pk === ctx.organizationPk) {
                return true;
            }

            if (await manager.isOrgAdminOf(
                mclient,
                target._pk,
                ctx.organizationPk
            )) {
                return true;
            }

            let granted = await mclient.query(
                (
                    "SELECT 1 FROM access_grant g " +
                    "JOIN tenant t ON t._pk = g._tenant_tenant_pk " +
                    "WHERE g._identity_identity_pk = $1 " +
                    "  AND t._organization_organization_pk = $2 " +
                    "  AND NOT g.is_deleted AND NOT t.is_deleted"
                ),
                [target._pk, ctx.organizationPk]
            );

            return granted.rows.length > 0;
        }

        async function targetFor(mclient, ctx, id, tenant, opts) {
            let options = opts || {};
            let target = await manager.identityById(
                mclient,
                ctx.organizationPk,
                id
            );

            if (!target) {
                throw notFound("No such identity");
            }

            if (!await belongsHere(mclient, ctx, target)) {
                throw notFound("No such identity in this organization");
            }

            /*
                The account itself -- its password, whether it may sign
                in at all -- belongs to the organization that owns it,
                and to the platform. Working here does not hand it
                over: otherwise an organization could appoint an
                outsider, reset the password of the account they use
                everywhere else, and walk in wherever it reaches.
                Anyone may still be given or refused this
                organization's instances, which is what administering
                them here means.
            */
            if (
                options.isAccountItself === true &&
                ctx.tier !== "platform" &&
                target.organization_pk !== ctx.organizationPk
            ) {
                throw forbidden(
                    target.username + "'s account belongs to another " +
                    "organization. You can give or take away your own " +
                    "instances, but the account is theirs to change."
                );
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
                        (
                            tenant
                            ? tenant.name
                            : "this instance"
                        ) + ", so it cannot be changed from here"
                    );
                }
            }

            return target;
        }

        /*
            Which organizations a caller may name. A platform
            administrator may name any; everybody else, those they hold
            an appointment over -- and the one they are signed in to,
            which is theirs by being here.
        */
        async function organizationsFor(mclient, ctx) {
            function out(row) {
                return {
                    id: row.id,
                    isActive: row.is_active !== false,
                    name: row.name
                };
            }

            if (ctx.tier === "platform") {
                return (await manager.organizations(mclient)).map(out);
            }

            if (!ctx.actor) {
                return undefined;
            }

            let mine = await manager.organizationsAdministered(
                mclient,
                ctx.actor._pk
            );

            return (
                mine.length > 1
                ? mine.map(out)
                : undefined
            );
        }

        function identityOut(row) {
            return {
                email: row.email,
                failedAttempts: row.failed_attempts,
                fullName: row.full_name,
                grants: row.grants,
                /*
                    Whose account this is, when it is not this
                    organization's. Somebody from outside -- a reseller,
                    or the platform's own staff -- appears in the list
                    because they work here, and saying so is the
                    difference between a colleague and a stranger.
                */
                homeOrganization: (
                    row.is_home === false
                    ? row.home_organization
                    : undefined
                ),
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

        /*
            The people who have a profile in the instance the caller is
            signed in to, with the contact details they keep there. A
            person's phone number, and the first and last name they edit
            for themselves, live on that profile's Contact rather than
            on the identity in the manager, which carries one name and
            one address for the whole organization. Keyed by lower-case
            user name. Empty when there is no instance (the platform
            console) or it cannot be read: the screen then shows what
            the identity holds, as it always did.
        */
        async function instanceContacts(obj) {
            let found = {};
            let conn;

            if (!obj.tenant) {
                return found;
            }

            try {
                conn = await db.connect(obj.tenant);

                let resp = await conn.client.query(
                    "SELECT lower(u.name) AS name, c.first_name, " +
                    "  c.last_name, c.email, c.phone " +
                    "FROM user_account u " +
                    "LEFT OUTER JOIN contact c ON " +
                    "  c._pk = u._contact_contact_pk " +
                    "WHERE NOT u.is_deleted"
                );

                resp.rows.forEach(function (row) {
                    found[row.name] = row;
                });
            } catch (e) {
                console.error(
                    "Could not read contact details: " + (e.message || e)
                );
            } finally {
                if (conn) {
                    conn.done();
                }
            }

            return found;
        }

        function withContact(out, contact) {
            if (!contact) {
                out.hasProfile = false;
                return out;
            }

            let first = contact.first_name || "";
            let last = contact.last_name || "";

            out.hasProfile = true;
            out.firstName = first;
            out.lastName = last;
            out.phone = contact.phone || "";

            if (contact.email) {
                out.email = contact.email;
            }
            if (joined(first, last)) {
                out.fullName = joined(first, last);
            }

            return out;
        }

        function joined(first, last) {
            return String(first + " " + last).trim();
        }

        function cleaned(value) {
            return (
                typeof value === "string"
                ? value.trim()
                : undefined
            );
        }

        /**
            Who the caller is signed in as, for the label the ribbon
            shows beside the alerts bell (John, Oct 2026: "I'd like to
            see who I'm logged as over near the alarm bell"). The
            organization is the part of that nothing else on a screen
            says, which is what made it worth a lookup: an identity
            belongs to one organization, and a platform administrator
            signed in to one organization's instance cannot tell from
            the screen which that is.

            Alone among the methods here this refuses nobody and goes
            through no `contextFor`: it reports, it does not act, and
            every signed-in person is entitled to be told their own
            name. What it says of their authority is read from the
            identity in the manager, not from the session, so it
            cannot say more than they have.

            @method whoAmI
            @param {Object} payload
            @param {Object} payload.tenant Instance of the request
            @param {String} payload.user Signed-in user name
            @return {Promise}
        */
        that.whoAmI = async function (obj) {
            return await manager.run(async function (mclient) {
                let instance = await manager.instance(mclient, obj.tenant);
                let organization = await manager.organization(
                    mclient,
                    instance.organizationPk
                );
                let actor = await manager.identity(mclient, obj.user || "");

                return {
                    /*
                        Administering this organization, not a rank the
                        person carries: one account may administer
                        several (ADR-001 revision 4).
                    */
                    isOrgAdmin: Boolean(
                        actor &&
                        await manager.isOrgAdminOf(
                            mclient,
                            actor._pk,
                            instance.organizationPk
                        )
                    ),
                    isPlatformAdmin: Boolean(
                        actor && actor.is_platform_admin
                    ),
                    organization: (
                        organization
                        ? organization.name
                        : undefined
                    ),
                    organizationId: (
                        organization
                        ? organization.id
                        : undefined
                    )
                };
            });
        };

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
                /*
                    Contact details are the signed-in instance's, so
                    they are read only for that instance's own
                    organization, never for one reached by break-glass.
                */
                let contacts = (
                    ctx.organizationPk === ctx.homeOrganizationPk
                    ? await instanceContacts(obj)
                    : {}
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
                    identities: identities.map(function (row) {
                        return withContact(
                            identityOut(row),
                            contacts[row.username.toLowerCase()]
                        );
                    }),
                    instance: homeInstanceId(obj),
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
                        The organizations this caller may act on, which
                        the screen offers as a picker. Every one for a
                        platform administrator, so they can reach one
                        that has lost its administrator; for everybody
                        else the ones they are appointed over, which is
                        how a reseller moves between their customers on
                        one account (John, Oct 2026). What other
                        organizations exist is still nobody else's to
                        see.
                    */
                    organizations: await organizationsFor(mclient, ctx),
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
            @param {Boolean} [payload.data.sendInvite] Instead of a
            password, mail the person a link that signs them in and
            makes them choose one (needs the email; the signed-in
            instance only). `mail` in the answer says what became of it:
            "sent", "failed" (with `mailError`), or "existing" when the
            person already had an account and so was not mailed.
            @param {String} [payload.data.instance] Instance id to grant
            @return {Promise}
        */
        that.createIdentity = async function (obj) {
            let data = obj.data || {};
            let invite = data.sendInvite === true;
            let email = cleaned(data.email) || "";
            let result;

            if (!data.username || !data.username.trim()) {
                throw invalid("A user name is required");
            }

            if (invite) {
                if (!email) {
                    throw invalid(
                        "An email address is needed to send an invitation"
                    );
                }
                if (data.password) {
                    throw invalid(
                        "Give a password or send an invitation, not both: " +
                        "the person chooses their own from the link"
                    );
                }
                if (data.instance && data.instance !== homeInstanceId(obj)) {
                    throw invalid(
                        "An invitation can only be sent for the instance " +
                        "you are signed in to"
                    );
                }
                if (typeof obj.invite !== "function") {
                    throw invalid("This request cannot send an invitation");
                }
            }

            result = await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let tenantPk = ctx.tenantPk;

                if (
                    data.instance &&
                    data.instance !== homeInstanceId(obj)
                ) {
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
                    email,
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

            /*
                After the identity and its grant are committed: the
                link signs them in, which needs both. A mail that does
                not go is reported, not raised -- the user exists, and
                the administrator can set a password by hand.
            */
            if (invite) {
                if (!result.created) {
                    result.mail = "existing";
                } else {
                    try {
                        await obj.invite(
                            data.username.trim(),
                            email,
                            cleaned(data.fullName)
                        );
                        result.mail = "sent";
                    } catch (e) {
                        result.mail = "failed";
                        result.mailError = e.message || String(e);
                    }
                }
            }

            return result;
        };

        /**
            Change a person's name, email address and phone number, for
            the user who cannot or will not do it themselves (a name
            that changes with marriage is the plain case).

            The details a person edits for themselves live on their
            profile in the instance, so for someone who has one they
            are written there, through the same code that serves "Edit
            my contact information", and the identity in the manager is
            brought into step. Someone who has not signed in yet has no
            profile: only a name and an address can be kept for them,
            on the identity, and the phone number waits for the profile.

            Same reach as setting a password: a tier-"instance"
            administrator may only change someone who can already reach
            their instance, and no one else's administrator.

            @method updateIdentity
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {String} [payload.data.firstName]
            @param {String} [payload.data.lastName]
            @param {String} [payload.data.fullName] Used when there is
            no profile to hold a first and last name
            @param {String} [payload.data.email]
            @param {String} [payload.data.phone]
            @return {Promise}
        */
        that.updateIdentity = async function (obj) {
            let data = obj.data || {};
            let email = cleaned(data.email);

            if (email && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/).test(email)) {
                throw invalid("That does not look like an email address");
            }

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                /*
                    The name and address are the account's, so they
                    follow the same rule as its password: an
                    organization may not rewrite the details of an
                    account another one owns. An email address is the
                    sharper half of that -- it is where a password
                    reset goes.
                */
                let target = await targetFor(
                    mclient,
                    ctx,
                    data.id,
                    obj.tenant,
                    {isAccountItself: true}
                );
                let contact = (
                    ctx.organizationPk === ctx.homeOrganizationPk
                    ? (await instanceContacts(obj))[
                        target.username.toLowerCase()
                    ]
                    : undefined
                );
                let fullName = cleaned(data.fullName);

                function keep(value, was) {
                    return (
                        value === undefined
                        ? (was || "")
                        : value
                    );
                }

                if (contact) {
                    let first = keep(
                        cleaned(data.firstName),
                        contact.first_name
                    );
                    let last = keep(
                        cleaned(data.lastName),
                        contact.last_name
                    );

                    await datasource.changeUserInfo({
                        by: obj.user,
                        email: keep(email, contact.email || target.email),
                        firstName: first,
                        lastName: last,
                        name: target.username,
                        phone: keep(cleaned(data.phone), contact.phone)
                    }, obj.tenant);
                    fullName = joined(first, last) || fullName;
                }

                await manager.setIdentityInfo(mclient, target._pk, {
                    email,
                    fullName: fullName || undefined
                }, obj.user);
                await manager.audit(mclient, {
                    action: "identity.info_changed",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        "From the administration screen" + (
                            contact
                            ? ""
                            : "; no profile in this instance yet, so " +
                                    "name and email only"
                        )
                    ),
                    organizationPk: ctx.organizationPk,
                    targetIdentityPk: target._pk
                });

                return true;
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
                    obj.tenant,
                    {isAccountItself: true}
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
                    obj.tenant,
                    {isAccountItself: true}
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
                let instanceId = data.instance || homeInstanceId(obj);
                let tenantPk = ctx.tenantPk;

                if (!instanceId) {
                    throw invalid("An instance is required");
                }

                if (instanceId !== homeInstanceId(obj)) {
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
            Make an identity an administrator of the organization
            being acted on, or stop it being one. Organization
            administrators and above only: this is the authority to
            manage everyone else in the organization, so it is not an
            instance administrator's to hand out.

            Any existing identity will do, whichever organization owns
            the account (John, Oct 2026): appointing somebody is what
            brings them into an organization's administration, and a
            person who already has an account does not need another one
            made for them to be appointed.

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
                    throw notFound("No such identity");
                }

                await manager.setOrgAdmin(
                    mclient,
                    target._pk,
                    ctx.organizationPk,
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

        /**
            Make an identity a platform administrator, or stop it being
            one -- the authority over every organization at once, so
            only somebody who already holds it may hand it out.

            A platform administrator is one account, not one per
            organization (John, Oct 2026: "it's not practical for them
            to have create many versions of themselves"), which is what
            global usernames are for.

            @method setPlatformAdmin
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Identity id
            @param {Boolean} payload.data.isPlatformAdmin
            @return {Promise}
        */
        that.setPlatformAdmin = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "appoint a platform administrator");

                let target = await manager.identityById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such identity");
                }

                /*
                    Standing down is one thing; taking the last
                    administrator away from the platform is another,
                    and would leave nobody able to put one back.
                */
                if (data.isPlatformAdmin !== true) {
                    let others = await mclient.query(
                        (
                            "SELECT count(*)::int AS n FROM identity " +
                            "WHERE is_platform_admin AND NOT is_deleted " +
                            "  AND status = 'active' AND _pk <> $1"
                        ),
                        [target._pk]
                    );

                    if (!others.rows[0].n) {
                        throw invalid(
                            "That is the last platform administrator. " +
                            "Appoint another before standing this one " +
                            "down."
                        );
                    }
                }

                await manager.setPlatformAdmin(
                    mclient,
                    target._pk,
                    data.isPlatformAdmin,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: (
                        data.isPlatformAdmin === true
                        ? "identity.platform_admin_granted"
                        : "identity.platform_admin_revoked"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: target.username,
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

        function instanceOut(row, registry, current, deployed) {
            let served = registry || [];
            let live = served.find(
                (entry) => entry.pgDatabase === row.pg_database
            );
            /*
                What this instance carries, and whether a newer package
                is installed on the server (ADR-002: the fleet view).
                Absent when the instance could not be asked, which is
                not the same as carrying nothing.
            */
            let carried = (deployed || {})[row.pg_database];
            /*
                The framework's own version in this instance, which is
                not part of the package fleet above: Core is installed
                from the framework's manifest, not from a package on
                disk, so "behind" for it means behind this server
                rather than behind a package it holds. It is what the
                Upgrade action acts on (John, 2026-10-17).
            */
            let core = (
                carried
                ? carried.modules.find((mod) => mod.name === "Core")
                : undefined
            );

            return {
                behind: (
                    carried
                    ? carried.modules.filter((mod) => mod.isBehind).length
                    : 0
                ),
                coreVersion: (
                    core
                    ? core.version
                    : undefined
                ),
                isCoreBehind: (
                    carried
                    ? upgrade.isBehind(
                        core
                        ? core.version
                        : undefined
                    )
                    : false
                ),
                database: row.pg_database,
                /*
                    How many of this instance's modules run from the
                    database's own rows rather than from a package
                    (ADR-002 section 2), and how many of those do so
                    because this server does not hold the version the
                    instance carries -- which is drift rather than a
                    module that was never packaged.
                */
                adrift: (
                    carried
                    ? carried.modules.filter(
                        (mod) => mod.isVersionMissing
                    ).length
                    : 0
                ),
                fromRows: (
                    carried
                    ? carried.modules.filter((mod) => !mod.isOnDisk).length
                    : 0
                ),
                modules: (
                    carried
                    ? carried.modules
                    : undefined
                ),
                modulesError: (
                    carried
                    ? carried.error
                    : "Not asked"
                ),
                expiration: row.expiration,
                id: row.id,
                isActive: row.is_active,
                isCurrent: row.id === current,
                isDemo: row.is_demo,
                isMaintenance: row.is_maintenance === true,
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
                let current = homeInstanceId(obj);
                /*
                    The fleet view (ADR-002): what each instance
                    carries, and what this server holds to deploy.
                    Asked only for someone who can see the whole
                    organization, because it means a round trip to
                    every registered instance.
                */
                let orgWideView = (
                    ctx.tier === "platform" || ctx.tier === "organization"
                );
                let deployed = (
                    orgWideView
                    ? await datasource.deployedModules()
                    : {}
                );
                let instances = rows.map(
                    (row) => instanceOut(
                        row,
                        obj.registry,
                        current,
                        deployed
                    )
                );
                let audit = [];
                let databases = [];
                let orphans = [];
                let services = [];
                let templates = [];
                let provisioning = {};
                let installed = [];

                if (orgWide) {
                    installed = await datasource.installedPackages();

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
                    /*
                        Packages on this server's file system, which is
                        what Deploy may apply (ADR-002 section 6).
                    */
                    packages: installed,
                    provisioning,
                    /*
                        The framework this server runs, so the screen
                        can say what an instance would be upgraded to
                        rather than only that it is behind.
                    */
                    serverVersion: upgrade.version(),
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

                let unservable = await datasource.unservableName(database);

                if (unservable) {
                    throw invalid(unservable);
                }

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
                    target.id === homeInstanceId(obj)
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

        /**
            Deploy an installed package into one instance (ADR-002
            section 6). Install put the files on this server; this is
            the separate, deliberate act of applying one version to one
            database.

            The instance is held while it runs (question 7) and let go
            afterwards. A deployment that fails leaves it held, because
            the schema is then in a state nobody has checked; ending
            the maintenance is the deliberate act that says someone
            has.

            @method deployPackage
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance
            @param {String} payload.data.module
            @param {String} payload.data.version
            @param {String} [payload.data.processId] Caller-chosen id for
            a ServerProcess row the screen can poll for progress
            @return {Promise}
        */
        that.deployPackage = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target;
                let dir;
                let tenant;

                requirePlatform(ctx, "deploy a package");

                if (!data.module || !data.version) {
                    throw invalid("Name the module and the version");
                }

                target = await manager.instanceById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such instance in this organization");
                }

                dir = datasource.packageDir(data.module, data.version);

                if (!dir) {
                    throw invalid(
                        data.module + " " + data.version +
                        " is not installed on this server. Install it " +
                        "with `node install.js --package <file>`."
                    );
                }

                /*
                    The registry entry this process serves, which is
                    what carries the connection to the instance.
                */
                tenant = (obj.registry || []).find(
                    (entry) => entry.pgDatabase === target.pg_database
                );

                if (!tenant) {
                    throw invalid(
                        target.pg_database + " is registered but this " +
                        "server is not serving it, so it cannot be " +
                        "deployed to from here."
                    );
                }

                await manager.setInstanceMaintenance(
                    mclient,
                    target._pk,
                    true,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "instance.deploy_began",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        data.module + " " + data.version + " into " +
                        target.name + " (" + target.pg_database + ")"
                    ),
                    organizationPk: ctx.organizationPk
                });

                try {
                    /*
                        The target's registry entry, not the caller's.
                        It is the connection the installer writes
                        through, so the caller's sent a deployment at
                        the database the operator happened to be signed
                        in to -- and from the platform console, where
                        there is no instance at all, at the manager.
                        The resolution above was already looking this
                        up and refusing when the server does not serve
                        it; it simply was not the value passed.

                        What it looked like: a module whose install
                        starts a ServerProcess failed on "Either a
                        client or tenant value must be included", and
                        the failed deployment left the instance held
                        (John, Oct 2026).
                    */
                    await datasource.install(dir, obj.user, {
                        databases: [target.pg_database],
                        isSuper: true,
                        processId: data.processId,
                        subscription: data.subscription,
                        tenant
                    });
                    await datasource.recordDeployed(
                        target.pg_database,
                        data.module,
                        data.version,
                        obj.user
                    );
                } catch (err) {
                    await manager.audit(mclient, {
                        action: "instance.deploy_failed",
                        actorPk: actorPk(ctx),
                        by: obj.user,
                        detail: (
                            data.module + " " + data.version + " into " +
                            target.pg_database + ": " +
                            (err.message || err)
                        ),
                        organizationPk: ctx.organizationPk
                    });

                    /*
                        The instance stays held, and the person who
                        asked is told so in the answer: a screen that
                        only said what went wrong left the instance
                        refusing everyone with no hint why (John, Oct
                        2026).
                    */
                    let failure = (
                        typeof err === "string"
                        ? new Error(err)
                        : err
                    );

                    failure.message = (
                        data.module + " " + data.version +
                        " was not deployed to " + target.pg_database +
                        ": " + failure.message + " The instance is held " +
                        "in maintenance; end it from the Instances " +
                        "screen once you have checked it."
                    );
                    throw failure;
                }

                await manager.setInstanceMaintenance(
                    mclient,
                    target._pk,
                    false,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "instance.deployed",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        data.module + " " + data.version + " into " +
                        target.name + " (" + target.pg_database + ")"
                    ),
                    organizationPk: ctx.organizationPk
                });

                return {
                    database: target.pg_database,
                    module: data.module,
                    version: data.version
                };
            });
        };

        /**
            What a Core upgrade or package deploy has gotten to, for
            the platform console and the Instances screen to poll:
            neither carries the subscription wiring the signed-in app
            uses to watch a process event by event, so they ask
            instead (John, 2026-10-18: "I get no idea of whether it's
            working or not").

            The process lives on the instance it is changing, not the
            manager, so this resolves the same tenant connection
            `upgradeInstance` and `deployPackage` do before reading it.

            @method processStatus
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance
            @param {String} payload.data.processId
            @return {Promise} {status, percentComplete, errorMessage},
            or null if the process has not started writing yet (the
            screen polled before the first row landed)
        */
        that.processStatus = async function (obj) {
            let data = obj.data || {};

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target;
                let tenant;

                requirePlatform(ctx, "watch an instance's progress");

                if (!data.id || !data.processId) {
                    throw invalid(
                        "Name the instance and the process to watch"
                    );
                }

                target = await manager.instanceById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such instance in this organization");
                }

                tenant = (obj.registry || []).find(
                    (entry) => entry.pgDatabase === target.pg_database
                );

                if (!tenant) {
                    throw invalid(
                        target.pg_database + " is registered but this " +
                        "server is not serving it, so its progress " +
                        "cannot be read from here."
                    );
                }

                return (await datasource.processStatus({
                    data: {id: data.processId},
                    tenant
                })) || null;
            });
        };

        /**
            Deploy one package version into several instances, one
            after another (ADR-002's fleet upgrade; John, 2026-10-16:
            "I'd like the option to upgrade the fleet one by one or in
            a group... likely patches I would want to deploy to a
            fleet, especially if urgent").

            Each instance is deployed exactly as a single deployment
            is -- held, applied, let go -- so a group is a sequence of
            the same act rather than a second way of doing it. That is
            what makes it a rolling outage: one instance is down at a
            time, and the instances are named rather than implied, so
            testing in one database before production is the same
            action with one name in the list.

            The default is to stop at the first failure, which leaves
            that instance held and the ones after it untouched. Pass
            `stopOnError: false` to carry on, for the urgent patch
            where the instances that can take it should.

            @method deployFleet
            @param {Object} payload
            @param {Object} payload.data
            @param {Array} payload.data.instances Instance ids, in order
            @param {String} payload.data.module
            @param {String} payload.data.version
            @param {Boolean} [payload.data.stopOnError] Default true
            @param {Array} [payload.data.processIds] Caller-chosen
            ServerProcess ids, one per instance, same order as
            `instances`: each instance runs in its turn, so the screen
            can poll them the same way, one at a time
            @return {Promise} {deployed, failed, results}
        */
        that.deployFleet = async function (obj) {
            let data = obj.data || {};
            let ids = data.instances;
            let stop = data.stopOnError !== false;
            let targets = [];

            if (!Array.isArray(ids) || !ids.length) {
                throw invalid("Name the instances to deploy to");
            }
            if (!data.module || !data.version) {
                throw invalid("Name the module and the version");
            }
            if (!datasource.packageDir(data.module, data.version)) {
                throw invalid(
                    data.module + " " + data.version +
                    " is not installed on this server. Install it " +
                    "with `node install.js --package <file>`."
                );
            }

            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "deploy to the fleet");

                let n = 0;

                while (n < ids.length) {
                    let found = await manager.instanceAnywhereById(
                        mclient,
                        ids[n]
                    );

                    n += 1;

                    if (!found) {
                        throw notFound("No instance has the id " + ids[n - 1]);
                    }
                    targets.push(found);
                }

                await manager.audit(mclient, {
                    action: "fleet.deploy_began",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        data.module + " " + data.version + " into " +
                        targets.length + " instance(s): " +
                        targets.map((t) => t.pg_database).join(", ")
                    ),
                    organizationPk: ctx.organizationPk
                });
            });

            let results = [];
            let processIds = data.processIds || [];
            let n = 0;

            while (n < targets.length) {
                let target = targets[n];

                n += 1;

                try {
                    /*
                        Each one runs as itself, in its own
                        organization: a platform administrator deploys
                        across organizations, and every instance's
                        audit trail should say what happened to it.
                    */
                    await that.deployPackage(Object.assign({}, obj, {
                        data: {
                            id: target.id,
                            module: data.module,
                            processId: processIds[n - 1],
                            version: data.version
                        },
                        organization: target.organization_id
                    }));
                    results.push({
                        database: target.pg_database,
                        id: target.id,
                        name: target.name,
                        ok: true,
                        organization: target.organization
                    });
                } catch (err) {
                    results.push({
                        database: target.pg_database,
                        id: target.id,
                        message: err.message || String(err),
                        name: target.name,
                        ok: false,
                        organization: target.organization
                    });

                    if (stop) {
                        break;
                    }
                }
            }

            let deployed = results.filter((r) => r.ok).length;
            let failed = results.filter((r) => !r.ok).length;

            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                await manager.audit(mclient, {
                    action: "fleet.deploy_finished",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        data.module + " " + data.version + ": " +
                        deployed + " deployed, " + failed + " failed" + (
                            failed && stop
                            ? ", stopped at the first failure with " +
                                (targets.length - results.length) +
                                " not attempted"
                            : ""
                        )
                    ),
                    organizationPk: ctx.organizationPk
                });
            });

            return {
                deployed,
                failed,
                notAttempted: targets.length - results.length,
                results
            };
        };

        /**
            Bring one instance's core current: apply the framework's
            own manifest to it, the way `install.js --instance` does
            from a command line (John, 2026-10-17: "how do I get its
            db up to 3.0.0 alpha?").

            Deploy is for packages the server holds in `modules/`, and
            the framework is not one of them, so until now a core
            upgrade was a shell and nothing else -- which is no use on
            a hosted installation. This is the same act as the startup
            self-upgrade's instance step, asked for on purpose instead
            of on a restart.

            Held, applied, let go, audited at both ends, exactly as a
            package deployment is: it is the same kind of outage and
            deserves the same handling. The installer reads the target
            database's own `"$db"` marker to know it is installing an
            instance, so nothing here has to say so.

            A database that is behind is the usual reason, but a
            current one is allowed: re-applying the manifest is how a
            changed script reaches an instance, and the installer
            makes nothing twice.

            @method upgradeInstance
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance id
            @param {String} [payload.data.processId] Caller-chosen id for
            a ServerProcess row the screen can poll for progress
            @return {Promise} {database, version}
        */
        that.upgradeInstance = async function (obj) {
            let data = obj.data || {};
            let version = upgrade.version();

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target;
                let tenant;

                requirePlatform(ctx, "upgrade an instance");

                if (!data.id) {
                    throw invalid("Name the instance to upgrade");
                }

                target = await manager.instanceById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such instance in this organization");
                }

                /*
                    The target's own registry entry, not the caller's:
                    it carries the connection the installer writes
                    through. The same mistake a deployment made once,
                    and the same fix.
                */
                tenant = (obj.registry || []).find(
                    (entry) => entry.pgDatabase === target.pg_database
                );

                if (!tenant) {
                    throw invalid(
                        target.pg_database + " is registered but this " +
                        "server is not serving it, so it cannot be " +
                        "upgraded from here."
                    );
                }

                await manager.setInstanceMaintenance(
                    mclient,
                    target._pk,
                    true,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "instance.upgrade_began",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        "Core " + version + " into " + target.name +
                        " (" + target.pg_database + ")"
                    ),
                    organizationPk: ctx.organizationPk
                });

                try {
                    await datasource.install(
                        upgrade.root(),
                        obj.user,
                        {
                            databases: [target.pg_database],
                            isSuper: true,
                            processId: data.processId,
                            tenant
                        }
                    );
                } catch (err) {
                    await manager.audit(mclient, {
                        action: "instance.upgrade_failed",
                        actorPk: actorPk(ctx),
                        by: obj.user,
                        detail: (
                            "Core " + version + " into " +
                            target.pg_database + ": " +
                            (err.message || err)
                        ),
                        organizationPk: ctx.organizationPk
                    });
                    /*
                        Left held, like a failed deployment: a half
                        applied manifest is not something to let
                        traffic back on to without a person looking.
                    */
                    throw err;
                }

                await manager.setInstanceMaintenance(
                    mclient,
                    target._pk,
                    false,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: "instance.upgraded",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        "Core " + version + " into " + target.name +
                        " (" + target.pg_database + ")"
                    ),
                    organizationPk: ctx.organizationPk
                });

                return {
                    database: target.pg_database,
                    version
                };
            });
        };

        /**
            Bring several instances' cores current, one after another.

            The fleet counterpart of `upgradeInstance`, and the same
            bargain as a group deployment: each instance goes through
            the single-instance path, held and let go in turn, so the
            outage rolls rather than landing on the whole fleet at
            once. The instances are named, so the test database before
            production is this action with one name in the list.

            Stops at the first failure by default, which leaves that
            instance held and the rest untouched.

            @method upgradeFleet
            @param {Object} payload
            @param {Object} payload.data
            @param {Array} payload.data.instances Instance ids, in order
            @param {Boolean} [payload.data.stopOnError] Default true
            @param {Array} [payload.data.processIds] Caller-chosen
            ServerProcess ids, one per instance, same order as
            `instances`: each instance runs in its turn, so the screen
            can poll them the same way, one at a time
            @return {Promise} {upgraded, failed, notAttempted, results}
        */
        that.upgradeFleet = async function (obj) {
            let data = obj.data || {};
            let ids = data.instances;
            let stop = data.stopOnError !== false;
            let version = upgrade.version();
            let targets = [];

            if (!Array.isArray(ids) || !ids.length) {
                throw invalid("Name the instances to upgrade");
            }

            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "upgrade the fleet");

                let n = 0;

                while (n < ids.length) {
                    let found = await manager.instanceAnywhereById(
                        mclient,
                        ids[n]
                    );

                    n += 1;

                    if (!found) {
                        throw notFound("No instance has the id " + ids[n - 1]);
                    }
                    targets.push(found);
                }

                await manager.audit(mclient, {
                    action: "fleet.upgrade_began",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        "Core " + version + " into " + targets.length +
                        " instance(s): " +
                        targets.map((t) => t.pg_database).join(", ")
                    ),
                    organizationPk: ctx.organizationPk
                });
            });

            let results = [];
            let processIds = data.processIds || [];
            let n = 0;

            while (n < targets.length) {
                let target = targets[n];

                n += 1;

                try {
                    // Each in its own organization, so every
                    // instance's trail says what happened to it.
                    await that.upgradeInstance(Object.assign({}, obj, {
                        data: {
                            id: target.id,
                            processId: processIds[n - 1]
                        },
                        organization: target.organization_id
                    }));
                    results.push({
                        database: target.pg_database,
                        id: target.id,
                        name: target.name,
                        ok: true,
                        organization: target.organization
                    });
                } catch (err) {
                    results.push({
                        database: target.pg_database,
                        id: target.id,
                        message: err.message || String(err),
                        name: target.name,
                        ok: false,
                        organization: target.organization
                    });

                    if (stop) {
                        break;
                    }
                }
            }

            let upgraded = results.filter((r) => r.ok).length;
            let failed = results.filter((r) => !r.ok).length;

            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                await manager.audit(mclient, {
                    action: "fleet.upgrade_finished",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: (
                        "Core " + version + ": " + upgraded +
                        " upgraded, " + failed + " failed" + (
                            (failed && stop)
                            ? ", stopped at the first failure with " +
                                (targets.length - results.length) +
                                " not attempted"
                            : ""
                        )
                    ),
                    organizationPk: ctx.organizationPk
                });
            });

            return {
                failed,
                notAttempted: targets.length - results.length,
                results,
                upgraded,
                version
            };
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

        /**
            What this server holds, and which instances run it.

            The usage is what makes a package safe to take off: a
            version an instance is running is the code that instance
            executes, and removing it drops that instance back to the
            rows in its own database without anything saying so --
            which is the "adrift" state the fleet view exists to make
            visible. So the screen that removes packages has to show
            the same thing first.

            @method packages
            @param {Object} payload
            @return {Promise} [{name, version, isNewest, instances,
                               isUsed, isUncertain}]
        */
        that.packages = async function (obj) {
            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "manage the packages on this server");
            });

            let installed = await datasource.installedPackages();
            let seen = await datasource.packageUsage();

            return {
                packages: installed.map(function (one) {
                    let instances = seen.usage[
                        one.name + "@" + one.version
                    ] || [];

                    return Object.assign({}, one, {
                        instances,
                        isUncertain: seen.unknown.length > 0,
                        isUsed: instances.length > 0
                    });
                }),
                unknown: seen.unknown
            };
        };

        /**
            Put a package on this server (ADR-002 section 6, Install).
            No database is touched; Deploy is the separate act that
            reaches one.

            @method installPackage
            @param {Object} payload
            @param {String} payload.data.source Uploaded archive
            @param {Boolean} [payload.data.force] Replace the version
            @return {Promise} {name, version, libraries}
        */
        that.installPackage = async function (obj) {
            let data = obj.data || {};
            let done;

            if (!data.source) {
                throw invalid("No package was uploaded");
            }

            let who = await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "install a package on this server");
                return actorPk(ctx);
            });

            done = await datasource.installPackage(data.source, {
                force: data.force === true
            });

            await manager.run((mclient) => manager.audit(mclient, {
                action: "package.installed",
                actorPk: who,
                by: obj.user,
                detail: done.name + " " + done.version + (
                    done.libraries
                    ? " with its libraries"
                    : ""
                )
            }));

            return {
                libraries: done.libraries,
                name: done.name,
                version: done.version
            };
        };

        /**
            Install a package on this server and deploy it into the
            instance the request came through: what the Modules page's
            Install button asks for. Two acts (ADR-002 section 6), done
            one after the other by the same rules each has on its own,
            so a platform administrator is needed for both and nothing
            here can do what neither could.

            The version is replaced if this server already holds it. A
            package being worked on is installed again and again at one
            version, and the command line's `--force` is the same
            choice; Install on its own does not make it for you.

            @method installAndDeploy
            @param {Object} payload
            @param {String} payload.data.source Uploaded archive
            @param {Object} [payload.data.subscription] Progress bar
            @return {Promise} {database, module, version, libraries}
        */
        that.installAndDeploy = async function (obj) {
            let data = obj.data || {};
            let tenant = obj.tenant;

            if (!tenant || !tenant.id || tenant.id === "-1") {
                throw invalid(
                    "This is not an instance, so there is nothing to " +
                    "deploy into. Use the Admin Console to install a " +
                    "package on the server."
                );
            }

            let installed = await that.installPackage({
                data: {force: true, source: data.source},
                identity: obj.identity,
                organization: obj.organization,
                registry: obj.registry,
                tenant: obj.tenant,
                user: obj.user
            });
            let deployed = await that.deployPackage({
                data: {
                    id: tenant.id,
                    module: installed.name,
                    subscription: data.subscription,
                    version: installed.version
                },
                identity: obj.identity,
                organization: obj.organization,
                registry: obj.registry,
                tenant: obj.tenant,
                user: obj.user
            });

            return Object.assign({libraries: installed.libraries}, deployed);
        };

        /**
            Take a package off this server, unless an instance is
            running it.

            An instance that cannot be asked is not taken for an
            instance that is not using it: the removal is refused and
            says which could not be reached, because the alternative
            is dropping an instance to its rows on the strength of a
            question nobody managed to ask.

            @method removePackage
            @param {Object} payload
            @param {String} payload.data.name
            @param {String} payload.data.version
            @return {Promise} {name, version}
        */
        that.removePackage = async function (obj) {
            let data = obj.data || {};
            let name = String(data.name || "").trim();
            let version = String(data.version || "").trim();

            if (!name || !version) {
                throw invalid("Name the module and the version");
            }

            let who = await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "remove a package from this server");
                return actorPk(ctx);
            });

            if (!datasource.packageDir(name, version)) {
                throw invalid(
                    name + " " + version + " is not installed on this " +
                    "server"
                );
            }

            let seen = await datasource.packageUsage();
            let running = seen.usage[name + "@" + version] || [];

            if (running.length) {
                throw invalid(
                    name + " " + version + " is deployed to " +
                    running.join(", ") + ". Deploy " + (
                        running.length === 1
                        ? "that instance"
                        : "those instances"
                    ) + " onto another version before removing it."
                );
            }
            if (seen.unknown.length) {
                throw invalid(
                    "Cannot tell whether " + name + " " + version +
                    " is in use: " + seen.unknown.join(", ") +
                    " could not be asked what " + (
                        seen.unknown.length === 1
                        ? "it carries"
                        : "they carry"
                    ) + ". Removing it would drop any instance running " +
                    "it back to the code in its own tables."
                );
            }

            await datasource.removePackage(name, version);

            await manager.run((mclient) => manager.audit(mclient, {
                action: "package.removed",
                actorPk: who,
                by: obj.user,
                detail: name + " " + version
            }));

            return {name, version};
        };

        function requirePlatform(ctx, what) {
            if (ctx.tier !== "platform") {
                throw forbidden(
                    "Only a platform administrator may " + what
                );
            }
        }

        /**
            Put an instance into maintenance, or take it out again. A
            schema change is not attempted under live traffic (ADR-002
            question 7), so Deploy brackets itself with this; it is
            also the switch a platform administrator throws by hand
            when something went wrong halfway.

            While an instance is in maintenance it answers 503 with an
            explanation for everything but its own sign-in and the
            administration routes, and only a platform administrator
            can sign in to it.

            @method setInstanceMaintenance
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.id Instance
            @param {Boolean} payload.data.isMaintenance
            @return {Promise}
        */
        that.setInstanceMaintenance = async function (obj) {
            let data = obj.data || {};
            let isMaintenance = data.isMaintenance === true;

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);
                let target;

                requirePlatform(ctx, "put an instance into maintenance");
                target = await manager.instanceById(
                    mclient,
                    ctx.organizationPk,
                    data.id
                );

                if (!target) {
                    throw notFound("No such instance in this organization");
                }

                await manager.setInstanceMaintenance(
                    mclient,
                    target._pk,
                    isMaintenance,
                    obj.user
                );
                await manager.audit(mclient, {
                    action: (
                        isMaintenance
                        ? "instance.maintenance_began"
                        : "instance.maintenance_ended"
                    ),
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: target.name + " (" + target.pg_database + ")",
                    organizationPk: ctx.organizationPk
                });

                return true;
            });
        };

        /*
            A client on the calling instance for the guarded database
            API, which asks databaseActor who the caller is.
        */
        async function callerClient(obj) {
            let conn = await db.connect(obj.tenant);

            conn.client.currentUser = () => obj.user;
            /*
                With no instance (the platform console, G.2) the client
                is the manager's, which is no instance's, so the
                organization the caller signed in to travels with it
                for the authority check in databaseActor.
            */
            if (!obj.tenant) {
                conn.client.currentOrganization = () => (
                    platform.organizationIdOf(obj.identity)
                );
            }
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
                            "SELECT i._pk, i.username " +
                            "FROM organization_admin a " +
                            "JOIN identity i " +
                            "  ON i._pk = a._identity_identity_pk " +
                            "WHERE a._organization_organization_pk = $1 " +
                            "  AND a.is_active AND NOT a.is_deleted " +
                            "  AND i.status = 'active' AND NOT i.is_deleted"
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

        /**
            Build or rebuild a template database from a registered
            instance (tenant plan D.4): the frozen copy new instances
            are provisioned from. Platform administrators only. The
            source must be quiet; the service account lets go of its
            own connections and anyone else's refuse the copy.

            @method buildTemplate
            @param {Object} payload
            @param {Object} payload.data
            @param {String} payload.data.source Instance database
            @param {String} payload.data.name Template database name
            @return {Promise} {marked, template}
        */
        that.buildTemplate = async function (obj) {
            let data = obj.data || {};
            let source = String(data.source || "").trim().toLowerCase();
            let name = String(data.name || "").trim().toLowerCase();

            if (!source) {
                throw invalid("Name the database to copy");
            }
            if (!name) {
                name = source.slice(0, 52) + "_template";
            }

            return await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requirePlatform(ctx, "build a template");

                let registered = await mclient.query(
                    (
                        "SELECT 1 FROM tenant " +
                        "WHERE pg_database = $1 AND NOT is_deleted"
                    ),
                    [source]
                );

                if (!registered.rows.length) {
                    throw invalid(
                        "\"" + source + "\" is not a registered " +
                        "instance, so there is nothing known to copy"
                    );
                }

                let resp = await datasource.createTemplateDatabase(
                    undefined,
                    undefined,
                    source,
                    name
                );

                await manager.audit(mclient, {
                    action: "template.built",
                    actorPk: actorPk(ctx),
                    by: obj.user,
                    detail: resp.template + " from " + source + (
                        resp.marked
                        ? ""
                        : (
                            " (not marked as a template in " +
                            "pg_database: that needs a superuser; " +
                            "it provisions all the same)"
                        )
                    ),
                    organizationPk: ctx.organizationPk
                });

                return resp;
            });
        };

        /**
            Close demo instances whose time is up (tenant plan D.4):
            is_demo with an expiration in the past stops accepting
            sign-ins, audited as instance.demo_expired. Nothing is
            dropped -- the data outlives the demo until somebody drops
            the instance deliberately. Runs from the server's timer and
            from its route; idempotent either way.

            @method sweepDemos
            @return {Promise} Names of the instances closed
        */
        that.sweepDemos = async function () {
            return await manager.run(async function (mclient) {
                let resp = await mclient.query(
                    (
                        "UPDATE tenant SET is_active = false, " +
                        "  updated = now(), updated_by = 'system' " +
                        "WHERE is_demo AND is_active AND NOT is_deleted " +
                        "  AND expiration IS NOT NULL " +
                        "  AND expiration < now() " +
                        "RETURNING name, pg_database, " +
                        "  _organization_organization_pk AS org_pk"
                    )
                );
                let n = 0;

                while (n < resp.rows.length) {
                    await manager.audit(mclient, {
                        action: "instance.demo_expired",
                        by: "system",
                        detail: (
                            resp.rows[n].name + " (" +
                            resp.rows[n].pg_database + ")"
                        ),
                        organizationPk: resp.rows[n].org_pk
                    });
                    n += 1;
                }

                return resp.rows.map((row) => row.name);
            });
        };

        /**
            Drop the demos that ran out long enough ago that nobody is
            going to ask for them back (tenant plan D.4, John's answer
            of 2026-10-16). Closing is immediate and reversible --
            somebody may yet say "I want that one back", and moving the
            expiration forward is how they get it. Dropping is neither,
            so it waits out `demoGraceDays` in config.json, a month by
            default, and never happens at all where that is zero.

            The data goes with the database. The registry row stays,
            marked deleted, so what was there and when it went survives
            the instance.

            @method sweepDemoDrops
            @return {Promise} Names of the instances dropped
        */
        that.sweepDemoDrops = async function () {
            let conf = await config.read();
            let days = datasource.demoGraceDays(conf);

            if (!days) {
                return [];
            }

            let due = await manager.run(
                (mclient) => mclient.query(
                    (
                        "SELECT _pk, name, pg_database, " +
                        "  _organization_organization_pk AS org_pk " +
                        "FROM tenant " +
                        "WHERE is_demo AND NOT is_active " +
                        "  AND NOT is_deleted " +
                        "  AND expiration IS NOT NULL " +
                        "  AND expiration < now() - " +
                        "      ($1 || ' days')::interval " +
                        "ORDER BY expiration"
                    ),
                    [String(days)]
                )
            );
            let dropped = [];
            let n = 0;

            while (n < due.rows.length) {
                let row = due.rows[n];

                n += 1;

                try {
                    /*
                        The registry is read again inside the drop, so
                        an instance reopened between the query above
                        and the drop below is left alone.
                    */
                    let went = await datasource.deleteExpiredDemo(
                        row.pg_database
                    );

                    if (!went) {
                        continue;
                    }
                } catch (err) {
                    /*
                        One that will not drop must not stop the rest,
                        and it will be due again on the next hour.
                    */
                    console.error(
                        "Could not drop the expired demo " +
                        row.pg_database + ": " + (err.message || err)
                    );
                    continue;
                }

                await manager.run(async function (mclient) {
                    await mclient.query(
                        (
                            "UPDATE tenant SET is_deleted = true, " +
                            "  updated = now(), updated_by = 'system' " +
                            "WHERE _pk = $1"
                        ),
                        [row._pk]
                    );
                    await provisionTable(mclient);
                    await mclient.query(
                        "DELETE FROM \"$provision\" WHERE tenant_pk = $1",
                        [row._pk]
                    );
                    await manager.audit(mclient, {
                        action: "instance.demo_dropped",
                        by: "system",
                        detail: (
                            row.name + " (" + row.pg_database +
                            "), expired more than " + days +
                            " days ago"
                        ),
                        organizationPk: row.org_pk
                    });
                });
                dropped.push(row.name);
            }

            return dropped;
        };

        /**
            The sweep behind a route: anyone org-wide may run it early
            rather than wait for the server's hour. The timer calls
            `sweepDemos` directly.

            @method sweepDemosGuarded
            @param {Object} payload
            @return {Promise} {closed, dropped}, names of each
        */
        that.sweepDemosGuarded = async function (obj) {
            await manager.run(async function (mclient) {
                let ctx = await contextFor(mclient, obj);

                requireOrgWide(ctx, "sweep expired demos");
            });

            return {
                closed: await that.sweepDemos(),
                dropped: await that.sweepDemoDrops()
            };
        };

        return that;
    };

}(exports));
