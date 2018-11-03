/*global datasource, Promise*/
/*jslint node*/
(function (datasource) {
    "strict";

    var f = require("./common/core"),
        jsonpatch = require("fast-json-patch");

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
            if (obj.data.firstName) {
                obj.data.fullName = obj.data.firstName + " " + obj.data.lastName;
            } else {
                obj.data.fullName = obj.data.lastName;
            }

            resolve();
        });
    }

    datasource.registerFunction("POST", "Contact",
            handleContact, datasource.TRIGGER_BEFORE);

    function doUpdateContact(obj) {
        return new Promise(function (resolve, reject) {
            function callback(result) {
                var newRec;

                // Apply changes submitted to copy of current
                newRec = f.copy(result);
                jsonpatch.apply(newRec, obj.data);

                function done() {
                    // Update patch
                    obj.data = jsonpatch.compare(result, newRec);

                    resolve();
                }

                // Add subtotal
                handleContact({data: newRec})
                    .then(done)
                    .catch(reject);
            }

            datasource.request({
                method: "GET",
                name: "Contact",
                id: obj.id,
                client: obj.client
            }, true)
                .then(callback)
                .catch(reject);
        });
    }

    datasource.registerFunction("PATCH", "Contact", doUpdateContact,
            datasource.TRIGGER_BEFORE);

    /**
      Currency
    */
    function handleCurrency(obj) {
        return new Promise(function (resolve, reject) {
            var payload,
                curr = obj.data;

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

    function doUpdateCurrencyBefore(obj) {
        return new Promise(function (resolve, reject) {
            var payload;

            function callback(result) {
                var oldCode = result.code;

                jsonpatch.apply(result, obj.data);

                if (oldCode !== result.code) {
                    throw new Error("Currency code '" + oldCode + "' may not be changed");
                }

                resolve();
            }

            payload = {
                method: "GET",
                name: "Currency",
                id: obj.id,
                client: obj.client
            };

            datasource.request(payload, true)
                .then(callback)
                .catch(reject);
        });
    }

    datasource.registerFunction("PATCH", "Currency",
            doUpdateCurrencyBefore, datasource.TRIGGER_BEFORE);

    function doUpdateCurrencyAfter(obj) {
        return new Promise(function (resolve, reject) {
            var payload;

            function callback(result) {
                var arg;

                jsonpatch.apply(result, obj.data);
                arg = {
                    client: obj.client,
                    id: result.id,
                    data: result
                };
                handleCurrency(arg).then(resolve).catch(reject);
            }

            payload = {
                method: "GET",
                name: "Currency",
                id: obj.id,
                client: obj.client
            };

            datasource.request(payload, true)
                .then(callback)
                .catch(reject);
        });
    }

    datasource.registerFunction("PATCH", "Currency",
            doUpdateCurrencyAfter, datasource.TRIGGER_AFTER);

    function doDeleteCurrency(obj) {
        return new Promise(function (resolve, reject) {
            var payload;

            function callback(result) {
                if (result.isBase) {
                    throw "Cannot delete the base currency.";
                }

                resolve();
            }

            payload = {
                method: "GET",
                name: "Currency",
                id: obj.id,
                client: obj.client
            };

            datasource.request(payload, true)
                .then(callback)
                .catch(reject);
        });
    }

    datasource.registerFunction("DELETE", "Currency",
            doDeleteCurrency, datasource.TRIGGER_BEFORE);

    /**
      Currency conversion
    */
    function checkCurrencyConversion(conv) {
        // Sanity check
        if (conv.fromCurrency.id === conv.toCurrency.id) {
            throw "'From' currency cannot be the same as the 'to' currency.";
        }

        if (conv.ratio <= 0) {
            throw "The conversion ratio nust be a positive number.";
        }
    }

    function doInsertCurrencyConversion(obj) {
        return new Promise(function (resolve) {
            checkCurrencyConversion(obj.data);
            resolve();
        });
    }

    datasource.registerFunction("POST", "CurrencyConversion",
            doInsertCurrencyConversion, datasource.TRIGGER_BEFORE);

    function doUpdateCurrencyConversion(obj) {
        return new Promise(function (resolve, reject) {
            var payload;

            function callback(result) {
                jsonpatch.apply(result, obj.data);
                checkCurrencyConversion(result);
                resolve();
            }

            payload = {
                method: "GET",
                name: "CurrencyConversion",
                id: obj.id,
                client: obj.client
            };

            datasource.request(payload, true)
                .then(callback)
                .catch(reject);
        });
    }

    datasource.registerFunction("PATCH", "CurrencyConversion",
            doUpdateCurrencyConversion, datasource.TRIGGER_BEFORE);

}(datasource));