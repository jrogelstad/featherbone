'use strict';

var util = require('util'),
  pg = require("pg"),
  conn = "postgres://postgres:password@localhost/demo",
  catalog = true,
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
  var begin, buildSql, getCatalog, query, qcallback,
    client = new pg.Client(conn);

  console.log(Object.keys(req));
  console.log(req.url);

  begin = function (err) {
    if (err) {
      console.error(err);
      return;
    }

    client.connect(query);
  };

  buildSql = function (payload) {
    return "SELECT request($$" + JSON.stringify(payload) + "$$) as response;";
  };

  getCatalog = function (callback) {
    client.connect(function (err) {
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

        catalog = resp.rows[0].repsonse;

        callback();
      });
    });
  };

  query = function (err) {
    var payload, sql, filter = {},
      limit = req.swagger.params.limit.value || 0;

    if (err) {
      console.error(err);
      return;
    }

    if (limit) {
      filter.limit = limit;
    }

    payload = {
      method: req.method,
      name: "Contact",
      user: "postgres",
      filter: filter
    };

    sql = buildSql(payload);
    client.query(sql, qcallback);
  };

  qcallback = function qcallback(err, resp) {
    if (err) {
      resp.statusCode = 500;
      return err;
    }

    client.end();

    // this sends back a JSON response which is a single string
    res.json(resp.rows[0].response);
  };

  if (catalog) {
    begin();
  } else {
    getCatalog(begin);
  }
}

function favicon(req, res) {
  // Placeholder to be dealt with later. Without route Chrome causes errors
  res.json("");
}
