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

(function () {
  "strict";

  require("./common/extend-string.js");

  var manifest, file, content, execute, name, defineSettings,
    saveModule, saveController, saveRoute, saveFeathers, saveWorkbooks,
    rollback, connect, commit, begin, processFile, client, user,
    runBatch, configure,
    MANIFEST = "manifest.json",
    pg = require("pg"),
    fs = require("fs"),
    path = require("path"),
    datasource = require("./server/datasource"),
    pgConfig = require("./server/pgconfig"),
    format = require("pg-format"),
    dir = path.resolve(__dirname, process.argv[2] || "."),
    filename = path.format({root: "/", dir: dir, base: MANIFEST}),
    exit = process.exit,
    i = 0;

  connect = function (callback) {
    pgConfig().then(function (config) {
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
    //console.log("BEGIN");
    client.query("BEGIN;", processFile);
  };

  commit = function (callback) {
    client.query("COMMIT;", function () {
      //console.log("COMMIT");
      client.end();
      callback();
    });
  };

  rollback = function (err) {
    client.query("ROLLBACK;", function () {
      console.error(err);
      //console.log("ROLLBACK");
      console.error("Configuration failed.");
      client.end();
      process.exit();
    });
  };

  execute = function (filename) {
    var dep = path.resolve(filename),
      exp = require(dep);

    exp.execute({user: user, client: client })
      .then(processFile)
      .catch(rollback);
  };

  processFile = function () {
    var filepath, module, version;

    file = manifest.files[i];
    i += 1;

    // If we've processed all the files, wrap this up
    if (!file) {
      commit(function () {
        console.log("Configuration completed!");
        client.end();
        process.exit();
      });
      return;
    }

    filename = file.path;
    name = path.parse(filename).name;
    filepath = path.format({root: "/", dir: dir, base: filename});
    module = file.module || manifest.module;
    version = file.version || manifest.version;

    fs.readFile(filepath, "utf8", function (err, data) {
      if (err) {
        console.error(err);
        return;
      }

      content = data;

      console.log("Configuring " + filename);

      switch (file.type) {
      case "configure":
        configure(filename);
        break;
      case "execute":
        execute(filename);
        break;
      case "module":
        saveModule(module, content, version);
        break;
      case "controller":
        saveController(file.name || name, module, content, version);
        break;
      case "route":
        saveRoute(file.name || name, module, content, version);
        break;
      case "feather":
        saveFeathers(JSON.parse(content), file.isSystem);
        break;
      case "batch":
        runBatch(JSON.parse(content));
        break;
      case "workbook":
        saveWorkbooks(JSON.parse(content));
        break;
      case "settings":
        defineSettings(JSON.parse(content));
        break;
      default:
        rollback("Unknown type.");
        return;
      }
    });
  };

  configure = function(filename) {
    var submanifest,
      subfilepath = path.format({root: "/", dir: dir, base: filename}),
      subdir = path.parse(filename).dir,
      n = i;

    fs.readFile(subfilepath, "utf8", function (err, data) {
      if (err) {
        console.error(err);
        return;
      }

      submanifest = JSON.parse(data);
      submanifest.files.forEach(function (file) {
        file.path = subdir + "/" + file.path;
        file.module = file.module || submanifest.module || manifest.module;
        file.version = file.version || submanifest.version || manifest.version;
        manifest.files.splice(n, 0, file);
        n += 1;
      });
      processFile();
    });
  };

  defineSettings = function (settings) {
    var sql = "SELECT * FROM \"$settings\" WHERE name='" + settings.name + "';",
      params = [settings.name, settings];

    client.query(sql, function (err, result) {
      if (err) {
        rollback(err);
        return;
      }
      if (result.rows.length) {
        sql = "UPDATE \"$settings\" SET " +
          "definition=$2 WHERE name=$1;";
      } else {
        params.push(user);
        sql = "INSERT INTO \"$settings\" (name, definition, id, " +
          " created, created_by, updated, updated_by, is_deleted) " +
          "VALUES ($1, $2, $1, now(), $3, now(), $3, false);";
      }

      client.query(sql, params, processFile);
    });
  };

  saveModule = function (name, script, version) {
    var sql = "SELECT * FROM \"$module\" WHERE name='" + name + "';";

    client.query(sql, function (err, result) {
      if (err) {
        rollback(err);
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

  saveController = function (name, module, script, version) {
    var sql = "SELECT * FROM \"$controller\" WHERE name='" + name + "';";

    client.query(sql, function (err, result) {
      if (err) {
        rollback(err);
        return;
      }
      if (result.rows.length) {
        sql = "UPDATE \"$controller\" SET " +
          "script=$$" + script + "$$," +
          "version='" + version + "' " +
          "WHERE name='" + name + "';";
      } else {
        sql = "INSERT INTO \"$controller\" VALUES ('" + name +
          "','" + module + "',$$" + script + "$$, '" + version + "');";
      }

      client.query(sql, processFile);
    });
  };


  saveRoute = function (name, module, script, version) {
    var sql = "SELECT * FROM \"$route\" WHERE name='" + name + "';";

    client.query(sql, function (err, result) {
      if (err) {
        rollback(err);
        return;
      }
      if (result.rows.length) {
        sql = "UPDATE \"$route\" SET " +
          "script=$$" + script + "$$," +
          "version='" + version + "' " +
          "WHERE name='" + name + "';";
      } else {
        sql = "INSERT INTO \"$route\" VALUES ('" + name +
          "','" + module + "',$$" + script + "$$, '" + version + "');";
      }

      client.query(sql, processFile);
    });
  };

  saveFeathers = function (feathers, isSystem) {
    var payload,
      data = [];

    // System feathers don't get to be tables
    if (isSystem) {
      payload = {
        method: "PUT",
        name: "saveFeather",
        user: user,
        client: client,
        data: {
          specs: feathers
        }
      };

      datasource.request(payload)
        .then(processFile)
        .catch(rollback);
      return;
    }

    // Map feather structure to table structure
    feathers.forEach(function (feather) {
      var keys = Object.keys(feather.properties || {}),
        props = feather.properties;

      feather.properties = keys.map(function (key) {
        var prop = props[key];
        prop.name = key;
        return prop;
      });

      data.push({
        name: "Table",
        method: "POST",
        id: feather.name,
        data: feather
      });
    });

    runBatch(data);
  };

  saveWorkbooks = function (workbooks) {
    var payload = {
        method: "PUT",
        name: "saveWorkbook",
        user: user,
        client: client,
        data: {
          specs: workbooks
        }
      };

    datasource.request(payload)
      .then(processFile)
      .catch(rollback);
  };

  runBatch = function (data) {
    var getControllers, nextItem,
      len = data.length,
      b = 0;

    getControllers = function () {
      var payload, after;

      after = function (resp) {
        resp.forEach(function (controller) {
          eval(controller.script);
        });
        nextItem();
      };

      payload = {
        method: "GET",
        name: "getControllers",
        user: "postgres",
        client: client
      };

      datasource.request(payload).then(after).catch(exit);
    };

    // Iterate recursively
    nextItem = function () {
      var payload;

      if (b < len) {
        payload = data[b];
        payload.user = user;
        payload.client = client;
        b += 1;
        datasource.request(payload)
          .then(nextItem)
          .catch(rollback);
        return;
      }

      // We're done here
      processFile();
    };

    // Start processing
    getControllers();
  };

  /* Real work starts here */
  fs.readFile(filename, "utf8", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    var exec = function () {
      manifest = JSON.parse(data);
      connect(begin);
    };

    pgConfig().then(function (config) {
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
            datasource.getCatalog().then(exec).catch(exit);
          // Otherwise create database first
          } else {
            console.log('Creating database "' + config.database + '"');
            sql = "CREATE DATABASE %I;";
            sql = format(sql, config.database, config.user);
            pgclient.query(sql, function () {
              if (err) { return console.error(err); }
              exec();        
            });
          }
        });
      });
    });
  });
}());


