/*jslint node*/
/**
    The "bi" schema the sales dashboard reads from, created when the
    package is deployed rather than the first time somebody presses
    Refresh.

    It used to be created by do-refresh-sales-bi.js, which meant a freshly
    deployed instance had no bi.sales_daily at all until a refresh ran.
    The dashboard asked whether the table existed to decide whether the
    figures had ever been built, so a missing table and an empty one
    looked the same; now the table is always there and the refresh log is
    what says whether anything has been rolled up. The two changes go
    together -- see do-get-sales-tile-data.js.

    The DDL lives here and nowhere else. Service scripts are run through
    `new Function("f", ...)` with no module scope, so a service cannot
    require this file, which is exactly why the refresh no longer carries
    its own copy: two copies of a schema is a schema with no owner.

    Everything is IF NOT EXISTS, so deploying again over an instance that
    already has the tables leaves the figures in them alone.

    @module BiSchema
*/
(function (exports) {
    "use strict";

    const SQL = [
        "CREATE SCHEMA IF NOT EXISTS bi;",

        // One row per (measure, day, item, customer, site, region).
        // Period windows are summed from these daily buckets at read
        // time, which is what lets the dashboard's reporting date be a
        // WHERE clause rather than a reason to re-run the rollup.
        (
            "CREATE TABLE IF NOT EXISTS bi.sales_daily (" +
            "measure text NOT NULL, " +
            "bucket_date date NOT NULL, " +
            "item_pk bigint, " +
            "customer_pk bigint, " +
            "site_pk bigint, " +
            "region text, " +
            "amount numeric NOT NULL DEFAULT 0, " +
            "units numeric NOT NULL DEFAULT 0);"
        ),

        (
            "CREATE INDEX IF NOT EXISTS sales_daily_measure_date_idx " +
            "ON bi.sales_daily (measure, bucket_date);"
        ),

        // When the rollup last ran, and what it found. A row here is
        // what the dashboard takes as "these figures have been built",
        // so an empty log on a deployed instance correctly reads as
        // "nothing rolled up yet" rather than as "no sales".
        (
            "CREATE TABLE IF NOT EXISTS bi.refresh_log (" +
            "job text NOT NULL, " +
            "refreshed timestamptz NOT NULL DEFAULT now(), " +
            "buckets bigint, " +
            "unmapped_states bigint);"
        )
    ];

    exports.execute = async function (obj) {
        let index = 0;

        while (index < SQL.length) {
            await obj.client.query(SQL[index]);
            index += 1;
        }
    };

}(exports));
