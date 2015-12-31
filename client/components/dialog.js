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
    vm.ids = m.prop({
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
      m.redraw(); // Bug in Chrome
    };
    vm.content = function () {
      return m("div", {id: vm.ids().content}, vm.message());
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
      m.redraw(); // Bug in Chrome
    };
    vm.okDisabled = m.prop(false);
    vm.okTitle = m.prop("");
    vm.show = function () {
      state.send("show");
    };
    vm.title = m.prop(options.title || "");
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
            var  id = vm.ids().dialog,
              dlg = document.getElementById(id);
            if (dlg) { dlg.close(); }
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

    component.controller = function () {
      this.vm = options.viewModel || dialog.viewModel(options);
    };

    component.view = function (ctrl) {
      var view, okOpts,
        vm = ctrl.vm,
        ids = vm.ids();

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
          style: vm.style(),
          config: function (dlg) {
            // Make Chrome style dialog available for all browsers
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
