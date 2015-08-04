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

'use strict';

require('./common/extend-string.js');

var pgconfig, catalog, hello, getCatalog, getCurrentUser,
  doGet, doHandleOne, doUpsert, doGetSettings, doSaveSettings,
  query, begin, buildSql, init, resolveName, client,
  util = require('util'),
  pg = require("pg"),
  concat = require("concat-stream"),
  readPgConfig = require("./common/pgconfig.js"),
  isInitialized = false;

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

      catalog = resp.rows[0].response;
      callback();
    });
  });
};

getCurrentUser = function () {
  // TODO: Make this real
  return "postgres";
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

function doGet(req, res) {
  var query;

  query = function (err) {
    var payload, sql,
      params = req.params,
      name = resolveName(req.url),
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
      user: getCurrentUser(),
      filter: {
        limit: limit,
        offset: offset
      }
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (err) {
        console.error(err);
        res.statusCode = 500;
        res.json(err);
        return err;
      }

      client.end();

      result = resp.rows[0].response;

      if (!result.length) {
        res.statusCode = 204;
        result = "";
      }

      // Handle processed error
      if (result.isError) {
        res.status(result.statusCode).json(result.message);
        return res;
      }

      // this sends back a JSON response which is a single string
      res.json(result);
    });
  };

  init(query);
}

function doHandleOne(req, res) {
  var query;

  query = function (err) {
    var payload, sql,
      name = resolveName(req.url),
      method = req.method,
      id = req.params.id,
      result;

    if (err) {
      console.error(err);
      return;
    }

    payload = {
      method: method,
      name: name,
      user: getCurrentUser(),
      id: id
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (err) {
        console.error(err);
        res.statusCode = 500;
        res.json(err);
        return err;
      }

      client.end();

      result = resp.rows[0].response;

      if (typeof result !== "boolean" && !Object.keys(result).length) {
        res.statusCode = 204;
        result = "";
      }

      // Handle processed error
      if (result.isError) {
        res.status(result.statusCode).json(result.message);
        return res;
      }

      // this sends back a JSON response which is a single string
      res.json(result);
    });
  };

  init(query);
}

function doUpsert(req, res) {
  var query;

  query = function (err) {
    var payload, sql,
      method = req.method,
      name = resolveName(req.url),
      id = req.params.id,
      result;

    if (err) {
      console.error(err);
      return;
    }

    payload = req.body;
    payload.method = method;
    payload.name = name;
    payload.user = getCurrentUser();
    if (id) { payload.id = id; }

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (err) {
        console.error(err);
        res.statusCode = 500;
        res.json(err);
        return err;
      }

      client.end();

      result = resp.rows[0].response;

      // Handle processed error
      if (result.isError) {
        res.status(result.statusCode).json(result.message);
        return res;
      }

      // this sends back a JSON response which is a single string
      res.json(result);
    });
  };

  init(query);
}

/**************************************************************************/

var express = require('express'),
  bodyParser = require('body-parser'),
  app = express(),
  port = process.env.PORT || 8080,
  router = express.Router();

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// middleware to use for all requests
router.use(function (req, res, next) {
  // do logging
  console.log('Something is happening.');
  next(); // make sure we go to the next routes and don't stop here
});

// test route to make sure everything is working 
// (accessed at GET http://localhost:8080/api)
router.get('/', function (req, res) {
  res.json({ message: 'hooray! welcome to our api!' });
});

// more routes for our API will happen here
router.route('/contact/:id')
  .get(function (req, res) {
    doHandleOne(req, res);
  })
  .patch(function (req, res) {
    doUpsert(req, res);
  })
  .delete(function (req, res) {
    doHandleOne(req, res);
  });

router.route('/contacts')
  .get(function (req, res) {
    doGet(req, res);
  })
  .post(function (req, res) {
    doUpsert(req, res);
  });

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/data', router);

// START THE SERVER
// =============================================================================
app.listen(port);
console.log('Magic happens on port ' + port);
