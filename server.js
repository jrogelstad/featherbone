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
  doGet, doHandleOne, doGetSettings, doGetModel,
  doGetMethod, doSaveModel, doSaveMethod, doDeleteModel,
  query, begin, buildSql, init, resolveName, client, done, handleError,
  util = require('util'),
  pg = require("pg"),
  datasource = require("./server/datasource"),
  readPgConfig = require("./common/pgconfig"),
  isInitialized = false;

// ..........................................................
// CONTROLLERS
//

handleError = function (err) {
  if (!err) { return false; }
  if (client) { done(client); }
  console.log(err);
  return true;
};

begin = function (callback) {
  var conn = "postgres://" +
    pgconfig.user + ":" +
    pgconfig.password + "@" +
    pgconfig.server + "/" +
    pgconfig.database;

  pg.connect(conn, function (err, pclient, pdone) {
    client = pclient;
    done = pdone;

    // handle an error from the connection
    if (handleError(err)) { return; }

    callback();
  });
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
      if (handleError(err)) { return; }

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

function doRequest(req, res) {
  var query;

  query = function (err) {
    var callback,
      params = req.params,
      name = resolveName(req.url),
      defaultLimit = pgconfig.defaultLimit,
      payload = req.body || {},
      id = params.id,
      limit = params.limit !== undefined ? params.limit.value : defaultLimit,
      offset = params.offset !== undefined ? params.offset.value || 0 : 0;

    if (handleError(err)) { return; }

    // Handle response
    callback = function (err, resp) {
      // Release client to pool
      done();

      // Handle controller error
      if (err) {
        res.status(err.statusCode).json(err.message);
        return;
      }

      if (resp === undefined) {
        res.statusCode = 204;
      }

      // Send back a JSON response
      res.json(resp);
    };

    payload.name = name;
    payload.method = req.method;
    payload.user = getCurrentUser();
    payload.client = client;
    payload.callback = callback;

    if (id) {
      payload.id = id;
    } else {
      payload.filter = {
        limit: limit,
        offset: offset
      };
    }

    datasource.request(payload);
  };

  init(query);
}

function doGetModel(req, res) {
  doGetMethod("getModel", req, res);
}

function doGetSettings(req, res) {
  doGetMethod("getSettings", req, res);
}

function doGetMethod(method, req, res) {
  var query;

  query = function (err) {
    var payload, sql,
      name = req.params.name,
      result;

    if (err) {
      console.error(err);
      return;
    }

    payload = {
      method: "POST",
      name: method,
      user: getCurrentUser(),
      data: [name]
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (handleError(err)) { return; }

      done();

      result = resp.rows[0].response;

      if (!result) { res.statusCode = 204; }

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

function doSaveModel(req, res) {
  doSaveMethod("saveModel", req, res);
}

function doSaveMethod(method, req, res) {
  var query;

  query = function (err) {
    var payload, sql, result,
      name = req.params.name,
      data = req.body;

    data.name = name;

    if (handleError(err)) { return; }

    payload = {
      method: "POST",
      name: method,
      user: getCurrentUser(),
      data: [data]
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (handleError(err)) { return; }

      done();

      result = resp.rows[0].response;

      // Handle processed error
      if (result.isError) {
        res.status(result.statusCode).json(result.message);
        return res;
      }

      res.json(result);
    });
  };

  init(query);
}

function doDeleteModel(req, res) {
  var query;

  query = function (err) {
    var payload, sql, result,
      name = req.params.name;

    if (handleError(err)) { return; }

    payload = {
      method: "POST",
      name: "deleteModel",
      user: getCurrentUser(),
      data: [[name]]
    };

    sql = buildSql(payload);

    client.query(sql, function (err, resp) {
      // Native error thrown. This should never happen
      if (handleError(err)) { return; }

      done();

      result = resp.rows[0].response;

      // Handle processed error
      if (result.isError) {
        res.status(result.statusCode).json(result.message);
        return res;
      }

      res.json(result);
    });
  };

  init(query);
}

// ..........................................................
// ROUTES
//

init(function () {
  var express = require('express'),
    bodyParser = require('body-parser'),
    app = express(),
    port = process.env.PORT || 8080,
    dataRouter = express.Router(),
    modelRouter = express.Router(),
    settingsRouter = express.Router(),
    keys;

  // configure app to use bodyParser()
  // this will let us get the data from a POST
  app.use(bodyParser.urlencoded({extended: true}));
  app.use(bodyParser.json());

  // static pages
  app.use(express.static(__dirname));

  // middleware to use for all requests
  dataRouter.use(function (req, res, next) {
    // do logging
    console.log('Something is happening.');
    next(); // make sure we go to the next routes and don't stop here
  });

  // test route to make sure everything is working 
  // (accessed at GET http://localhost:8080/api)
  dataRouter.get('/', function (req, res) {
    res.json({ message: 'hooray! welcome to our api!' });
  });

  // Create routes for each catalog object
  keys = Object.keys(catalog);
  keys.forEach(function (key) {
    dataRouter.route("/" + key.toSpinalCase() + "/:id")
      .get(doRequest)
      .patch(doRequest)
      .delete(doRequest);

    if (catalog[key].plural) {
      dataRouter.route("/" + catalog[key].plural.toSpinalCase())
        .get(doRequest)
        .post(doRequest);
    }
  });

  modelRouter.route('/:name')
    .get(doGetModel)
    .put(doSaveModel)
    .delete(doDeleteModel);
  settingsRouter.route('/:name')
    .get(doGetSettings);

  // REGISTER OUR ROUTES -------------------------------
  // all of our routes will be prefixed with /data
  app.use('/data', dataRouter);
  app.use('/model', modelRouter);
  app.use('/settings', settingsRouter);

  // START THE SERVER
  // ========================================================================
  app.listen(port);
  console.log('Magic happens on port ' + port);
});
