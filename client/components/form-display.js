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

/*global window*/
(function () {
  "use strict";

  var formDisplay = {},
    m = require("mithril"),
    stream = require("stream"),
    button = require("button"),
    catalog = require("catalog"),
    formWidget = require("form-widget");

  formDisplay.viewModel = function (options) {
    var state, toggleNew, isDisabled, applyTitle, saveTitle,
      feather = options.feather.toProperCase(),
      forms = catalog.store().forms(),
      formId = Object.keys(forms).find(function (id) {
        return forms[id].feather === feather;
      }),
      form = forms[formId],
      vm = {};

    vm.buttonApply = stream();
    vm.buttonBack = stream();
    vm.buttonSave = stream();
    vm.buttonSaveAndNew = stream();
    vm.doApply = function () {
      vm.formWidget().model().save();
    };
    vm.doBack = function () {
      window.history.back();
    };
    vm.doNew = function () {
      m.route.set("/edit/:form", {
        form: options.form
      });
    };
    vm.doSave = function () {
      vm.model().save().then(function () {
        vm.doBack();
      });
    };
    vm.doSaveAndNew = function () {
      vm.model().save().then(function () {
        vm.doNew();
      });
    };
    vm.formWidget = stream(formWidget.viewModel({
      model: options.feather.toCamelCase(),
      id: options.id,
      config: form,
      outsideElementIds: ["toolbar"]
    }));
    vm.model = function () {
      return vm.formWidget().model();
    };

    // ..........................................................
    // PRIVATE
    //

    // Create button view models
    vm.buttonBack(button.viewModel({
      onclick: vm.doBack,
      label: "&Back",
      icon: "arrow-left"
    }));

    vm.buttonApply(button.viewModel({
      onclick: vm.doApply,
      label: "&Apply"
    }));

    vm.buttonSave(button.viewModel({
      onclick: vm.doSave,
      label: "&Save",
      icon: "cloud-upload"
    }));

    vm.buttonSaveAndNew(button.viewModel({
      onclick: vm.doSaveAndNew,
      label: "Save and &New",
      icon: "plus-circle"
    }));

    // Bind model state to display state
    isDisabled = function () { return !vm.model().canSave(); };
    applyTitle = vm.buttonApply().title;
    saveTitle = vm.buttonSave().title;
    vm.buttonApply().isDisabled = isDisabled;
    vm.buttonApply().title = function () {
      if (isDisabled()) {
        return vm.model().lastError() || "No changes to apply";
      }
      return applyTitle();
    };
    vm.buttonSave().isDisabled = isDisabled;
    vm.buttonSave().title = function () {
      if (isDisabled()) {
        return vm.model().lastError() || "No changes to save";
      }
      return saveTitle();
    };
    toggleNew = function (isNew) {
      vm.buttonSaveAndNew().title("");
      if (isNew) {
        vm.buttonSaveAndNew().label("&New");
        vm.buttonSaveAndNew().onclick(vm.doNew);    
      } else {
        vm.buttonSaveAndNew().label("Save and &New");
        vm.buttonSaveAndNew().onclick(vm.doSaveAndNew);  
      }
    };
    state = vm.model().state();
    state.resolve("/Ready/New").enter(toggleNew.bind(this, false));
    state.resolve("/Ready/Fetched/Clean").enter(toggleNew.bind(this, true));
    state.resolve("/Ready/Fetched/Dirty").enter(toggleNew.bind(this, false));

    return vm;
  };

  formDisplay.component = {
    oninit: function (vnode) {
      vnode.attrs.viewModel = formDisplay.viewModel(vnode.attrs);
    },

    view: function (vnode) {
      var vm = vnode.attrs.viewModel;

      // Build view
      return m("div", [
        m("div", {
          id: "toolbar",
          class: "suite-header"
        }, [
          m(button.component, {viewModel: vm.buttonBack()}),
          m(button.component, {viewModel: vm.buttonApply()}),
          m(button.component, {viewModel: vm.buttonSave()}),
          m(button.component, {viewModel: vm.buttonSaveAndNew()})
        ]),
        m(formWidget.component, {viewModel: vm.formWidget()})
      ]);
    }
  };

  catalog.register("components", "formDisplay", formDisplay.component);
  module.exports = formDisplay;

}());


