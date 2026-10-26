/*
    Which service rows a database loads (ADR-002 question 6).

    `Script.script` is source code in a table that the server compiles
    and runs. Loading has only ever walked the modules, so a row
    belonging to no module was never executed -- but nothing said so,
    and the code sat in the table looking live. The ADR settles that
    those rows are not carried forward, which makes saying so the
    work: a database is told once, by name.

    No database here: the client is a stand-in, which is all this
    decision needs.
*/
/*jslint node*/
"use strict";

const {describe, it, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const {Services} = require("../../server/services/services");

function fakeClient(database, rows, modules) {
    return {
        database,
        query: function (sql) {
            if (sql.indexOf("data_service") !== -1) {
                return Promise.resolve({rows});
            }
            return Promise.resolve({
                rows: modules.map(function (mod) {
                    // A plain name means no dependencies; {name, needs}
                    // names what has to load first.
                    let name = mod.name || mod;
                    let needs = mod.needs || [];

                    return {
                        dependencies: needs.map(function (dep) {
                            return {module: {name: dep}};
                        }),
                        name,
                        script: "",
                        version: "1.0.0"
                    };
                })
            });
        }
    };
}

let services;
let warnings;
let realWarn;

describe("loading service rows", function () {
    beforeEach(function () {
        services = new Services();
        warnings = [];
        realWarn = console.warn;
        console.warn = (msg) => warnings.push(String(msg));
    });

    it("loads the modules' rows in dependency order", async function () {
        let client = fakeClient(
            "one",
            [
                {module: "Beta", name: "second", script: "b"},
                {module: "Core", name: "first", script: "a"}
            ],
            ["Core", "Beta"]
        );
        let ret = await services.getServices({client});

        console.warn = realWarn;
        assert.deepEqual(ret.map((row) => row.name), ["first", "second"]);
        assert.deepEqual(warnings, [], "nothing to report");
    });

    it("leaves out a row belonging to no module, and says so once",
            async function () {
        let client = fakeClient(
            "two",
            [
                {module: "Core", name: "kept", script: "a"},
                {module: "Gone", name: "orphan", script: "b"},
                {module: null, name: "nameless", script: "c"}
            ],
            ["Core"]
        );
        let ret = await services.getServices({client});
        let again = await services.getServices({client});

        console.warn = realWarn;
        assert.deepEqual(ret.map((row) => row.name), ["kept"]);
        assert.deepEqual(
            again.map((row) => row.name),
            ["kept"],
            "same answer the second time"
        );
        assert.equal(warnings.length, 1, "told once, not every load");
        assert.match(warnings[0], /"two" holds 2 service row/);
        assert.match(warnings[0], /orphan \(Gone\)/);
        assert.match(
            warnings[0],
            /nameless \(no module\)/,
            "a row with no module at all reads as such"
        );
        assert.match(warnings[0], /not carried forward/);
    });

    it("tells each database about its own", async function () {
        let one = fakeClient(
            "three",
            [{module: "Gone", name: "a", script: ""}],
            ["Core"]
        );
        let other = fakeClient(
            "four",
            [{module: "Gone", name: "b", script: ""}],
            ["Core"]
        );

        await services.getServices({client: one});
        await services.getServices({client: other});
        console.warn = realWarn;

        assert.equal(warnings.length, 2);
        assert.match(warnings[0], /"three"/);
        assert.match(warnings[1], /"four"/);
    });

    /*
        The order is the module list's, so it holds for modules with no
        rows at all -- which is every module the server holds a package
        for, and which is what lets the rows go.
    */
    it("orders every module, rows or not", async function () {
        let client = fakeClient("five", [], [
            {name: "Sell", needs: ["Common"]},
            {name: "Core"},
            {name: "Common", needs: ["Core"]}
        ]);
        let order = await services.getModuleOrder({client});

        assert.deepEqual(order, ["Core", "Common", "Sell"]);
    });

    it("puts a module after what it depends on, not after its row",
            async function () {
        let client = fakeClient("six", [], [
            {name: "Ship", needs: ["Sell", "Core"]},
            {name: "Sell", needs: ["Core"]},
            {name: "Core"}
        ]);
        let order = await services.getModuleOrder({client});

        assert.ok(
            order.indexOf("Core") < order.indexOf("Sell"),
            order.join(" ")
        );
        assert.ok(
            order.indexOf("Sell") < order.indexOf("Ship"),
            order.join(" ")
        );
    });
});
