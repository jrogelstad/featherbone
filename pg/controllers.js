/*global datasource*/
(function (datasource) {
  "strict";

  var f = require("./common/core"),
    jsonpatch = require("fast-json-patch");

  function doUpsertTableSpec (obj) {
    return new Promise (function (resolve, reject) {
      var table = obj.data,
        feather = f.copy(table);

      // Save the table as a feather in the catalog
      var props = feather.properties;
      feather.properties = {};
      props.forEach(function (prop) {
        feather.properties[prop.name] = prop;
        delete prop.name;
      });

      datasource.request({
        method: "PUT",
        name: "saveFeather",
        data: {
          specs: feather
        },
        client: obj.client
      }, true)
      .then(resolve)
      .catch(reject);
    });
  }

  datasource.registerFunction("POST", "TableSpec", doUpsertTableSpec,
    datasource.TRIGGER_BEFORE);

  function checkCurrencyConversion (conv) {
    // Sanity check
    if (conv.fromCurrency.id === conv.toCurrency.id) {
      throw "'From' currency cannot be the same as the 'to' currency.";
    }

    if (conv.ratio <= 0) {
      throw "The conversion ratio nust be a positive number.";
    }
  }

  function doInsertCurrencyConversion (obj) {
    return new Promise (function (resolve) {
      checkCurrencyConversion(obj.data);
      resolve();
    });  
  }

  datasource.registerFunction("POST", "CurrencyConversion",
    doInsertCurrencyConversion, datasource.TRIGGER_BEFORE);

  function doUpdateCurrencyConversion (obj) {
    return new Promise (function (resolve, reject) {
      function callback (result) {
        jsonpatch.apply(result, obj.data);
        checkCurrencyConversion(result);
        resolve();
      }

      datasource.request({
        method: "GET",
        name: "CurrencyConversion",
        id: obj.id,
        client: obj.client
      }, true)
        .then(callback)
        .catch(reject);
    });
  }

  datasource.registerFunction("PATCH", "CurrencyConversion",
    doUpdateCurrencyConversion, datasource.TRIGGER_BEFORE);

}(datasource));
