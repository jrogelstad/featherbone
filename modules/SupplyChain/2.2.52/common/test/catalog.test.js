/*
    The package's catalog, as Core serves it (ADR-003): every feather it
    declares with its properties and overloads, its settings definitions,
    and the routes its modules register. Compared with golden files in
    ./golden, so a change to what the package declares shows up as a
    diff. Core's own goldens hold Core alone.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {catalog, golden, http} = require("featherbone-test");
const {carried} = require("./package");

const {matchGolden} = golden.at(__dirname);
const KEEP_ALL = {drop: new Set()};

describe("catalog (SupplyChain)", function () {
    let admin;
    let mine;
    let merged = {};

    before(async function () {
        admin = await http.signedIn();
        mine = carried();
        await Promise.all(mine.feathers.map(async function (name) {
            merged[name] = await admin.feather(name);
        }));
    });

    it("declares every feather the package carries", function () {
        assert.ok(mine.feathers.length > 50);
        mine.feathers.forEach(function (name) {
            assert.ok(merged[name] && merged[name].name === name, name);
        });
    });

    it("matches the golden catalog (every feather and property)",
            function () {
        let out = {};

        mine.feathers.forEach(function (name) {
            out[name] = catalog.describeFeather(merged[name], name);
        });
        matchGolden("catalog-feathers", out, KEEP_ALL);
    });

    it("merges Product's inheritance of Item", function () {
        let product = merged.Product;

        assert.equal(product.inherits, "Item");
        assert.equal(product.module, "Design");
        assert.equal(product.properties.number.inheritedFrom, "Item");
        assert.equal(product.properties.number.isNaturalKey, true);
        assert.equal(product.properties.materialCost.format, "unitCost");
        assert.equal(product.properties.price.format, "salesPrice");
        assert.deepEqual(
            product.overloads.type.dataList.map((d) => d.value),
            ["I", "E", "K"]
        );
    });

    it("lists the package's settings definitions (golden)", async function () {
        let defs = await admin.get("/settings-definition");
        let names = defs.map((d) => d.name);
        let out = {};

        assert.ok(names.includes("buySettings"));
        defs.filter((d) => mine.modules.has(d.module)).forEach(function (d) {
            out[d.name] = {
                encrypted: Object.keys(d.properties).filter(
                    (key) => d.properties[key].isEncrypted
                ),
                module: d.module,
                properties: Object.keys(d.properties).sort()
            };
        });
        matchGolden("settings-definitions", out, KEEP_ALL);
    });

    it("lists the routes the package's modules register (golden)",
            async function () {
        let routes = await admin.list("Routes");
        let out = routes.filter(
            (r) => mine.modules.has(r.module)
        ).map(
            (r) => "/" + r.module.replace(
                /([a-z0-9])([A-Z])/g,
                "$1-$2"
            ).toLowerCase() + r.path + " -> " + r.function
        ).sort();

        assert.ok(out.includes(
            "/buy/post-purchase-order-receipts -> doPostPurchaseOrderReceipts"
        ));
        matchGolden("catalog-routes", out, KEEP_ALL);
    });
});
