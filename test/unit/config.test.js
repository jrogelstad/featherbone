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

    it("reports, but does not refuse, the old template placeholders",
            function () {
        let data = {
            pgCryptoKey: "Your db encryption key here",
            secret: "Your own session key here"
        };
        assert.deepEqual(config.missingSecrets(data), []);
        assert.deepEqual(
            config.placeholderSecrets(data).sort(),
            ["pgCryptoKey", "secret"]
        );
        assert.deepEqual(
            config.placeholderSecrets({pgCryptoKey: "k1", secret: "s1"}),
            []
        );
    });
});

/*
    The control plane block and the declared server role (tenant plan
    A.1). A deployment that says nothing keeps the single database
    behaviour it has always had.
*/
describe("config control plane", function () {
    const config = new Config();
    const base = {
        pgDatabase: "demo",
        pgHost: "127.0.0.1",
        pgPort: 5432,
        pgUser: "admin",
        pgPassword: "pw"
    };

    it("defaults to serving both roles", function () {
        assert.equal(config.serverRole(base), "both");
        assert.equal(config.isValidRole(base), true);
    });

    it("knows the roles it accepts", function () {
        assert.deepEqual(config.roles().sort(), [
            "both", "controlPlane", "tenant"
        ]);
        assert.equal(
            config.isValidRole(Object.assign({}, base, {
                serverRole: "controlplane"
            })),
            false
        );
    });

    it("falls back to the ordinary connection", function () {
        assert.deepEqual(config.controlPlane(base), base);
        assert.equal(config.hasOwnControlPlane(base), false);
    });

    it("takes what the block names and falls back for the rest",
            function () {
        let data = Object.assign({}, base, {
            controlPlane: {pgDatabase: "featherbone_control"}
        });

        assert.deepEqual(config.controlPlane(data), Object.assign({}, base, {
            pgDatabase: "featherbone_control"
        }));
        assert.equal(config.hasOwnControlPlane(data), true);
    });

    it("treats a blank setting in the block as absent", function () {
        let data = Object.assign({}, base, {
            controlPlane: {
                pgDatabase: "",
                pgHost: null,
                pgUser: undefined
            }
        });

        assert.deepEqual(config.controlPlane(data), base);
        assert.equal(config.hasOwnControlPlane(data), false);
    });

    it("notices a control plane on another server", function () {
        assert.equal(
            config.hasOwnControlPlane(Object.assign({}, base, {
                controlPlane: {pgHost: "10.0.0.9"}
            })),
            true
        );
        assert.equal(
            config.hasOwnControlPlane(Object.assign({}, base, {
                controlPlane: {pgPort: 5433}
            })),
            true
        );
    });
});

describe("config modes", function () {
    const config = new Config();

    it("knows the modes a database may be in", function () {
        assert.deepEqual(config.modes().sort(), ["dev", "prod", "test"]);
    });
});
