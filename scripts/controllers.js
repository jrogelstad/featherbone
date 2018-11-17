/*global datasource, Promise*/
/*jslint node*/
(function (datasource) {
    "strict";

    var f = require("./common/core");

    /**
      Table specification
    */
    function doUpsertTableSpec(obj) {
        return new Promise(function (resolve, reject) {
            var payload,
                table = obj.data,
                feather = f.copy(table);

            // Save the table as a feather in the catalog
            var props = feather.properties;
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

            datasource.request(payload, true)
                .then(resolve)
                .catch(reject);
        });
    }

    datasource.registerFunction("POST", "TableSpec", doUpsertTableSpec,
            datasource.TRIGGER_BEFORE);

    /**
      Contact
    */
    function handleContact(obj) {
        return new Promise(function (resolve) {
            var newRec = obj.newRec;

            if (newRec.firstName) {
                newRec.fullName = newRec.firstName + " " + newRec.lastName;
            } else {
                newRec.fullName = newRec.lastName;
            }

            resolve();
        });
    }

    datasource.registerFunction("POST", "Contact",
            handleContact, datasource.TRIGGER_BEFORE);

    datasource.registerFunction("PATCH", "Contact",
            handleContact, datasource.TRIGGER_BEFORE);

    /**
      Currency
    */
    function doUpdateCurrencyBefore(obj) {
        return new Promise(function (resolve) {
            if (obj.oldRec.code !== obj.newRec.code) {
                throw new Error("Currency code '" + obj.oldRec.code + "' may not be changed");
            }

            resolve();
        });
    }

    datasource.registerFunction("PATCH", "Currency",
            doUpdateCurrencyBefore, datasource.TRIGGER_BEFORE);

    function handleCurrency(obj) {
        return new Promise(function (resolve, reject) {
            var payload,
                curr = obj.newRec;

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

                    datasource.request(payload, true)
                        .then(resolve)
                        .catch(reject);
                });
            }

            // Find any other currency tagged as base and update
            function updatePrevBase() {
                return new Promise(function (resolve, reject) {

                    function callback(result) {
                        var data;

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

                            datasource.request(payload, true)
                                .then(resolve)
                                .catch(reject);

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

                    datasource.request(payload, true)
                        .then(callback)
                        .catch(reject);
                });
            }

            if (curr.isBase) {
                Promise.resolve()
                    .then(insertBaseEffective)
                    .then(updatePrevBase)
                    .then(resolve)
                    .catch(reject);

                return;
            }

            resolve();
        });
    }

    datasource.registerFunction("POST", "Currency",
            handleCurrency, datasource.TRIGGER_AFTER);

    datasource.registerFunction("PATCH", "Currency",
            handleCurrency, datasource.TRIGGER_AFTER);

    function doDeleteCurrency(obj) {
        return new Promise(function (resolve) {
            if (obj.oldRec.isBase) {
                throw new Error("Cannot delete the base currency.");
            }

            resolve();
        });
    }

    datasource.registerFunction("DELETE", "Currency",
            doDeleteCurrency, datasource.TRIGGER_BEFORE);

    /**
      Currency conversion
    */
    function doCheckCurrencyConversion(obj) {
        return new Promise(function (resolve) {
            // Sanity check
            if (obj.newRec.fromCurrency.id === obj.newRec.toCurrency.id) {
                throw new Error("'From' currency cannot be the same as the 'to' currency.");
            }

            if (obj.newRec.ratio <= 0) {
                throw new Error("The conversion ratio nust be a positive number.");
            }

            resolve();
        });
    }

    datasource.registerFunction("POST", "CurrencyConversion",
            doCheckCurrencyConversion, datasource.TRIGGER_BEFORE);

    datasource.registerFunction("PATCH", "CurrencyConversion",
            doCheckCurrencyConversion, datasource.TRIGGER_BEFORE);

}(datasource));