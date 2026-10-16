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
    Signing in as somebody an identity provider vouches for (ADR-001
    C.3 and C.4; Microsoft Entra ID, which everyone still calls Azure
    AD, is the reference target).

    Everything here is about *what the claims mean*: which identity a
    subject is, whether one may be made for them on the spot, and what
    an organization's policy allows. Talking to the provider -- the
    redirect, the code exchange, verifying the token -- is
    `server/services/oidc.js`, and it hands its result here. The two
    are separate so the half that decides who somebody is can be run
    against a database without an identity provider in the room, which
    is the half worth testing.

    The subject, never the email, is the key. An email address can be
    reassigned to a new employee; `sub` at an issuer cannot.
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

    const DOC_COLS = (
        "_pk,id,created,created_by,updated,updated_by,is_deleted," +
        "owner,etag"
    );

    /**
        Identity federation: the link between a subject at an identity
        provider and an identity here.

        @class Federation
        @constructor
        @namespace Services
    */
    exports.Federation = function () {
        let that = {};

        function refuse(message, code) {
            let err = new Error(message);

            err.statusCode = code || 401;
            return err;
        }

        /**
            The identity provider configured for an organization, with
            its secret decrypted. Undefined when there is none, or when
            the one there is has been turned off.

            @method providerFor
            @param {Client} client Manager client
            @param {Number} organizationPk
            @return {Promise} Object or undefined
        */
        that.providerFor = async function (client, organizationPk) {
            let conf = await config.read();
            let resp = await client.query(
                (
                    "SELECT _pk, id, name, kind, issuer, client_id, " +
                    "  pgp_sym_decrypt(client_secret::BYTEA, $2) " +
                    "    AS client_secret, " +
                    "  is_just_in_time, default_instances, " +
                    "  username_claim, admin_group " +
                    "FROM identity_provider " +
                    "WHERE _organization_organization_pk = $1 " +
                    "  AND is_active AND NOT is_deleted"
                ),
                [organizationPk, conf.pgCryptoKey]
            );

            if (!resp.rows.length) {
                return;
            }

            let row = resp.rows[0];

            return {
                adminGroup: row.admin_group || "",
                clientId: row.client_id,
                clientSecret: row.client_secret || "",
                defaultInstances: row.default_instances || [],
                id: row.id,
                isJustInTime: row.is_just_in_time === true,
                issuer: row.issuer,
                kind: row.kind,
                name: row.name,
                pk: row._pk,
                usernameClaim: row.username_claim || "preferred_username"
            };
        };

        /**
            How an organization's identities are allowed to sign in:
            "password", "sso" or "both". The column has been on
            Organization since A.3 and nothing read it; this is what
            reads it.

            @method policyFor
            @param {Client} client Manager client
            @param {Number} organizationPk
            @return {Promise} String
        */
        that.policyFor = async function (client, organizationPk) {
            let organization = await manager.organization(
                client,
                organizationPk
            );

            return (organization || {}).authentication || "password";
        };

        /**
            Whether a local password may be used here at all. An
            organization that has moved to single sign-on says so by
            its policy, and a password that still works is a way round
            it.

            @method passwordRefusal
            @param {Client} client Manager client
            @param {Number} organizationPk
            @return {Promise} String or undefined
        */
        that.passwordRefusal = async function (client, organizationPk) {
            let policy = await that.policyFor(client, organizationPk);

            if (policy !== "sso") {
                return;
            }

            let provider = await that.providerFor(client, organizationPk);

            return (
                "Sign in with single sign-on. This organization signs " +
                "in through " + (
                    provider
                    ? provider.name
                    : "its identity provider"
                ) + " and does not take a password here."
            );
        };

        /*
            The user name to give an identity made on the strength of
            claims. The configured claim first, then the usual
            fallbacks; an email is a reasonable user name even though it
            is a poor key.
        */
        function usernameFrom(claims, provider) {
            let named = claims[provider.usernameClaim];

            return String(
                named ||
                claims.preferred_username ||
                claims.upn ||
                claims.email ||
                ""
            ).trim();
        }

        function groupsFrom(claims) {
            let groups = claims.groups || claims.roles || [];

            if (typeof groups === "string") {
                return [groups];
            }
            return (
                Array.isArray(groups)
                ? groups
                : []
            );
        }

        /**
            Who this subject is here, given claims an identity provider
            has vouched for.

            Three cases. The subject is already linked, and is that
            identity. The subject is not linked but the user name it
            carries is already an identity in the organization, and the
            link is made to it -- the person was here before the
            organization moved to single sign-on. Or neither, and an
            identity is made if the provider is allowed to make them
            (C.4), with the grants it is configured to give.

            A suspended or locked identity is refused as it would be
            with a password: the provider says who somebody is, not
            whether they may come in.

            @method resolve
            @param {Client} client Manager client
            @param {Object} obj
            @param {Number} obj.organizationPk
            @param {Object} obj.provider As providerFor returns
            @param {String} obj.subject The provider's `sub`
            @param {Object} obj.claims
            @return {Promise} {identity, created, linked}
        */
        that.resolve = async function (client, obj) {
            let provider = obj.provider;
            let subject = String(obj.subject || "").trim();
            let claims = obj.claims || {};
            let username = usernameFrom(claims, provider);

            if (!subject) {
                throw refuse("The provider named no subject");
            }

            let found = await client.query(
                (
                    "SELECT fed._pk AS federation_pk, i._pk, i.username, " +
                    "  i.status, i.is_platform_admin, i.is_org_admin, " +
                    "  i._organization_organization_pk AS org " +
                    "FROM identity_federation fed " +
                    "JOIN identity i ON i._pk = fed._identity_identity_pk " +
                    "WHERE fed.issuer = $1 AND fed.subject = $2 " +
                    "  AND NOT fed.is_deleted AND NOT i.is_deleted"
                ),
                [provider.issuer, subject]
            );
            let identity;
            let federationPk;
            let created = false;
            let linked = false;

            if (found.rows.length) {
                identity = found.rows[0];
                federationPk = identity.federation_pk;

                /*
                    The link belongs to the organization whose provider
                    vouched for it. A provider that returns a subject
                    already linked in another organization is not
                    speaking for that organization.
                */
                if (identity.org !== obj.organizationPk) {
                    throw refuse(
                        "That sign-in belongs to another organization"
                    );
                }
            } else {
                if (!username) {
                    throw refuse(
                        "The provider sent no user name. Set the user " +
                        "name claim on the provider, or add the claim " +
                        "to the token."
                    );
                }

                let here = await manager.identity(
                    client,
                    obj.organizationPk,
                    username
                );

                if (here) {
                    identity = here;
                    linked = true;
                } else {
                    if (!provider.isJustInTime) {
                        throw refuse(
                            "There is no account for " + username +
                            " here, and this provider does not make " +
                            "them. An administrator can."
                        );
                    }

                    let made = await manager.addIdentity(client, {
                        by: "sso",
                        email: claims.email || "",
                        fullName: claims.name || username,
                        organizationPk: obj.organizationPk,
                        username
                    });

                    identity = await manager.identity(
                        client,
                        obj.organizationPk,
                        username
                    );
                    created = made.created;
                }

                let resp = await client.query(
                    (
                        "INSERT INTO identity_federation (" + DOC_COLS +
                        ",_identity_identity_pk,issuer,subject," +
                        "_provider_identity_provider_pk) VALUES (" +
                        "nextval('object__pk_seq'),$1,now(),'sso',now()," +
                        "'sso',false,'sso',$1,$2,$3,$4,$5) RETURNING _pk"
                    ),
                    [
                        f.createId(),
                        identity._pk,
                        provider.issuer,
                        subject,
                        provider.pk
                    ]
                );

                federationPk = resp.rows[0]._pk;
            }

            if (identity.status === "locked") {
                throw refuse("User account is locked");
            }
            if (identity.status !== "active") {
                throw refuse(
                    "No active user account " + identity.username + " found"
                );
            }

            /*
                What the provider says about the person, applied on
                every sign-in rather than only on the first: a group
                taken away at the provider should be taken away here
                (C.4). Only the administrator flag is read -- platform
                administration is never a claim, because the provider
                belongs to one organization and that flag crosses all
                of them.
            */
            if (provider.adminGroup) {
                let isAdmin = groupsFrom(claims).indexOf(
                    provider.adminGroup
                ) !== -1;

                if (isAdmin !== (identity.is_org_admin === true)) {
                    await manager.setOrgAdmin(
                        client,
                        identity._pk,
                        isAdmin,
                        "sso"
                    );
                    await manager.audit(client, {
                        action: (
                            isAdmin
                            ? "identity.org_admin_granted"
                            : "identity.org_admin_revoked"
                        ),
                        by: "sso",
                        detail: (
                            "From the " + provider.name + " group claim " +
                            provider.adminGroup
                        ),
                        organizationPk: obj.organizationPk,
                        targetIdentityPk: identity._pk
                    });
                }
            }

            if (created) {
                await that.grantDefaults(client, obj, identity, provider);
                await manager.audit(client, {
                    action: "identity.provisioned",
                    by: "sso",
                    detail: (
                        username + " made on a first sign-in through " +
                        provider.name
                    ),
                    organizationPk: obj.organizationPk,
                    targetIdentityPk: identity._pk
                });
            } else if (linked) {
                await manager.audit(client, {
                    action: "identity.federated",
                    by: "sso",
                    detail: (
                        identity.username + " linked to " + provider.name +
                        " at " + provider.issuer
                    ),
                    organizationPk: obj.organizationPk,
                    targetIdentityPk: identity._pk
                });
            }

            await client.query(
                (
                    "UPDATE identity_federation SET last_signed_in = now()," +
                    "  updated = now(), updated_by = 'sso' WHERE _pk = $1"
                ),
                [federationPk]
            );
            await client.query(
                (
                    "UPDATE identity SET failed_attempts = 0, " +
                    "  last_signed_in = now(), updated = now(), " +
                    "  updated_by = 'sso' WHERE _pk = $1"
                ),
                [identity._pk]
            );

            return {created, identity, linked};
        };

        /**
            The instances a just-in-time identity is given, named by
            database on the provider. Nothing is granted when none are
            named: an account that reaches nothing is a safer default
            than one that reaches everything.

            @method grantDefaults
            @param {Client} client Manager client
            @param {Object} obj As resolve's
            @param {Object} identity
            @param {Object} provider
            @return {Promise}
        */
        that.grantDefaults = async function (client, obj, identity, provider) {
            let wanted = provider.defaultInstances || [];
            let n = 0;

            while (n < wanted.length) {
                let database = wanted[n];

                n += 1;

                let resp = await client.query(
                    (
                        "SELECT _pk FROM tenant " +
                        "WHERE pg_database = $1 " +
                        "  AND _organization_organization_pk = $2 " +
                        "  AND NOT is_deleted"
                    ),
                    [database, obj.organizationPk]
                );

                if (!resp.rows.length) {
                    console.error(
                        "The identity provider of organization " +
                        obj.organizationPk + " grants \"" + database +
                        "\", which is not one of its instances"
                    );
                    continue;
                }

                await manager.setGrant(client, {
                    by: "sso",
                    identityPk: identity._pk,
                    isActive: true,
                    tenantPk: resp.rows[0]._pk
                });
            }
        };

        return that;
    };

}(exports));
