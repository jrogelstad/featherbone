/*
    Make ribbon: when Complete is available.

    Complete receives ALL remaining quantity, so it applies to a work
    order that still has some. checkCanComplete lives in the client file
    and needs no browser, so it is lifted from the source and run here.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function lift(name) {
    let src = fs.readFileSync(path.join(__dirname, "../module.js"), "utf8");
    let start = src.indexOf("    " + name + ": function");
    let end = src.indexOf("\n    },\n", start);

    assert.ok(start > -1 && end > start, name + " found in make/module.js");
    return new Function(
        "return {" + src.slice(start, end + 7).replace(/,\s*$/, "") + "}"
    )()[name];
}

function wo(status, ordered, received) {
    return {
        canSave: () => false,
        data: {
            status: () => status,
            lock: () => false,
            onHold: () => false,
            ordered: {toJSON: () => ordered},
            received: {toJSON: () => received}
        }
    };
}

describe("checkCanComplete", function () {
    let can = lift("checkCanComplete");

    it("is on for an active work order with quantity left", function () {
        assert.ok(can([wo("A", 5, 0)]));
        assert.ok(can([wo("I", 5, 2)]));
    });

    it("is off once everything is received", function () {
        assert.ok(!can([wo("I", 5, 5)]));
        assert.ok(!can([wo("I", 5, 6)]));
    });

    it("is off for pending and closed work orders", function () {
        assert.ok(!can([wo("P", 5, 0)]));
        assert.ok(!can([wo("C", 5, 0)]));
    });

    it("needs every selection to qualify", function () {
        assert.ok(!can([wo("A", 5, 0), wo("A", 5, 5)]));
        assert.ok(!can([]));
    });
});
