/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {
  "use strict";

  var settingsDialog = {},
    formDialog = require("form-dialog"),
    catalog = require("catalog");

  /**
    View model for sort dialog.

    @param {Object} Options
  */
  settingsDialog.viewModel = function (options) {
    options = options || {};
    var vm, form = {},
      models = catalog.store().models(),
      definition = models[options.model].definition(),
      store = {};


    // Build form from settings definition
    form.name = definition.name;
    form.description = definition.description;
    form.attrs = [];
    Object.keys(definition.properties).forEach(function (key) {
      form.attrs.push({
        attr: key,
        grid: 0,
        unit: 0
      });
    });

    options.onOk = function () {
      // Save
    };
    options.title = options.title || "Settings";
    options.icon = options.icon || "wrench";
    options.model = options.model;
    options.config = form;
    options.id = options.model;

    // ..........................................................
    // PUBLIC
    //

    vm = formDialog.viewModel(options);
    vm.model = function () { return store; };

    // ..........................................................
    // PRIVATE
    //


    return vm;
  };

  /**
    Settings dialog component

    @params {Object} View model
  */
  settingsDialog.component = formDialog.component;

  module.exports = settingsDialog;

}());
