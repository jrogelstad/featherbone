/**
    Featherbone is a JavaScript based persistence framework for building object relational database applications
    
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
  saveScript, saveFeather, rollback, commit, begin, processFile,
  pg = require("pg"),
  fs = require("fs"),
  path = require("path"),
  dir = process.argv[2],
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
  var sql = "CREATE OR REPLACE function " + name + "(",
    ary = [],
    n = 0,
    keys, arg, txt;

  if (args) {
    keys = Object.keys(args);

    while (n < keys.length) {
      arg = args[keys[n]];
      txt = keys[n] + " " + arg.type;

      if (arg.defaultValue) {
        txt += " default " + arg.defaultValue;
      };

      ary.push(txt);
      n++;
    }

    sql += ary.join(", ")
  };

  sql += ") RETURNS " + (returns || "void") + " AS $$" + script +
    "$$ LANGUAGE plv8;"
  client.query(sql, processFile);
};

processFile = function (err, result) {
  if (err) {
    console.log(err);
    rollback();
    return;
  }

  file = manifest.files[i];
  filename = dir + "/" + file.path;
  ext = path.extname(filename);
  content = fs.readFileSync(filename).toString();
  name = path.parse(filename).name;
  i++;

  if (i === manifest.files.length) {
    commit();
    return;
  }

  console.log("Installing " + filename);
  
  switch (file.type) {
    case "execute":
      execute(content);
      break;
    case "function":
      createFunction(name, file.args, file.returns, content);
      break;
    case "script":
      processFile();
      //saveScript(content);
      break;
    case "feather":
      processFile();
      //saveFeather(content);
      break;
    default:
      console.error("Unknown type.");
      rollback();
      return;
  }
}

saveScript = function (script) {
  console.log("Save script not implemented!");
};

saveFeather = function (script) {
  console.log("Save feather not implemented!");
};

/* Real work starts here */
if (!dir) { 
  console.error("A manifest directory must be provided.");
  return;
}

filename = path.format({root: "/", dir: dir, base: "manifest.js"});
manifest = JSON.parse(fs.readFileSync(filename).toString());

client.connect(begin);

