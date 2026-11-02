/*
    Terms (common/triggers-terms.js): the trigger asks for the deposit
    amount before the feather's own required check does, and rewrites the
    terms a policy fixes.
*/
/*jslint node*/
"use strict";

const {describe, it, before} = require("node:test");
const assert = require("node:assert/strict");
const {signedIn} = require("featherbone-test").http;
const {money, uniq} = require("featherbone-test").fixtures;

describe("terms", function () {
    let s;

    before(async function () {
        s = await signedIn();
    });

    it("requires the deposit amount", async function () {
        let resp = await s.raw("POST", "/data/terms", {code: uniq("NET")});

        assert.equal(resp.status, 500);
        assert.equal(
            resp.body,
            "Deposit money object is required on terms."
        );
    });

    it("keeps what the net policy is given", async function () {
        let terms = await s.create("Terms", {
            code: uniq("NET"),
            depositAmount: money(0),
            depositRequired: false,
            net: 30,
            policy: "N"
        });

        assert.equal(terms.net, 30);
        assert.equal(terms.depositRequired, false);
    });

    it("makes prepaid terms a full deposit due at once", async function () {
        let terms = await s.create("Terms", {
            code: uniq("PRE"),
            depositAmount: money(5),
            depositRequired: false,
            discount: 3,
            discountDays: 10,
            net: 30,
            policy: "P"
        });

        assert.equal(terms.net, 0);
        assert.equal(terms.day, 1);
        assert.equal(terms.discount, 0);
        assert.equal(terms.discountDays, 0);
        assert.equal(terms.depositRequired, true);
        assert.equal(terms.depositPercent, 100);
        assert.equal(terms.depositAmount.amount, 0);
    });
});
