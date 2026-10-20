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

/*
    No config.json (John, Oct 2026): a deployment that sets everything in
    the environment has no file, and the server starts from defaults that
    live in the code. The template is documentation, never read.
*/
describe("config without a file", function () {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const config = new Config();
    const missing = path.join(os.tmpdir(), "fb-no-such-config.json");
    const touched = [];

    function env(name, value) {
        touched.push([name, process.env[name]]);
        process.env[name] = value;
    }

    function restore() {
        touched.splice(0).reverse().forEach(function ([name, was]) {
            if (was === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = was;
            }
        });
    }

    it("starts from the defaults", async function () {
        let data = await config.read(missing);

        assert.equal(data.pgHost, "127.0.0.1");
        assert.equal(data.pgPort, 5432);
        assert.equal(data.managerDatabase, "db_manager");
        assert.equal(data.modulesDir, "./modules");
        assert.equal(data.clientPort, 80);
        assert.equal(data.twoFactorAuth, false);
    });

    it("still refuses to start without the secrets", async function () {
        let data = await config.read(missing);

        assert.deepEqual(
            config.missingSecrets(data).sort(),
            ["pgCryptoKey", "secret"]
        );
    });

    it("ships no password and no placeholder mail server", async function () {
        let data = await config.read(missing);

        assert.equal(data.pgPassword, "");
        assert.equal(data.smtpHost, "");
        assert.equal(data.smtpAuthUser, "");
        assert.equal(data.smtpAuthPass, "");
    });

    it("lets the environment set any setting", async function () {
        env("pgCryptoKey", "k1");
        env("secret", "s1");
        env("pgPort", "6543");
        env("selfUpgrade", "true");
        env("smtpHost", "mail.example.com");
        try {
            let data = await config.read(missing);

            assert.deepEqual(config.missingSecrets(data), []);
            assert.equal(data.pgPort, 6543);
            assert.equal(data.selfUpgrade, true);
            assert.equal(data.smtpHost, "mail.example.com");
        } finally {
            restore();
        }
    });

    it("keeps an empty environment value empty", async function () {
        env("pgPassword", "");
        try {
            let data = await config.read(missing);

            assert.equal(data.pgPassword, "");
        } finally {
            restore();
        }
    });

    it("lets a file over-ride the defaults, and the environment the file",
            async function () {
        let file = path.join(os.tmpdir(), "fb-config-" + process.pid + ".json");

        fs.writeFileSync(file, JSON.stringify({pgHost: "db1", pgPort: 1}));
        env("pgPort", "2");
        try {
            let data = await config.read(file);

            assert.equal(data.pgHost, "db1");
            assert.equal(data.pgPort, 2);
            assert.equal(data.pgUser, "admin");
        } finally {
            restore();
            fs.unlinkSync(file);
        }
    });

    it("rejects a file that is not JSON", async function () {
        let file = path.join(os.tmpdir(), "fb-bad-" + process.pid + ".json");

        fs.writeFileSync(file, "{not json");
        try {
            await assert.rejects(config.read(file), /not valid JSON/);
        } finally {
            fs.unlinkSync(file);
        }
    });

    it("hands out a fresh copy, so one caller can't change another's",
            async function () {
        let one = await config.read(missing);

        one.platformOnlySettings.push("x");
        assert.deepEqual(
            (await config.read(missing)).platformOnlySettings,
            []
        );
    });

    it("has a default for every setting the template documents",
            function () {
        let template = JSON.parse(fs.readFileSync(
            path.join(__dirname, "../../server/config.template.json"),
            "utf8"
        ));
        let have = config.defaults();
        let absent = Object.keys(template).filter((key) => !(key in have));

        assert.deepEqual(absent, [], "add these to defaults() in config.js");
    });
});
