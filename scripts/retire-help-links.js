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
    Off the stored help link, one way (ADR-003).

    Help used to be a record a form or a worksheet pointed at. A
    configured worksheet kept a copy of the whole record -- in the
    workbook's default configuration, its local one and every user's
    profile -- so a change to the record never reached a worksheet
    configured before it, and a package upgrade could not either. One
    field also served two owners: a reinstall overwrote the customer's
    link, or the customer's edit hid the vendor's for good.

    Help now travels with the module (server/services/help.js) and is
    looked up when it opens, so:

      * a link that belongs to no module is the customer's own, and
        becomes a supplement naming the form it supplemented;
      * a link that belongs to a module is the vendor's, and goes
        altogether: the module's own help folder answers for it now,
        and the Help Files worksheet is the customer's own list to
        keep (John, Oct 2026: "clearing out all help links in job shop
        or any other packages ... a clean state for the customer to add
        their own"). The row is removed rather than marked deleted,
        which keeps its id taken and was what made a deploy of a
        package still carrying one fail on a duplicate key;
      * `helpLink` is dropped from worksheet configurations wherever one
        was saved.

    The manifest runs this twice, once either side of the feathers,
    because the feathers are where the two columns change hands:
    Form.helpLink is dropped there and HelpLink.form is added there. The
    first pass reads the references while the old column is still there
    and parks them; the second writes the supplements once the new column
    exists, and clears up. Which pass this is, is read off the database
    rather than passed in.

    Clearing the vendor's links is not part of either pass: it runs
    every time, so a stale package that puts some back does not leave
    them there for good. A link belonging to no module is the
    customer's and is never touched by any of this.

    A fresh install has neither column and does nothing. Idempotent: a
    second upgrade finds no references left to move.
*/
(function (exports) {
    "use strict";

    // Where the first pass leaves what the second one writes
    const CARRY = "$help_carry";

    const SQL_TABLE = "SELECT to_regclass($1) IS NOT NULL AS held";

    const SQL_COLUMN = (
        "SELECT 1 FROM information_schema.columns " +
        "WHERE table_name = $1 AND column_name = $2"
    );

    const SQL_CARRY = (
        "CREATE TABLE \"" + CARRY + "\" (" +
        "  form text, id text, module text, label text, icon text," +
        "  resource text, notes text" +
        ")"
    );

    /*
        Every form that points at a help link, with who owns the link.
        Soft-deleted forms are included: the column is going either way,
        and a form restored later should not come back pointing at one
        that is no longer there.
    */
    const SQL_FILL = (
        "INSERT INTO \"" + CARRY + "\" " +
        "SELECT f.name, h.id, coalesce(h.module, ''), h.label, h.icon," +
        "  h.resource, h.notes " +
        "FROM form f JOIN help_link h " +
        "  ON h._pk = f._help_link_help_link_pk " +
        "WHERE NOT h.is_deleted ORDER BY f.name"
    );

    const SQL_CARRIED = (
        "SELECT form, id, label, icon, resource, notes FROM \"" + CARRY +
        "\" WHERE coalesce(module, '') = '' ORDER BY form"
    );

    // A form that already has a supplement has been moved already
    const SQL_MOVED = (
        "SELECT 1 FROM help_link " +
        "WHERE form = $1 AND coalesce(module, '') = '' AND NOT is_deleted"
    );

    /*
        A string property installs with '' for its default, so "no form"
        is an empty one as often as a null.
    */
    const SQL_CLAIM = (
        "UPDATE help_link SET form = $2, updated = now()," +
        "  updated_by = 'install' " +
        "WHERE id = $1 AND coalesce(form, '') = ''"
    );

    /*
        A link two forms shared becomes one supplement each: a supplement
        answers for a form, and the two forms are the point of keeping
        help per form at all.
    */
    const SQL_COPY = (
        "INSERT INTO help_link (" +
        "  _pk, id, created, created_by, updated, updated_by, is_deleted," +
        "  owner, etag, module, form, label, icon, resource, notes," +
        "  display_value" +
        ") VALUES (" +
        "  nextval('object__pk_seq'), $1, now(), 'install', now()," +
        "  'install', false, 'install', $1, '', $2, $3, $4, $5, $6, $7" +
        ")"
    );

    /*
        Removed, not marked deleted. A deleted row keeps its id, the
        unique index on id covers deleted rows, and the next deploy of
        a package that still carries the link could then neither insert
        it nor see it.
    */
    const SQL_CLEAR = (
        "DELETE FROM help_link WHERE coalesce(module, '') <> ''"
    );

    const SQL_UNSUBSCRIBE = (
        "DELETE FROM \"$subscription\" WHERE objectid IN (" +
        "  SELECT id FROM help_link WHERE coalesce(module, '') <> ''" +
        ")"
    );

    exports.execute = function (obj) {
        const client = obj.client;

        async function has(table) {
            let resp = await client.query(SQL_TABLE, [table]);

            return resp.rows[0].held;
        }

        async function hasColumn(table, column) {
            let resp = await client.query(SQL_COLUMN, [table, column]);

            return resp.rows.length > 0;
        }

        /*
            A worksheet's saved copy of a help record, wherever a
            configuration was saved. The shape is the same in all three
            places: an array of sheets, each of which may carry one.
        */
        function strip(config) {
            let changed = false;

            if (!Array.isArray(config)) {
                return false;
            }
            config.forEach(function (sheet) {
                if (sheet && sheet.helpLink !== undefined) {
                    delete sheet.helpLink;
                    changed = true;
                }
            });

            return changed;
        }

        async function stripWorkbooks() {
            let resp = await client.query(
                "SELECT _pk, default_config, local_config FROM \"$workbook\""
            );
            let n = 0;
            let i = 0;

            while (i < resp.rows.length) {
                let row = resp.rows[i];
                let one = strip(row.default_config);
                let two = strip(row.local_config);

                i += 1;

                if (one || two) {
                    n += 1;
                    await client.query(
                        "UPDATE \"$workbook\" SET default_config = $2," +
                        "  local_config = $3 WHERE _pk = $1",
                        [
                            row._pk,
                            JSON.stringify(row.default_config),
                            JSON.stringify(row.local_config)
                        ]
                    );
                }
            }

            return n;
        }

        async function stripProfiles() {
            let resp = await client.query(
                "SELECT role, data FROM \"$profiles\""
            );
            let n = 0;
            let i = 0;

            while (i < resp.rows.length) {
                let row = resp.rows[i];
                let data = row.data || {};
                let changed = false;

                i += 1;
                Object.keys(data).forEach(function (key) {
                    let book = data[key];

                    if (book && strip(book.sheets || book)) {
                        changed = true;
                    }
                });

                if (changed) {
                    n += 1;
                    await client.query(
                        "UPDATE \"$profiles\" SET data = $2 WHERE role = $1",
                        [row.role, JSON.stringify(data)]
                    );
                }
            }

            return n;
        }

        // Before the feathers: read the old column while it is there
        async function park() {
            await client.query("DROP TABLE IF EXISTS \"" + CARRY + "\"");
            await client.query(SQL_CARRY);
            await client.query(SQL_FILL);

            let resp = await client.query(
                "SELECT count(*)::int AS n," +
                "  count(nullif(module, ''))::int AS theirs FROM \"" +
                CARRY + "\""
            );
            let counted = resp.rows[0];
            let books = await stripWorkbooks();
            let profiles = await stripProfiles();
            let said = [];

            if (counted.theirs) {
                said.push(
                    counted.theirs + " form reference(s) to a module's " +
                    "own help dropped, which its help folder answers " +
                    "for now"
                );
            }
            if (books || profiles) {
                said.push(
                    "help removed from " + books + " workbook " +
                    "configuration(s) and " + profiles + " profile(s)"
                );
            }
            if (said.length) {
                console.log(
                    "Help travels with its module now: " +
                    said.join("; ") + "."
                );
            }
        }

        // After the feathers: write what the first pass parked
        async function apply() {
            let resp = await client.query(SQL_CARRIED);
            let claimed = {};
            let kept = 0;
            let i = 0;

            while (i < resp.rows.length) {
                let row = resp.rows[i];
                let already = await client.query(SQL_MOVED, [row.form]);

                i += 1;

                if (already.rows.length) {
                    // Moved by an earlier upgrade
                    claimed[row.id] = true;
                } else if (claimed[row.id]) {
                    kept += 1;
                    await client.query(SQL_COPY, [
                        row.id + "-" + row.form.toLowerCase().replace(
                            /[^a-z0-9]+/g,
                            "-"
                        ),
                        row.form,
                        row.label,
                        row.icon,
                        row.resource,
                        row.notes,
                        (row.label || row.resource) + " (" + row.form + ")"
                    ]);
                } else {
                    kept += 1;
                    claimed[row.id] = true;
                    await client.query(SQL_CLAIM, [row.id, row.form]);
                }
            }

            await client.query("DROP TABLE IF EXISTS \"" + CARRY + "\"");

            if (kept) {
                console.log(
                    kept + " help link(s) kept as a customer supplement " +
                    "to the form that used one."
                );
            }
        }

        // Every vendor link, whoever shipped it and whenever
        async function clear() {
            await client.query(SQL_UNSUBSCRIBE);

            let gone = await client.query(SQL_CLEAR);

            if (gone.rowCount) {
                console.log(
                    gone.rowCount + " help link(s) belonging to a module " +
                    "cleared: help travels with the module now, and the " +
                    "Help Files worksheet is the customer's own."
                );
            }
        }

        async function run() {
            if (!await has("help_link")) {
                return;
            }

            let old = (
                await has("form") &&
                await hasColumn("form", "_help_link_help_link_pk")
            );

            if (old) {
                await park();
            } else if (await has(CARRY)) {
                await apply();
            }

            await clear();
        }

        return run();
    };

}(exports));
