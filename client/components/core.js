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
    var rel, w,
      key = obj.key,
      d = obj.model.data,
      p = d[obj.key],
      format = obj.format || p.format || p.type,
      opts = obj.options || {};

    // Handle input types
    if (typeof p.type === "string") {
      opts.id = key;
      opts.type = f.inputMap[format];

      if (d[key].isReadOnly()) {
        opts.disabled = true;
      }
      if (d[key].isRequired()) {
        opts.required = true;
      }
      if (p.type === "boolean") {
        opts.onclick = m.withAttr("checked", d[key]);
        opts.checked = d[key]();
      } else {
        opts.onchange = m.withAttr("value", d[key]);
        opts.value = d[key]();
      }

      return m("input", opts);
    }

    // Handle relations
    rel = d[key].type.relation.toCamelCase();
    w = f.components[rel + "Relation"]({parentProperty: key});

    if (d[key].isToOne() && w) {
      return m.component(w, {viewModel: obj.viewModel});
    }

    console.log("Widget for property '" + key + "' is unknown");
  };

}(f));


