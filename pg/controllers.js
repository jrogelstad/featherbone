/*global datasource*/
(function (datasource) {
  "strict";

  var f = require("./common/core");

  var doUpsertTable = function (obj) {
    var afterSaveFeather,
      client = obj.client,
      callback = obj.callback,
      table = obj.data,
      feather = f.copy(table);

    afterSaveFeather = function (err, ignore) {
      if (err) {
        callback(err);
        return;
      }

      callback(null, obj);
    };

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
      client: client,
      callback: afterSaveFeather
    }, true);
  };

  datasource.registerFunction("POST", "Table", doUpsertTable, datasource.TRIGGER_BEFORE);

}(datasource));
