/*
    A list's sticky header and totals footer have a z-index, so they paint
    over a context menu that has none: the menu's own z-index, on the list
    inside it, is trapped in the menu's stacking context. The totals row
    covered the middle of the menu (John, Nov 2026).
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function zIndexOf(css, selector) {
    let rule = css.match(new RegExp(
        "(?:^|\\n)" + selector.replace(/[.]/g, "\\.") +
        "\\s*\\{([^}]*)\\}"
    ));
    let z = rule && rule[1].match(/z-index:\s*(-?\d+)/);

    return (
        z
        ? Number(z[1])
        : undefined
    );
}

describe("the list context menu's layer", function () {
    it("is above the list's sticky header and footer", async function () {
        let css = await fsp.readFile(
            path.join(ROOT, "css", "featherbone.css"),
            "utf8"
        );
        let menu = zIndexOf(css, ".fb-context-menu");
        let sticky = zIndexOf(css, ".fb-table thead th");

        assert.ok(menu !== undefined, "the menu sets its own z-index");
        assert.ok(sticky !== undefined, "the header sets one");
        assert.ok(menu > sticky, menu + " is not above " + sticky);
        assert.ok(css.includes(
            ".fb-table tfoot th,\n.fb-table tfoot td {\n" +
            "  position: sticky;\n  bottom: 0;\n  z-index: " + sticky
        ), "the footer is on the header's layer");
    });
});
