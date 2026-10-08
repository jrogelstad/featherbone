/*
    common/number.js (server, CommonJS) and common/number.mjs (client, ES
    module): Number.prototype pad/plus/minus/times/div/round. These are
    the decimal-safe money helpers (big.js) SupplyChain uses for totals,
    tax and costing, so exact outputs are pinned, including half-up
    rounding of negatives and binary-float traps.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {pathToFileURL} = require("url");

const COMMON = path.join(__dirname, "..", "..", "common");

require(path.join(COMMON, "number.js"));

// [value, method, argument, expected]
const TABLE = [
    [0.1, "plus", 0.2, 0.3],
    [0.3, "minus", 0.1, 0.2],
    [1.1, "times", 3, 3.3],
    [19.99, "times", 3, 59.97],
    [0.000001, "times", 3, 0.000003],
    [10, "div", 4, 2.5],
    [1, "div", 3, 0.3333333333333333],
    [2, "div", 3, 0.6666666666666666],
    [100, "minus", 0.01, 99.99],
    [-1.1, "plus", -2.2, -3.3],
    [1.005, "round", 2, 1.01],
    [2.675, "round", 2, 2.68],
    [-1.005, "round", 2, -1.01],
    [2.5, "round", 0, 3],
    [-2.5, "round", 0, -3],
    [-0.5, "round", 0, -1],
    [1234.5678, "round", undefined, 1235],
    [15, "round", -1, 20],
    [1, "round", -1, 0],
    [1.23456789, "round", 8, 1.23456789],
    [1.234567891, "round", 8, 1.23456789],
    [1e21, "times", 10, 1e22],
    [0.1, "plus", "0.2", 0.3],
    [5, "times", "1.5", 7.5]
];

function runTable() {
    return TABLE.map(function (row) {
        return row[0][row[1]](row[2]);
    });
}

describe("common/number.js", function () {
    TABLE.forEach(function (row) {
        it(row[0] + "." + row[1] + "(" + row[2] + ") === " + row[3],
                function () {
            let result = row[0][row[1]](row[2]);
            assert.equal(typeof result, "number");
            assert.equal(result, row[3]);
        });
    });

    it("rounds money half away from zero where Math.round would not",
            function () {
        // Binary float: 1.005 * 100 = 100.49999999999999
        assert.equal(Math.round(1.005 * 100) / 100, 1);
        assert.equal((1.005).round(2), 1.01);
        // Math.round(x, 2) ignores the second argument (plan 2.2)
        assert.equal(Math.round(12.345, 2), 12);
        assert.equal((12.345).round(2), 12.35);
        // Tax example: 19.99 at 8.25%
        assert.equal((19.99).times(0.0825), 1.649175);
        assert.equal((19.99).times(0.0825).round(2), 1.65);
        // Negative credit amounts round symmetrically
        assert.equal((-19.99).times(0.0825).round(2), -1.65);
    });

    it("chains decimal-safe operations for a line total", function () {
        // qty 3 x 33.33 less 10% discount, rounded to cents
        let total = (3).times(33.33).times((1).minus(0.1)).round(2);
        assert.equal(total, 89.99);
        // Summing many cents stays exact
        let sum = 0;
        let i;
        for (i = 0; i < 10; i += 1) {
            sum = sum.plus(0.1);
        }
        assert.equal(sum, 1);
    });

    it("throws big.js errors for invalid operands", function () {
        assert.throws(() => (1).div(0), /Division by zero/);
        assert.throws(() => (1).plus("abc"), /Invalid number/);
        assert.throws(() => (1).plus(null), /Invalid number/);
        assert.throws(() => (1).plus(undefined), /Invalid number/);
        assert.throws(() => (NaN).round(2), /Invalid number/);
    });

    it("pads numbers to a width", function () {
        assert.equal((9).pad(3), "009");
        assert.equal((9).pad(3, "-"), "--9");
        assert.equal((123).pad(2), "123");
        assert.equal((0).pad(0), "0");
        assert.equal((1.5).pad(5), "001.5");
        assert.equal((7).pad(2), "07");
    });

    it("pads negative numbers after the sign", function () {
        assert.equal((-5).pad(3), "-05");
    });
});

describe("common/number.mjs matches common/number.js", function () {
    let cjsResults;
    let cjsPad;

    before(async function () {
        cjsResults = runTable();
        cjsPad = [(9).pad(3), (9).pad(3, "-"), (-5).pad(3)];
        await import(pathToFileURL(path.join(COMMON, "number.mjs")).href);
    });

    it("produces identical results for every table row", function () {
        assert.deepEqual(runTable(), cjsResults);
        assert.deepEqual(runTable(), TABLE.map((r) => r[3]));
        assert.deepEqual([(9).pad(3), (9).pad(3, "-"), (-5).pad(3)], cjsPad);
    });
});
