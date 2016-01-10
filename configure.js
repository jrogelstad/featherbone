/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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

(function () {
  "strict";

  require("./common/extend-string.js");

  var manifest, file, content, result, execute, name, createFunction, buildApi,
    saveModule, saveFeathers, rollback, connect, commit, begin, processFile, ext,
    client, user, processProperties, executeSql, runBatch,
    pg = require("pg"),
    fs = require("fs"),
    path = require("path"),
    datasource = require("./server/datasource"),
    pgConfig = require("./server/pgconfig"),
    f = require("./common/core.js"),
    format = require("pg-format"),
    dir = path.resolve(__dirname, process.argv[2] || "."),
    filename = path.format({root: "/", dir: dir, base: "manifest.json"}),
    i = 0;

  connect = function (callback) {
    pgConfig(function (config) {
      var conn = "postgres://" +
        config.user + ":" +
        config.password + "@" +
        config.server + ":" +
        config.port + "/" +
        config.database;

      user = config.user;
      client = new pg.Client(conn);

      client.connect(function (err) {
        if (err) { return console.error(err); }

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
      console.error("Configuration failed.");
      client.end();
      process.exit();
    });
  };

  execute = function (filename) {
    var dep = path.resolve(filename),
      exp = require(dep),
      callback = function (err, resp) {
        if (err) {
          console.error(err);
          rollback();
        }

        processFile();
      };

    exp.execute({user: user, client: client, callback: callback});
  };

  processFile = function (err) {
    var filepath;

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
    filepath = path.format({root: "/", dir: dir, base: filename});

    fs.readFile(filepath, "utf8", function (err, data) {
      if (err) {
        console.error(err);
        return;
      }

      content = data;

      console.log("Configuring " + filename);

      switch (file.type) {
      case "execute":
        execute(filename);
        break;
      case "module":
        saveModule(file.name || name, content, manifest.version);
        break;
      case "feather":
        saveFeathers(JSON.parse(content));
        break;
      case "batch":
        runBatch(JSON.parse(content));
        break;
      case "workbook":
        saveWorkbooks(JSON.parse(content));
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

  saveFeathers = function (feathers) {
    var callback, payload;

    callback = function (err) {
      if (err) {
        rollback();
        return;
      }

      processFile();
    };

    payload = {
      method: "PUT",
      name: "saveFeather",
      user: user,
      client: client,
      callback: callback,
      data: {
        specs: feathers
      }
    };

    datasource.request(payload);
  };

  saveWorkbooks = function (workbooks) {
    var callback, payload;

    callback = function (err) {
      if (err) {
        rollback();
        return;
      }

      processFile();
    };

    payload = {
      method: "PUT",
      name: "saveWorkbook",
      user: user,
      client: client,
      callback: callback,
      data: {
        specs: workbooks
      }
    };

    datasource.request(payload);
  };

  runBatch = function (data) {
    var nextItem,
      len = data.length,
      b = 0;

    // Iterate recursively
    nextItem = function (err, resp) {
      var payload;

      if (err) {
        rollback();
        return;
      }

      if (b < len) {
        payload = data[b];
        payload.user = user;
        payload.client = client;
        payload.callback = nextItem;
        b++;
        datasource.request(payload);
        return;
      }

      // We're done here
      processFile();
    };

    // Start processing
    nextItem();
  };

  buildApi = function () {
    var swagger, catalog, payload, callback, keys;

    callback = function (err, resp) {
      var definitions = swagger.definitions;

      if (err) {
        console.error(err);
        return;
      }

      catalog = resp;

      // Loop through each feather and append to swagger api
      keys = Object.keys(catalog);
      keys.forEach(function (key) {
        var definition,
          feather = catalog[key],
          properties = {},
          inherits = feather.inherits || "Object",
          pathName = "/" + key.toSpinalCase() + "/{id}";
        name = key.toProperCase();

        feather.name = key; // For error trapping later

        // Append singluar path
        if (!feather.isChild) {
          path = {
            "x-swagger-router-controller": "data",
            get: {
              summary: "Info for a specific " + name,
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
          if (feather.plural) {
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
                    description: "Array of " + feather.plural.toProperCase(),
                    schema: {
                      $ref: "#/definitions/" + feather.plural
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

            pathName = "/" + feather.plural.toSnakeCase();
            swagger.paths[pathName] = path;
          }
        }

        // Append singular feather definition
        definition = {};

        if (feather.description) {
          definition.description = feather.description;
        }

        if (feather.discriminator) {
          definition.discriminator = feather.discriminator;
        }

        processProperties(feather, properties);

        if (key === "Object") {
          definition.properties = properties;
        } else {
          definition.allOf = [
            {$ref: "#/definitions/" + inherits},
            {properties: properties}
          ];
        }

        if (feather.required) {
          definition.required = feather.required;
        }

        definitions[key] = definition;

        // Append plural definition
        if (feather.plural) {
          definitions[feather.plural] = {
            type: "array",
            items: {
              $ref: "#/definitions/" + key
            }
          };
        }
      });

      swagger = JSON.stringify(swagger, null, 2);

      // Save swagger file
      fs.writeFile("swagger.json", swagger, function (err) {
        if (err) {
          console.error(err);
          return;
        }

        console.log("Configuration completed!");
        client.end();
        process.exit();
      });
    };

    // Real work starts here
    console.log("Building swagger API");

    // Load the baseline swagger file
    fs.readFile("config/swagger-base.json", "utf8", function (err, data) {
      if (err) {
        console.error(err);
        return;
      }

      swagger = JSON.parse(data);

      // Load the existing feather catalog from postgres
      payload = {
        method: "GET",
        name: "getSettings",
        user: user,
        callback: callback,
        data: {
          name: "catalog"
        }
      };

      datasource.request(payload);
    });
  };

  processProperties = function (feather, properties) {
    var keys = Object.keys(feather.properties);

    keys.forEach(function (key) {
      var property = feather.properties[key], newProperty,
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
            " not supported on " + key + " for feather " + feather.name);
          process.exit(1);
        }

        if (property.format) {
          if (formats.indexOf(property.format) !== -1) {
            newProperty.format = property.format.toSpinalCase();
          } else {
            console.error("Property format " + property.format +
              " not supported on " + key + " for feather " + feather.name);
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

    var execute = function () {
      manifest = JSON.parse(data);
      connect(begin);
    };

    pgConfig(function (config) {
      var pgclient,
        conn = "postgres://" +
        config.user + ":" +
        config.password + "@" +
        config.server + ":" +
        config.port + "/" + "postgres";

      pgclient = new pg.Client(conn);

      pgclient.connect(function (err) {
        if (err) { return console.error(err); }

        var sql = "SELECT datname FROM pg_database " +
          "WHERE datistemplate = false AND datname = $1";

        pgclient.query(sql, [config.database], function (err, resp) {
          if (err) { return console.error(err); }

          // If database exists, get started
          if (resp.rows.length === 1) {
            execute();
          // Otherwise create database first
          } else {
            console.log('Creating database "' + config.database + '"');
            sql = "create database %I;";
            sql = format(sql, config.database, config.user);
            pgclient.query(sql, function () {
              if (err) { return console.error(err); }
              execute();         
            });
          }
        });
      });
    });
  });
}());


