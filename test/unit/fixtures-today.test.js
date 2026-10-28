/*
    today(n) is the UTC date n days on, whatever the zone and wherever a
    daylight saving change falls in between.
*/
/*jslint node*/
"use strict";

const {afterEach, describe, it} = require("node:test");
const assert = require("node:assert/strict");
const {today} = require("../harness/fixtures");

const ZONE = process.env.TZ;

describe("today", function () {
    afterEach(function () {
        if (ZONE === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = ZONE;
        }
    });

    it("adds days across the autumn change in a Toronto evening", function (t) {
        process.env.TZ = "America/Toronto";
        // 19:55 EDT on Oct 27 2026, which is still Oct 27 in UTC
        t.mock.timers.enable({
            apis: ["Date"],
            now: Date.UTC(2026, 9, 27, 23, 55)
        });

        assert.equal(today(), "2026-10-27");
        assert.equal(today(11), "2026-11-07");
        assert.equal(today(-1), "2026-10-26");
    });

    it("adds days across the spring change in a Toronto evening", function (t) {
        process.env.TZ = "America/Toronto";
        // 19:55 EST on Mar 1 2026; the change is on Mar 8
        t.mock.timers.enable({
            apis: ["Date"],
            now: Date.UTC(2026, 2, 2, 0, 55)
        });

        assert.equal(today(), "2026-03-02");
        assert.equal(today(10), "2026-03-12");
    });
});
