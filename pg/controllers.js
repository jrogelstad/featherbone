/*global datasource*/
(function (datasource) {
  "strict";

  var f = require("./common/core");

  var doUpsertTableSpec = function (obj) {
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
  };

  datasource.registerFunction("POST", "TableSpec", doUpsertTableSpec, datasource.TRIGGER_BEFORE);

}(datasource));
