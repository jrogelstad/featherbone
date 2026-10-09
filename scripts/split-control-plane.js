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
/*jslint node*/
/*
    Help move a combined database onto a dedicated control plane
    (tenant plan A.1).

    Run it after `node install.js --control-plane` has created and
    bootstrapped the control-plane database.

    What it does: copies `tenant_service` rows across. They are
    self-contained, and their `pg_password` is encrypted with the
    installation's `pgCryptoKey`, which both databases share, so the
    stored value can be copied as it stands rather than retyped.

    What it deliberately does not do: copy `tenant` rows. A tenant
    points at a contact and an edition by primary key, and primary keys
    are per database, so moving one means moving application data with
    it -- and in the model this plan is building toward, a tenant also
    belongs to an organization, which does not exist yet. The rows are
    listed here so they can be re-entered in the control plane's own
    administration, and tenant-plan A.5 is where they move properly,
    with their ownership.

        node scripts/split-control-plane.js
        node scripts/split-control-plane.js --apply

    Reads both connections from server/config.json: the source is
    `pgDatabase`, the destination is the `controlPlane` block. Nothing
    is deleted from the source; once the split server is serving, drop
    the old rows by hand.
*/
(function () {
    "use strict";

    const {Client} = require("pg");
    const {Config} = require("../server/config");

    const config = new Config();
    const apply = process.argv.includes("--apply");

    const SERVICE_COLUMNS = [
        "id", "created", "created_by", "updated", "updated_by",
        "is_deleted", "lock", "owner", "etag", "name", "pg_host",
        "pg_port", "pg_user", "pg_password"
    ];

    function connect(settings, database) {
        let client = new Client({
            database: database,
            host: settings.pgHost,
            password: settings.pgPassword,
            port: settings.pgPort,
            user: settings.pgUser
        });

        return client.connect().then(() => client);
    }

    function quoted(columns) {
        return columns.map((c) => "\"" + c + "\"").join(", ");
    }

    function placeholders(n) {
        let ret = [];

        while (ret.length < n) {
            ret.push("$" + (ret.length + 1));
        }

        return ret.join(", ");
    }

    async function kindOf(client, name) {
        let resp = await client.query(
            "SELECT kind FROM pg_tables, \"$db\" " +
            "WHERE tablename = '$db' AND schemaname = 'public'"
        ).catch(function () {
            return {rows: []};
        });

        if (!resp.rows.length) {
            throw new Error(
                "\"" + name + "\" has no \"$db\" marker. Install it first."
            );
        }

        return resp.rows[0].kind;
    }

    async function copyServices(from, to) {
        let rows = (await from.query(
            "SELECT " + quoted(SERVICE_COLUMNS) + " FROM tenant_service;"
        )).rows;
        let have = (await to.query(
            "SELECT id FROM tenant_service;"
        )).rows.map((r) => r.id);
        let moved = 0;
        let i = 0;

        while (i < rows.length) {
            let row = rows[i];
            i += 1;

            if (have.includes(row.id)) {
                console.log("  service \"" + row.name + "\" is already there");
            } else if (apply) {
                await to.query((
                    "INSERT INTO tenant_service (_pk, " +
                    quoted(SERVICE_COLUMNS) + ") VALUES (" +
                    "nextval('object__pk_seq'), " +
                    placeholders(SERVICE_COLUMNS.length) + ");"
                ), SERVICE_COLUMNS.map((c) => row[c]));
                moved += 1;
                console.log("  copied service \"" + row.name + "\"");
            } else {
                moved += 1;
                console.log("  would copy service \"" + row.name + "\"");
            }
        }

        return {moved, total: rows.length};
    }

    async function listTenants(from) {
        let rows = (await from.query((
            "SELECT tenant.name, tenant.pg_database, tenant.is_active, " +
            "  (SELECT name FROM tenant_service AS svc " +
            "   WHERE svc._pk = tenant._pg_service_tenant_service_pk" +
            "  ) AS service, " +
            "  (SELECT name FROM edition AS ed " +
            "   WHERE ed._pk = tenant._edition_edition_pk) AS edition " +
            "FROM tenant WHERE NOT is_deleted ORDER BY tenant.name;"
        ))).rows;

        if (!rows.length) {
            console.log("  no tenants to re-enter");
            return rows;
        }

        console.log(
            "  re-enter these in the control plane's administration " +
            "(see the note at the top of this script):"
        );
        rows.forEach(function (row) {
            console.log(
                "    " + row.name + " -> database " + row.pg_database +
                ", service " + (row.service || "(none)") +
                ", edition " + (row.edition || "(none)") +
                (
                    row.is_active === false
                    ? ", inactive"
                    : ""
                )
            );
        });

        return rows;
    }

    async function main() {
        let conf = await config.read();
        let cp = config.controlPlane(conf);
        let from;
        let to;

        if (cp.pgDatabase === conf.pgDatabase) {
            throw new Error(
                "controlPlane.pgDatabase is the same database as " +
                "pgDatabase. Set it to the dedicated tenant management " +
                "database first."
            );
        }

        from = await connect(conf, conf.pgDatabase);
        to = await connect(cp, cp.pgDatabase);

        try {
            let sourceKind = await kindOf(from, conf.pgDatabase);
            let targetKind = await kindOf(to, cp.pgDatabase);
            let services;
            let tenants;

            if (targetKind !== "controlPlane") {
                throw new Error(
                    "\"" + cp.pgDatabase + "\" is installed as \"" +
                    targetKind + "\". Install it with " +
                    "`node install.js --control-plane`."
                );
            }

            console.log(
                (
                    apply
                    ? "Copying"
                    : "Dry run: would copy"
                ) + " tenant services from \"" + conf.pgDatabase +
                "\" (" + sourceKind + ") to \"" + cp.pgDatabase + "\""
            );

            services = await copyServices(from, to);
            tenants = await listTenants(from);

            console.log(
                "Services: " + services.moved + " of " + services.total +
                ". Tenants listed: " + tenants.length + "."
            );

            if (!apply) {
                console.log("Nothing was changed. Run with --apply.");
                return;
            }

            console.log(
                "Next: set serverRole and the controlPlane block in " +
                "server/config.json, restart, check that every tenant " +
                "still signs in, then drop the old tenant and " +
                "tenant_service rows from \"" + conf.pgDatabase + "\"."
            );
        } finally {
            await from.end();
            await to.end();
        }
    }

    main().catch(function (err) {
        console.error(err.message);
        process.exit(1);
    });
}());
