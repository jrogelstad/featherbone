/*global datasource*/
(function (datasource) {
  "strict";

  var f = require("./common/core"),
    jsonpatch = require("fast-json-patch");

  var doUpsertTable = function (obj) {
    var afterSaveFeather,
      client = obj.client,
      callback = obj.callback,
      table = obj.data,
      id = table.id || f.createId(),
      feather = f.copy(table);

    afterSaveFeather =function (err, ignore) {
      if (err) {
        callback(err);
        return;
      }

      // Now handle the table as regular data
      if (!table.id) {
        datasource.request({
          method: "POST",
          name: "doInsert",
          data: {
            name: "Table",
            data: table
          },
          client: client,
          callback: callback
        }, true);
      } else {
        datasource.request({
          method: "POST",
          name: "doUpsert",
          id: id,
          data: {
            name: "Table",
            data: table
          },
          client: client,
          callback: callback
        }, true);
      }
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

  datasource.registerFunction("POST", "Table", doUpsertTable);

  var doUpdateTable = function (obj) {
    var afterTable, afterUpdate, proposed, patches, actual, original,
      client = obj.client,
      callback = obj.callback,
      table = obj.data,
      id = table.id;

    afterTable = function (err, resp) {
      if (err) {
        callback(err);
        return;
      }

      original = f.copy(resp);
      jsonpatch.apply(resp, obj);
      proposed = f.copy(resp);
      actual = f.copy(resp);
      patches = jsonpatch.compare(original, resp);

      datasource.request({
        method: "POST",
        name: "doUpdate",
        client: client,
        callback: afterUpdate,
        id: id,
        data: {
          name: "Table",
          data: patches
        }
      });
    };

    afterUpdate = function (err, resp) {
      if (err)  {
        callback(err);
        return;
      }

      jsonpatch.apply(actual, resp);
      patches = jsonpatch.compare(proposed, actual);
      callback(null, patches);
    };

    datasource.request({
      method: "GET",
      name: "Table",
      client: client,
      callback: afterTable,
      id: id
    }, true);
  };

  datasource.registerFunction("PATCH", "Table", doUpdateTable);

  var doDeleteTable = function (obj) {
    var afterDelete;

    try {
      // Delete table
      datasource.request({
        method: "POST",
        name: "doDelete",
        client: obj.client,
        callback: afterDelete,
        data: {
          name: "Table",
          id: obj.id
        }
      }, true);
    } catch (e) {
      obj.callback(e);
    }

    afterDelete = function (err) {
      obj.callback(err, true);
    };
  };

  datasource.registerFunction("DELETE", "Table", doDeleteTable);

}(datasource));
