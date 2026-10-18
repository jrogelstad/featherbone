/*
    Self upgrade at startup: what a boot decides to run.

    No database and no child process. Everything that could be got
    wrong about an upgrade -- which steps, in what order, with which
    flags, and above all when the one-way identity backfill runs -- is
    the plan, so the plan is what is tested here. Running the steps is
    `install.js`, which has its own suites.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Upgrade} = require("../../server/services/upgrade");

const upgrade = new Upgrade();

// A current single-instance installation: nothing to do.
function current() {
    return {
        instances: [{name: "acme", version: "3.0.0-alpha.1"}],
        managerKind: "manager",
        version: "3.0.0-alpha.1"
    };
}

function names(steps) {
    return steps.map((step) => step.step);
}

describe("self upgrade: the instance list", function () {
    it("takes an array from the configuration file", function () {
        assert.deepEqual(
            upgrade.instanceNames(["acme", "acme_test"]),
            ["acme", "acme_test"]
        );
    });

    it("splits a comma separated list from the environment", function () {
        assert.deepEqual(
            upgrade.instanceNames("acme, acme_test ,demo"),
            ["acme", "acme_test", "demo"]
        );
    });

    it("is empty when the setting is missing or blank", function () {
        assert.deepEqual(upgrade.instanceNames(undefined), []);
        assert.deepEqual(upgrade.instanceNames(""), []);
        assert.deepEqual(upgrade.instanceNames([]), []);
        assert.deepEqual(upgrade.instanceNames(" , "), []);
    });
});

describe("self upgrade: what counts as behind", function () {
    /*
        One definition, shared by the startup path, the Instances
        screen's Upgrade button and the fleet view's Core column. It
        is measured against this checkout, so the claims below are
        written against whatever manifest.json says rather than a
        version pinned here.
    */
    let own = upgrade.version();

    it("reads the framework's own version from the manifest", function () {
        assert.equal(typeof own, "string");
        assert.match(own, /^\d+\.\d+\.\d+/);
    });

    it("counts a database with no Core version as behind", function () {
        assert.equal(upgrade.isBehind(undefined), true);
        assert.equal(upgrade.isBehind(null), true);
    });

    it("counts an older version as behind", function () {
        assert.equal(upgrade.isBehind("0.0.1"), true);
        assert.equal(upgrade.isBehind("2.2.0"), true);
    });

    it("does not count its own version as behind", function () {
        assert.equal(upgrade.isBehind(own), false);
    });

    it("does not count a newer version as behind", function () {
        assert.equal(upgrade.isBehind("999.0.0"), false);
    });

    it("agrees with the plan, which is the other caller", function () {
        let steps = upgrade.plan({
            instances: [
                {name: "behind", version: "2.2.0"},
                {name: "current", version: own}
            ],
            managerKind: "manager",
            version: own
        }, {selfUpgrade: true});

        assert.deepEqual(steps.map((step) => step.name), ["behind"]);
        assert.equal(upgrade.isBehind("2.2.0"), true);
        assert.equal(upgrade.isBehind(own), false);
    });

    it("points at the checkout the manifest lives in", function () {
        assert.equal(typeof upgrade.root(), "string");
        assert.equal(upgrade.root().length > 0, true);
    });
});

describe("self upgrade: what a boot plans", function () {
    it("plans nothing when everything is current", function () {
        assert.deepEqual(
            upgrade.plan(current(), {selfUpgrade: true}),
            []
        );
    });

    it("builds the manager when there is none", function () {
        let state = current();
        delete state.managerKind;

        let steps = upgrade.plan(state, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["manager"]);
        assert.deepEqual(steps[0].args, ["--manager"]);
        assert.equal(steps[0].why, "no manager database");
    });

    it("builds the manager before any instance", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: undefined,
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["manager", "instance"]);
    });

    it("upgrades an instance that is behind this server", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["instance"]);
        assert.deepEqual(steps[0].args, ["--instance", "acme"]);
        assert.match(steps[0].why, /carries Core 2\.2\.0/);
    });

    it("upgrades one that carries no Core version at all", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: undefined}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["instance"]);
        assert.equal(steps[0].why, "carries no Core version");
    });

    it("leaves an instance ahead of this server alone", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "3.1.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.deepEqual(steps, []);
    });

    it("counts a prerelease as behind the release it leads to", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "3.0.0-alpha.1"}],
            managerKind: "manager",
            version: "3.0.0"
        }, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["instance"]);
    });

    it("names the organization when one is configured", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {
            selfUpgrade: true,
            selfUpgradeOrganization: "Acme"
        });

        assert.deepEqual(
            steps[0].args,
            ["--instance", "acme", "--organization", "Acme"]
        );
    });

    it("plans one step per instance behind, in the order given", function () {
        let steps = upgrade.plan({
            instances: [
                {name: "acme", version: "2.2.0"},
                {name: "acme_test", version: "3.0.0-alpha.1"},
                {name: "acme_demo", version: undefined}
            ],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.deepEqual(names(steps), ["instance", "instance"]);
        assert.deepEqual(
            steps.map((step) => step.name),
            ["acme", "acme_demo"]
        );
    });
});

describe("self upgrade: the identity backfill", function () {
    it("does not run unless it is asked for", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: undefined,
            version: "3.0.0-alpha.1"
        }, {selfUpgrade: true});

        assert.equal(names(steps).includes("identities"), false);
    });

    it("does not run when nothing else did", function () {
        let steps = upgrade.plan(current(), {
            selfUpgrade: true,
            selfUpgradeIdentities: true
        });

        assert.deepEqual(steps, []);
    });

    it("runs last, after the upgrade that gave it work", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: undefined,
            version: "3.0.0-alpha.1"
        }, {
            selfUpgrade: true,
            selfUpgradeIdentities: true
        });

        assert.deepEqual(
            names(steps),
            ["manager", "instance", "identities"]
        );
        assert.equal(
            steps[2].script,
            "scripts/migrate-identities.js"
        );
    });

    it("applies rather than rehearsing", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {
            selfUpgrade: true,
            selfUpgradeIdentities: true
        });

        assert.deepEqual(steps[1].args, ["--apply"]);
    });

    it("carries the organization, administrator and superuser", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {
            selfUpgrade: true,
            selfUpgradeIdentities: true,
            selfUpgradeOrgAdmin: "jsmith",
            selfUpgradeOrganization: "Acme",
            selfUpgradeSuperuser: "postgres",
            selfUpgradeSuperuserPassword: "s3cret"
        });

        assert.deepEqual(steps[1].args, [
            "--apply",
            "--organization", "Acme",
            "--org-admin", "jsmith",
            "--username", "postgres",
            "--password", "s3cret"
        ]);
    });

    it("leaves the password out when no superuser was named", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            version: "3.0.0-alpha.1"
        }, {
            selfUpgrade: true,
            selfUpgradeIdentities: true,
            selfUpgradeSuperuserPassword: "s3cret"
        });

        assert.equal(steps[1].args.includes("--password"), false);
        assert.equal(steps[1].args.includes("s3cret"), false);
    });
});
