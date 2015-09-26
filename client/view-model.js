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

/*global window, f, m */
(function (f) {
  "use strict";

  f.viewModel = function (feather, id) {
    var vm = {},
      name = feather.toCamelCase(),
      plural = f.catalog.getFeather(feather).plural.toSpinalCase();

    vm.model = f.models[name]({id: id});
    vm.attrs = {};

    if (id) { vm.model.fetch(); }

    vm.doApply = function () {
      vm.model.save();
    };
    vm.doList = function () {
      m.route("/" + plural);
    };
    vm.doNew = function () {
      m.route("/" + name);
    };
    vm.doSave = function () {
      vm.model.save().then(function () {
        m.route("/" + plural);
      });
    };
    vm.doSaveAndNew = function () {
      vm.model.save().then(function () {
        m.route("/" + name);
      });
    };
    vm.isDirty = function () {
      var currentState = vm.model.state.current()[0];
      return currentState === "/Ready/New" ||
        currentState === "/Ready/Fetched/Dirty";
    };

    return vm;
  };

}(f));
