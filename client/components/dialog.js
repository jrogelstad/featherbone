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

/*global dialogPolyfill*/
(function () {
  "use strict";

  require("dialog-polyfill");

  var dialog = {},
    m = require("mithril"),
    stream = require("stream"),
    f = require("common-core"),
    statechart = require("statechartjs");

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.icon] Dialog icon
    @param {Array} [options.title] Dialog title
    @param {Array} [options.message] Text message
    @param {Function} [options.onclickOk] Function to execute on ok clicked
  */
  dialog.viewModel = function (options) {
    options = options || {};
    var vm, state;

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.icon = stream(options.icon);
    vm.ids = stream({
      dialog: options.id || f.createId(),
      header: f.createId(),
      buttonOk: f.createId(),
      buttonCancel: f.createId(),
      content: f.createId()
    });
    vm.cancel = function () {
      var doCancel = vm.onCancel();
      if (typeof doCancel === "function") {
        doCancel();
      }
      state.send("close");
    };
    vm.content = function () {
      return m("div", {id: vm.ids().content}, vm.message());
    };
    vm.displayCancel = function () {
      return vm.onOk() ? "inline-block" : "none";
    };
    vm.message = stream(options.message || "Your message here");
    vm.onCancel = stream(options.onCancel);
    vm.onOk = stream(options.onOk);
    vm.ok = function () {
      var doOk = vm.onOk();
      if (typeof doOk === "function") {
        doOk();
      }
      state.send("close");
    };
    vm.okDisabled = stream(false);
    vm.okTitle = stream("");
    vm.show = function () {
      state.send("show");
    };
    vm.title = stream(options.title || "");
    vm.state = function () {
      return state;
    };
    vm.style = stream({width: "450px"});

    // ..........................................................
    // PRIVATE
    //

    // Statechart
    state = statechart.define(function () {
      this.state("Display", function () {
        this.state("Closed", function () {
          this.enter(function () {
            var  id = vm.ids().dialog,
              dlg = document.getElementById(id);
            if (dlg && dlg.open) { dlg.close(); }
          });
          this.event("show", function () {
            this.goto("../Showing");
          });
        });
        this.state("Showing", function () {
          this.enter(function () {
            var id = vm.ids().dialog,
              dlg = document.getElementById(id);
            if (dlg) { dlg.showModal(); }
          });
          this.event("close", function () {
            this.goto("../Closed");
          });
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
  dialog.component = function (options) {
    var component = {};

    component.oninit = function (vnode) {
      vnode.attrs.vm = options.viewModel || dialog.viewModel(options);
      vnode.attrs.key = vnode.attrs.key || f.createId();
    };

    component.view = function (vnode) {
      var view, okOpts,
        vm = vnode.attrs.vm,
        ids = vm.ids(),
        style = f.copy(vm.style());

      okOpts = {
        id: ids.buttonOk,
        class: "pure-button  pure-button-primary suite-dialog-button-ok",
        onclick: vm.ok,
        disabled: vm.okDisabled()
      };

      if (vm.okTitle()) {
        okOpts.title = vm.okTitle();
      }

      view = m("dialog", {
          id: ids.dialog,
          class: "suite-dialog",
          style: style,
          oncreate: function (vnode) {
            // Make Chrome style dialog available for all browsers
            var dlg = document.getElementById(vnode.dom.id);
            if (!dlg.showModal) { dialogPolyfill.registerDialog(dlg); }
          }
        }, [
        m("h3", {
          id: ids.header,
          class: "suite-header"
        }, [m("i", {
          class:"fa fa-" + vm.icon() + " suite-dialog-icon"
        })], vm.title().toName()),
        m("div", {class: "suite-dialog-content-frame"}, [
          vm.content(),
          m("br"),
          m("button", okOpts, "Ok"),
          m("button", {
            id: ids.buttonCancel,
            class: "pure-button",
            style: { display: vm.displayCancel() },
            onclick: vm.cancel,
            autofocus: true
          }, "Cancel")
        ])
      ]);

      return view;
    };

    return component;
  };

  module.exports = dialog;

}());
