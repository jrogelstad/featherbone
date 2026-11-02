/*
    The help this package carries (ADR-003): every module's help.json,
    the pages it names, and what the server answers for a form.

    What this holds down is the join between three things that move
    independently -- a page on disk, a form name in the database, and the
    entry in help.json that ties them -- so a renamed form or a deleted
    page shows up here rather than as a Help button that opens the
    framework's generic page.
*/
/*jslint node*/
"use strict";

const {before, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {db, http} = require("featherbone-test");

const ROOT = path.resolve(__dirname, "../..");

// Each module of this package that carries help: {module, dir, index}
function carried() {
    return fs.readdirSync(ROOT, {withFileTypes: true}).filter(
        (ent) => ent.isDirectory() &&
        fs.existsSync(path.join(ROOT, ent.name, "help", "help.json"))
    ).map(function (ent) {
        let dir = path.join(ROOT, ent.name, "help");

        return {
            dir,
            index: JSON.parse(
                fs.readFileSync(path.join(dir, "help.json"), "utf8")
            ),
            module: ent.name
        };
    });
}

describe("help (SupplyChain)", function () {
    const modules = carried();
    let admin;
    let forms;

    before(async function () {
        admin = await http.signedIn();

        let resp = await db.query(
            "SELECT name, module FROM form WHERE NOT is_deleted"
        );

        forms = new Map(resp.rows.map((row) => [row.name, row.module]));
    });

    it("carries help for every module that has pages", function () {
        let names = modules.map((one) => one.module).sort();

        assert.ok(names.length > 10, names.join());
        assert.ok(names.includes("sell"), names.join());
        assert.ok(names.includes("make"), names.join());
    });

    it("names a page that is there, and no page it leaves out",
            function () {
        let problems = [];

        modules.forEach(function (one) {
            let named = new Set();
            let held = fs.readdirSync(one.dir).filter(
                (file) => file.endsWith(".md")
            );

            function page(file, why) {
                named.add(file);

                if (!file || !held.includes(file)) {
                    problems.push(one.module + "/" + why + " -> " + file);
                }
            }

            let listed = one.index.pages || [];

            page(one.index.default, "default");
            listed.forEach((entry) => page(entry.path, "pages"));
            ["feathers", "forms"].forEach(function (key) {
                let map = one.index[key] || {};

                Object.keys(map).forEach(
                    (of) => page(map[of], key + "." + of)
                );
            });
            held.filter((file) => !named.has(file)).forEach(
                (file) => problems.push(
                    one.module + ": " + file + " is in no contents list"
                )
            );
        });

        assert.deepEqual(problems, []);
    });

    it("maps form names this database really has", function () {
        let problems = [];

        modules.forEach(function (one) {
            Object.keys(one.index.forms || {}).forEach(function (name) {
                if (!forms.has(name)) {
                    problems.push(one.module + ": no form \"" + name + "\"");
                }
            });
        });

        assert.deepEqual(problems, []);
    });

    /*
        The server reads help from the deployed package, so these are
        the pages a reader actually gets.
    */
    it("answers for this package's forms, not the framework's page",
            async function () {
        let asked = [
            ["Sales Order", "Sell", "sales-orders.md"],
            ["Customer", "Sell", "customers.md"],
            ["Work Order", "Make", "work-orders.md"],
            ["Product", "Design", "products.md"],
            ["Purchase Order", "Buy", "purchase-orders.md"],
            ["Inventory", "Stock", "inventory.md"],
            ["Invoice", "Bill", "invoicing.md"]
        ];
        let got = [];
        let i = 0;

        while (i < asked.length) {
            let one = asked[i];
            let topic = await admin.get(
                "/help-topic?form=" + encodeURIComponent(one[0])
            );

            i += 1;
            got.push([one[0], topic.module, topic.path]);
        }

        assert.deepEqual(got, asked);
    });

    it("falls back to the module's own page, never the framework's",
            async function () {
        // A form this package carries but help.json says nothing about
        let topic = await admin.get("/help-topic?form=Bill Of Lading");

        assert.equal(topic.module, "Ship");
        assert.equal(topic.path, "shipping.md");
    });

    it("serves a page from the deployed version", async function () {
        let resp = await admin.raw("GET", "/help/Sell/sales-orders.md");

        assert.equal(resp.status, 200);
        assert.match(String(resp.body), /^# Sales orders/);
    });
});
