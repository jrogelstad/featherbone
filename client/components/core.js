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

  f.components = {};
  f.viewModels = {};

  /**
    Object to define what input type to use for data
  */
  f.inputMap = {
    integer: "number",
    number: "text",
    string: "text",
    date: "date",
    dateTime: "datetime-local",
    boolean: "checkbox",
    password: "text",
    tel: "tel"
  };

  /**
    Helper function for building input elements

    @param {Object} Arguments object
    @param {Object} [obj.model] Model
    @param {String} [obj.key] Property key
    @param {Object} {obj.controller} Controller
    @param {object} Properties specification
  */
  f.buildInputComponent = function (obj) {
    var rel, w, component,
      key = obj.key,
      prop = f.resolveProperty(obj.model, key),
      format = prop.format || prop.type,
      opts = obj.options || {};

    // Handle input types
    if (typeof prop.type === "string") {
      opts.id = key;
      opts.type = f.inputMap[format];

      if (prop.isReadOnly() || key.indexOf(".") !== -1) {
        opts.disabled = true;
      }

      if (prop.isRequired()) {
        opts.required = true;
      }

      if (prop.type === "boolean") {
        opts.onclick = m.withAttr("checked", prop);
        opts.checked = prop();
        opts.style = opts.style || {};
        opts.style.position = "absolute";
        opts.style.left = "-999px";

        component = m("div", {
          style: {display: "inline-block"}
        }, [
          m("input", opts),
          m("label", {
            for: key,
            style: {
              borderWidth: "thin",
              borderStyle: "solid",
              borderRadius: "4px",
              borderColor: "#ccc",
              boxShadow: "inset 0 1px 3px #ddd",
              padding: "7px",
              maxWidth: "15px",
              minWidth: "15px"
            }
          }, m("i", {
            class:"fa fa-check",
            style: {visibility: prop() ? "visible" : "hidden"}
          }))
        ]);

      } else {
        opts.onchange = m.withAttr("value", prop);
        opts.value = prop();
        component = m("input", opts);
      }

      return component;
    }

    // Handle relations
    rel = prop.type.relation.toCamelCase();
    w = f.components[rel + "Relation"]({parentProperty: key});

    if (prop.isToOne() && w) {
      return m.component(w, {viewModel: obj.viewModel});
    }

    console.log("Widget for property '" + key + "' is unknown");
  };

  /** @private  Helper function to resolve property dot notation */
  f.resolveProperty = function (model, property) {
    var prefix, suffix,
      idx = property.indexOf(".");

    if (!model) { return m.prop(null); }

    if (idx > -1) {
      prefix = property.slice(0, idx);
      suffix = property.slice(idx + 1, property.length);
      return f.resolveProperty(model.data[prefix](), suffix);
    }

    return model.data[property];
  };

}(f));


