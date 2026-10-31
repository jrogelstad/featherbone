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
/*jslint this, browser, unordered*/
/*global f, m*/
/**
    Formats and notes users put on list rows and cells. They live in each
    record's `meta` and are written through `/do/meta`, never by a save.
    Shared with table-widget.js through the catalog ("global",
    "listMeta").

    @module ListMeta
*/

const tinymce = window.tinymce;

// Named colors; featherbone.css gives each a light and a dark shade
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

const NO_RIGHTS = "You need update permission on this record";
const NOT_SAVED = "Save the record first";
const NOT_HERE = "This list can't hold notes or formats";
const CHECKING = "Checking permission…";

// Tags and attributes a note may render with
const NOTE_TAGS = [
    "P", "BR", "DIV", "SPAN", "STRONG", "B", "EM", "I", "U", "S", "STRIKE",
    "SUB", "SUP", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "A", "H1",
    "H2", "H3", "H4"
];

const authorized = new WeakMap();

// A format that applies wherever the record appears, not in one place
const EVERYWHERE = "*";

// Where the format dialog keeps what it was last saved with
const CHOICES = "fb-format-choices";

/*
    What the user last saved a format with: which target, for whom,
    and in what scope. The dialog opens there next time, because a
    user who dislikes the defaults will tend to want the same
    alternative every time and should not have to click to it each
    time (John, Oct 2026). Kept per user and per browser -- it is a
    habit, not data, so it earns no server round trip. Anything
    unreadable or unrecognized is no habit at all.
*/
function recall() {
    let kept;
    let scopes = ["here", "everywhere"];
    let targets = ["cell", "row"];
    let whos = ["mine", "all"];

    try {
        kept = JSON.parse(window.localStorage.getItem(
            CHOICES + ":" + f.currentUser().name
        ));
    } catch (ignore) {
        return {};
    }
    kept = kept || {};

    return {
        scope: (
            scopes.includes(kept.scope)
            ? kept.scope
            : undefined
        ),
        target: (
            targets.includes(kept.target)
            ? kept.target
            : undefined
        ),
        who: (
            whos.includes(kept.who)
            ? kept.who
            : undefined
        )
    };
}

function remember(choices) {
    try {
        window.localStorage.setItem(
            CHOICES + ":" + f.currentUser().name,
            JSON.stringify(choices)
        );
    } catch (ignore) {
        return;
    }
}

function metaOf(model) {
    return (
        model.data.meta
        ? model.data.meta() || {}
        : {}
    );
}

function color(value, part) {
    if (!value) {
        return undefined;
    }
    if (SWATCHES.includes(value)) {
        return "var(--fb-swatch-" + value + "-" + part + ")";
    }
    return value;
}

/*
    CSS for one stored format. Only what the user set, so whatever they
    left alone still shows the business style beneath.
*/
function css(format) {
    let ret = {};

    if (!format) {
        return ret;
    }
    if (format.background) {
        ret.backgroundColor = color(format.background, "bg");
    }
    if (format.color) {
        ret.color = color(format.color, "fg");
    }
    if (format.bold) {
        ret.fontWeight = "bold";
    }
    if (format.italic) {
        ret.fontStyle = "italic";
    }
    if (format.underline) {
        ret.textDecoration = "underline";
    }

    return ret;
}

/*
    The format entries on one target. A record written before formats
    had a who and a where holds a single object where this wants a
    list, and that object meant everyone, everywhere -- so that is what
    it is read as, which saves migrating anything.
*/
function entriesOf(held) {
    if (Array.isArray(held)) {
        return held;
    }
    if (held && typeof held === "object") {
        return [Object.assign({}, held, {
            where: EVERYWHERE,
            who: "all"
        })];
    }
    return [];
}

function heldOn(model, attr) {
    let fmt = metaOf(model).format;

    if (!fmt) {
        return undefined;
    }
    return (
        attr
        ? fmt.cells && fmt.cells[attr]
        : fmt.row
    );
}

// Whether an entry is the one a given who and place addresses
function isSlot(entry, who, where) {
    return (
        entry.who === who &&
        entry.where === where &&
        (who === "all" || entry.by === f.currentUser().name)
    );
}

/*
    Which of a target's formats shows, by how specific it is: one of
    mine before everyone's, and one made here before one made
    everywhere. The winner is used whole rather than layered over the
    others, so a format of your own that sets only bold shows no part
    of the shared red beneath it (John, Oct 2026). Formats still layer
    across targets -- business style, then row, then cell -- which is
    where `css` leaving unset properties alone still matters.

    `place` is undefined wherever a list has no place of its own, and
    that drops the two rungs that name one.
*/
function winner(entries, place) {
    let rungs = [];

    if (place) {
        rungs.push({where: place, who: "mine"});
    }
    rungs.push({where: EVERYWHERE, who: "mine"});
    if (place) {
        rungs.push({where: place, who: "all"});
    }
    rungs.push({where: EVERYWHERE, who: "all"});

    return rungs.reduce(function (found, rung) {
        if (found) {
            return found;
        }
        return entries.find((e) => isSlot(e, rung.who, rung.where));
    }, undefined);
}

function rowFormat(model, place) {
    return winner(entriesOf(heldOn(model)), place);
}

function cellFormat(model, attr, place) {
    return winner(entriesOf(heldOn(model, attr)), place);
}

/*
    The format everyone is getting on this target, whether or not one
    of the user's own is hiding it. The dialog says so when it is.
*/
function sharedFormat(model, attr, place) {
    let entries = entriesOf(heldOn(model, attr)).filter(
        (e) => e.who === "all"
    );

    return winner(entries, place);
}

// The stored entry a given who and place addresses, for the dialog
function formatEntry(model, attr, who, where) {
    return entriesOf(heldOn(model, attr)).find(
        (e) => isSlot(e, who, where)
    );
}

function notesOf(model, attr) {
    let notes = metaOf(model).notes || {};

    return notes[attr] || [];
}

function myNote(model, attr) {
    let me = f.currentUser().name;

    return notesOf(model, attr).find((note) => note.by === me);
}

function hasNotes(model) {
    let notes = metaOf(model).notes || {};

    return Object.keys(notes).some((key) => notes[key].length);
}

// Defense in depth: the server already sanitized what it stored
function cleanHtml(html) {
    let doc = new window.DOMParser().parseFromString(
        "<div>" + (html || "") + "</div>",
        "text/html"
    );
    let root = doc.body.firstChild;

    function walk(node) {
        Array.from(node.childNodes).forEach(function (child) {
            let href;

            if (child.nodeType === 3) {
                return;
            }
            if (
                child.nodeType !== 1 ||
                !NOTE_TAGS.includes(child.tagName)
            ) {
                child.replaceWith(doc.createTextNode(child.textContent));
                return;
            }
            href = child.getAttribute("href");
            Array.from(child.attributes).forEach(function (attr) {
                child.removeAttribute(attr.name);
            });
            if (
                child.tagName === "A" && href &&
                (/^(https?:|mailto:)/i).test(href.trim())
            ) {
                child.setAttribute("href", href.trim());
                child.setAttribute("target", "_blank");
                child.setAttribute("rel", "noopener noreferrer");
            }
            walk(child);
        });
    }

    walk(root);
    return root.innerHTML;
}

function when(at) {
    return (
        at
        ? new Date(at).toLocaleString()
        : ""
    );
}

// How much larger than its CSS sizes the page is drawn (html zoom)
function pageScale() {
    let scale = parseFloat(
        window.getComputedStyle(document.documentElement).zoom
    );

    return (
        scale > 0
        ? scale
        : 1
    );
}

function isDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Whether the user may update the record, once the server has said
function canShare(model) {
    return authorized.get(model) === true;
}

/*
    Whether formats and notes can be written for the record at all, and
    if not why. Asks the server once per model, then redraws. Update
    permission is not asked of here: a format of one's own needs only
    to be able to read the record, so what update permission buys is
    settled by canShare -- the notes, and a format for everyone.
*/
function why(model, feather) {
    let state = model.state().current()[0];
    let ok = authorized.get(model);

    if (feather && feather.isView) {
        return NOT_HERE;
    }
    if (!model.data.meta) {
        return NOT_HERE;
    }
    if (state === "/Ready/New") {
        return NOT_SAVED;
    }
    if (ok === undefined) {
        authorized.set(model, null);
        f.catalog().isAuthorized({
            id: model.id(),
            action: "canUpdate"
        }).then(function (resp) {
            authorized.set(model, Boolean(resp));
            m.redraw();
        }).catch(function () {
            authorized.set(model, false);
            m.redraw();
        });
        return CHECKING;
    }
    if (ok === null) {
        return CHECKING;
    }
    return "";
}

function save(model, body, onError) {
    body.id = model.id();

    return f.datasource().request({
        method: "POST",
        path: "/do/meta",
        body
    }).then(function (resp) {
        model.setMeta(resp);
        m.redraw();
    }).catch(function (err) {
        if (onError) {
            onError(err);
        }
    });
}

function swatchRow(options) {
    let value = options.value();
    let items = [
        m("button", {
            type: "button",
            class: (
                "fb-swatch fb-swatch-none" + (
                    value
                    ? ""
                    : " fb-swatch-on"
                )
            ),
            title: options.noneTitle,
            onclick: () => options.value(undefined)
        }, "∅")
    ];

    SWATCHES.forEach(function (name) {
        let style = {};

        if (options.part === "bg") {
            style.backgroundColor = color(name, "bg");
        } else {
            style.color = color(name, "fg");
        }
        items.push(m("button", {
            type: "button",
            class: (
                "fb-swatch" + (
                    value === name
                    ? " fb-swatch-on"
                    : ""
                )
            ),
            title: name.toName(),
            style,
            onclick: () => options.value(name)
        }, (
            options.part === "bg"
            ? " "
            : "A"
        )));
    });

    items.push(m("label", {
        class: (
            "fb-swatch fb-swatch-custom" + (
                (value && value.slice(0, 1) === "#")
                ? " fb-swatch-on"
                : ""
            )
        ),
        title: "Pick any color"
    }, [
        m("input", {
            type: "color",
            value: (
                (value && value.slice(0, 1) === "#")
                ? value
                : "#000000"
            ),
            oninput: (e) => options.value(e.target.value)
        })
    ]));

    return m("div", {class: "fb-swatch-row"}, items);
}

/**
    Format dialog: apply to cell or row, background, text color, bold,
    italic, underline.

    @method formatDialog
    @param {Object} options
    @param {Function} options.onError Called with a failed save's error
    @return {ViewModels.Dialog}
*/
function formatDialog(options) {
    let dlg = f.createViewModel("Dialog", {
        icon: "platte",
        title: "Format"
    });
    let target = f.prop("row");
    let who = f.prop("all");
    let scope = f.prop("everywhere");
    let background = f.prop();
    let textColor = f.prop();
    let bold = f.prop(false);
    let italic = f.prop(false);
    let underline = f.prop(false);
    let model;
    let attr;
    let label;
    let place;
    let clear;

    // The column a cell format is on, or nothing for a row format
    function on() {
        return (
            target() === "row"
            ? undefined
            : attr
        );
    }

    // What the radios add up to, as the service names it
    function where() {
        return (
            scope() === "here"
            ? place
            : EVERYWHERE
        );
    }

    /*
        The dialog edits one entry at a time, so changing any of the
        three radios loads that entry: pick "Everyone" where a shared
        format is hiding behind yours and the editor fills with what
        everyone is getting, which is how you see it.
    */
    function load() {
        let fmt = formatEntry(model, on(), who(), where()) || {};

        background(fmt.background);
        textColor(fmt.color);
        bold(Boolean(fmt.bold));
        italic(Boolean(fmt.italic));
        underline(Boolean(fmt.underline));
    }

    /*
        The format everyone is getting on this target while one of the
        user's own hides it. Worth saying, because nothing else on
        screen gives it away.
    */
    function hidden() {
        let shared;

        if (who() !== "mine") {
            return undefined;
        }
        shared = sharedFormat(model, on(), place);
        if (!shared) {
            return undefined;
        }
        return (
            formatEntry(model, on(), "mine", where())
            ? shared
            : undefined
        );
    }

    function current() {
        return {
            background: background(),
            color: textColor(),
            bold: bold(),
            italic: italic(),
            underline: underline()
        };
    }

    function toggle(prop, text, title, style) {
        return m("button", {
            type: "button",
            class: (
                "pure-button fb-format-toggle" + (
                    prop()
                    ? " fb-format-toggle-on"
                    : ""
                )
            ),
            title,
            style,
            "aria-pressed": String(prop()),
            onclick: () => prop(!prop())
        }, text);
    }

    function choice(options) {
        let prop = options.prop;
        let value = options.value;

        return m("label", {
            class: "fb-format-target",
            title: options.title
        }, [
            m("input", {
                type: "radio",
                name: dlg.ids().dialog + "-" + options.group,
                checked: prop() === value,
                disabled: Boolean(options.disabled),
                onchange: function () {
                    prop(value);
                    load();
                }
            }),
            " " + options.text
        ]);
    }

    dlg.style({width: "460px"});
    dlg.isTitleLiteral(true);
    dlg.content = function () {
        if (dlg.state().current()[0] !== "/Display/Showing") {
            return m("div", {id: dlg.ids().content});
        }

        return m("div", {
            class: "fb-format-dialog",
            id: dlg.ids().content
        }, [
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Apply to"),
                choice({
                    group: "target",
                    prop: target,
                    text: "Cell “" + label + "”",
                    title: "Format this one cell",
                    value: "cell"
                }),
                choice({
                    group: "target",
                    prop: target,
                    text: "Whole row",
                    title: "Format every cell in this row",
                    value: "row"
                })
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Who"),
                choice({
                    group: "who",
                    prop: who,
                    text: "Just me",
                    title: "Only you see this format",
                    value: "mine"
                }),
                choice({
                    disabled: !canShare(model),
                    group: "who",
                    prop: who,
                    text: "Everyone",
                    title: (
                        canShare(model)
                        ? (
                            "Everyone who can see this record sees " +
                            "this format"
                        )
                        : (
                            "You need update permission on this " +
                            "record to format it for everyone"
                        )
                    ),
                    value: "all"
                }),
                (
                    hidden()
                    ? m("span", {
                        class: "fb-format-hidden-note",
                        title: (
                            "Choose Everyone to see the format they " +
                            "are getting"
                        )
                    }, "Everyone also has a format here")
                    : undefined
                )
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Where"),
                choice({
                    disabled: !place,
                    group: "scope",
                    prop: scope,
                    text: "Just here",
                    title: (
                        place
                        ? "Applies only in this list"
                        : (
                            "This list has no place of its own, so a " +
                            "format here applies wherever the record " +
                            "appears"
                        )
                    ),
                    value: "here"
                }),
                choice({
                    group: "scope",
                    prop: scope,
                    text: "Everywhere",
                    title: "Applies wherever this record appears",
                    value: "everywhere"
                })
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Background"),
                swatchRow({
                    value: background,
                    part: "bg",
                    noneTitle: "No background"
                })
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Text"),
                swatchRow({
                    value: textColor,
                    part: "fg",
                    noneTitle: "Default text color"
                })
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Style"),
                toggle(bold, "B", "Bold", {fontWeight: "bold"}),
                toggle(italic, "I", "Italic", {fontStyle: "italic"}),
                toggle(underline, "U", "Underline", {
                    textDecoration: "underline"
                })
            ]),
            m("div", {class: "fb-format-line"}, [
                m("span", {class: "fb-format-label"}, "Preview"),
                m("span", {
                    class: "fb-format-preview",
                    style: css(current())
                }, "Sample text 123")
            ])
        ]);
    };

    // Clears the one entry the three radios address, nobody else's
    clear = f.createViewModel("Button", {
        onclick: function () {
            save(model, {
                action: "clearFormat",
                target: target(),
                attr,
                who: who(),
                where: where()
            }, options.onError);
            dlg.cancel();
        },
        label: "Clear",
        title: "Remove this format",
        class: "fb-dialog-button"
    });
    dlg.buttons().unshift(f.prop(clear));

    dlg.onOk(function () {
        // Next time opens where this one was left
        remember({
            // A list with no place made no choice about one
            scope: (
                place
                ? scope()
                : recall().scope
            ),
            target: target(),
            who: who()
        });
        save(model, {
            action: "format",
            target: target(),
            attr,
            format: current(),
            who: who(),
            where: where()
        }, options.onError);
    });

    /**
        @method open
        @param {Object} pModel Row model
        @param {String} pAttr Column
        @param {String} pLabel Column label
        @param {String} [pPlace] What the host calls this list, for a
        format that is to apply here and nowhere else
    */
    dlg.open = function (pModel, pAttr, pLabel, pPlace) {
        let habit = recall();
        let showing;

        model = pModel;
        attr = pAttr;
        label = pLabel;
        place = pPlace;
        /*
            With nothing showing, the dialog opens on what the user
            last saved with, and on the most intuitive choice of all
            where there is no such habit: the whole row, for everyone,
            everywhere. A habit only counts for what is possible here:
            no format for everyone without update permission, none
            "just here" in a list with no place of its own.
        */
        who(
            (canShare(model) && habit.who !== "mine")
            ? "all"
            : "mine"
        );
        scope(
            (place && habit.scope === "here")
            ? "here"
            : "everywhere"
        );
        if (cellFormat(model, attr, place)) {
            target("cell");
        } else if (rowFormat(model, place)) {
            target("row");
        } else {
            target(habit.target || "row");
        }
        /*
            A format already showing is the one to edit, so the dialog
            opens on its who and where rather than on the habit --
            otherwise changing a shared format would mean noticing that
            the radios had quietly aimed somewhere else. Someone who
            cannot update the record is shown only a format of their
            own: a shared one is not theirs to edit.
        */
        showing = winner(entriesOf(heldOn(model, on())), place);
        if (showing && (canShare(model) || showing.who === "mine")) {
            who(showing.who);
            scope(
                showing.where === EVERYWHERE
                ? "everywhere"
                : "here"
            );
        }
        load();
        dlg.title("Format");
        dlg.show();
    };

    return dlg;
}

/**
    Note dialog: the current user's own note on a cell, in TinyMCE.

    @method noteDialog
    @param {Object} options
    @param {Function} options.onError Called with a failed save's error
    @return {ViewModels.Dialog}
*/
function noteDialog(options) {
    let dlg = f.createViewModel("Dialog", {
        icon: "comment",
        title: "Note"
    });
    // A selector TinyMCE can use: generated ids may start with a digit
    let editorId = "fb-note-" + f.createId();
    let html = "";
    let model;
    let attr;
    let clear;

    dlg.style({width: "560px"});
    dlg.isTitleLiteral(true);
    dlg.content = function () {
        let showing = dlg.state().current()[0] === "/Display/Showing";

        return m("div", {
            id: dlg.ids().content,
            class: "fb-note-dialog"
        }, (
            showing
            ? m("textarea", {
                id: editorId,
                key: editorId,
                oncreate: function (vnode) {
                    vnode.dom.value = html;
                    tinymce.init({
                        target: vnode.dom,
                        height: 260,
                        license_key: "gpl",
                        menubar: false,
                        statusbar: false,
                        plugins: "lists autolink",
                        toolbar: (
                            "bold italic underline strikethrough | " +
                            "bullist numlist | removeformat"
                        ),
                        skin: (
                            isDark()
                            ? "oxide-dark"
                            : "oxide"
                        ),
                        content_css: (
                            isDark()
                            ? "dark"
                            : "default"
                        ),
                        setup: function (editor) {
                            editor.on("init", () => editor.focus());
                        }
                    });
                },
                onremove: function () {
                    let editor = tinymce.get(editorId);

                    if (editor) {
                        editor.remove();
                    }
                }
            })
            : undefined
        ));
    };

    // Enabled by `open`, for a cell this user has a note on
    clear = f.createViewModel("Button", {
        onclick: function () {
            save(model, {
                action: "clearNote",
                attr
            }, options.onError);
            dlg.cancel();
        },
        label: "Clear",
        title: "You have no note on this cell",
        class: "fb-dialog-button"
    });
    clear.disable();
    dlg.buttons().unshift(f.prop(clear));

    dlg.onOk(function () {
        let editor = tinymce.get(editorId);
        let text = (
            editor
            ? editor.getContent()
            : html
        );

        save(model, {
            action: "note",
            attr,
            html: text
        }, options.onError);
    });

    dlg.state().resolve("/Display/Closed").enter(m.redraw);

    /**
        @method open
        @param {Object} pModel Row model
        @param {String} pAttr Column
        @param {String} pLabel Column label
    */
    dlg.open = function (pModel, pAttr, pLabel) {
        let mine = myNote(pModel, pAttr);

        model = pModel;
        attr = pAttr;
        html = (
            mine
            ? mine.html
            : ""
        );
        // Nothing to clear until there is a note of one's own, which
        // the menu used to say by disabling its own "Clear note"
        if (mine) {
            clear.enable();
            clear.title("Remove your note on this cell");
        } else {
            clear.disable();
            clear.title("You have no note on this cell");
        }
        dlg.title(
            (
                mine
                ? "Edit note on "
                : "Add note to "
            ) + "“" + pLabel + "”"
        );
        dlg.show();
    };

    return dlg;
}

/**
    The card that shows a cell's notes on hover, under the cell's own
    tooltip text. One per grid.

    @method noteCard
    @param {Object} options
    @param {Function} options.onEdit Called with model and attr
    @param {Function} options.onClear Called with model and attr
    @return {Object} Card controller with `enter`, `leave` and `view`
*/
function noteCard(options) {
    let card = {};
    let showTimer;
    let hideTimer;
    let current;

    function cancel() {
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
    }

    /**
        Pointer entered a cell with notes.
        @method enter
    */
    card.enter = function (e, model, attr, title) {
        let rect = e.currentTarget.getBoundingClientRect();
        let scale = pageScale();

        cancel();
        showTimer = window.setTimeout(function () {
            current = {
                model,
                attr,
                title,
                left: rect.left / scale,
                top: rect.bottom / scale,
                above: rect.top / scale
            };
            m.redraw();
        }, 350);
    };

    /**
        Pointer left the cell or the card.
        @method leave
    */
    card.leave = function () {
        window.clearTimeout(showTimer);
        hideTimer = window.setTimeout(function () {
            current = undefined;
            m.redraw();
        }, 200);
    };

    /**
        @method hide
    */
    card.hide = function () {
        cancel();
        current = undefined;
    };

    card.view = function () {
        let notes;
        let me;
        let body = [];

        if (!current) {
            return undefined;
        }

        notes = notesOf(current.model, current.attr);
        if (!notes.length) {
            return undefined;
        }
        me = f.currentUser().name;

        if (current.title) {
            body.push(m("div", {class: "fb-note-card-title"}, current.title));
        }

        notes.forEach(function (note) {
            let stamp = when(note.at);
            let links;

            if (note.updated) {
                stamp += " · edited " + when(note.updated);
            }
            if (note.by === me) {
                links = m("span", {class: "fb-note-card-links"}, [
                    m("a", {
                        href: "#",
                        onclick: function (e) {
                            /*
                                Which note this is, before hiding the
                                card: hiding is what forgets it, so
                                reading `current` afterwards threw and
                                Edit did nothing at all, while Clear --
                                written this way from the start --
                                worked (John, Oct 2026).
                            */
                            let target = current;

                            e.preventDefault();
                            card.hide();
                            options.onEdit(target.model, target.attr);
                        }
                    }, "Edit"),
                    m("a", {
                        href: "#",
                        onclick: function (e) {
                            let target = current;

                            e.preventDefault();
                            card.hide();
                            options.onClear(target.model, target.attr);
                        }
                    }, "Clear")
                ]);
            }
            body.push(m("div", {class: "fb-note-card-note"}, [
                m("div", {class: "fb-note-card-head"}, [
                    m("span", {class: "fb-note-card-user"}, note.by),
                    m("span", {class: "fb-note-card-time"}, stamp),
                    links
                ]),
                m("div", {
                    class: "fb-note-card-body"
                }, m.trust(cleanHtml(note.html)))
            ]));
        });

        return m("div", {
            class: "fb-note-card",
            style: {
                left: current.left + "px",
                top: current.top + "px"
            },
            onmouseenter: cancel,
            onmouseleave: card.leave,
            oncreate: function (vnode) {
                // Flip above the cell when there is no room below
                let height = vnode.dom.offsetHeight;
                let room = window.innerHeight / pageScale();

                if (current && current.top + height > room - 8) {
                    vnode.dom.style.top = Math.max(
                        8,
                        current.above - height
                    ) + "px";
                }
            }
        }, body);
    };

    return card;
}

/**
    Actions for the cell a context menu was opened on, as data, the way
    the grid builds its other actions.

    @method cellActions
    @param {Object} options
    @param {Object} options.model Row model
    @param {String} options.attr Column
    @param {String} options.label Column label
    @param {Object} options.feather List feather
    @param {Object} options.formatDialog
    @param {Object} options.noteDialog
    @param {Function} options.onError
    @return {Array}
*/
function cellActions(options) {
    let model = options.model;
    let attr = options.attr;
    let reason = why(model, options.feather);
    // A note is shared by nature, so it takes update permission
    let noteReason = reason || (
        canShare(model)
        ? ""
        : NO_RIGHTS
    );
    let mine = !noteReason && myNote(model, attr);

    function act(run) {
        return function () {
            run();
        };
    }

    // Each dialog carries its own "Clear" button (formatDialog,
    // noteDialog), so the menu only needs to open one or the other --
    // it doesn't also offer the clearing actions themselves.
    return [{
        key: "format",
        icon: "platte",
        label: "Format…",
        title: reason || "Colors and text style for this cell or row",
        disabled: Boolean(reason),
        run: act(() => options.formatDialog.open(
            model,
            attr,
            options.label,
            options.place
        ))
    }, {
        key: "note",
        icon: "comment",
        label: "Note…",
        title: noteReason || (
            mine
            ? "View or change your note on this cell"
            : "Add a note to this cell"
        ),
        disabled: Boolean(noteReason),
        run: act(() => options.noteDialog.open(model, attr, options.label))
    }];
}

f.catalog().register("global", "listMeta", {
    cellActions,
    cellFormat,
    css,
    formatDialog,
    hasNotes,
    noteCard,
    noteDialog,
    notesOf,
    rowFormat,
    save
});
