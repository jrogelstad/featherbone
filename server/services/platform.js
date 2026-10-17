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

    const {Manager} = require("./manager");
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

            @method instancesFor
            @param {Client} client Manager client
            @param {String} username
            @param {String} organizationId
            @return {Promise} Array of instances
        */
        that.instancesFor = async function (client, username, organizationId) {
            let organization = await manager.organizationById(
                client,
                organizationId
            );

            if (!organization) {
                return [];
            }

            let maint = (
                await that.hasMaintenance(client)
                ? "t.is_maintenance"
                : "false AS is_maintenance"
            );
            let resp = await client.query(
                (
                    "SELECT t.id, t.name, t.pg_database, t.is_active, " +
                    "  t.is_demo, t.expiration, " + maint + " " +
                    "FROM access_grant g " +
                    "JOIN tenant t ON t._pk = g._tenant_tenant_pk " +
                    "JOIN identity i ON i._pk = g._identity_identity_pk " +
                    "WHERE lower(i.username) = lower($1) " +
                    "  AND i._organization_organization_pk = $2 " +
                    "  AND t._organization_organization_pk = $2 " +
                    "  AND i.status = 'active' AND NOT i.is_deleted " +
                    "  AND g.is_active AND NOT g.is_deleted " +
                    "  AND NOT t.is_deleted " +
                    "ORDER BY lower(t.name)"
                ),
                [username, organization._pk]
            );

            return resp.rows.map(function (row) {
                return {
                    database: row.pg_database,
                    expiration: row.expiration,
                    id: row.id,
                    isActive: row.is_active === true,
                    isDemo: row.is_demo === true,
                    isMaintenance: row.is_maintenance === true,
                    name: row.name
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
            @param {String} organizationId
            @param {String} instanceId
            @param {Boolean} [isPlatformAdmin]
            @return {Promise} Object, `ok` with a `reason` when not
        */
        that.mayEnter = async function (
            client,
            username,
            organizationId,
            instanceId,
            isPlatformAdmin
        ) {
            let instances = await that.instancesFor(
                client,
                username,
                organizationId
            );
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

        return that;
    };

}(exports));
