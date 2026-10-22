/*
    Self upgrade at startup: what a boot decides to run.

    No database and no child process. Everything that could be got
    wrong about an upgrade -- which steps, in what order, with which
    flags, and above all which of the two switches does what -- is
    the plan, so the plan is what is tested here. Running the steps is
    `install.js`, which has its own suites.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {Upgrade} = require("../../server/services/upgrade");

const upgrade = new Upgrade();
const OWN = upgrade.version();

// A current single-instance installation: nothing to do.
function current() {
    return {
        instances: [{name: "acme", version: OWN}],
        managerKind: "manager",
        managerVersion: OWN,
        version: OWN
    };
}

const BOTH = {selfUpgradeInstances: true, selfUpgradeManager: true};

function names(steps) {
    return steps.map((step) => step.step);
}

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
            managerVersion: own,
            version: own
        }, BOTH);

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
        assert.deepEqual(upgrade.plan(current(), BOTH), []);
    });

    it("plans nothing when both switches are off", function () {
        let state = current();

        state.managerVersion = "2.2.0";
        state.instances = [{name: "acme", version: "2.2.0"}];

        assert.deepEqual(upgrade.plan(state, {}), []);
        assert.deepEqual(upgrade.plan(state, {
            selfUpgradeInstances: false,
            selfUpgradeManager: false
        }), []);
    });

    it("builds a manager that is not there", function () {
        let steps = upgrade.plan({
            instances: [],
            managerKind: undefined,
            version: OWN
        }, {selfUpgradeManager: true});

        assert.deepEqual(names(steps), ["manager"]);
        assert.deepEqual(steps[0].args, ["--manager"]);
    });

    it("leaves refusing a non-manager to the manager step", function () {
        let steps = upgrade.plan({
            instances: [],
            managerKind: "instance",
            version: OWN
        }, {selfUpgradeManager: true});

        assert.deepEqual(names(steps), ["manager"]);
    });

    it("upgrades a manager whose Core is behind", function () {
        let state = current();

        state.managerVersion = "2.19.0";

        let steps = upgrade.plan(state, {selfUpgradeManager: true});

        assert.deepEqual(names(steps), ["manager"]);
        assert.deepEqual(steps[0].args, ["--manager"]);
        assert.match(steps[0].why, /2\.19\.0/);
    });

    it("upgrades a manager that carries no Core version", function () {
        let state = current();

        delete state.managerVersion;

        assert.deepEqual(
            names(upgrade.plan(state, {selfUpgradeManager: true})),
            ["manager"]
        );
    });

    it("leaves the manager alone when only instances", function () {
        let state = current();

        state.managerVersion = "2.2.0";
        state.instances = [{name: "acme", version: "2.2.0"}];

        let steps = upgrade.plan(state, {selfUpgradeInstances: true});

        assert.deepEqual(names(steps), ["instance"]);
        assert.deepEqual(steps[0].args, ["--instance", "acme"]);
    });

    it("leaves instances alone when only the manager", function () {
        let state = current();

        state.managerVersion = "2.2.0";
        state.instances = [{name: "acme", version: "2.2.0"}];

        let steps = upgrade.plan(state, {selfUpgradeManager: true});

        assert.deepEqual(names(steps), ["manager"]);
    });

    it("plans a step per instance behind, manager first", function () {
        let steps = upgrade.plan({
            instances: [
                {name: "a", version: OWN},
                {name: "b", version: "2.2.0"},
                {name: "c", version: undefined},
                {name: "d", version: "2.19.0"}
            ],
            managerKind: "manager",
            managerVersion: "2.2.0",
            version: OWN
        }, BOTH);

        assert.deepEqual(
            steps.map((step) => step.name || step.step),
            ["manager", "b", "c", "d"]
        );
        assert.deepEqual(steps[2].args, ["--instance", "c"]);
    });

    it("names no organization, user or script of its own", function () {
        let steps = upgrade.plan({
            instances: [{name: "acme", version: "2.2.0"}],
            managerKind: "manager",
            managerVersion: "2.2.0",
            version: OWN
        }, Object.assign({
            selfUpgradeIdentities: true,
            selfUpgradeOrganization: "Acme"
        }, BOTH));

        steps.forEach(function (step) {
            assert.equal(step.args.indexOf("--organization"), -1);
            assert.equal(step.script, undefined);
        });
    });
});
