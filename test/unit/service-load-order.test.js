/*
    The order a database runs its service scripts in (ADR-002).

    Loading used to walk the `data_service` rows and substitute a
    module's package files in place, with a second pass to catch a disk
    module that had no rows. That second pass walked an unordered object,
    so it appended rather than placed: order was really being taken from
    which modules happened to have rows. Since a deployment writes no
    rows, "no rows" is the normal case, and dropping the table would
    have left every module's code loading in whatever order Postgres
    returned -- a module running before the one it depends on.

    The order now comes from the module list alone.

    No database and no packages directory: this is the decision only.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const datasource = require("../../server/datasource");

// Core -> Common -> Sell, as a database's module list would give it.
const ORDER = ["Core", "Common", "Sell"];

// Stands in for packages.serviceSources: one script per module.
function fromDisk(name, version) {
    return [{module: name, name: name + "-disk", script: version}];
}

function row(module, name) {
    return {module, name, script: ""};
}

function names(run) {
    return run.map((src) => src.name);
}

describe("service load order", function () {
    it("follows the module list when nothing has rows", function () {
        // Every module on disk, which is what a deployed database looks
        // like. The old second pass put these in object-key order.
        let run = datasource.serviceLoadOrder(
            ORDER,
            {Common: "1.0.0", Core: "1.0.0", Sell: "1.0.0"},
            [],
            fromDisk
        );

        assert.deepEqual(
            names(run),
            ["Core-disk", "Common-disk", "Sell-disk"]
        );
    });

    it("ignores the order the rows arrive in", function () {
        let run = datasource.serviceLoadOrder(
            ORDER,
            {},
            [row("Sell", "s"), row("Core", "c"), row("Common", "m")],
            fromDisk
        );

        assert.deepEqual(names(run), ["c", "m", "s"]);
    });

    it("places a module on disk where its dependencies say", function () {
        // Common is deployed and so has no rows; it still has to run
        // between Core and Sell, not after them.
        let run = datasource.serviceLoadOrder(
            ORDER,
            {Common: "2.0.0"},
            [row("Core", "c"), row("Sell", "s")],
            fromDisk
        );

        assert.deepEqual(names(run), ["c", "Common-disk", "s"]);
    });

    it("takes the version the database deployed", function () {
        let run = datasource.serviceLoadOrder(
            ["Core"],
            {Core: "3.0.0"},
            [],
            fromDisk
        );

        assert.deepEqual(run.map((src) => src.script), ["3.0.0"]);
    });

    it("prefers the package over rows the module still has", function () {
        // A deployment does not delete what was there before; the
        // package wins and the stale rows are not also run.
        let run = datasource.serviceLoadOrder(
            ["Core"],
            {Core: "1.0.0"},
            [row("Core", "stale")],
            fromDisk
        );

        assert.deepEqual(names(run), ["Core-disk"]);
    });

    it("keeps a module's own rows in their own order", function () {
        let run = datasource.serviceLoadOrder(
            ["Core", "Sell"],
            {},
            [
                row("Sell", "s1"),
                row("Core", "c1"),
                row("Sell", "s2"),
                row("Core", "c2")
            ],
            fromDisk
        );

        assert.deepEqual(names(run), ["c1", "c2", "s1", "s2"]);
    });

    it("runs nothing for a module with neither", function () {
        let run = datasource.serviceLoadOrder(
            ORDER,
            {},
            [row("Core", "c")],
            fromDisk
        );

        assert.deepEqual(names(run), ["c"]);
    });

    it("drops a row whose module the database does not list", function () {
        // getServices already filters these; the order must not put
        // them back.
        let run = datasource.serviceLoadOrder(
            ["Core"],
            {},
            [row("Core", "c"), row("Gone", "orphan")],
            fromDisk
        );

        assert.deepEqual(names(run), ["c"]);
    });
});
