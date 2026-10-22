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
/*
    Uniqueness the feather definitions cannot express (tenant plan A.3).

    A feather's `isNaturalKey` builds an ordinary index, not a unique one,
    and there is no way to declare a constraint spanning two columns.
    Enforcing uniqueness in application code alone would leave the race
    open, so these are database constraints.

    A username is unique across the whole installation. It was once
    unique only within an organization, so that two customers could each
    employ an `alice` -- but a username that means a different person
    depending on where you are standing cannot name the people who
    stand everywhere: the platform administrator who answers for every
    organization, and the reseller whose customers are several of them
    (John, Oct 2026: "user names must be global and unique to the whole
    system"). Those people had to be recreated in each organization,
    which is no way to run a support desk. One name, one person, and an
    email address -- which people reach for anyway, being universal and
    memorable -- works as a username without further thought.

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
            /*
                An installation that predates global usernames has this
                index keyed on the organization as well. It is dropped
                and rebuilt rather than left: the duplicates it allowed
                are merged by the step before this one, so by now there
                are none to stand in the way.
            */
            stale: "_organization_organization_pk",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "identity_unique_username ON identity " +
                "(lower(username)) WHERE NOT is_deleted"
            ),
            comment: (
                "A username is unique across the installation, so one " +
                "name is one person everywhere"
            )
        },
        {
            name: "organization_admin_unique_pair",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "organization_admin_unique_pair ON organization_admin " +
                "(_identity_identity_pk, _organization_organization_pk) " +
                "WHERE NOT is_deleted"
            ),
            comment: "One appointment per identity and organization"
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
        },
        {
            name: "identity_federation_unique_subject",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "identity_federation_unique_subject ON identity_federation " +
                "(issuer, subject) WHERE NOT is_deleted"
            ),
            comment: (
                "One identity per subject at an issuer (ADR-001 C.3): the " +
                "provider's subject is the key, so two identities cannot " +
                "claim the same person"
            )
        },
        {
            name: "identity_provider_unique_organization",
            sql: (
                "CREATE UNIQUE INDEX IF NOT EXISTS " +
                "identity_provider_unique_organization ON " +
                "identity_provider (_organization_organization_pk) " +
                "WHERE NOT is_deleted"
            ),
            comment: "One identity provider per organization, for now"
        }
    ];

    /*
        Columns added to a table that already existed, which every
        instance registered before the column was added has as NULL.
        The feather's own default governs new tables; this is what
        brings the rows already there into line, and fixes the column
        for the inserts that do not name it.

        Every reader tests `=== true`, so a NULL reads as false today
        -- but "down for maintenance is unknown" is not a state the
        design has, and anybody writing the obvious `WHERE NOT
        is_maintenance` would quietly skip those rows (John, Oct 2026).
    */
    const BACKFILL = [
        {
            column: "is_maintenance",
            table: "tenant",
            value: "false"
        }
    ];

    exports.execute = function (obj) {
        async function build() {
            let i = 0;

            while (i < INDEXES.length) {
                let idx = INDEXES[i];
                i += 1;

                /*
                    An index whose shape has changed: CREATE ... IF NOT
                    EXISTS would find the old one and leave it, so the
                    old one goes first. Only when it really is the old
                    one, so a current installation rebuilds nothing.
                */
                if (idx.stale) {
                    let found = await obj.client.query(
                        (
                            "SELECT indexdef FROM pg_indexes " +
                            "WHERE indexname = $1"
                        ),
                        [idx.name]
                    );

                    if (
                        found.rows.length &&
                        found.rows[0].indexdef.indexOf(idx.stale) !== -1
                    ) {
                        await obj.client.query(
                            "DROP INDEX IF EXISTS " + idx.name
                        );
                    }
                }

                await obj.client.query(idx.sql);
                // COMMENT is a utility statement and takes no bind
                // parameters, so the text is quoted into the statement
                await obj.client.query(
                    "COMMENT ON INDEX " + idx.name + " IS '" +
                    idx.comment.replace(/'/g, "''") + "'"
                );
            }

            let n = 0;

            while (n < BACKFILL.length) {
                let one = BACKFILL[n];
                n += 1;

                let there = await obj.client.query(
                    (
                        "SELECT 1 FROM information_schema.columns " +
                        "WHERE table_name = $1 AND column_name = $2"
                    ),
                    [one.table, one.column]
                );

                if (!there.rows.length) {
                    continue;
                }

                await obj.client.query(
                    "ALTER TABLE " + one.table + " ALTER COLUMN " +
                    one.column + " SET DEFAULT " + one.value
                );
                await obj.client.query(
                    "UPDATE " + one.table + " SET " + one.column + " = " +
                    one.value + " WHERE " + one.column + " IS NULL"
                );
            }
        }

        return build();
    };
}(exports));
