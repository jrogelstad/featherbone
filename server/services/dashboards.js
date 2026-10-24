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
/*jslint node*/
/**
    @module Dashboards
*/
(function (exports) {
    "use strict";

    const {Tools} = require("./tools");
    const f = require("../../common/core");

    const tools = new Tools();

    /*
        A layout is one JSON document, handled whole. It is shaped like a
        workbook rather than made a feather for the reason workbooks were:
        the structure is deep and gets deeper as tile types arrive with
        their own options and their own editing, and nobody is ever going
        to maintain one as rows in a table (John, Oct 2026).

        This table holds the layouts that are SHARED -- shipped by a
        package, or saved by somebody for everyone to use. Whichever
        layout a given person has chosen, and any private adjustments to
        it, belong in `$profiles` beside their workbook column widths,
        so that one person rearranging their board does not rearrange
        everybody's.
    */
    const COLUMNS = (
        "id, name, label, description, module, sequence, " +
        "is_default AS \"isDefault\", config, " +
        "created_by AS \"createdBy\""
    );

    /**
        Dashboard layouts: the arrangement of tiles on the Home tab.

        @class Dashboards
        @constructor
        @namespace Services
    */
    exports.Dashboards = function () {
        let that = {};

        /**
            Resolves to every layout, in presentation order.

            Layouts are readable by everyone on the instance. They
            describe an arrangement, not data: what a tile is allowed to
            show is settled when the tile loads, against the viewer's own
            permissions, so a layout naming a measure somebody may not see
            yields an empty tile rather than a leak.

            @method getDashboards
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @return {Promise}
        */
        that.getDashboards = async function (obj) {
            let sql = (
                "SELECT " + COLUMNS + " FROM \"$dashboard\" " +
                "WHERE NOT is_deleted " +
                "ORDER BY sequence, name;"
            );
            let resp = await obj.client.query(sql);

            return resp.rows;
        };

        /**
            Resolves to one layout by name, or false where there is none.

            @method getDashboard
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {Object} payload.data Request data
            @param {String} payload.data.name Layout name
            @return {Promise}
        */
        that.getDashboard = async function (obj) {
            let data = obj.data || {};
            let name = data.name;
            let sql = (
                "SELECT " + COLUMNS + " FROM \"$dashboard\" " +
                "WHERE name = $1 AND NOT is_deleted;"
            );
            let resp = await obj.client.query(sql, [name]);

            if (!resp.rows.length) {
                return false;
            }
            return resp.rows[0];
        };

        /**
            Creates or replaces a layout, keyed on its name.

            Anyone may create one: a layout is somebody's own arrangement
            offered to the rest of the instance, and needing an
            administrator to publish one would mean nobody ever did.
            Changing or removing one is held to its author or a super
            user, so a shared layout cannot be quietly rewritten under the
            people using it.

            @method saveDashboard
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {String} payload.user User name
            @param {Object} payload.data Layout
            @return {Promise}
        */
        that.saveDashboard = async function (obj) {
            let spec = obj.data || {};
            let theClient = obj.client;
            let name = spec.name;
            let user = theClient.currentUser();
            let found;
            let isSuper;
            let err;
            let sql;

            if (!name) {
                err = new Error("Layout requires a name.");
                err.statusCode = 400;
                throw err;
            }

            found = await that.getDashboard({
                client: theClient,
                data: {name}
            });

            if (found) {
                isSuper = await tools.isSuperUser({
                    client: theClient,
                    user: obj.user
                });

                if (found.createdBy !== user && !isSuper) {
                    err = new Error(
                        "Layout \"" + name + "\" belongs to " +
                        found.createdBy + ". Save it under another name " +
                        "to keep your own version."
                    );
                    err.statusCode = 401;
                    throw err;
                }

                sql = (
                    "UPDATE \"$dashboard\" SET " +
                    "updated_by = $2, updated = now(), " +
                    "label = $3, description = $4, module = $5, " +
                    "sequence = $6, is_default = $7, config = $8 " +
                    "WHERE name = $1;"
                );
                await theClient.query(sql, [
                    name,
                    user,
                    spec.label || found.label,
                    spec.description || found.description,
                    spec.module || found.module,
                    spec.sequence || found.sequence || 0,
                    Boolean(spec.isDefault),
                    JSON.stringify(spec.config || found.config || {})
                ]);

                if (spec.isDefault) {
                    await that.clearOtherDefaults({
                        client: theClient,
                        data: {name}
                    });
                }
                return found.id;
            }

            sql = (
                "INSERT INTO \"$dashboard\" (" +
                "_pk, id, name, label, description, module, sequence, " +
                "is_default, config, created_by, updated_by, " +
                "created, updated, is_deleted) " +
                "VALUES (nextval('object__pk_seq'), " +
                "$1, $2, $3, $4, $5, $6, $7, $8, $9, $9, " +
                "now(), now(), false);"
            );
            spec.id = f.createId();
            await theClient.query(sql, [
                spec.id,
                name,
                spec.label || name,
                spec.description || "",
                spec.module || "",
                spec.sequence || 0,
                Boolean(spec.isDefault),
                JSON.stringify(spec.config || {}),
                user
            ]);

            if (spec.isDefault) {
                await that.clearOtherDefaults({
                    client: theClient,
                    data: {name}
                });
            }
            return spec.id;
        };

        /**
            Leaves exactly one layout flagged as the default.

            Two defaults is not a state anybody can resolve by looking at
            the board, so the flag is treated as a switch rather than a
            property: setting it on one layout takes it off the rest.

            @method clearOtherDefaults
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {Object} payload.data Request data
            @param {String} payload.data.name The layout keeping the flag
            @return {Promise}
        */
        that.clearOtherDefaults = async function (obj) {
            let data = obj.data || {};
            let sql = (
                "UPDATE \"$dashboard\" SET is_default = false " +
                "WHERE name <> $1 AND is_default;"
            );

            await obj.client.query(sql, [data.name]);
        };

        /**
            Removes a layout. Its author or a super user only.

            @method deleteDashboard
            @param {Object} payload Request payload
            @param {Client} payload.client Database client
            @param {String} payload.user User name
            @param {Object} payload.data Request data
            @param {String} payload.data.name Layout name
            @return {Promise}
        */
        that.deleteDashboard = async function (obj) {
            let theClient = obj.client;
            let data = obj.data || {};
            let name = data.name;
            let user = theClient.currentUser();
            let found = await that.getDashboard({
                client: theClient,
                data: {name}
            });
            let isSuper;
            let err;

            if (!found) {
                return false;
            }

            isSuper = await tools.isSuperUser({
                client: theClient,
                user: obj.user
            });

            if (found.createdBy !== user && !isSuper) {
                err = new Error(
                    "Layout \"" + name + "\" belongs to " +
                    found.createdBy + "."
                );
                err.statusCode = 401;
                throw err;
            }

            await theClient.query(
                "UPDATE \"$dashboard\" SET is_deleted = true, " +
                "updated_by = $2, updated = now() WHERE name = $1;",
                [name, user]
            );

            return true;
        };

        return that;
    };

}(exports));
