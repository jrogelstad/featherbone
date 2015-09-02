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
  doHandleOne, doGetSettings, doGetModel, doRequest,
  doGetMethod, doSaveModel, doDeleteModel, registerDataRoutes,
  datasource = require("./server/datasource"),
  express = require('express'),
  bodyParser = require('body-parser'),
  app = express(),
  port = process.env.PORT || 8080,
  dataRouter = express.Router(),
  modelRouter = express.Router(),
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

doRequest = function (req, res) {
  var callback,
    params = req.params,
    name = resolveName(req.url),
    payload = req.body || {},
    id = params.id,
    limit = params.limit,
    offset = params.offset || 0;

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

  if (id) {
    payload.id = id;
  } else {
    payload.filter = {
      limit: limit,
      offset: offset
    };
  }

console.log(JSON.stringify(payload, null, 2));
  datasource.request(payload);
};

doGetModel = function (req, res) {
  req.params.name = req.params.name.toCamelCase(true);
  doGetMethod("getModel", req, res);
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

doSaveModel = function (req, res) {
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
    name: "saveModel",
    user: getCurrentUser(),
    callback: callback,
    data: {
      specs: data
    }
  };

  datasource.request(payload);
};

doDeleteModel = function (req, res) {
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
    name: "deleteModel",
    user: getCurrentUser(),
    callback: callback,
    data: {
      name: name
    }
  };

  datasource.request(payload);
};

registerDataRoutes = function () {
  var keys;

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
  // (accessed at GET http://localhost:8080/api)
  dataRouter.get('/', function (req, res) {
    res.json({ message: 'hooray! welcome to our api!' });
  });

  // Create routes for each catalog object
  registerDataRoutes();

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
