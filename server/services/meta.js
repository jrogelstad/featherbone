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
    @module Meta
*/
(function (exports) {
    "use strict";

    const {Feathers} = require("./feathers");
    const f = require("../../common/core");
    const sanitizeHtml = require("sanitize-html");

    const feathers = new Feathers();

    // Named colors the client draws differently in light and dark mode
    const SWATCHES = [
        "red",
        "orange",
        "yellow",
        "green",
        "teal",
        "blue",
        "purple",
        "gray"
    ];
    const ATTR = /^[A-Za-z$][\w$]*(\.[A-Za-z$][\w$]*)*$/;
    const ACTIONS = ["format", "clearFormat", "note", "clearNote"];
    const TABLE = /^[a-z][a-z0-9_]*$/;
    const MAX_NOTE = 20000;
    const MAX_META = 200000;

    // What a note may contain once saved
    const NOTE_HTML = {
        allowedTags: [
            "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s",
            "strike", "sub", "sup", "ul", "ol", "li", "blockquote", "pre",
            "code", "a", "h1", "h2", "h3", "h4"
        ],
        allowedAttributes: {
            a: ["href", "target", "rel"]
        },
        allowedSchemes: ["http", "https", "mailto"],
        transformTags: {
            a: sanitizeHtml.simpleTransform("a", {
                target: "_blank",
                rel: "noopener noreferrer"
            })
        }
    };

    function bad(msg) {
        let err = new Error(msg);

        err.statusCode = 400;
        return err;
    }

    function isColor(value) {
        return (
            typeof value === "string" && (
                /^#[0-9a-fA-F]{6}$/.test(value) ||
                SWATCHES.includes(value)
            )
        );
    }

    // A clean format, or undefined when nothing is set
    function cleanFormat(format) {
        let ret = {};

        format = format || {};

        ["background", "color"].forEach(function (key) {
            if (format[key] === undefined || format[key] === null) {
                return;
            }
            if (!isColor(format[key])) {
                throw bad("Invalid color \"" + format[key] + "\"");
            }
            ret[key] = format[key];
        });

        ["bold", "italic", "underline"].forEach(function (key) {
            if (format[key] === true) {
                ret[key] = true;
            }
        });

        if (!Object.keys(ret).length) {
            return undefined;
        }

        return ret;
    }

    function prune(meta) {
        let format = meta.format || {};

        if (format.cells && !Object.keys(format.cells).length) {
            delete format.cells;
        }
        if (!Object.keys(format).length) {
            delete meta.format;
        }
        if (meta.notes && !Object.keys(meta.notes).length) {
            delete meta.notes;
        }

        return (
            Object.keys(meta).length
            ? meta
            : null
        );
    }

    /**
        Formats and notes users put on rows and cells of a list. Kept in
        the record's `meta` column and written only here, so annotating
        a record is not editing it: no `updated` stamp, no feather
        triggers, no lock.

        @class Meta
        @constructor
        @namespace Services
    */
    exports.Meta = function () {
        let that = {};

        /**
            Change one format or the current user's note on a record.
            Needs update authorization on the record. A user can only
            write or clear their own note.

            @method saveMeta
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data
            @param {String} payload.data.id Record id
            @param {String} payload.data.action `format`, `clearFormat`,
            `note` or `clearNote`
            @param {String} [payload.data.target] `row` or `cell`, for
            formats
            @param {String} [payload.data.attr] Column the cell is in
            @param {Object} [payload.data.format] background, color, bold,
            italic, underline
            @param {String} [payload.data.html] Note text
            @param {Boolean} [isChild]
            @param {Boolean} [isSuperUser]
            @return {Promise} Resolves to the record's new meta
        */
        that.saveMeta = async function (obj, ignore, isSuperUser) {
            let client = obj.client;
            let data = obj.data || {};
            let user = client.currentUser();
            let now = new Date().toJSON();
            let action = data.action;
            let attr = data.attr;
            let isRow = data.target === "row";
            let isFormat = action === "format" || action === "clearFormat";
            let resp;
            let table;
            let feather;
            let meta;
            let format;
            let notes;
            let mine;
            let html;
            let sql;
            let err;

            if (typeof data.id !== "string" || !data.id) {
                throw bad("Record id is required");
            }

            if (!ACTIONS.includes(action)) {
                throw bad("Unknown action \"" + action + "\"");
            }

            if (
                !(isFormat && isRow) && (
                    typeof attr !== "string" ||
                    attr.length > 200 ||
                    !ATTR.test(attr)
                )
            ) {
                throw bad("Invalid column \"" + attr + "\"");
            }

            resp = await client.query((
                "SELECT tableoid::regclass::text AS t FROM object " +
                "WHERE id = $1 AND NOT is_deleted;"
            ), [data.id]);

            if (!resp.rows.length) {
                err = new Error("Record \"" + data.id + "\" not found");
                err.statusCode = 404;
                throw err;
            }

            table = resp.rows[0].t;
            if (!TABLE.test(table)) {
                throw bad("Records of this kind take no notes or formats");
            }

            feather = await feathers.getFeather({
                client,
                data: {name: table.toCamelCase(true)}
            });

            if (!feather || feather.isView || !feather.properties.meta) {
                throw bad("Records of this kind take no notes or formats");
            }

            if (attr && !feather.properties[attr.split(".")[0]]) {
                throw bad(
                    "Feather \"" + feather.name + "\" has no property \"" +
                    attr + "\""
                );
            }

            if (
                isSuperUser !== true &&
                !await feathers.isAuthorized({
                    client,
                    data: {
                        id: data.id,
                        action: "canUpdate"
                    }
                })
            ) {
                err = new Error(
                    "Not authorized to update \"" + data.id + "\""
                );
                err.statusCode = 401;
                throw err;
            }

            sql = "SELECT meta FROM %I WHERE id = $1 FOR UPDATE;";
            resp = await client.query(sql.format([table]), [data.id]);
            meta = resp.rows[0].meta || {};

            switch (action) {
            case "format":
            case "clearFormat":
                format = (
                    action === "format"
                    ? cleanFormat(data.format)
                    : undefined
                );
                if (format) {
                    format.by = user;
                    format.at = now;
                }
                meta.format = meta.format || {};
                if (isRow) {
                    if (format) {
                        meta.format.row = format;
                    } else {
                        delete meta.format.row;
                    }
                } else {
                    meta.format.cells = meta.format.cells || {};
                    if (format) {
                        meta.format.cells[attr] = format;
                    } else {
                        delete meta.format.cells[attr];
                    }
                }
                break;
            default:
                html = (
                    action === "note"
                    ? sanitizeHtml(String(data.html || ""), NOTE_HTML).trim()
                    : ""
                );
                if (html.length > MAX_NOTE) {
                    throw bad("Note is too long");
                }
                // A note with no text left in it is a cleared note
                if (!sanitizeHtml(html, {
                    allowedTags: [],
                    allowedAttributes: {}
                }).trim()) {
                    html = "";
                }

                meta.notes = meta.notes || {};
                notes = meta.notes[attr] || [];
                mine = notes.find((note) => note.by === user);

                if (html) {
                    if (mine) {
                        mine.html = html;
                        mine.updated = now;
                    } else {
                        notes.push({
                            id: f.createId(),
                            html,
                            by: user,
                            at: now
                        });
                    }
                } else if (mine) {
                    notes.splice(notes.indexOf(mine), 1);
                }

                if (notes.length) {
                    meta.notes[attr] = notes;
                } else {
                    delete meta.notes[attr];
                }
            }

            meta = prune(meta);
            if (meta && JSON.stringify(meta).length > MAX_META) {
                throw bad("Too many notes on this record");
            }

            sql = "UPDATE %I SET meta = $2 WHERE id = $1;";
            await client.query(sql.format([table]), [
                data.id,
                (
                    meta
                    ? JSON.stringify(meta)
                    : null
                )
            ]);

            return meta;
        };

        return that;
    };

}(exports));
