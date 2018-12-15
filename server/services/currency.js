/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
**/
/*global Promise*/
/*jslint node, es6*/
(function (exports) {
    "strict";

    const {
        Database
    } = require("../database");
    const {
        Events
    } = require("./events");
    const {
        Tools
    } = require("./tools");
    const Big = require("../../node_modules/big.js/big.js");

    const db = new Database();
    const events = new Events();
    const tools = new Tools();

    var baseCurrs, currencies;

    function byEffective(a, b) {
        var aEffect = a.effective,
            bEffect = b.effective;

        return aEffect > bEffect
            ? -1
            : 1;
    }

    // Get currency info and listen for any subsequent changes
    function init() {
        return new Promise(function (resolve, reject) {
            var id;

            function getCurrencies(obj) {
                return new Promise(function (resolve, reject) {
                    var sql = "SELECT to_json(_currency) AS result FROM _currency;";

                    function callback(resp) {
                        currencies = tools.sanitize(resp.rows).map((row) => row.result);
                        resolve(obj);
                    }

                    obj.client.query(sql)
                        .then(callback)
                        .catch(reject);
                });
            }

            function getBaseCurrencies(obj) {
                return new Promise(function (resolve, reject) {
                    var sql = "SELECT to_json(_base_currency) AS result FROM _base_currency;";

                    function callback(resp) {
                        baseCurrs = tools.sanitize(resp.rows).map((row) => row.result);
                        resolve(obj);
                    }

                    obj.client.query(sql)
                        .then(callback)
                        .catch(reject);
                });
            }

            function receiver(message) {
                var found,
                    data = message.payload.data,
                    change = message.payload.subscription.change;

                // Handle change to currency
                if (data.objectType === "Currency") {
                    if (change === "create") {
                        currencies.push(data);
                    } else {
                        found = currencies.find((currency) => currency.id === data.id);

                        if (change === "delete") {
                            currencies.splice(currencies.indexOf(found), 1);
                        } else {
                            currencies.splice(currencies.indexOf(found), 1, data);
                        }
                    }
                // Base currency records only ever get added
                } else {
                    baseCurrs.push(data);
                }
            }

            function subscribe(obj) {
                return new Promise(function (resolve, reject) {
                    var ids, subscription;

                    id = db.nodeId() + "$currency";

                    // Subscribe to changes to currency and new records
                    ids = currencies.map((currency) => currency.id);
                    ids.push("currency");
                    ids.push("base_currency");

                    subscription = {
                        nodeId: id,
                        sessionId: id,
                        id: id
                    };

                    events.subscribe(obj.client, subscription, ids)
                        .then(resolve.bind(null, obj))
                        .catch(reject);
                });
            }

            function listen(obj) {
                return new Promise(function (resolve, reject) {
                    events.listen(obj.client, id, receiver)
                        .then(resolve)
                        .catch(reject);
                });
            }

            // Note the client stays open here listening for events
            Promise.resolve()
                .then(db.connect)
                .then(getCurrencies)
                .then(getBaseCurrencies)
                .then(subscribe)
                .then(listen)
                .then(resolve)
                .catch(reject);
        });
    }

    exports.Currency = function () {
        // ..........................................................
        // PUBLIC
        //

        var that = {};

        /**
          Resolves to a base currency object based on an effective date.

          @param {Object} [payload] Payload
          @param {String} [payload.data] Arguments.
          @param {String} [payload.data.effective] ISO formatted effective date. Default today.
          @return {Object} Promise
        */
        that.baseCurrency = function (obj) {
            return new Promise(function (resolve, reject) {
                var effective = obj.data.effective
                    ? new Date(obj.data.effective).toDate()
                    : new Date();

                function calculate() {
                    var current, baseCurr;

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

                init(obj).then(calculate).catch(reject);
            });
        };

        /**
          Resolves to a base currency money object populated with the base currency amount.

          @param {Object} [payload] Payload
          @param {Object} [payload.client] Database client
          @param {String} [payload.data] Arguments
          @param {String} [payload.data.fromCurrency] Currency code to convert from
          @param {Number} [payload.data.amount] Amount
          @param {String} [payload.data.toCurrency] Target currencny to convert to. Default base.
          @param {String} [payload.data.effective] ISO formatted effective date. Default today.
          @return {Object} Promise
        */
        that.convertCurrency = function (obj) {
            return new Promise(function (resolve, reject) {
                var baseCurr, err,
                    effective = obj.data.effective
                        ? new Date(obj.data.effective).toDate()
                        : new Date(),
                    fromCurr = obj.data.fromCurrency,
                    fromAmount = obj.data.amount;

                if (obj.data.toCurrency) {
                    err = new Error("Conversion to a specific currency is not implemented yet.");
                    err.statusCode = "501";
                }

                function calculate(resp) {
                    var conv, amount;

                    if (!resp.rows.length) {
                        err = new Error("Conversion not found for " +
                                fromCurr + " to " + baseCurr.code + " on " + effective.toLocaleString());
                        err.statusCode = "404";
                    }

                    conv = tools.sanitize(resp.rows[0]);
                    if (conv.fromCurrency.code === baseCurr.code) {
                        amount = new Big(fromAmount)
                            .times(conv.ratio)
                            .round(baseCurr.minorUnit)
                            .valueOf() - 0;
                    } else {
                        amount = new Big(fromAmount)
                            .div(conv.ratio)
                            .round(baseCurr.minorUnit)
                            .valueOf() - 0;
                    }

                    resolve({
                        currency: baseCurr.code,
                        amount: amount,
                        effective: undefined,
                        ratio: undefined
                    });
                }

                function getConversion(resp) {
                    var sql, params;

                    baseCurr = resp;

                    // If already base currency, just return
                    if (fromCurr === baseCurr.code) {
                        resolve({
                            currency: fromCurr,
                            amount: fromAmount,
                            effective: undefined,
                            ratio: undefined
                        });
                        return;
                    }

                    sql = "SELECT * FROM _currency_conversion " +
                            "WHERE (from_currency).code IN ($1, $2) " +
                            "AND (to_currency).code IN ($1,$2) " +
                            "AND effective <= $3 " +
                            "ORDER BY effective DESC " +
                            "LIMIT 1;";

                    params = [
                        fromCurr,
                        baseCurr.code,
                        effective.toISOString()
                    ];

                    obj.client.query(sql, params)
                        .then(calculate)
                        .catch(reject);
                }

                that.baseCurrency({
                    data: {
                        effective: effective
                    }
                })
                    .then(getConversion)
                    .catch(reject);
            });
        };


        return that;
    };

}(exports));

