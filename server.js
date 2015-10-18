/**
    Framework for building object relational database apps

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

var catalog, init, resolveName, getCatalog, getCurrentUser,
  doHandleOne, doGetSettings, doGetFeather, doGetModules, doRequest,
  doGetMethod, doSaveFeather, doDeleteFeather, registerDataRoutes,
  datasource = require("./server/datasource"),
  express = require("express"),
  bodyParser = require("body-parser"),
  qs = require("qs"),
  app = express(),
  port = process.env.PORT || 10001,
  dataRouter = express.Router(),
  featherRouter = express.Router(),
  moduleRouter = express.Router(),
  settingsRouter = express.Router();

// ..........................................................
// CONTROLLERS
//

getCatalog = function (callback) {
  var payload, after;

  after = function (err, resp) {
    if (err) {
      console.error(err);
      return;
    }

    catalog = resp;
    callback();
  };

  payload = {
    method: "GET",
    name: "getSettings",
    user: "postgres",
    callback: after,
    data: {
      name: "catalog"
    },
  };

  datasource.request(payload);
};

getCurrentUser = function () {
  // TODO: Make this real
  return "postgres";
};

init = function (callback) {
  getCatalog(callback);
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
    // Look for feather with same name
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

doRequest = function (req, res) {
  var callback,
    params = req.params,
    name = resolveName(req.url),
    payload = req.body || {},
    id = params.id,
    filter = params.filter ? qs.parse(params.filter) : {};

  // Handle response
  callback = function (err, resp) {
    // Handle datasource error
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
  payload.callback = callback;

  if (req.method !== "POST") {
    if (id) {
      payload.id = id;
    } else {
      payload.filter = filter;
      filter.offset = filter.offset || 0;
    }
  }

console.log(JSON.stringify(payload, null, 2));
  datasource.request(payload);
};

doGetFeather = function (req, res) {
  req.params.name = req.params.name.toCamelCase(true);
  doGetMethod("getFeather", req, res);
};

doGetModules = function (req, res) {
  doGetMethod("getModules", req, res);
};

doGetSettings = function (req, res) {
  doGetMethod("getSettings", req, res);
};

doGetMethod = function (fn, req, res) {
  var payload, callback,
    name = req.params.name;

  callback = function (err, resp) {
    // Handle error
    if (err) {
      err.status(err.statusCode).json(err.message);
      return res;
    }

    if (!resp) { res.statusCode = 204; }
    res.json(resp);
  };

  payload = {
    method: "GET",
    name: fn,
    user: getCurrentUser(),
    callback: callback,
    data: {
      name: name
    }
  };

  datasource.request(payload);
};

doSaveFeather = function (req, res) {
  var payload, callback,
    data = req.body;

  callback = function (err, resp) {
    if (err) {
      err.status(err.statusCode).json(err.message);
      return;
    }

    getCatalog(function () {
      registerDataRoutes();
      res.json(resp);
    });
  };

  payload = {
    method: "PUT",
    name: "saveFeather",
    user: getCurrentUser(),
    callback: callback,
    data: {
      specs: data
    }
  };

  datasource.request(payload);
};

doDeleteFeather = function (req, res) {
  var payload, callback,
    name = req.params.name.toCamelCase(true);

  callback = function (err, resp) {
    if (err) {
      err.status(err.statusCode).json(err.message);
      return;
    }

    res.json(resp);
  };

  payload = {
    method: "DELETE",
    name: "deleteFeather",
    user: getCurrentUser(),
    callback: callback,
    data: {
      name: name
    }
  };

  datasource.request(payload);
};

registerDataRoutes = function () {
  var keys, name;

  keys = Object.keys(catalog);
  keys.forEach(function (key) {
    name = key.toSpinalCase();
    dataRouter.route("/" + name + "/:id")
      .get(doRequest)
      .patch(doRequest)
      .delete(doRequest);

    if (catalog[key].plural) {
      name = catalog[key].plural.toSpinalCase();
      dataRouter.route("/" + name)
        .get(doRequest)
        .post(doRequest);
      dataRouter.route("/" + name + "/:filter")
        .get(doRequest);
    }
  });
};

// ..........................................................
// ROUTES
//

init(function () {
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
  // (accessed at GET http://localhost:{port}/api)
  dataRouter.get('/', function (req, res) {
    res.json({ message: 'hooray! welcome to our api!' });
  });

  // Create routes for each catalog object
  registerDataRoutes();

  featherRouter.route("/:name")
    .get(doGetFeather)
    .put(doSaveFeather)
    .delete(doDeleteFeather);
  moduleRouter.route("/")
    .get(doGetModules);
  settingsRouter.route("/:name")
    .get(doGetSettings);

  // REGISTER OUR ROUTES -------------------------------
  app.use('/data', dataRouter);
  app.use('/feather', featherRouter);
  app.use('/module', moduleRouter);
  app.use('/modules', moduleRouter);
  app.use('/settings', settingsRouter);

  // START THE SERVER
  // ========================================================================
  app.listen(port);
  console.log('Magic happens on port ' + port);
});
