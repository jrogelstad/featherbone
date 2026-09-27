/*
    client/property.js: f.prop / model data properties. A getter/setter
    with its own four-state statechart (Ready, Changing, Silent,
    Disabled). Pins get/set semantics, change/changed event order,
    newValue/oldValue during Changing (including overriding the proposed
    value), silence/report, disable/enable (read only + revert),
    formatters and flags.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");
const env = require("./lib/browser-env");

let prop;

describe("client/property.js", function () {
    before(async function () {
        env.install();
        prop = (await import(pathToFileURL(
            path.join(env.ROOT, "client", "property.js")
        ).href)).default;
    });

    it("gets and sets a value", function () {
        let p = prop("a");
        assert.equal(p(), "a");
        assert.equal(p("b"), "b", "setter returns the new value");
        assert.equal(p(), "b");
        assert.equal(prop()(), undefined);
    });

    it("setting the same value is a no-op that returns undefined",
            function () {
        let events = [];
        let p = prop("a");
        p.state().resolve("/Changing").enter(() => events.push("change"));
        assert.equal(p("a"), undefined);
        assert.deepEqual(events, []);
    });

    it("starts in /Ready and returns there after a change", function () {
        let p = prop(1);
        assert.deepEqual(p.state().current(), ["/Ready"]);
        p(2);
        assert.deepEqual(p.state().current(), ["/Ready"]);
    });

    it("fires Changing enter before the store changes and exit after",
            function () {
        let log = [];
        let p = prop("old");
        let changing = p.state().resolve("/Changing");
        changing.enter(function () {
            log.push([
                "enter", p.state().current()[0], p(), p.oldValue(),
                p.newValue()
            ]);
        });
        changing.exit(function () {
            log.push(["exit", p(), p.oldValue(), p.newValue()]);
        });
        p("new");
        assert.deepEqual(log, [
            ["enter", "/Changing", "old", "old", "new"],
            ["exit", "new", "old", "new"]
        ]);
        assert.equal(p.oldValue(), undefined, "cleared after the change");
        assert.equal(p.newValue(), undefined);
    });

    it("lets a Changing handler replace the proposed value", function () {
        let p = prop("");
        p.state().resolve("/Changing").enter(function () {
            p.newValue(p.newValue().toUpperCase());
        });
        p("abc");
        assert.equal(p(), "ABC");
    });

    it("setting the property while Changing sets newValue", function () {
        let p = prop(0);
        p.state().resolve("/Changing").enter(function () {
            assert.equal(p(99), 99, "returns the new proposed value");
        });
        p(1);
        assert.equal(p(), 99);
    });

    it("newValue() only writes while Changing", function () {
        let p = prop(1);
        assert.equal(p.newValue(5), undefined);
        assert.equal(p(), 1);
    });

    it("silence suppresses change events until report", function () {
        let events = 0;
        let p = prop(1);
        p.state().resolve("/Changing").enter(() => (events += 1));
        p.state().send("silence");
        assert.deepEqual(p.state().current(), ["/Silent"]);
        p(2);
        assert.equal(p(), 2);
        assert.equal(events, 0);
        assert.equal(p.isReadOnly(), true, "read only while not Ready");
        p.state().send("report");
        assert.deepEqual(p.state().current(), ["/Ready"]);
        p(3);
        assert.equal(events, 1);
    });

    it("disable makes the property read only and reverts writes",
            function () {
        let p = prop("keep");
        p.state().send("disable");
        assert.deepEqual(p.state().current(), ["/Disabled"]);
        assert.equal(p.isReadOnly(), true);
        assert.equal(p("changed"), "keep");
        assert.equal(p(), "keep");
        // Ready-only events are ignored while disabled
        p.state().send("silence");
        assert.deepEqual(p.state().current(), ["/Disabled"]);
        p.state().send("enable");
        assert.deepEqual(p.state().current(), ["/Ready"]);
        assert.equal(p.isReadOnly(), false);
        p("changed");
        assert.equal(p(), "changed");
    });

    it("ignores events that do not apply to the current state",
            function () {
        let p = prop(1);
        p.state().send("changed");
        p.state().send("report");
        p.state().send("enable");
        p.state().send("bogus");
        assert.deepEqual(p.state().current(), ["/Ready"]);
    });

    it("applies formatter toType on write and fromType on read",
            function () {
        let p = prop("5", {
            toType: (v) => Number(v),
            fromType: (v) => "#" + v
        });
        assert.equal(p(), "#5", "initial value converted too");
        assert.equal(p.toJSON(), 5);
        p("7");
        assert.equal(p(), "#7");
        assert.equal(p.toJSON(), 7);
        // toType result equal to store -> no change
        assert.equal(p(7), undefined);
    });

    it("oldValue uses fromType, oldValue.toJSON the raw value",
            function () {
        let seen;
        let p = prop(1, {fromType: (v) => "v" + v});
        p.state().resolve("/Changing").enter(function () {
            seen = [p.oldValue(), p.oldValue.toJSON(), p.newValue.toJSON()];
        });
        p(2);
        assert.deepEqual(seen, ["v1", 1, 2]);
    });

    it("toJSON delegates to objects that have toJSON", function () {
        let p = prop({toJSON: () => ({x: 1})});
        assert.deepEqual(p.toJSON(), {x: 1});
        assert.equal(prop(null).toJSON(), null);
        assert.deepEqual(prop([1, 2]).toJSON(), [1, 2]);
    });

    it("carries alias, isRequired and isReadOnly flags", function () {
        let p = prop();
        assert.equal(p.alias(), undefined);
        assert.equal(p.alias("Name"), "Name");
        assert.equal(p.isRequired(), false);
        assert.equal(p.isRequired(1), true);
        assert.equal(p.isReadOnly(), false);
        assert.equal(p.isReadOnly(true), true);
        assert.equal(p.isReadOnly(false), false);
    });

    it("classifies relation types from p.type", function () {
        let p = prop();
        assert.ok(!p.isToOne());
        p.type = {relation: "Contact"};
        assert.ok(p.isToOne());
        assert.ok(!p.isToMany());
        p.type = {relation: "OrderLine", parentOf: "parent"};
        assert.ok(p.isToMany());
        assert.ok(!p.isToOne());
        p.type = {relation: "Order", childOf: "lines"};
        assert.ok(p.isChild());
        assert.ok(p.isToOne());
    });

    it("the factory is frozen", function () {
        assert.equal(Object.isFrozen(prop), true);
    });
});
