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

(function () {
  "use strict";

  require("workbook");

  var f = require("common-core"),
    catalog = require("catalog"),
    m = require("mithril"),
    stream = require("stream");

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

    Use of this function requires that "Checkbox" has been pre-registered,
    (i.e. "required") in the application before it is called.

    @param {Object} Options object
    @param {Object} [options.model] Model
    @param {String} [options.key] Property key
    @param {Object} [options.viewModel] View Model
  */
  f.buildInputComponent = function (obj) {
    var rel, w, component,
      key = obj.key,
      isPath = key.indexOf(".") !== -1,
      prop = f.resolveProperty(obj.model, key),
      format = prop.format || prop.type,
      opts = obj.options || {},
      components = catalog.store().components();

    // Handle input types
    if (typeof prop.type === "string" || isPath) {
      opts.id = key;
      opts.type = f.inputMap[format];

      if (isPath || prop.isReadOnly()) {
        opts.disabled = true;
      }

      if (isPath || prop.isRequired()) {
        opts.required = true;
      }

      if (prop.type === "boolean") {
        component = m(components.checkbox({
          id: key,
          value: prop(),
          onclick: prop,
          required: opts.required,
          disabled: opts.disabled,
          style: opts.style
        }));
      } else {
        opts.onchange = m.withAttr("value", prop);
        opts.value = prop();

        // If options were passed in, used a select element
        if (obj.dataList) {
          component = m("select", opts, obj.dataList.map(function (item) {
            return m("option", {value: item.value}, item.label);
          }));

        // Otherwise standard input
        } else {
          component = m("input", opts);
        }
      }

      return component;
    }

    // Handle relations
    if (prop.isToOne()) {
      rel = prop.type.relation.toCamelCase();
      w = catalog.store().components()[rel + "Relation"]({
        parentViewModel: obj.viewModel,
        parentProperty: key,
        isCell: opts.isCell,
        style: opts.style
      });

      if (w) { return m(w); }
    }

    if (prop.isToMany()) {
      w = catalog.store().components().childTable({
        parentViewModel: obj.viewModel,
        parentProperty: key
      });
      if (w) { return m(w); }
    }

    console.log("Widget for property '" + key + "' is unknown");
  };

  /**
    Helper function for building relation widgets.

    Use of this function requires that the Relation Widget object has been pre-registered,
    (i.e. "required") in the application before it is called.

    @param {Object} Options
    @param {Object} [options.parentProperty] Default name of parent property on parent model
    @param {String} [options.valueProperty] Default name of value property on relation model
    @param {Object} {options.labelProperty} Default name of label property on relation model
    @param {Object} {options.isCell} Whether to use table cell style
  */
  f.buildRelationWidget = function (relopts) {
    var that,
      relationWidget = catalog.store().components().relationWidget,
      name = relopts.feather.toCamelCase() + "Relation";

    that = function (options) {
      options = options || {};
      var form, w,
        id = options.form || relopts.form;
      form = catalog.store().forms()[id];
      w = relationWidget({
        parentViewModel: options.parentViewModel,
        parentProperty: options.parentProperty || relopts.parentProperty,
        valueProperty: options.valueProperty || relopts.valueProperty,
        labelProperty: options.labelProperty || relopts.labelProperty,
        form: form,
        list: options.list || relopts.list,
        style: options.style || relopts.style,
        isCell: options.isCell === undefined ?
          relopts.isCell : options.isCell
      });

      return w;
    };

    that.labelProperty = function () {
      return relopts.labelProperty;
    };
    that.valueProperty = function () {
      return relopts.valueProperty;
    };
    catalog.register("components", name, that);
  };

  /*
    Returns the exact x, y coordinents of an HTML element.

    Thanks to:
    http://www.kirupa.com/html5/get_element_position_using_javascript.htm
  */
  f.getElementPosition = function (element) {
    var xPosition = 0,
      yPosition = 0;
  
    while (element) {
      xPosition += (element.offsetLeft - element.scrollLeft + element.clientLeft);
      yPosition += (element.offsetTop - element.scrollTop + element.clientTop);
      element = element.offsetParent;
    }

    return { x: xPosition, y: yPosition };
  };

  /** @private  Helper function recursive list of feather properties */
  f.resolveProperties = function (feather, properties, ary, prefix) {
    prefix = prefix || "";
    var result = ary || [];
    properties.forEach(function (key) {
      var rfeather,
        prop = feather.properties[key],
        isObject = typeof prop.type === "object",
        path = prefix + key;
      if (isObject && prop.type.properties) {
        rfeather = catalog.getFeather(prop.type.relation);
        f.resolveProperties(rfeather, prop.type.properties, result, path + ".");
      }
      if (!isObject || (!prop.type.childOf && !prop.type.parentOf)) {
        result.push(path);
      }
    });
    return result;
  };

  /** @private  Helper function to resolve property dot notation */
  f.resolveProperty = function (model, property) {
    var prefix, suffix,
      idx = property.indexOf(".");

    if (!model) { return stream(null); }

    if (idx > -1) {
      prefix = property.slice(0, idx);
      suffix = property.slice(idx + 1, property.length);
      return f.resolveProperty(model.data[prefix](), suffix);
    }

    return model.data[property];
  };

  module.exports = f;

}());


