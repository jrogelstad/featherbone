/*
    Config.missingSecrets (plan 1.7): the server refuses to start with
    empty or placeholder secrets.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Config} = require("../../server/config");

describe("config secrets", function () {
    const config = new Config();

    it("accepts real values", function () {
        assert.deepEqual(
            config.missingSecrets({pgCryptoKey: "k1", secret: "s1"}),
            []
        );
    });

    it("flags empty, blank and missing values", function () {
        assert.deepEqual(
            config.missingSecrets({pgCryptoKey: "", secret: "  "}).sort(),
            ["pgCryptoKey", "secret"]
        );
        assert.deepEqual(
            config.missingSecrets({secret: "s1"}),
            ["pgCryptoKey"]
        );
    });

    it("flags the old template placeholders", function () {
        assert.deepEqual(
            config.missingSecrets({
                pgCryptoKey: "Your db encryption key here",
                secret: "Your own session key here"
            }).sort(),
            ["pgCryptoKey", "secret"]
        );
    });
});
