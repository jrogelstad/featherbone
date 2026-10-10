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
/*
    Uniqueness the feather definitions cannot express (tenant plan A.3).

    A feather's `isNaturalKey` builds an ordinary index, not a unique one,
    and there is no way to declare a constraint spanning two columns. The
    one that matters most here is a username unique *within* an
    organization and not across them: that is the whole point of improvement
    item 1.1, where cluster-wide Postgres role names mean two customers
    cannot both employ an `alice`. Enforcing it in application code alone
    would leave the race open, so it is a database constraint.

    Every index is partial on `NOT is_deleted`, because rows here are
    soft-deleted: a deleted identity must not reserve its username forever.

    Runs after the control-plane feathers have built their tables, and only
    on a control plane. Idempotent, so an upgrade re-runs it harmlessly.
*/
(function (exports) {
    "use strict";

    const INDEXES = [
        {
            name: "identity_unique_username",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "identity_unique_username ON identity " +
                "(_organization_organization_pk, lower(username)) " +
                "WHERE NOT is_deleted"
            ),
            comment: (
                "A username is unique within its organization, never across " +
                "organizations (improvement item 1.1)"
            )
        },
        {
            name: "organization_unique_name",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "organization_unique_name ON organization (lower(name)) " +
                "WHERE NOT is_deleted"
            ),
            comment: "Organization names are unique"
        },
        {
            name: "access_grant_unique_pair",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "access_grant_unique_pair ON access_grant " +
                "(_identity_identity_pk, _tenant_tenant_pk) " +
                "WHERE NOT is_deleted"
            ),
            comment: "One grant per identity and instance"
        }
    ];

    exports.execute = function (obj) {
        async function build() {
            let i = 0;

            while (i < INDEXES.length) {
                let idx = INDEXES[i];
                i += 1;

                await obj.client.query(idx.sql);
                // COMMENT is a utility statement and takes no bind
                // parameters, so the text is quoted into the statement
                await obj.client.query(
                    "COMMENT ON INDEX " + idx.name + " IS '" +
                    idx.comment.replace(/'/g, "''") + "'"
                );
            }
        }

        return build();
    };
}(exports));
