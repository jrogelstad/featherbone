/**
    Framework for building object relational database apps

    Copyright (C) 2016  John Rogelstad
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

(function () {
  "use strict";

  var formDialog = {},
    m = require("mithril"),
    dialog = require("dialog"),
    formWidget = require("form-widget");

  /**
    View model for form dialog.

    @param {Object} Options
  */
  formDialog.viewModel = function (options) {
    var vm, substate,
      onOk = options.onOk;

    // ..........................................................
    // PUBLIC
    //

    options.title = options.title || options.feather.toName();
    options.icon = options.icon || "file-text";
    options.onOk = function () {
      var model = vm.formWidget().model();
      model.save().then(function () {
        if (onOk) { onOk(model); }
      });
    };

    vm = dialog.viewModel(options);
    vm.formWidget = m.prop();
    vm.modelId = m.prop(options.id);
    vm.okDisabled = function () {
      var w = vm.formWidget();
      return w ? !w.model().canSave() : true;
    };
    vm.okTitle = function () {
      var w = vm.formWidget(),
        def = "Record is unchanged";
      return w ? w.model().lastError() ||  def : "";
    };
    vm.content = function () {
      var state = vm.state();
      return state.resolve(state.current()[0]).content();
    };

    // ..........................................................
    // PRIVATE
    //

    // Only create the form instance when showing. Otherwise leads to creating forms
    // for entire relation tree which is too heavy and could lead to infinite loops
    substate = vm.state().resolve("/Display/Closed");
    substate.content = function () {
      return m("div"); 
    };
    substate = vm.state().resolve("/Display/Showing");
    substate.enter(function () {
      // Create dalog view models
      vm.formWidget(formWidget.viewModel({
        feather: options.feather,
        config: options.config,
        id: vm.modelId(),
        outsideElementIds: [
          vm.ids().header,
          vm.ids().buttonOk
        ]
      }));
    });
    substate.content = function () {
      return  m.component(formWidget.component({viewModel: vm.formWidget()}));
    };
    substate.exit(function () {
      vm.formWidget(undefined);
    });

    vm.style().width = undefined;
    vm.style().margin = "25px";
    vm.style().top = "0px";

    return vm;
  };

  /**
    Form dialog component

    @params {Object} View model
  */
  formDialog.component = dialog.component;
  module.exports = formDialog;

}());
