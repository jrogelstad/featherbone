'use strict';

require('../../common/extend-string.js');

var pgconfig, catalog, hello, doGet, doPost, favicon,
  begin, buildSql, getCatalog, init, resolveName, client,
  util = require('util'),
  pg = require("pg"),
  concat = require("concat-stream"),
  readPgConfig = require("../../common/pgconfig.js"),
  isInitialized = false;

module.exports = {
  hello: hello,
  doGet: doGet,
  doPost: doPost,
  favicon: favicon
};

// Shared functions
begin = function (callback) {
  var conn = "postgres://" +
    pgconfig.user + ":" +
    pgconfig.password + "@" +
    pgconfig.server + "/" +
    pgconfig.database;

  client = new pg.Client(conn);
  client.connect(callback);
};

buildSql = function (payload) {
  return "SELECT request($$" + JSON.stringify(payload) + "$$) as response;";
};

getCatalog = function (callback) {
  begin(function (err) {
    if (err) {
      console.error(err);
      return;
    }

    var payload = {
        method: "POST",
        name: "getSettings",
        user: "postgres",
        data: "catalog"
      },
      sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      if (err) {
        console.error(err);
        return;
      }

      catalog = resp.rows[0].response.value;
      callback();
    });
  });
};

init = function (callback) {
  if (isInitialized) {
    begin(callback);
    return;
  }

  readPgConfig(function (config) {
    pgconfig = config;
    isInitialized = true;
    getCatalog(callback);
  });
};

resolveName = function (apiPath) {
  var name,
    keys,
    found;

  if (apiPath.lastIndexOf("/") > 0) {
    name = apiPath.match("[/](.*)[/]")[1].toCamelCase(true);
  } else {
    name = apiPath.slice(1).toCamelCase(true);
  }

  if (catalog) {
    // Look for model with same name
    if (catalog[name]) { return name; }

    // Look for plural version
    keys = Object.keys(catalog);
    found = keys.filter(function (key) {
      return catalog[key].plural === name;
    });

    if (found.length) {
      return found[0];
    }

    return;
  }
};

/*
  Functions in a127 controllers used for operations should take two parameters:

  Param 1: a handle to the request object
  Param 2: a handle to the response object
 */
function hello(req, res) {
  // variables defined in the Swagger document can be referenced using
  // req.swagger.params.{parameter_name}
  var name = req.swagger.params.name.value || 'stranger',
    ret = util.format('Hello, %s!', name);

  // this sends back a JSON response which is a single string
  res.json(ret);
}

function doGet(req, res) {
  var query;

  query = function (err) {
    var payload, sql,
      params = req.swagger.params,
      name = resolveName(req.swagger.apiPath),
      id = params.id !== undefined ? params.id.value : undefined,
      defaultLimit = pgconfig.defaultLimit,
      limit = params.limit !== undefined ? params.limit.value : defaultLimit,
      offset = params.offset !== undefined ? params.offset.value || 0 : 0,
      result;

    if (err) {
      console.error(err);
      return;
    }

    payload = {
      method: "GET",
      name: name,
      user: "postgres"
    };

    if (id) {
      payload.id = id;
    } else {
      payload.filter = {
        limit: limit,
        offset: offset
      };
    }

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      if (err) {
        res.statusCode = 500;
        console.error(err);
        return err;
      }

      client.end();

      result = resp.rows[0].response;

      if ((Array.isArray(result) && !result.length) ||
          !Object.keys(result).length) {
        res.statusCode = 204;
        result = "";
      }

      // this sends back a JSON response which is a single string
      res.json(result);
    });
  };

  init(query);
}

function doPost(req, res) {
  var query;

  query = function (err) {
    var payload, sql, gotPost, handleError, concatStream,
      params = req.swagger.params,
      name = resolveName(req.swagger.apiPath),
      id = params.id !== undefined ? params.id.value : undefined,
      result;

    if (err) {
      console.error(err);
      return;
    }

    gotPost = function (data) {
      console.log(data);

      payload = JSON.parse(data);
      payload.method = "POST";
      payload.name = name;
      payload.user = "postgres";
      payload.id = id;

      sql = buildSql(payload);

      client.query(sql, function (err, resp) {
        if (err) {
          res.statusCode = 500;
          console.error(err);
          return err;
        }

        client.end();

        result = resp.rows[0].response;

        // this sends back a JSON response which is a single string
        res.json(result);
      });
    };

    handleError = function (err) {
      // handle your error appropriately here, e.g.:
      console.error(err); // print the error to STDERR
      process.exit(1); // exit program with non-zero exit code
    };

    concatStream = concat({encoding: "string"}, gotPost);
    req.on('error', handleError);
    req.pipe(concatStream);
  };

  init(query);
}

function favicon(req, res) {
  // Placeholder to be dealt with later. Without route Chrome causes errors
  res.json("");
}

