/*
    The names the framework will act on when it creates, clones or
    drops a database (tenant plan D.2).

    Everything the database API does with a name goes through
    datasource.databaseName first: it folds the name the way Postgres
    folds an unquoted identifier, so the name can be compared with
    pg_database before it is used, and it refuses anything that is not
    a plain name. The refusal of the cluster's own databases and of the
    manager needs configuration, so it is covered by the manager API
    suite instead.
*/
/*jslint node*/
"use strict";

const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const datasource = require("../../server/datasource");

describe("database names", function () {
    it("folds a name the way Postgres folds an identifier", function () {
        assert.equal(datasource.databaseName("Demo"), "demo");
        assert.equal(datasource.databaseName("  demo  "), "demo");
        assert.equal(datasource.databaseName("JOB_SHOP_2"), "job_shop_2");
    });

    it("accepts the shapes Postgres accepts unquoted", function () {
        assert.equal(datasource.databaseName("demo"), "demo");
        assert.equal(datasource.databaseName("_demo"), "_demo");
        assert.equal(datasource.databaseName("demo$1"), "demo$1");
    });

    it("refuses a name that is not a plain identifier", function () {
        [
            "", " ", "1demo", "demo-1", "demo one", "demo;drop", "demo\"x",
            "demo'x", "demo(", "démo", undefined, null
        ].forEach(function (name) {
            assert.equal(
                datasource.databaseName(name),
                undefined,
                JSON.stringify(name) + " should be refused"
            );
        });
    });

    it("refuses a name longer than Postgres allows", function () {
        let ok = "d".repeat(63);
        let tooLong = "d".repeat(64);

        assert.equal(datasource.databaseName(ok), ok);
        assert.equal(datasource.databaseName(tooLong), undefined);
    });
});
