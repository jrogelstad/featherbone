/*global dialogPolyfill*/
(function () {
  "use strict";

  require("dialog-polyfill");

  var dialog = {},
    m = require("mithril"),
    f = require("feather-core"),
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
    vm.icon = m.prop(options.icon);
    vm.id = m.prop(options.id || f.createId());
    vm.cancel = function () {
      var doCancel = vm.onCancel();
      if (typeof doCancel === "function") {
        doCancel();
      }
      state.send("close");
    };
    vm.content = function () {
      return m("div", vm.message());
    };
    vm.displayCancel = function () {
      return vm.onOk() ? "inline-block" : "none";
    };
    vm.message = m.prop(options.message || "Your message here");
    vm.onCancel = m.prop(options.onCancel);
    vm.onOk = m.prop(options.onOk);
    vm.ok = function () {
      var doOk = vm.onOk();
      if (typeof doOk === "function") {
        doOk();
      }
      state.send("close");
    };
    vm.show = function () {
      state.send("show");
    };
    vm.title = m.prop(options.title);
    vm.state = function () {
      return state;
    };
    vm.style = m.prop({width: "350px"});

    // ..........................................................
    // PRIVATE
    //

    // Statechart
    state = statechart.define(function () {
      this.state("Display", function () {
        this.state("Closed", function () {
          this.enter(function () {
            var  id = vm.id(),
              dlg = document.getElementById(id);
            if (dlg) { dlg.close(); }
          });
          this.event("show", function () {
            this.goto("../Showing");
          });
        });
        this.state("Showing", function () {
          this.enter(function () {
            var id = vm.id(),
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

    component.controller = function () {
      this.vm = options.viewModel || dialog.viewModel(options);
    };

    component.view = function (ctrl) {
      var view,
        vm = ctrl.vm;

      view = m("dialog", {
          id: vm.id(),
          class: "suite-dialog",
          style: vm.style(),
          config: function (dlg) {
            // Make Chrome style dialog available for all browsers
            if (!dlg.showModal) { dialogPolyfill.registerDialog(dlg); }
          }
        }, [
        m("h3", {
          class: "suite-header"
        }, [m("i", {
          class:"fa fa-" + vm.icon() + " suite-dialog-icon"
        })], vm.title().toName()),
        m("div", {class: "suite-dialog-content-frame"}, [
          vm.content(),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary suite-dialog-button-ok",
            onclick: vm.ok
          }, "Ok"),
          m("button", {
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
