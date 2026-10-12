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
/**
    The manager database, as the rest of the server sees it.

    One place that knows the registry's tables -- organization, tenant,
    identity, access_grant, admin_audit -- so that the sign-in path
    (`database.js`), the user and role triggers (`role.js`, tenant plan
    B.4 and B.5) and the administration routes (`server.js`) do not each
    carry their own SQL.

    Every call opens its own connection to the manager, because the
    manager is a different database from the instance a request is for.
    Two databases means two transactions: a write here does not roll
    back when the instance's transaction does. Where that matters the
    order is chosen so a failure leaves something recoverable rather
    than something wrong -- an identity with no grant is inert, a grant
    with no local profile is refused at sign-in.

    @module Manager
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const {Identities} = require("./identities");
    const f = require("../../common/core");

    const db = new Database();
    const identities = new Identities();

    // _pk,id,created,created_by,updated,updated_by,is_deleted,owner,etag
    const DOC_COLS = (
        "_pk,id,created,created_by,updated,updated_by,is_deleted,owner,etag"
    );
    const DOC_VALS = (
        "nextval('object__pk_seq'),$1,now(),$2,now(),$2,false,$2,$1"
    );

    /**
        @class Manager
        @constructor
        @namespace Services
    */
    exports.Manager = function () {
        let that = {};

        /**
            Run a function against a connection to the manager database
            and release it afterwards. Resolves to whatever the function
            resolves to.

            @method run
            @param {Function} callback Receives the manager client
            @return {Promise}
        */
        that.run = async function (callback) {
            let obj = await db.connect();

            try {
                return await callback(obj.client);
            } finally {
                obj.done();
            }
        };

        /**
            The registry's view of one instance: its primary key and the
            primary key of the organization it belongs to. Rejects when
            the instance is not registered or has no organization, with
            the same wording the sign-in path uses.

            @method instance
            @param {Client} client Manager client
            @param {Object} tenant Tenant as the instance knows it
            @return {Promise} {tenantPk, organizationPk}
        */
        that.instance = async function (client, tenant) {
            if (!tenant || !tenant.id || tenant.id === "-1") {
                throw new Error("No instance for this request");
            }

            let resp = await client.query(
                (
                    "SELECT _pk, _organization_organization_pk AS org " +
                    "FROM tenant WHERE id = $1 AND NOT is_deleted"
                ),
                [tenant.id]
            );

            if (!resp.rows.length) {
                throw new Error(
                    "Instance " + tenant.name + " is not registered"
                );
            }
            if (resp.rows[0].org === null) {
                throw new Error(
                    "Instance " + tenant.name +
                    " is not assigned to an organization"
                );
            }

            return {
                organizationPk: resp.rows[0].org,
                tenantPk: resp.rows[0]._pk
            };
        };

        /**
            One identity by organization and username, or undefined.
            Usernames are compared without case, as at sign-in.

            @method identity
            @param {Client} client Manager client
            @param {Number} organizationPk
            @param {String} username
            @return {Promise} Row or undefined
        */
        that.identity = async function (client, organizationPk, username) {
            let resp = await client.query(
                (
                    "SELECT _pk, id, username, full_name, email, status, " +
                    "  password_hash, failed_attempts, locked_until, " +
                    "  last_signed_in, is_platform_admin, is_org_admin " +
                    "FROM identity " +
                    "WHERE _organization_organization_pk = $1 " +
                    "  AND lower(username) = lower($2) " +
                    "  AND NOT is_deleted"
                ),
                [organizationPk, username]
            );

            return resp.rows[0];
        };

        /**
            Create an identity in an organization, or return the one
            already there.

            An existing identity keeps its password. The same username
            in one organization is the same person -- the
            test-and-production case -- and creating an account for them
            in a second instance is a grant, not a password reset.

            @method addIdentity
            @param {Client} client Manager client
            @param {Object} data
            @param {Number} data.organizationPk
            @param {String} data.username
            @param {String} [data.fullName] Defaults to the username
            @param {String} [data.email]
            @param {String} [data.password] Hashed here, never stored raw
            @param {String} [data.by] Who to record as the author
            @return {Promise} {identityPk, created}
        */
        that.addIdentity = async function (client, data) {
            let by = data.by || "system";
            let found = await that.identity(
                client,
                data.organizationPk,
                data.username
            );

            if (found) {
                return {created: false, identityPk: found._pk};
            }

            let resp = await client.query(
                (
                    "INSERT INTO identity (" + DOC_COLS + "," +
                    "_organization_organization_pk,username,full_name," +
                    "email,password_hash,status,is_platform_admin," +
                    "is_org_admin,failed_attempts) " +
                    "VALUES (" + DOC_VALS +
                    ",$3,$4,$5,$6,$7,'active',false,false,0) " +
                    "RETURNING _pk"
                ),
                [
                    f.createId(),
                    by,
                    data.organizationPk,
                    data.username,
                    data.fullName || data.username,
                    data.email || "",
                    (
                        data.password
                        ? identities.hashPassword(data.password)
                        : ""
                    )
                ]
            );

            return {created: true, identityPk: resp.rows[0]._pk};
        };

        /**
            Replace an identity's password and clear its failed
            attempts. The password is hashed here; callers pass the
            plain text and keep none of it.

            @method setPassword
            @param {Client} client Manager client
            @param {Number} identityPk
            @param {String} password
            @param {String} [by] Who to record as the author
            @return {Promise}
        */
        that.setPassword = async function (client, identityPk, password, by) {
            await client.query(
                (
                    "UPDATE identity SET password_hash = $2, " +
                    "failed_attempts = 0, updated = now(), " +
                    "updated_by = $3 WHERE _pk = $1"
                ),
                [identityPk, identities.hashPassword(password), by || "system"]
            );
        };

        /**
            Set an identity's status: active, disabled or locked.
            Unlocking clears the counter and the lock expiry with it.

            @method setStatus
            @param {Client} client Manager client
            @param {Number} identityPk
            @param {String} status
            @param {String} [by] Who to record as the author
            @return {Promise}
        */
        that.setStatus = async function (client, identityPk, status, by) {
            await client.query(
                (
                    "UPDATE identity SET status = $2, " +
                    "failed_attempts = (" +
                    "  CASE WHEN $2 = 'active' THEN 0 " +
                    "  ELSE failed_attempts END), " +
                    "locked_until = (" +
                    "  CASE WHEN $2 = 'active' THEN NULL " +
                    "  ELSE locked_until END), " +
                    "updated = now(), updated_by = $3 WHERE _pk = $1"
                ),
                [identityPk, status, by || "system"]
            );
        };

        /**
            Grant or ungrant an identity access to one instance. The
            pair is unique, so this creates the grant or flips the one
            already there; a revoke deactivates it and keeps the row, so
            the history of who could reach what is not destroyed
            (tenant plan B.5).

            @method setGrant
            @param {Client} client Manager client
            @param {Object} data
            @param {Number} data.identityPk
            @param {Number} data.tenantPk
            @param {Boolean} data.isActive
            @param {Number} [data.grantedByPk]
            @param {String} [data.by] Who to record as the author
            @return {Promise} {created}
        */
        that.setGrant = async function (client, data) {
            let by = data.by || "system";
            let resp = await client.query(
                (
                    "SELECT _pk FROM access_grant " +
                    "WHERE _identity_identity_pk = $1 " +
                    "  AND _tenant_tenant_pk = $2 AND NOT is_deleted"
                ),
                [data.identityPk, data.tenantPk]
            );

            if (resp.rows.length) {
                await client.query(
                    (
                        "UPDATE access_grant SET is_active = $2, " +
                        "updated = now(), updated_by = $3 WHERE _pk = $1"
                    ),
                    [resp.rows[0]._pk, data.isActive !== false, by]
                );
                return {created: false};
            }

            await client.query(
                (
                    "INSERT INTO access_grant (" + DOC_COLS + "," +
                    "_identity_identity_pk,_tenant_tenant_pk,is_active," +
                    "granted,_granted_by_identity_pk) " +
                    "VALUES (" + DOC_VALS + ",$3,$4,$5,now(),$6)"
                ),
                [
                    f.createId(),
                    by,
                    data.identityPk,
                    data.tenantPk,
                    data.isActive !== false,
                    data.grantedByPk || null
                ]
            );

            return {created: true};
        };

        /**
            Record a privileged change. Anything that alters who can get
            in, or what they can get into, leaves a row here
            (ADR-001 A.4).

            @method audit
            @param {Client} client Manager client
            @param {Object} data
            @param {String} data.action
            @param {Number} [data.actorPk]
            @param {Number} [data.organizationPk]
            @param {Number} [data.targetIdentityPk]
            @param {String} [data.detail]
            @param {String} [data.by] Who to record as the author
            @return {Promise}
        */
        that.audit = async function (client, data) {
            await client.query(
                (
                    "INSERT INTO admin_audit (" + DOC_COLS + "," +
                    "action,occurred,_actor_identity_pk," +
                    "_on_behalf_of_organization_pk," +
                    "_target_identity_identity_pk,detail) " +
                    "VALUES (" + DOC_VALS + ",$3,now(),$4,$5,$6,$7)"
                ),
                [
                    f.createId(),
                    data.by || "system",
                    data.action,
                    data.actorPk || null,
                    data.organizationPk || null,
                    data.targetIdentityPk || null,
                    data.detail || ""
                ]
            );
        };

        return that;
    };

}(exports));
