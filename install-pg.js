/**
    Featherbone is a JavaScript based persistence framework for building object
    relational database applications
    
    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

require("./common/extend-string.js");

var manifest, file, content, result, execute, name, createFunction, buildApi,
  saveModule, saveModels, rollback, connect, commit, begin, processFile, ext,
  client, user, processProperties, executeSql,
  pg = require("pg"),
  fs = require("fs"),
  path = require("path"),
  yaml = require("js-yaml"),
  datasource = require("./server/datasource"),
  pgConfig = require("./server/pgconfig"),
  f = require("./common/core.js"),
  filename = path.format({root: "/", dir: __dirname, base: "manifest.json"}),
  i = 0;

connect = function (callback) {
  pgConfig(function (config) {
    var conn = "postgres://" +
      config.user + ":" +
      config.password + "@" +
      config.server + "/" +
      config.database;

    user = config.user;
    client = new pg.Client(conn);

    client.connect(function (err) {
      if (err) {
        console.error(err);
        return;
      }

      callback();
    });
  });
};

begin = function () {
  client.query("BEGIN;", processFile);
};

commit = function (callback) {
  client.query("COMMIT;", function () {
    client.end();
    callback();
  });
};

rollback = function () {
  client.query("ROLLBACK;", function () {
    console.log("Install failed.");
    client.end();
  });
};

execute = function (filename) {
  var f = path.resolve(filename),
    exp = require(f),
    callback = function (err, resp) {
      if (err) {
        console.error(err);
        rollback();
      }

      processFile();
    };

  exp.execute({client: client, callback: callback});
};

createFunction = function (name, args, returns, volatility, script) {
  volatility = volatility || "VOLATILE";

  var keys, arg, txt,
    sql = "CREATE OR REPLACE function " + name + "(",
    ary = [],
    n = 0;

  if (args) {
    keys = Object.keys(args);

    while (n < keys.length) {
      arg = args[keys[n]];
      txt = keys[n] + " " + arg.type;

      if (arg.defaultValue) {
        txt += " default " + arg.defaultValue;
      }

      ary.push(txt);
      n++;
    }

    sql += ary.join(", ");
  }

  sql += ") RETURNS " + (returns || "void") + " AS $$" + script +
    "$$ LANGUAGE plv8 " + volatility + ";";

  client.query(sql, processFile);
};

processFile = function (err) {
  if (err) {
    console.error(err);
    rollback();
    return;
  }

  file = manifest.files[i];
  i++;

  // If we've processed all the files, wrap this up
  if (!file) {
    commit(buildApi);
    return;
  }

  filename = file.path;
  ext = path.extname(filename);
  name = path.parse(filename).name;

  fs.readFile(filename, "utf8", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    content = data;

    console.log("Installing " + filename);

    switch (file.type) {
    case "execute":
      execute(filename);
      break;
    case "function":
      createFunction(name, file.args, file.returns, file.volatility, content);
      break;
    case "module":
      saveModule(file.name || name, content, manifest.version);
      break;
    case "model":
      saveModels(JSON.parse(content));
      break;
    case "sql":
      executeSql(content);
      break;
    default:
      console.error("Unknown type.");
      rollback();
      return;
    }
  });
};

saveModule = function (name, script, version) {
  var sql = "SELECT * FROM \"$module\" WHERE name='" + name + "';";

  client.query(sql, function (err, result) {
    if (err) {
      rollback();
      console.error(err);
      return;
    }
    if (result.rows.length) {
      sql = "UPDATE \"$module\" SET " +
        "script=$$" + script + "$$," +
        "version='" + version + "' " +
        "WHERE name='" + name + "';";
    } else {
      sql = "INSERT INTO \"$module\" VALUES ('" + name +
        "',$$" + script + "$$, '" + version + "');";
    }

    client.query(sql, processFile);
  });
};

saveModels = function (models) {
  var callback, payload;

  callback = function (err) {
    if (err) {
      console.error(err);
      rollback();
      return;
    }

    processFile();
  };

  payload = {
    method: "PUT",
    name: "saveModel",
    user: user,
    data: {
      specs: models,
      client: client,
      callback: callback
    }
  };

  datasource.request(payload);
};

executeSql = function (sql) {
  client.query(sql, function (err, result) {
    if (err) {
      rollback();
      console.error(err);
      return;
    }

    processFile();
  });
};

buildApi = function () {
  var swagger, catalog, sql, payload, keys;

  console.log("Building swagger API");

  // Load the baseline swagger file
  fs.readFile("config/swagger-base.yaml", "utf8", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    swagger = yaml.safeLoad(data);

    // Load the existing model catalog from postgres
    connect(function (err) {
      if (err) {
        console.error(err);
        return;
      }

      payload = {
        method: "POST",
        name: "getSettings",
        user: "postgres",
        data: "catalog"
      };
      sql = "SELECT request($$" + JSON.stringify(payload) + "$$) as response;";

      // ...execute query
      client.query(sql, function (err, resp) {
        var definitions = swagger.definitions;

        if (err) {
          console.error(err);
          return;
        }

        catalog = resp.rows[0].response;

        // Loop through each model and append to swagger api
        keys = Object.keys(catalog);
        keys.forEach(function (key) {
          var definition, path,
            model = catalog[key],
            properties = {},
            inherits = model.inherits || "Object",
            pathName = "/" + key.toSpinalCase() + "/{id}",
            name = key.toProperCase();

          model.name = key; // For error trapping later

          // Append singluar path
          if (!model.isChild) {
            path = {
              "x-swagger-router-controller": "data",
              get: {
                summary: "Info for a specific " + name,
                operationId: "doHandleOne",
                parameters: [
                  {
                    name: "id",
                    in: "path",
                    description: "The id of the " + name + " to retrieve",
                    type: "string"
                  }
                ],
                responses: {
                  200: {
                    description: "Expected response to a valid request",
                    schema: {
                      $ref: "#/definitions/" + key
                    }
                  },
                  default: {
                    description: "unexpected error",
                    schema: {
                      $ref: "#/definitions/ErrorResponse"
                    }
                  }
                }
              },
              patch: {
                summary: "Update an existing " + name,
                operationId: "doUpsert",
                parameters: [
                  {
                    name: "id",
                    in: "path",
                    description: "The id of the " + name + " to update",
                    type: "string"
                  }
                ],
                responses: {
                  200: {
                    description: "Expected response to a valid request",
                    schema: {
                      $ref: "#/definitions/RequestResponse"
                    }
                  },
                  default: {
                    description: "unexpected error",
                    schema: {
                      $ref: "#/definitions/ErrorResponse"
                    }
                  }
                }
              },
              delete: {
                summary: "Delete a " + name,
                operationId: "doHandleOne",
                parameters: [
                  {
                    name: "id",
                    in: "path",
                    description: "The id of the " + name + " to delete",
                    type: "string"
                  }
                ],
                responses: {
                  200: {
                    description: "Expected response to a valid request",
                    schema: {
                      $ref: "#/definitions/RequestResponse"
                    }
                  },
                  default: {
                    description: "unexpected error",
                    schema: {
                      $ref: "#/definitions/ErrorResponse"
                    }
                  }
                }
              },
            };

            swagger.paths[pathName] = path;

            // Append list path
            if (model.plural) {
              path = {
                "x-swagger-router-controller": "data",
                get: {
                  description: key + " data",
                  operationId: "doGet",
                  parameters: [
                    {
                      name: "offset",
                      in: "query",
                      description: "Offset from first item",
                      required: false,
                      type: "integer",
                      format: "int32"
                    },
                    {
                      name: "limit",
                      in: "query",
                      description: "How many items to return",
                      required: false,
                      type: "integer",
                      format: "int32"
                    }
                  ],
                  responses: {
                    200: {
                      description: "Array of " + model.plural.toProperCase(),
                      schema: {
                        $ref: "#/definitions/" + model.plural
                      }
                    },
                    default: {
                      description: "Error",
                      schema: {
                        $ref: "#/definitions/ErrorResponse"
                      }
                    }
                  }
                },
                post: {
                  summary: "Add a new " + name + " to the database",
                  operationId: "doUpsert",
                  responses: {
                    200: {
                      description: "Expected response to a valid request",
                      schema: {
                        $ref: "#/definitions/RequestResponse"
                      }
                    },
                    default: {
                      description: "unexpected error",
                      schema: {
                        $ref: "#/definitions/PgErrorResponse"
                      }
                    }
                  }
                }
              };

              pathName = "/" + model.plural.toSnakeCase();
              swagger.paths[pathName] = path;
            }
          }

          // Append singular model definition
          definition = {};

          if (model.description) {
            definition.description = model.description;
          }

          if (model.discriminator) {
            definition.discriminator = model.discriminator;
          }

          processProperties(model, properties);

          if (key === "Object") {
            definition.properties = properties;
          } else {
            definition.allOf = [
              {$ref: "#/definitions/" + inherits},
              {properties: properties}
            ];
          }

          if (model.required) {
            definition.required = model.required;
          }

          definitions[key] = definition;

          // Append plural definition
          if (model.plural) {
            definitions[model.plural] = {
              type: "array",
              items: {
                $ref: "#/definitions/" + key
              }
            };
          }
        });

        // Save swagger file
        data = yaml.safeDump(swagger);
        fs.writeFile("swagger.yaml", data, function (err) {
          if (err) {
            console.error(err);
            return;
          }

          console.log("Install completed!");
          client.end();
          process.exit();
        });
      });
    });
  });
};

processProperties = function (model, properties) {
  var keys = Object.keys(model.properties);

  keys.forEach(function (key) {
    var property = model.properties[key], newProperty,
      primitives = Object.keys(f.types),
      formats = Object.keys(f.formats);

    // Bail if child property. Not necessary for api definition
    if (typeof property.type === "object" && property.type.childOf) { return; }

    newProperty = {};

    if (property.description) {
      newProperty.description = property.description;
    }

    if (typeof property.type === "object") {
      newProperty.type = property.type.parentOf ? "array" : "object";
      newProperty.items = {
        $ref: "#/definitions/" + property.type.relation
      };
    } else {
      if (primitives.indexOf(property.type) !== -1) {
        newProperty.type = property.type;
      } else {
        console.error("Property type " + property.type +
          " not supported on " + key + " for model " + model.name);
        process.exit(1);
      }

      if (property.format) {
        if (formats.indexOf(property.format) !== -1) {
          newProperty.format = property.format.toSpinalCase();
        } else {
          console.error("Property format " + property.format +
            " not supported on " + key + " for model " + model.name);
          process.exit(1);
        }
      }
    }

    properties[key] = newProperty;
  });
};

/* Real work starts here */
fs.readFile(filename, "utf8", function (err, data) {
  if (err) {
    console.error(err);
    return;
  }

  manifest = JSON.parse(data);
  connect(begin);
});


