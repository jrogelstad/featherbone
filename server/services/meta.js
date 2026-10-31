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
    // Who a format is for: everyone who can read the record, or its author
    const WHOS = ["all", "mine"];
    // Where it applies: one place, or wherever the record appears
    const EVERYWHERE = "*";
    /*
        A place is the host's own name for where a list appears -- a
        worksheet id, a form id and its child property. Opaque here, so
        only its shape is checked.
    */
    const PLACE = /^[A-Za-z][\w.:\/\-]{0,199}$/;

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

    /*
        The format entries on one target. A record written before
        formats had a who and a where holds a single object where this
        wants a list, and that object meant everyone, everywhere -- so
        that is what it is read as, which saves migrating anything.
    */
    function entriesOf(held) {
        if (Array.isArray(held)) {
            return held.slice();
        }
        if (held && typeof held === "object") {
            return [Object.assign({}, held, {
                where: EVERYWHERE,
                who: "all"
            })];
        }
        return [];
    }

    /*
        Whether an entry is the one a write addresses. A shared format
        is the target's single `all` entry for that place; a private one
        belongs to the caller, so nobody writes over anyone else's.
    */
    function isSlot(entry, who, where, user) {
        return (
            entry.who === who &&
            entry.where === where &&
            (who === "all" || entry.by === user)
        );
    }

    function prune(meta) {
        let format = meta.format || {};

        if (Array.isArray(format.row) && !format.row.length) {
            delete format.row;
        }
        if (format.cells) {
            Object.keys(format.cells).forEach(function (key) {
                let held = format.cells[key];

                if (Array.isArray(held) && !held.length) {
                    delete format.cells[key];
                }
            });
        }

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
            @param {String} [payload.data.who] `all` for everyone who can
            read the record, or `mine` for the caller alone. Default
            `all`, which is what an omitted who meant before formats had
            one.
            @param {String} [payload.data.where] The place a format
            applies in, as the client names it, or `*` for wherever the
            record appears. Default `*`.
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
            let who = data.who || "all";
            let where = data.where || EVERYWHERE;
            let needs;
            let entries;
            let held;
            let idx;
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

            if (isFormat) {
                if (!WHOS.includes(who)) {
                    throw bad("Unknown who \"" + who + "\"");
                }
                if (where !== EVERYWHERE && !PLACE.test(String(where))) {
                    throw bad("Invalid place \"" + where + "\"");
                }
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

            /*
                A format for everyone changes what everyone reads, so it
                needs update rights, as a note does. A format for
                oneself is a view preference, and being able to see the
                record is enough for one: otherwise a user with
                read-only access to a list could not mark it up for
                their own eyes (John, Oct 2026).
            */
            needs = (
                (isFormat && who === "mine")
                ? "canRead"
                : "canUpdate"
            );

            if (
                isSuperUser !== true &&
                !await feathers.isAuthorized({
                    client,
                    data: {
                        id: data.id,
                        action: needs
                    }
                })
            ) {
                err = new Error(
                    "Not authorized to " + (
                        needs === "canRead"
                        ? "read"
                        : "update"
                    ) + " \"" + data.id + "\""
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
                meta.format = meta.format || {};
                if (isRow) {
                    held = meta.format.row;
                } else {
                    meta.format.cells = meta.format.cells || {};
                    held = meta.format.cells[attr];
                }

                /*
                    One entry per who and place, and per author for a
                    private one. The write replaces its own entry and
                    leaves every other alone, so clearing your own
                    colour cannot take a colleague's with it.
                */
                entries = entriesOf(held);
                idx = entries.findIndex(
                    (entry) => isSlot(entry, who, where, user)
                );
                if (idx !== -1) {
                    entries.splice(idx, 1);
                }
                if (format) {
                    format.who = who;
                    format.where = where;
                    format.by = user;
                    format.at = now;
                    entries.push(format);
                }

                if (isRow) {
                    if (entries.length) {
                        meta.format.row = entries;
                    } else {
                        delete meta.format.row;
                    }
                } else if (entries.length) {
                    meta.format.cells[attr] = entries;
                } else {
                    delete meta.format.cells[attr];
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
                throw bad("Too many notes and formats on this record");
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
