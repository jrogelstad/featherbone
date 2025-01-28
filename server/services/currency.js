/*
    Framework for building object relational database apps
    Copyright (C) 2025  Featherbone LLC

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
/*jslint node*/
/**
    @module Currency
*/
/**
    @class Money
    @static
*/
/**
    @property currency
    @type String
*/
/**
    @property amount
    @type Number
*/
/**
    Conversion date
    @property effective
    @type String
    @optional
*/
/**
    Amount in base currency
    @property baseAmmount
    @type Number
    @optional
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const {Events} = require("./events");
    const {Tools} = require("./tools");
    const Big = require("../../node_modules/big.js/big.js");

    const db = new Database();
    const events = new Events();
    const tools = new Tools();
    const f = require("../../common/core");

    let baseCurrs;
    let currencies;

    function byEffective(a, b) {
        let aEffect = a.effective;
        let bEffect = b.effective;

        return (
            aEffect > bEffect
            ? -1
            : 1
        );
    }

    // Get currency info and listen for any subsequent changes
    function init() {
        return new Promise(function (resolve, reject) {
            let theId;

            function getCurrencies(obj) {
                return new Promise(function (resolve, reject) {
                    let sql;

                    sql = "SELECT to_json(_currency) AS result ";
                    sql += "FROM _currency;";

                    function callback(resp) {
                        currencies = tools.sanitize(resp.rows).map(
                            (row) => row.result
                        );
                        resolve(obj);
                    }

                    obj.client.query(sql).then(callback).catch(reject);
                });
            }

            function getBaseCurrencies(obj) {
                return new Promise(function (resolve, reject) {
                    let sql;

                    sql = "SELECT to_json(_base_currency) AS result ";
                    sql += "FROM _base_currency;";

                    function callback(resp) {
                        baseCurrs = tools.sanitize(resp.rows).map(
                            (row) => row.result
                        );
                        resolve(obj);
                    }

                    obj.client.query(sql).then(callback).catch(reject);
                });
            }

            function receiver(message) {
                let found;
                let data = message.payload.data;
                let change = message.payload.subscription.change;

                // Handle change to currency
                if (data.objectType === "Currency") {
                    if (change === "create") {
                        currencies.push(data);
                    } else {
                        found = currencies.find(
                            (currency) => currency.id === data.id
                        );

                        if (change === "delete") {
                            currencies.splice(currencies.indexOf(found), 1);
                        } else {
                            currencies.splice(
                                currencies.indexOf(found),
                                1,
                                data
                            );
                        }
                    }
                // Base currency records only ever get added
                } else {
                    baseCurrs.push(data);
                }
            }

            function subscribe(obj) {
                return new Promise(function (resolve, reject) {
                    let ids;
                    let subscription;

                    theId = db.nodeId + "$currency";

                    // Subscribe to changes to currency and new records
                    ids = currencies.map((currency) => currency.id);
                    ids.push("currency");
                    ids.push("base_currency");

                    subscription = {
                        nodeId: theId,
                        eventKey: theId,
                        id: theId
                    };

                    events.subscribe(
                        obj.client,
                        subscription,
                        ids
                    ).then(
                        resolve.bind(null, obj)
                    ).catch(
                        reject
                    );
                });
            }

            function listen(obj) {
                return new Promise(function (resolve, reject) {
                    events.listen(
                        obj.client,
                        theId,
                        receiver
                    ).then(
                        resolve
                    ).catch(
                        reject
                    );
                });
            }

            // Note the client stays open here listening for events
            Promise.resolve().then(
                db.connect
            ).then(
                getCurrencies
            ).then(
                getBaseCurrencies
            ).then(
                subscribe
            ).then(
                listen
            ).then(
                resolve
            ).catch(
                reject
            );
        });
    }

    /**
        Currency conversion service.

        @class Currency
        @constructor
        @namespace Services
    */
    exports.Currency = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Resolves to a base currency object based on an effective date.

            @method baseCurrency
            @param {Object} [payload] Payload
            @param {String} [payload.data] Arguments.
            @param {String} [payload.data.effective] ISO formatted date.
                Default today.
            @return {Promise} Resolves to base currency record.
        */
        that.baseCurrency = function (obj) {
            return new Promise(function (resolve, reject) {
                let effective = (
                    obj.data.effective
                    ? new Date(obj.data.effective).toDate()
                    : new Date()
                );

                function calculate() {
                    let current;
                    let baseCurr;

                    baseCurrs.sort(byEffective);
                    current = baseCurrs.find(function (item) {
                        return new Date(item.effective) <= effective;
                    });

                    if (!current) {
                        current = baseCurrs[baseCurrs.length - 1];
                    }

                    current = current.currency.code;

                    baseCurr = currencies.find(function (currency) {
                        return currency.code === current;
                    });

                    resolve(baseCurr);
                }

                if (baseCurrs) {
                    calculate();
                    return;
                }

                init(obj).then(
                    calculate
                ).catch(
                    reject
                );
            });
        };

        /**
            Resolves to a base currency money object populated with the base
            currency amount.

            @method convertCurrency
            @param {Object} payload Payload
            @param {Client} payload.client Database client
            @param {Object} payload.data Arguments
            @param {String} payload.data.fromCurrency Currency code from
            @param {Number} payload.data.amount Amount
            @param {String} [payload.data.toCurrency] Target currency code.
                Default base.
            @param {String} [payload.data.effective] ISO formatted date.
                Default today.
            @return {Promise} Resolves to {{#crossLink "Money"}}{{/crossLink}}
        */
        that.convertCurrency = function (obj) {
            return new Promise(function (resolve, reject) {
                let baseCurr;
                let err;
                let eff;
                let fromCurr = obj.data.fromCurrency;
                let fromAmount = obj.data.amount;
                let msg;
                let client = obj.client;

                // Advance date to next day so we get latest conversion for
                // that day
                eff = (
                    f.parseDate(obj.data.effective || f.today()).toDate()
                );
                eff.setDate(eff.getDate() + 1);

                if (obj.data.toCurrency) {
                    msg = "Conversion to a specific currency is not";
                    msg += "implemented yet.";
                    err = new Error(msg);
                    err.statusCode = "501";
                    reject(err);
                    return;
                }

                function calculate(resp) {
                    let conv;
                    let amt;

                    if (!resp.rows.length) {
                        msg = "Conversion not found for ";
                        msg += fromCurr + " to " + baseCurr.code + " on ";
                        msg += eff.toLocaleString();
                        err = new Error(msg);
                        err.statusCode = "404";
                        reject(err);
                        return;
                    }

                    conv = tools.sanitize(resp.rows[0]);
                    if (conv.fromCurrency.code === baseCurr.code) {
                        amt = new Big(
                            fromAmount
                        ).div(
                            conv.ratio
                        ).round(
                            baseCurr.minorUnit
                        ).valueOf() - 0;
                    } else {
                        amt = new Big(
                            fromAmount
                        ).times(
                            conv.ratio
                        ).round(
                            baseCurr.minorUnit
                        ).valueOf() - 0;
                    }

                    resolve({
                        currency: baseCurr.code,
                        amount: amt,
                        effective: undefined,
                        baseAmount: undefined
                    });
                }

                function getConversion(resp) {
                    let sql;
                    let params;

                    baseCurr = resp;

                    // If already base currency, just return
                    if (fromCurr === baseCurr.code) {
                        resolve({
                            currency: fromCurr,
                            amount: fromAmount,
                            effective: undefined,
                            baseAmount: undefined
                        });
                        return;
                    }

                    sql = "SELECT * FROM _currency_conversion ";
                    sql += "WHERE (from_currency).code IN ($1, $2) ";
                    sql += "AND (to_currency).code IN ($1,$2) ";
                    sql += "AND effective < $3 ";
                    sql += "ORDER BY effective DESC ";
                    sql += "LIMIT 1;";

                    params = [
                        fromCurr,
                        baseCurr.code,
                        eff.toISOString()
                    ];

                    client.query(sql, params).then(
                        calculate
                    ).catch(
                        reject
                    );
                }

                that.baseCurrency({
                    data: {
                        effective: eff
                    }
                }).then(
                    getConversion
                ).catch(
                    reject
                );
            });
        };


        return that;
    };

}(exports));

