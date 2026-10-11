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
    The manager database (tenant plan section 9). Every installation is
    multi-instance, so there is no role to declare and no second
    connection block -- only which database holds the registry.
*/
describe("config manager database", function () {
    const config = new Config();
    const base = {
        pgHost: "127.0.0.1",
        pgPort: 5432,
        pgUser: "admin",
        pgPassword: "pw"
    };

    it("defaults to db_manager", function () {
        assert.equal(config.managerDatabase(base), "db_manager");
        assert.equal(config.managerDatabase({}), "db_manager");
        assert.equal(config.managerDatabase(), "db_manager");
    });

    it("takes the name configuration gives it", function () {
        assert.equal(
            config.managerDatabase(Object.assign({}, base, {
                managerDatabase: "fbt_manager"
            })),
            "fbt_manager"
        );
    });

    it("treats a blank name as absent", function () {
        assert.equal(
            config.managerDatabase(Object.assign({}, base, {
                managerDatabase: "   "
            })),
            "db_manager"
        );
        assert.equal(
            config.managerDatabase(Object.assign({}, base, {
                managerDatabase: null
            })),
            "db_manager"
        );
    });

    it("no longer answers to a server role or a control plane block",
            function () {
        // Retired by section 9: one shape, so nothing to declare
        assert.equal(config.serverRole, undefined);
        assert.equal(config.isValidRole, undefined);
        assert.equal(config.roles, undefined);
        assert.equal(config.controlPlane, undefined);
        assert.equal(config.hasOwnControlPlane, undefined);
    });
});

describe("config modes", function () {
    const config = new Config();

    it("knows the modes a database may be in", function () {
        assert.deepEqual(config.modes().sort(), ["dev", "prod", "test"]);
    });
});
