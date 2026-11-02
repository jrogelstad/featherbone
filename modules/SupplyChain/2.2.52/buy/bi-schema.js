/*jslint node*/
/**
    The `bi` table the purchasing tiles read from, created at deploy.
    IF NOT EXISTS throughout, so a redeploy keeps the figures. The schema
    and bi.refresh_log belong to sell/bi-schema.js, which runs first.

    @module BuyBiSchema
*/
(function (exports) {
    "use strict";

    const SQL = [
        "CREATE SCHEMA IF NOT EXISTS bi;",

        // One row per (measure, day, item, supplier, site).
        (
            "CREATE TABLE IF NOT EXISTS bi.purchase_daily (" +
            "measure text NOT NULL, " +
            "bucket_date date NOT NULL, " +
            "item_pk bigint, " +
            "supplier_pk bigint, " +
            "site_pk bigint, " +
            "amount numeric NOT NULL DEFAULT 0, " +
            "units numeric NOT NULL DEFAULT 0);"
        ),

        (
            "CREATE INDEX IF NOT EXISTS purchase_daily_measure_date_idx " +
            "ON bi.purchase_daily (measure, bucket_date);"
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
