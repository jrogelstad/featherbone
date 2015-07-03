'use strict';

require('../../common/extend_string.js');

var util = require('util'),
  pg = require("pg"),
  conn = "postgres://postgres:password@localhost/demo",
  catalog,
  hello,
  request,
  favicon;

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
  var begin, buildSql, getCatalog, query, resolveModel,
    client = new pg.Client(conn);

  //console.log(Object.keys(req));

  begin = function (callback) {
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

  query = function (err) {
    var payload, sql, filter = {},
      limit = req.swagger.params.limit.value || 0,
      method = req.method,
      name = resolveModel(req.swagger.apiPath);

    if (err) {
      console.error(err);
      return;
    }

    if (limit) {
      filter.limit = limit;
    }

    payload = {
      method: method,
      name: name,
      user: "postgres",
      filter: filter
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      if (err) {
        resp.statusCode = 500;
        return err;
      }

      client.end();

      // this sends back a JSON response which is a single string
      res.json(resp.rows[0].response);
    });
  };

  resolveModel = function (apiPath) {
    var name = apiPath.slice(1).toCamelCase(true),
      keys,
      found;

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

  if (catalog) {
    begin(query);
  } else {
    getCatalog(query);
  }
}

function favicon(req, res) {
  // Placeholder to be dealt with later. Without route Chrome causes errors
  res.json("");
}

