/*
    The rich text editor (TinyMCE) and the record behind it.

    TinyMCE announces its changes from its own event loop, not Mithril's,
    so nothing redraws afterwards. A record could know it had changed
    while the Save button, drawn from that, stayed disabled until the
    next click on something Mithril handles: tab out of a required rich
    text field and Save stayed off. The editor now asks for a redraw on
    a change and when it loses focus, and commits what was typed on
    leaving.

    No browser: TinyMCE is a recorder with just the parts the field uses.
*/
/*jslint node*/
"use strict";

const {before, beforeEach, describe, it} = require("node:test");
const assert = require("node:assert/strict");

let handlers;
let content;
let dirty;

globalThis.tinymce = {
    init: function (config) {
        let editor = {
            getContent: () => content,
            isDirty: () => dirty,
            mode: {set: () => undefined},
            on: function (name, callback) {
                handlers[name] = callback;
            }
        };

        config.setup(editor);
        return Promise.resolve([editor]);
    },
    remove: () => undefined
};
globalThis.matchMedia = () => ({matches: false});

const env = require("./lib/browser-env");

let f;
let prop;

async function mount() {
    let node = f.formats().richText.editor({id: "reproduction", prop});

    handlers = {};
    node.attrs.oncreate({dom: {id: "reproduction"}});
    await new Promise((resolve) => setImmediate(resolve));
}

describe("rich text editor", function () {
    before(async function () {
        let loaded = await env.loadClient();

        f = loaded.f;
        globalThis.document.getElementById = () => ({});
    });

    beforeEach(async function () {
        prop = f.prop("");
        content = "";
        dirty = false;
        await mount();
    });

    it("redraws after a change so Save can enable", function () {
        let redraws = env.redraws();

        handlers.change({level: {content: "<p>steps</p>"}});

        assert.equal(prop(), "<p>steps</p>");
        assert.equal(env.redraws(), redraws + 1);
    });

    it("commits what was typed when the editor is left", function () {
        let redraws = env.redraws();

        content = "<p>steps</p>";
        dirty = true;
        handlers.blur();

        assert.equal(prop(), "<p>steps</p>");
        assert.equal(env.redraws(), redraws + 1);
    });

    it("does not mark an untouched editor as edited on leaving", function () {
        let redraws = env.redraws();

        content = "<p>normalised</p>";
        dirty = false;
        handlers.blur();

        assert.equal(prop(), "");
        assert.equal(env.redraws(), redraws + 1);
    });
});
