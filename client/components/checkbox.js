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

  // Define checkbox component
  f.components.checkbox = function (options) {
    var component = {};

    component.view = function () {
      var view, opts,
        value = options.value,
        id = options.id || f.createId();

      opts = {
        id: id,
        type: "checkbox",
        onclick: m.withAttr("checked", options.onclick),
        checked: value,
        style: options.style || {}
      };
      opts.style.position = "absolute";
      opts.style.left = "-999px";

      if (options.required) { opts.required = true; }
      if (options.disabled) { opts.disabled = true; }

      view = m("div", {
          style: {display: "inline-block"}
        }, [
          m("input", opts),
          m("label", {
            for: id,
            style: {
              borderWidth: "thin",
              borderStyle: "solid",
              borderRadius: "4px",
              borderColor: "#ccc",
              boxShadow: "inset 0 1px 3px #ddd",
              padding: "7px",
              maxWidth: "15px",
              minWidth: "15px",
              backgroundColor: "White"
            }
          }, m("i", {
            class:"fa fa-check",
            style: {visibility: value ? "visible" : "hidden"}
          }))
        ]);

      return view;
    };

    return component;
  };

}(f));


