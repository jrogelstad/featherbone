(function () {
  "use strict";

  var checkbox = {},
    m = require("mithril"),
    f = require("feather-core");

  // Define checkbox component
  checkbox.component = function (options) {
    var component = {};

    component.view = function () {
      var view, opts,
        value = options.value,
        id = options.id || f.createId();

      opts = {
        id: id,
        class: "suite-checkbox-input",
        type: "checkbox",
        onclick: m.withAttr("checked", options.onclick),
        checked: value,
        style: options.style || {}
      };

      if (options.required) { opts.required = true; }
      if (options.disabled) { opts.disabled = true; }

      view = m("div", {
          class: "suite-checkbox"
        }, [
          m("input", opts),
          m("label", {
            for: id,
            class: "suite-checkbox-label"
          }, m("i", {
            class:"fa fa-check",
            style: {visibility: value ? "visible" : "hidden"}
          }))
        ]);

      return view;
    };

    return component;
  };

  module.exports = checkbox;

}());


