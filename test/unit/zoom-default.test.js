/*
    The interface's default zoom is written in two places that must agree:
    the stylesheet's --fb-ui-scale, which draws the page before any script
    runs, and APP_ZOOM_DEFAULT in client/main.js, which is what the ribbon's
    zoom box calls 100%. Out of step, the box reads something else than the
    page is drawn at and no choice of number gets back to the default
    (John, Oct 2026: wanted the app at 1.00, and the box showed 100% at
    1.13).
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

describe("the default zoom", function () {
    it("is the same in the stylesheet and the client", async function () {
        let css = await fsp.readFile(
            path.join(ROOT, "css", "featherbone.css"),
            "utf8"
        );
        let main = await fsp.readFile(
            path.join(ROOT, "client", "main.js"),
            "utf8"
        );
        let scale = css.match(/--fb-ui-scale:\s*([0-9.]+);/);
        let shown = main.match(/const APP_ZOOM_DEFAULT = (\d+);/);

        assert.ok(scale, "the stylesheet sets --fb-ui-scale");
        assert.ok(shown, "the client names its default");
        assert.equal(Math.round(Number(scale[1]) * 100), Number(shown[1]));
    });

    it("is true size, 1.00", async function () {
        let main = await fsp.readFile(
            path.join(ROOT, "client", "main.js"),
            "utf8"
        );

        assert.match(main, /const APP_ZOOM_DEFAULT = 100;/);
    });
});
