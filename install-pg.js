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

var manifest, file, content, result, filename, execute, name, createFunction,
  saveModule, saveFeather, rollback, commit, begin, processFile, ext,
  pg = require("pg"),
  fs = require("fs"),
  path = require("path"),
  conString = "postgres://postgres:password@localhost/demo",
  client = new pg.Client(conString),
  i = 0;

begin = function () {
  client.query("BEGIN;", processFile);
};

commit = function () {
  client.query("COMMIT;", function () {
    console.log("Install completed!");
    client.end();
  });
};

rollback = function () {
  client.query("ROLLBACK;", function () {
    console.log("Install failed.");
    client.end();
  });
};

execute = function (script) {
  var sql = "DO $$" + script + "$$ LANGUAGE plv8;";

  client.query(sql, processFile);
};

createFunction = function (name, args, returns, script) {
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
    "$$ LANGUAGE plv8;";

  client.query(sql, processFile);
};

processFile = function (err) {
  if (err) {
    console.log(err);
    rollback();
    return;
  }

  file = manifest.files[i];
  i++;

  if (i > manifest.files.length) {
    commit();
    return;
  }

  filename = file.path;
  ext = path.extname(filename);
  content = fs.readFileSync(filename, "utf8");
  name = path.parse(filename).name;

  console.log("Installing " + filename);

  switch (file.type) {
  case "execute":
    execute(content);
    break;
  case "function":
    createFunction(name, file.args, file.returns, content);
    break;
  case "module":
    saveModule(file.name || name, content, file.isGlobal, manifest.version);
    break;
  case "feather":
    saveFeather(JSON.parse(content));
    break;
  default:
    console.error("Unknown type.");
    rollback();
    return;
  }
};

saveModule = function (name, script, isGlobal, version) {
  isGlobal = JSON.stringify(isGlobal || false);

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
        "is_global='" + isGlobal + "', " +
        "version='" + version + "' " +
        "WHERE name='" + name + "';";
    } else {
      sql = "INSERT INTO \"$module\" VALUES ('" + name +
        "',$$" + script + "$$," + isGlobal + ", '" + version + "');";
    }

    client.query(sql, processFile);
  });
};

saveFeather = function (feathers) {
  client.query("SELECT CURRENT_USER;", function (err, result) {
    if (err) {
      console.error(err);
      rollback();
      return;
    }

    var payload = JSON.stringify({
        action: "POST",
        name: "saveFeather",
        user: result.rows[0].current_user,
        data: [feathers]
      }),
      sql = "SELECT request('" + payload + "');";

    client.query(sql, function (err) {
      if (err) {
        console.error(err);
        rollback();
        return;
      }
      processFile();
    });
  });
};

/* Real work starts here */
filename = path.format({root: "/", base: "manifest.json"});
manifest = JSON.parse(fs.readFileSync(filename).toString());

client.connect(begin);

