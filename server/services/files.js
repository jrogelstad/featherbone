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
/**
    Uploaded files, kept in each instance's `"$file"` table so they
    survive a deploy and travel with the instance's backups.

    @module Files
*/
(function (exports) {
    "use strict";

    const crypto = require("crypto");
    const path = require("path");

    // Shown in the browser; anything else is offered as a download
    const INLINE = [
        ".gif", ".jpeg", ".jpg", ".pdf", ".png", ".webp"
    ];

    // An instance not yet upgraded has no table: hold nothing
    const NO_TABLE = "42P01";

    function absent(err) {
        if (err.code === NO_TABLE) {
            return {rows: []};
        }
        throw err;
    }

    exports.Files = function () {
        let that = {};

        /**
            Store a file under its name.

            @method put
            @param {Object} db Pool or client of the instance
            @param {String} name
            @param {Buffer} data
            @param {String} user Uploader
            @param {Boolean} [overwrite] Replace one of that name
            @return {Promise} "success", or "exists" when refused
        */
        that.put = async function (db, name, data, user, overwrite) {
            let resp = await db.query(
                "INSERT INTO \"$file\" " +
                "(name, size, sha256, created_by, data) " +
                "VALUES ($1, $2, $3, $4, $5) " +
                "ON CONFLICT (name) " + (
                    overwrite
                    ? "DO UPDATE SET size = EXCLUDED.size, " +
                    "sha256 = EXCLUDED.sha256, created = now(), " +
                    "created_by = EXCLUDED.created_by, " +
                    "data = EXCLUDED.data "
                    : "DO NOTHING "
                ) + "RETURNING name",
                [
                    name,
                    data.length,
                    crypto.createHash("sha256").update(data).digest("hex"),
                    user,
                    data
                ]
            );

            return (
                resp.rows.length
                ? "success"
                : "exists"
            );
        };

        /**
            What is held under a name, without the bytes.

            @method info
            @param {Object} db Pool or client of the instance
            @param {String} name
            @return {Promise} {size, sha256}, or undefined
        */
        that.info = async function (db, name) {
            let resp = await db.query(
                "SELECT size, sha256 FROM \"$file\" WHERE name = $1",
                [name]
            ).catch(absent);

            return resp.rows[0];
        };

        /**
            The bytes held under a name.

            @method data
            @param {Object} db Pool or client of the instance
            @param {String} name
            @return {Promise} Buffer, or undefined
        */
        that.data = async function (db, name) {
            let resp = await db.query(
                "SELECT data FROM \"$file\" WHERE name = $1",
                [name]
            ).catch(absent);

            return (
                resp.rows.length
                ? resp.rows[0].data
                : undefined
            );
        };

        /**
            Whether a file may be shown in the browser: images and PDFs.
            Anything else (a page, a script) is downloaded, never run
            from this origin.

            @method isInline
            @param {String} name
            @return {Boolean}
        */
        that.isInline = function (name) {
            let suffix = path.extname(name);

            return INLINE.includes(suffix.toLowerCase());
        };

        return that;
    };

}(exports));
