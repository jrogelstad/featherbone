/*jslint node*/
/**
    Settles the costs of inventory transactions posted before posting
    settled them (stock/triggers-inventory-transaction.js).

    A posted transaction is a completed one, with its costs in the base
    currency, so each cost gets the transaction's date as `effective` and
    its base amount from the framework's money_base. Until then every
    figure and list that added them up looked the base currency up for
    each one: five columns of a demo's 109,000 transactions took most of
    a minute.

    Runs at every deploy and only touches costs with no `effective`, so a
    redeploy changes nothing.

    @module StockInventoryTransactionSettle
*/
(function (exports) {
    "use strict";

    const COSTS = [
        "material_cost",
        "labor_cost",
        "service_cost",
        "overhead_cost",
        "total_cost"
    ];

    function settled(col) {
        return (
            col + " = CASE WHEN (" + col + ").amount IS NOT NULL " +
            "AND (" + col + ").effective IS NULL " +
            "AND money_base(" + col + ", date) IS NOT NULL " +
            "THEN ROW((" + col + ").amount, (" + col + ").currency, " +
            "date::timestamptz, money_base(" + col + ", date))::mono " +
            "ELSE " + col + " END"
        );
    }

    const SQL = (
        "UPDATE inventory_transaction SET " +
        COSTS.map(settled).join(", ") + " " +
        "WHERE date IS NOT NULL AND (" +
        COSTS.map(function (col) {
            return (
                "((" + col + ").amount IS NOT NULL " +
                "AND (" + col + ").effective IS NULL)"
            );
        }).join(" OR ") + ");"
    );

    exports.execute = async function (obj) {
        await obj.client.query(SQL);
    };

}(exports));
