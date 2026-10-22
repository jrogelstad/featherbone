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
/*jslint node, name, unordered*/
/*
    One name, one person (John, Oct 2026: "user names must be global and
    unique to the whole system").

    A username used to be unique only within an organization, so the same
    name could stand for a different person in each one -- and the people
    who stand everywhere, the platform administrator and the reseller
    with several customers as accounts, had to be recreated in each. The
    index that follows this step makes a username unique across the
    installation, which the duplicates already there would refuse.

    They are merged rather than reported, which is what John asked for:
    the duplicates these installations actually hold are one person
    entered twice, usually by a command-line install making its own
    administrator in a new organization. The survivor is the identity
    most recently signed in to -- the credential the person is actually
    using -- and it inherits everything the others could reach: their
    instance grants, their federated subjects, and an appointment over
    each organization they administered, so no access is lost by being
    merged. The others are soft-deleted, never dropped, and each merge
    is recorded in the audit with the names and organizations involved.

    A merge joins credentials, so it says what it did: every one is
    printed as it happens, and the audit keeps the record after the
    console has scrolled away.

    Runs before manager-constraints builds the unique index, and only on
    a manager. Idempotent: a second run finds no duplicates.
*/
(function (exports) {
    "use strict";

    /*
        Which identity of a set survives. The one most recently signed
        in to is the credential in use; where none has ever signed in,
        the oldest is the one the others were made alongside.
    */
    const SQL_DUPLICATES = (
        "SELECT lower(username) AS name, count(*)::int AS n " +
        "FROM identity WHERE NOT is_deleted " +
        "GROUP BY lower(username) HAVING count(*) > 1 " +
        "ORDER BY lower(username)"
    );

    const SQL_SET = (
        "SELECT i._pk, i.id, i.username, i.last_signed_in, i.created, " +
        "  i.is_platform_admin, i.is_org_admin, i.status, " +
        "  i._organization_organization_pk AS org_pk, " +
        "  o.name AS org_name " +
        "FROM identity i " +
        "LEFT JOIN organization o " +
        "  ON o._pk = i._organization_organization_pk " +
        "WHERE lower(i.username) = $1 AND NOT i.is_deleted " +
        "ORDER BY i.last_signed_in DESC NULLS LAST, i.created"
    );

    exports.execute = function (obj) {
        const client = obj.client;

        async function has(table) {
            let found = await client.query(
                "SELECT to_regclass($1) IS NOT NULL AS found",
                [table]
            );

            return found.rows[0].found;
        }

        /*
            An organization the merged identity administered as one of
            the others. Written as an appointment of its own, so the
            reach survives the row that carried it.
        */
        async function appoint(keep, orgPk, username) {
            if (!orgPk) {
                return;
            }

            let there = await client.query(
                (
                    "SELECT _pk FROM organization_admin " +
                    "WHERE _identity_identity_pk = $1 " +
                    "  AND _organization_organization_pk = $2 " +
                    "  AND NOT is_deleted"
                ),
                [keep._pk, orgPk]
            );

            if (there.rows.length) {
                return;
            }

            await client.query(
                (
                    "INSERT INTO organization_admin " +
                    "  (_pk, id, created, created_by, updated, " +
                    "   updated_by, is_deleted, owner, etag, " +
                    "   _identity_identity_pk, " +
                    "   _organization_organization_pk, is_active, " +
                    "   appointed) " +
                    "VALUES (nextval('object__pk_seq'), $1, now(), " +
                    "  'system', now(), 'system', false, 'system', $1, " +
                    "  $2, $3, true, now())"
                ),
                [
                    "oa" + keep._pk + "-" + orgPk,
                    keep._pk,
                    orgPk
                ]
            );
            console.log(
                "  " + username + " keeps administering " +
                (keep.org_name || "organization " + orgPk)
            );
        }

        async function carry(table, column, pair, keep, loser) {
            if (!await has(table)) {
                return 0;
            }

            let moved = await client.query(
                (
                    "UPDATE " + table + " SET " + column + " = $1, " +
                    "  updated = now(), updated_by = 'system' " +
                    "WHERE " + column + " = $2 AND NOT is_deleted " +
                    "  AND NOT EXISTS (" +
                    "    SELECT 1 FROM " + table + " mine " +
                    "    WHERE mine." + column + " = $1 " +
                    "      AND NOT mine.is_deleted " +
                    "      AND mine._pk <> " + table + "._pk" +
                    "      AND mine." + pair + " = " +
                    table + "." + pair + ")"
                ),
                [keep._pk, loser._pk]
            );

            return moved.rowCount;
        }

        async function merge(name) {
            let set = await client.query(SQL_SET, [name]);
            let rows = set.rows;
            let keep = rows[0];
            let losers = rows.slice(1);
            let n = 0;

            console.log(
                "Merging " + rows.length + " identities named \"" +
                keep.username + "\" into the one in " +
                (keep.org_name || "no organization") +
                " (most recently signed in)"
            );

            // The appointment that the survivor's own flag stood for
            if (keep.is_org_admin === true) {
                await appoint(keep, keep.org_pk, keep.username);
            }

            while (n < losers.length) {
                let loser = losers[n];
                let grants;
                n += 1;

                /*
                    A grant or a federated subject the survivor already
                    has is left where it is rather than moved onto a
                    duplicate of itself, which the unique indexes would
                    refuse.
                */
                grants = await carry(
                    "access_grant",
                    "_identity_identity_pk",
                    "_tenant_tenant_pk",
                    keep,
                    loser
                );
                await carry(
                    "identity_federation",
                    "_identity_identity_pk",
                    "subject",
                    keep,
                    loser
                );

                if (loser.is_org_admin === true) {
                    await appoint(
                        {
                            _pk: keep._pk,
                            org_name: loser.org_name
                        },
                        loser.org_pk,
                        keep.username
                    );
                }

                if (loser.is_platform_admin === true) {
                    await client.query(
                        (
                            "UPDATE identity SET is_platform_admin = true, " +
                            "  updated = now(), updated_by = 'system' " +
                            "WHERE _pk = $1"
                        ),
                        [keep._pk]
                    );
                    console.log(
                        "  " + keep.username +
                        " keeps administering the platform"
                    );
                }

                await client.query(
                    (
                        "UPDATE identity SET is_deleted = true, " +
                        "  updated = now(), updated_by = 'system' " +
                        "WHERE _pk = $1"
                    ),
                    [loser._pk]
                );
                console.log(
                    "  merged the one in " +
                    (loser.org_name || "no organization") + ", carrying " +
                    grants + " instance grant(s)"
                );

                if (await has("admin_audit")) {
                    await client.query(
                        (
                            "INSERT INTO admin_audit " +
                            "  (_pk, id, created, created_by, updated, " +
                            "   updated_by, is_deleted, owner, etag, " +
                            "   action, occurred, detail, " +
                            "   _actor_identity_pk, " +
                            "   _target_identity_identity_pk, " +
                            "   _on_behalf_of_organization_pk) " +
                            "VALUES (nextval('object__pk_seq'), $1, " +
                            "  now(), 'system', now(), 'system', false, " +
                            "  'system', $1, 'identity.merged', now(), " +
                            "  $2, null, $4, $3)"
                        ),
                        [
                            "mg" + loser._pk + "-" + keep._pk,
                            (
                                "\"" + keep.username + "\" in " +
                                (loser.org_name || "no organization") +
                                " merged into the one in " +
                                (keep.org_name || "no organization") +
                                ", carrying " + grants + " instance " +
                                "grant(s); usernames are now unique " +
                                "across the installation"
                            ),
                            loser.org_pk,
                            keep._pk
                        ]
                    );
                }
            }
        }

        async function run() {
            if (!await has("identity")) {
                return;
            }

            let duplicates = await client.query(SQL_DUPLICATES);
            let i = 0;

            if (!duplicates.rows.length) {
                return;
            }

            console.log(
                "Usernames are unique across the installation now, and " +
                duplicates.rows.length + " name(s) are held by more than " +
                "one identity. Merging each into one person:"
            );

            while (i < duplicates.rows.length) {
                await merge(duplicates.rows[i].name);
                i += 1;
            }
        }

        return run();
    };

}(exports));
