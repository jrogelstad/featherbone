/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*global datasource*/
/*jslint node browser*/
(function (datasource) {
    "use strict";

    let f = require("./common/core");

    /**
      Table specification
    */
    function doUpsertTableSpec(obj) {
        return new Promise(function (resolve, reject) {
            let payload;
            let table = obj.newRec;
            let feather = f.copy(table);

            // Save the table as a feather in the catalog
            let props = feather.properties;
            feather.properties = {};
            props.forEach(function (prop) {
                feather.properties[prop.name] = prop;
                delete prop.name;
            });

            payload = {
                method: "PUT",
                name: "saveFeather",
                data: {
                    specs: feather
                },
                client: obj.client
            };

            datasource.request(payload, true).then(resolve).catch(reject);
        });
    }

    datasource.registerFunction(
        "POST",
        "TableSpec",
        doUpsertTableSpec,
        datasource.TRIGGER_BEFORE
    );

    datasource.registerFunction(
        "PATCH",
        "TableSpec",
        doUpsertTableSpec,
        datasource.TRIGGER_BEFORE
    );

    /**
      Contact
    */
    function handleContact(obj) {
        return new Promise(function (resolve) {
            let newRec = obj.newRec;

            if (newRec.firstName) {
                newRec.fullName = newRec.firstName + " " + newRec.lastName;
            } else {
                newRec.fullName = newRec.lastName;
            }

            resolve();
        });
    }

    datasource.registerFunction(
        "POST",
        "Contact",
        handleContact,
        datasource.TRIGGER_BEFORE
    );

    datasource.registerFunction(
        "PATCH",
        "Contact",
        handleContact,
        datasource.TRIGGER_BEFORE
    );

    /**
      Currency
    */
    function doUpdateCurrencyBefore(obj) {
        return new Promise(function (resolve) {
            if (obj.oldRec.code !== obj.newRec.code) {
                throw new Error(
                    "Currency code '" + obj.oldRec.code +
                    "' may not be changed"
                );
            }

            resolve();
        });
    }

    datasource.registerFunction(
        "PATCH",
        "Currency",
        doUpdateCurrencyBefore,
        datasource.TRIGGER_BEFORE
    );

    function handleCurrency(obj) {
        return new Promise(function (resolve, reject) {
            let payload;
            let curr = obj.newRec;

            // Create a base currency effectivity record
            function insertBaseEffective() {
                return new Promise(function (resolve, reject) {
                    payload = {
                        method: "POST",
                        name: "BaseCurrency",
                        data: {
                            currency: curr
                        },
                        client: obj.client
                    };

                    datasource.request(payload, true).then(
                        resolve
                    ).catch(
                        reject
                    );
                });
            }

            // Find any other currency tagged as base and update
            function updatePrevBase() {
                return new Promise(function (resolve, reject) {

                    function callback(result) {
                        let data;

                        if (result.length) {
                            data = result[0];
                            data.isBase = false;

                            payload = {
                                method: "POST",
                                name: "Currency",
                                id: data.id,
                                data: data,
                                client: obj.client
                            };

                            datasource.request(payload, true).then(
                                resolve
                            ).catch(
                                reject
                            );

                            return;
                        }

                        resolve();
                    }

                    payload = {
                        method: "GET",
                        name: "Currency",
                        filter: {
                            criteria: [{
                                property: "isBase",
                                value: true
                            }, {
                                property: "id",
                                operator: "!=",
                                value: curr.id
                            }]
                        },
                        client: obj.client
                    };

                    datasource.request(payload, true).then(
                        callback
                    ).catch(
                        reject
                    );
                });
            }

            if (curr.isBase && (!obj.oldRec || !obj.oldRec.isBase)) {
                Promise.resolve().then(
                    insertBaseEffective
                ).then(
                    updatePrevBase
                ).then(
                    resolve
                ).catch(
                    reject
                );

                return;
            }

            resolve();
        });
    }

    datasource.registerFunction(
        "POST",
        "Currency",
        handleCurrency,
        datasource.TRIGGER_AFTER
    );

    datasource.registerFunction(
        "PATCH",
        "Currency",
        handleCurrency,
        datasource.TRIGGER_AFTER
    );

    function doDeleteCurrency(obj) {
        return new Promise(function (resolve) {
            if (obj.oldRec.isBase) {
                throw new Error("Cannot delete the base currency.");
            }

            resolve();
        });
    }

    datasource.registerFunction(
        "DELETE",
        "Currency",
        doDeleteCurrency,
        datasource.TRIGGER_BEFORE
    );

    /**
      Currency conversion
    */
    function doCheckCurrencyConversion(obj) {
        return new Promise(function (resolve) {
            // Sanity check
            if (obj.newRec.fromCurrency.id === obj.newRec.toCurrency.id) {
                throw new Error(
                    "'From' currency cannot be the same as the 'to' currency."
                );
            }

            if (obj.newRec.ratio <= 0) {
                throw new Error(
                    "The conversion ratio nust be a positive number."
                );
            }

            resolve();
        });
    }

    datasource.registerFunction(
        "POST",
        "CurrencyConversion",
        doCheckCurrencyConversion,
        datasource.TRIGGER_BEFORE
    );

    datasource.registerFunction(
        "PATCH",
        "CurrencyConversion",
        doCheckCurrencyConversion,
        datasource.TRIGGER_BEFORE
    );

}(datasource));