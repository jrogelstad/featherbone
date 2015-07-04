'use strict';

require('../../common/extend_string.js');

var pgconfig, catalog, hello, request, favicon,
  util = require('util'),
  pg = require("pg"),
  readPgConfig = require("../../common/pgconfig.js"),
  isInitialized = false;

module.exports = {
  hello: hello,
  request: request,
  favicon: favicon
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

function request(req, res) {
  var begin, buildSql, getCatalog, init, query, resolveName, client;

  //console.log(Object.keys(req));

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
        sql;

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

  init = function () {
    if (isInitialized) {
      begin(query);
      return;
    }

    readPgConfig(function (config) {
      pgconfig = config;
      isInitialized = true;
      getCatalog(query);
    });
  };

  query = function (err) {
    var payload, sql,
      params = req.swagger.params,
      method = req.method,
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
      method: method,
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
        resp.statusCode = 500;
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

  init();
}

function favicon(req, res) {
  // Placeholder to be dealt with later. Without route Chrome causes errors
  res.json("");
}

