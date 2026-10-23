/*
    What the sign-in screen is told when a sign-in link did not work: the
    user name for the box and a line to show (see sign-in-link.test.js
    for the server's half).
*/
/*jslint node*/
"use strict";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const env = require("./lib/browser-env");

let f;

describe("sign-in hint", function () {
    before(async function () {
        f = (await env.loadClient()).f;
    });

    it("holds the name and shows the line", function () {
        f.signInHint("ptyler", "That link has expired.");

        assert.equal(f.signInUser(), "ptyler");
        assert.equal(
            f.state().resolve("/SignedOut").message(),
            "That link has expired."
        );
    });

    it("clears when there is nothing to say", function () {
        f.signInHint();

        assert.equal(f.signInUser(), "");
        assert.equal(f.state().resolve("/SignedOut").message(), "");
    });
});
