/*jslint node*/
/**
    The `bi` table the inventory tiles read from, created at deploy.
    IF NOT EXISTS throughout, so a redeploy keeps the figures. The schema
    and bi.refresh_log belong to sell/bi-schema.js; the schema is created
    here too so this does not depend on which module deploys first.

    Unlike the sales, purchasing and production tables, which hold what
    happened on a day, this holds what each day did to the balance: the
    net change in value and quantity. A balance on any date is the running
    total up to it, which is how one table answers both "what is on hand
    now" and "what was on hand a year ago".

    @module StockBiSchema
*/
(function (exports) {
    "use strict";

    const SQL = [
        "CREATE SCHEMA IF NOT EXISTS bi;",

        // One row per (measure, day, item, site). Only one measure
        // ('inventory'); value in `amount`, quantity in `units`.
        (
            "CREATE TABLE IF NOT EXISTS bi.inventory_daily (" +
            "measure text NOT NULL, " +
            "bucket_date date NOT NULL, " +
            "item_pk bigint, " +
            "site_pk bigint, " +
            "amount numeric NOT NULL DEFAULT 0, " +
            "units numeric NOT NULL DEFAULT 0);"
        ),

        (
            "CREATE INDEX IF NOT EXISTS inventory_daily_measure_date_idx " +
            "ON bi.inventory_daily (measure, bucket_date);"
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
