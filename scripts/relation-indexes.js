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
    Index every relation column (improvement items 3.1 and 3.4).

    Relation columns (_<property>_<relation>_pk) are what the generated
    views run their correlated subqueries against -- the child side of
    every to-many lookup is one -- and they carried no index at all, so
    every list page scanned each child table once per parent row.

    feathers.js now builds these indexes whenever a feather is saved, but
    only for feathers an install actually saves. This pass sweeps the
    whole database instead: every relation column of every table gets an
    index, including tables whose feathers are managed elsewhere (for
    example manager feathers left behind in a converted instance) and
    databases installed long before this change. Idempotent, so an
    upgrade re-runs it harmlessly.
*/
(function (exports) {
    "use strict";

    exports.execute = async function (obj) {
        let resp = await obj.client.query(
            "SELECT c.table_name AS tbl, c.column_name AS col " +
            "FROM information_schema.columns c " +
            "  JOIN pg_tables t ON t.tablename = c.table_name " +
            "    AND t.schemaname = c.table_schema " +
            "WHERE c.table_schema = 'public' " +
            "  AND c.column_name LIKE '\\_%\\_pk' " +
            "  AND c.column_name <> '_pk' " +
            "ORDER BY c.table_name, c.column_name"
        );
        let i = 0;

        while (i < resp.rows.length) {
            let row = resp.rows[i];
            let name = row.tbl + "_index" + row.col;

            i += 1;
            // Identifiers are server-validated names from the catalog,
            // quoted here all the same
            await obj.client.query(
                "CREATE INDEX IF NOT EXISTS \"" + name + "\" ON \"" +
                row.tbl + "\" (\"" + row.col + "\")"
            );
        }
    };
}(exports));
