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
    Navigation categories -- the ribbon's category tabs (see
    client/components/ribbon.js), which used to be a hard-coded table in
    that file and are now rows the user maintains (John, Oct 2026).

    A category's `name` is its natural key: it is what package exports
    and imports reference, so a package carries no ids and can't be
    broken by ids differing between databases (see packager.js and
    installer.js). Workbooks point at a category by ID, though, so
    renaming one keeps its workbooks attached.

    @module NavigationCategories
*/
(function (exports) {
    "use strict";

    const {Tools} = require("./tools");
    const f = require("../../common/core");

    const tools = new Tools();

    /**
        @class NavigationCategories
        @constructor
        @namespace Services
    */
    exports.NavigationCategories = function () {
        // ..........................................................
        // PRIVATE
        //

        let that = {};

        function requireSuperUser(client, user) {
            return tools.isSuperUser({
                client,
                user
            }).then(function (isSuper) {
                let err;

                if (!isSuper) {
                    err = new Error(
                        "Only super users may maintain navigation categories."
                    );
                    err.statusCode = 401;
                    throw err;
                }

                return true;
            });
        }

        // ..........................................................
        // PUBLIC
        //

        /**
            Resolve to all navigation categories, in presentation order.

            Each one carries `workbookCount`, the number of workbooks
            currently filed under it, so the maintenance dialog can
            refuse to remove a category that is still in use without
            having to work that out for itself.

            @method getNavigationCategories
            @param {Object} payload Request payload
            @param {Object} [payload.client] Database client
            @return {Promise}
        */
        that.getNavigationCategories = function (obj) {
            return new Promise(function (resolve, reject) {
                let theClient = obj.client;
                let sql = (
                    "SELECT category.id, category.name, category.icon, " +
                    "category.sequence, " +
                    "(SELECT count(*) FROM \"$workbook\" AS workbook " +
                    "  WHERE workbook.category = category.id " +
                    "    AND NOT workbook.is_deleted) AS \"workbookCount\" " +
                    "FROM \"$navigation_category\" AS category " +
                    "WHERE NOT category.is_deleted " +
                    "ORDER BY category.sequence, category.name;"
                );

                theClient.query(sql, function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // count() comes back from pg as a string.
                    resp.rows.forEach(function (row) {
                        row.workbookCount = Number(row.workbookCount);
                    });

                    resolve(resp.rows);
                });
            });
        };

        /**
            Save the whole set of navigation categories at once.

            The payload is the complete list as it should end up, the
            same shape `saveWorkbook` takes: categories with an `id`
            that already exists are updated, ones without are inserted,
            and any existing category missing from the list is removed.
            One request, one transaction -- so the maintenance dialog's
            `Ok` applies every add, rename and removal together and its
            `Cancel` genuinely changes nothing.

            Removing a category that workbooks are still filed under is
            refused; the error names them.

            @method saveNavigationCategories
            @param {Object} payload Request payload
            @param {String} [payload.user] User name
            @param {Object} [payload.data] Payload data
            @param {Array} [payload.data.specs] The complete category list
            @param {Object} [payload.client] Database client
            @return {Promise}
        */
        that.saveNavigationCategories = function (obj) {
            return new Promise(function (resolve, reject) {
                let theClient = obj.client;
                let specs = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );

                function findExisting() {
                    let sql = (
                        "SELECT id, name FROM \"$navigation_category\" " +
                        "WHERE NOT is_deleted;"
                    );

                    return theClient.query(sql);
                }

                function validate(existing) {
                    let names = [];
                    let err;

                    specs.forEach(function (spec) {
                        let name = spec.name || "";

                        name = name.trim();

                        if (!name) {
                            err = new Error("Category name is required.");
                            err.statusCode = 400;
                            throw err;
                        }

                        if (names.indexOf(name) !== -1) {
                            err = new Error(
                                "Category \"" + name + "\" is listed twice. " +
                                "Names must be unique."
                            );
                            err.statusCode = 400;
                            throw err;
                        }

                        names.push(name);
                        spec.name = name;
                    });

                    return existing;
                }

                /*
                    Anything that exists but isn't in the list the
                    client sent has been removed in the dialog.
                */
                function doomed(existing) {
                    let keep = specs.map((spec) => spec.id);

                    return existing.rows.filter(
                        (row) => keep.indexOf(row.id) === -1
                    );
                }

                function checkNotInUse(existing) {
                    let ids = doomed(existing).map((row) => row.id);
                    let sql;

                    if (!ids.length) {
                        return existing;
                    }

                    sql = (
                        "SELECT category.name AS category, " +
                        "  workbook.name AS workbook " +
                        "FROM \"$workbook\" AS workbook, " +
                        "  \"$navigation_category\" AS category " +
                        "WHERE workbook.category = category.id " +
                        "  AND workbook.category = ANY($1) " +
                        "  AND NOT workbook.is_deleted;"
                    );

                    return theClient.query(sql, [ids]).then(function (resp) {
                        let err;
                        let used;

                        if (resp.rows.length) {
                            used = resp.rows.map(function (row) {
                                return (
                                    row.category +
                                    " (" + row.workbook + ")"
                                );
                            }).join(", ");
                            err = new Error(
                                "Cannot remove a category a workbook is " +
                                "using: " + used + "."
                            );
                            err.statusCode = 400;
                            throw err;
                        }

                        return existing;
                    });
                }

                function upsert(existing) {
                    let ids = existing.rows.map((row) => row.id);
                    let requests = [];

                    specs.forEach(function (spec, idx) {
                        let sql;
                        let params;
                        let hasSequence = (
                            spec.sequence !== undefined &&
                            spec.sequence !== null &&
                            spec.sequence !== ""
                        );
                        let sequence = (
                            hasSequence
                            ? spec.sequence
                            : idx
                        );

                        if (spec.id && ids.indexOf(spec.id) !== -1) {
                            sql = (
                                "UPDATE \"$navigation_category\" SET " +
                                "name=$2, icon=$3, sequence=$4, " +
                                "updated=now(), updated_by=$5 " +
                                "WHERE id=$1;"
                            );
                            params = [
                                spec.id,
                                spec.name,
                                spec.icon || "",
                                sequence,
                                theClient.currentUser()
                            ];
                        } else {
                            sql = (
                                "INSERT INTO \"$navigation_category\" " +
                                "(_pk, id, name, icon, sequence, " +
                                "created, created_by, updated, updated_by, " +
                                "is_deleted) " +
                                "VALUES (nextval('object__pk_seq'), " +
                                "$1, $2, $3, $4, now(), $5, now(), $5, " +
                                "false);"
                            );
                            params = [
                                spec.id || f.createId(),
                                spec.name,
                                spec.icon || "",
                                sequence,
                                theClient.currentUser()
                            ];
                        }

                        requests.push(theClient.query(sql, params));
                    });

                    return Promise.all(requests).then(() => existing);
                }

                function remove(existing) {
                    let ids = doomed(existing).map((row) => row.id);
                    let sql = (
                        "DELETE FROM \"$navigation_category\" " +
                        "WHERE id = ANY($1);"
                    );

                    if (!ids.length) {
                        return true;
                    }

                    return theClient.query(sql, [ids]).then(() => true);
                }

                requireSuperUser(theClient, obj.user).then(
                    findExisting
                ).then(
                    validate
                ).then(
                    checkNotInUse
                ).then(
                    upsert
                ).then(
                    remove
                ).then(resolve).catch(reject);
            });
        };

        return that;
    };

}(exports));
