/*
    common/date.js (Date.prototype toLocalDateTime, toLocalDate, toDate,
    getWeek) and common/core.js (the `f` object shared by client and
    server: copy, createId, dates, netWorkDays, operators, types).

    Runs in a fixed time zone with daylight saving (America/Chicago) so
    local-date conversions and DST boundaries are deterministic.
*/
/*jslint node*/
"use strict";

process.env.TZ = "America/Chicago";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const COMMON = path.join(__dirname, "..", "..", "common");

require(path.join(COMMON, "string.js"));
require(path.join(COMMON, "number.js"));
require(path.join(COMMON, "date.js"));
const f = require(path.join(COMMON, "core.js"));

describe("common/date.js", function () {
    it("formats local date and date-time strings", function () {
        let d = new Date(2026, 0, 5, 7, 3, 59);
        assert.equal(d.toLocalDateTime(), "2026-01-05T07:03");
        assert.equal(d.toLocalDate(), "2026-01-05");
        assert.equal(
            new Date(2026, 11, 31, 23, 59).toLocalDateTime(),
            "2026-12-31T23:59"
        );
        assert.equal(new Date(99, 0, 1).toLocalDate(), "1999-01-01");
    });

    it("uses local time, not UTC", function () {
        // 03:00 UTC on Mar 1 is still Feb 28 evening in Chicago
        let d = new Date("2026-03-01T03:00:00Z");
        assert.equal(d.toLocalDate(), "2026-02-28");
        assert.equal(d.toLocalDateTime(), "2026-02-28T21:00");
    });

    it("toDate strips the time in place and returns the same object",
            function () {
        let d = new Date(2026, 4, 6, 13, 45, 12, 500);
        let r = d.toDate();
        assert.equal(r, d);
        assert.deepEqual(
            [d.getHours(), d.getMinutes(), d.getSeconds(),
                    d.getMilliseconds()],
            [0, 0, 0, 0]
        );
        assert.equal(d.getDate(), 6);
    });

    it("returns ISO-8601 week numbers", function () {
        const cases = {
            "2026-01-01": 1,
            "2026-06-15": 25,
            "2026-12-31": 53,
            "2027-01-01": 53,
            "2021-01-03": 53,
            "2020-12-31": 53,
            "2024-12-30": 1,
            "2026-03-09": 11
        };
        Object.keys(cases).forEach(function (s) {
            assert.equal(f.parseDate(s).getWeek(), cases[s], s);
        });
    });
});

describe("common/core.js", function () {
    it("exposes constants and the operator list", function () {
        assert.equal(f.PRECISION_DEFAULT, 18);
        assert.equal(f.SCALE_DEFAULT, 8);
        assert.equal(f.startOfTime(), "1970-01-01");
        assert.equal(f.endOfTime(), "2100-12-31");
        assert.deepEqual(Object.keys(f.operators), [
            "=", "!=", "~", "!~", "~*", "!~*", ">", "<", ">=", "<=", "IN", "IS"
        ]);
        assert.equal(f.dateOptions.length, 21);
        assert.equal(f.dateOptions[0], "TODAY");
        assert.ok(f.dateOptions.includes("ON_OR_AFTER_THIS_MONTH"));
    });

    it("copy makes a deep JSON copy", function () {
        let src = {a: [1, {b: 2}], d: new Date(0), u: undefined, fn: () => 1};
        let c = f.copy(src);
        assert.notEqual(c, src);
        assert.notEqual(c.a, src.a);
        c.a[1].b = 3;
        assert.equal(src.a[1].b, 2);
        // JSON semantics: dates become strings, undefined/functions dropped
        assert.equal(c.d, "1970-01-01T00:00:00.000Z");
        assert.equal(Object.hasOwn(c, "u"), false);
        assert.equal(Object.hasOwn(c, "fn"), false);
    });

    it("createId returns unique base-36 strings", function () {
        let ids = new Set();
        let i;
        for (i = 0; i < 2000; i += 1) {
            ids.add(f.createId());
        }
        assert.equal(ids.size, 2000);
        ids.forEach(function (id) {
            assert.match(id, /^[0-9a-z]{2,14}$/);
        });
    });

    it("parseDate and isoDateToDate build local midnight dates", function () {
        let d = f.parseDate("2026-03-08");
        assert.deepEqual(
            [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()],
            [2026, 2, 8, 0]
        );
        assert.equal(
            f.isoDateToDate("2026-03-08").getTime(),
            d.getTime()
        );
        // new Date("2026-03-08") would be UTC midnight = Mar 7 locally
        assert.equal(new Date("2026-03-08").getDate(), 7);
    });

    it("today and now return current local/ISO strings", function () {
        assert.equal(f.today(), new Date().toLocalDate());
        assert.match(f.now(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        assert.match(f.now(true), /^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
    });

    it("netWorkDays counts weekdays inclusive of both ends", function () {
        // [start, end, expected]
        const cases = [
            ["2026-09-28", "2026-09-29", 2], // Mon-Tue
            ["2026-09-28", "2026-10-02", 5], // Mon-Fri
            ["2026-09-28", "2026-10-04", 5], // Mon-Sun
            ["2026-09-28", "2026-10-05", 6], // Mon-Mon
            ["2026-09-26", "2026-09-28", 1], // Sat-Mon
            ["2026-09-27", "2026-09-28", 1], // Sun-Mon
            ["2026-09-26", "2026-09-27", 0], // Sat-Sun
            ["2026-10-02", "2026-10-05", 2], // Fri-Mon
            ["2026-09-27", "2026-10-03", 5], // Sun-Sat
            ["2026-01-01", "2026-12-31", 261],
            ["2026-03-06", "2026-03-09", 2] // across DST start
        ];
        cases.forEach(function (c) {
            assert.equal(f.netWorkDays(c[0], c[1]), c[2], c[0] + ".." + c[1]);
        });
    });

    it("netWorkDays returns null when end is not after start", function () {
        assert.equal(f.netWorkDays("2026-09-28", "2026-09-28"), null);
        assert.equal(f.netWorkDays("2026-09-29", "2026-09-28"), null);
    });

    it("netWorkDays accepts Date objects", function () {
        assert.equal(
            f.netWorkDays(new Date(2026, 8, 28), new Date(2026, 9, 2)),
            5
        );
    });

    it("netWorkDays leaves Date arguments unchanged",
            {todo: "defect: netWorkDays calls setHours on its Date arguments"},
            function () {
        let start = new Date(2026, 8, 28, 10, 30);
        let end = new Date(2026, 9, 2, 10, 30);
        f.netWorkDays(start, end);
        assert.equal(start.getHours(), 10);
        assert.equal(end.getHours(), 10);
    });

    describe("types", function () {
        it("number.toType strips formatting characters", function () {
            const t = f.types.number.toType;
            assert.equal(t("$1,234.50"), 1234.5);
            assert.equal(t("-1.5e3"), -1500);
            assert.equal(t(" 7 "), 7);
            assert.equal(t(true), 1);
            // Invalid or empty input becomes 0, never NaN
            assert.equal(t("abc"), 0);
            assert.equal(t(""), 0);
            assert.equal(t(null), 0);
            assert.equal(t("1.2.3"), 0);
            // Pinned: comma is treated as a thousands separator and
            // parentheses are not a negative sign
            assert.equal(t("1,5"), 15);
            assert.equal(t("(5)"), 5);
        });

        it("number.fromType formats with the locale", function () {
            assert.equal(f.types.number.fromType(null), null);
            assert.equal(
                f.types.number.fromType(1234.5),
                (1234.5).toLocaleString()
            );
            assert.equal(f.types.number.default, 0);
        });

        it("integer, boolean, string and container types", function () {
            assert.equal(f.types.integer.toType("12.9"), 12);
            assert.ok(Number.isNaN(f.types.integer.toType("x")));
            assert.equal(f.types.integer.default, 0);
            assert.equal(f.types.boolean.toType("false"), true);
            assert.equal(f.types.boolean.toType(""), false);
            assert.equal(f.types.boolean.default, false);
            assert.equal(f.types.string.toType(5), "5");
            assert.equal(f.types.string.toType(null), null);
            assert.equal(f.types.string.default, "");
            assert.deepEqual(f.types.array.default(), []);
            assert.notEqual(f.types.array.default(), f.types.array.default());
            assert.deepEqual(f.types.object.default(), {});
        });
    });
});
