/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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

  var tableDialog = {},
    m = require("mithril"),
    f = require("feather-core"),
    dialog = require("dialog"),
    button = require("button"),
    statechart = require("statechartjs");

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.propertyName] Filter property being modified
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Array} [options.feather] Feather
    @param {Function} [options.filter] Filter property
  */
  tableDialog.viewModel = function (options) {
    options = options || {};
    var vm, state, createButton, buttonAdd, buttonRemove,
      buttonClear, buttonDown, buttonUp,
      selection = m.prop();

    // ..........................................................
    // PUBLIC
    //

    vm = dialog.viewModel(options);
    vm.add = function () {
      var ary = vm.data(),
       attrs = vm.attrs();

      attrs.some(vm.addAttr.bind(ary));

      if (!vm.isSelected()) {
        vm.selection(ary.length - 1);
      }

      buttonRemove.enable();
      buttonClear.enable();
      vm.scrollBottom(true);
    };
    vm.addAttr = function (attr) {
      if (!this.some(vm.hasAttr.bind(attr))) {
        this.push({property: attr});
        return true;
      }
    };
    vm.buttonAdd = function () {
      return buttonAdd;
    };
    vm.buttonClear = function () {
      return buttonClear;
    };
    vm.buttonDown = function () {
      return buttonDown;
    };
    vm.buttonRemove = function () {
      return buttonRemove;
    };
    vm.buttonUp = function () {
      return buttonUp;
    };
    vm.clear = function () {
      vm.data().length = 0;
      buttonClear.disable();
    };
    vm.content = function () {
      return [
        m.component(button.component({viewModel: vm.buttonAdd()})),
        m.component(button.component({viewModel: vm.buttonRemove()})),
        m.component(button.component({viewModel: vm.buttonClear()})),
        m.component(button.component({viewModel: vm.buttonDown()})),
        m.component(button.component({viewModel: vm.buttonUp()})),
        m("table", {
          class: "pure-table"
        }, [
          m("thead", {
            style: {
              minWidth: "inherit",
              display: "inherit"
            }
          }, vm.viewHeaders()),
          m("tbody", {
            id: "sortTbody",
            style: {
              maxHeight: "175px",
              minHeight: "175px",
              overflowX: "hidden",
              overflowY: "auto",
              display: "inline-block"
            },
            config: function (e) {
              if (vm.scrollBottom()) {
                e.scrollTop = e.scrollHeight;
              }
              vm.scrollBottom(false);
            } 
          }, vm.viewRows()
          )
        ])
      ];
    };
    vm.data = function () {
      // Implement list here
    };
    vm.isSelected = function () {
      return state.resolve(state.resolve("/Selection").current()[0]).isSelected();
    };
    vm.itemChanged = function (index, property, value) {
      vm.data()[index][property] = value;
    };
    vm.items = function () {
      var i = 0,
        items = vm.data().map(function (item) {
          var ret = f.copy(item);
          ret.index = i;
          i += 1;
          return ret;
        });

      return items;
    };
    vm.hasAttr = function (item) { 
      return item.property === this;
    };
    vm.list = m.prop(options.list);
    vm.moveDown = function () {
      var ary = vm.data(),
        idx = vm.selection(),
        a = ary[idx],
        b = ary[idx + 1];

      ary.splice(idx, 2, b, a);
      vm.selection(idx + 1);
    };
    vm.moveUp = function () {
      var  ary = vm.data(),
        idx = vm.selection() - 1,
        a = ary[idx],
        b = ary[idx + 1];

      ary.splice(idx, 2, b, a);
      vm.selection(idx);
    };
    vm.remove = function () {
      var idx = selection(),
        ary = vm.data();
      ary.splice(idx, 1);
      state.send("unselected");
      if (ary.length) {
        if (idx > 0) { idx -= 1; }
        selection(idx);
        return;
      }
      buttonRemove.disable();
    };
    vm.reset = function () {
      // Reset code here
    };
    vm.rowColor = function (index) {
      if (vm.selection() === index) {
        if (vm.isSelected()) {
          return "LightSkyBlue" ;
        }
        return "AliceBlue";
      }
      return "White";
    };
    vm.title = m.prop(options.title);
    vm.viewHeaderIds = m.prop();
    vm.viewHeaders = function () {};
    vm.viewRows = function () {};
    vm.scrollBottom = m.prop(false);
    vm.selection = function (index, select) {
      var ary = vm.data();

      if (select) { state.send("selected"); }

      if (arguments.length) {
        buttonUp.disable();
        buttonDown.disable();

        if (ary.length > 1) {
          if (index < ary.length - 1) {
            buttonDown.enable();
          }
          if (index > 0) {
            buttonUp.enable();
          }
        }

        return selection(index);
      }

      return selection();
    };

    // ..........................................................
    // PRIVATE
    //

    createButton = button.viewModel;
    buttonAdd = createButton({
      onclick: vm.add,
      label: "Add",
      icon: "plus-circle",
      style: {backgroundColor: "white"}
    });

    buttonRemove = createButton({
      onclick: vm.remove,
      label: "Remove",
      icon: "remove",
      style: {backgroundColor: "white"}
    });

    buttonClear = createButton({
      onclick: vm.clear,
      title: "Clear",
      icon: "eraser",
      style: {backgroundColor: "white"}
    });

    buttonUp = createButton({
      onclick: vm.moveUp,
      icon: "chevron-up",
      title: "Move up",
      style: {
        backgroundColor: "white",
        float: "right"
      }
    });

    buttonDown = createButton({
      onclick: vm.moveDown,
      icon: "chevron-down",
      title: "Move down",
      style: {
        backgroundColor: "white",
        float: "right"
      }
    });

    // Statechart
    state = statechart.define(function () {
      this.state("Selection", function () {
        this.state("Off", function () {
          this.event("selected", function () {
            this.goto("../On");
          });
          this.isSelected = function () { return false; };
        });
        this.state("On", function () {
          this.event("unselected", function () {
            this.goto("../Off");
          });
          this.isSelected = function () { return true; };
        });
      });
    });
    state.goto();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  tableDialog.component = dialog.component;

  module.exports = tableDialog;

}());
