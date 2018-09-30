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
  require("money-relation");

  var f = require("common-core"),
    catalog = require("catalog"),
    m = require("mithril"),
    stream = require("stream"),
    mathjs = require("mathjs");

  function getCurrency (currency) {
    return catalog.store().data().currencies().find(function (curr) {
      return curr.data.code() === currency ||
        (curr.data.hasDisplayUnit() &&
        curr.data.displayUnit().data.code() === currency);
    });
  }

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

  f.formats.money.fromType = function (value) {
    var style, expr,
      amount = value.amount,
      currency = value.currency,
      curr = getCurrency(value.currency),
      hasDisplayUnit = curr.data.hasDisplayUnit(),
      minorUnit = hasDisplayUnit ?
        curr.data.displayUnit().data.minorUnit() : curr.data.minorUnit();

    style = {
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit
    };

    if (hasDisplayUnit) {
      curr.data.conversions().some(function (conv) {
        if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
          expr = amount + " / " + conv.data.ratio();
          amount = mathjs.eval(expr);
          return true;
        }
      });

      currency = curr.data.displayUnit().data.code();
    }

    return {
      amount: amount.toLocaleString(undefined, style),
      currency: currency,
      effective: f.formats.dateTime.fromType(value.effective),
      ratio: f.types.number.fromType(value.ratio)
    };
  };

  f.formats.money.toType = function (value) {
    var expr,
      amount = f.types.number.toType(value.amount),
      currency = f.formats.string.toType(value.currency),
      curr = getCurrency(value.currency);

    if (curr.data.hasDisplayUnit() && currency !== curr.data.code()) {
      curr.data.conversions().some(function (conv) {
        if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
          expr = amount + " * " + conv.data.ratio();
          amount = mathjs.eval(expr);
          return true;
        }
      });

      currency = curr.data.code();
    }

    return {
      amount: amount,
      currency: currency,
      effective: f.formats.dateTime.toType(value.effective),
      ratio: f.types.number.toType(value.ratio)
    };
  };

  f.baseCurrency = function () {
    var ret = catalog.store().data().currencies().find(function (currency) {
        return currency.data.isBase();
      });

    return ret;
  };

  /**
    Return a money object.

    @param {Number} Amount.
    @param {String} Currency code.
    @param {Date} Effective date.
    @param {Number} Ratio.
    @return {Object}
  */
  f.money = function (amount, currency, effective, ratio) {
    var ret = {
        amount: amount || 0,
        currency: currency || f.baseCurrency().data.code(),
        effective: effective || null,
        ratio: ratio || null
      };

    return ret;
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
      components = catalog.store().components(),
      id = opts.id || key;

    // Handle input types
    if (typeof prop.type === "string" || isPath) {
      opts.type = f.inputMap[format];

      if (isPath || prop.isReadOnly()) {
        opts.disabled = true;
      }

      if (isPath || prop.isRequired()) {
        opts.required = true;
      }

      if (prop.type === "boolean") {
        component = m(components.checkbox, {
          id: id,
          value: prop(),
          onclick: prop,
          required: opts.required,
          disabled: opts.disabled,
          style: opts.style
        });
      } else if (prop.type === "object" &&
          prop.format === "money") {
        component = m(components.moneyRelation, {
          parentViewModel: obj.viewModel,
          parentProperty: key,
          filter: obj.filter,
          isCell: opts.isCell,
          style: opts.style,
          onCreate: opts.oncreate,
          id: id,
          disabled: prop.isReadOnly()
        });
      } else {
        opts.id = id;
        opts.onchange = m.withAttr("value", prop);
        opts.value = prop();

        // If options were passed in, used a select element
        if (obj.dataList) {
          component = m("select", {
            id: id,
            onchange: opts.onchange, 
            value: (opts.value === "" ? undefined : opts.value),
            disabled: opts.disabled
          }, obj.dataList.map(function (item) {
            return m("option", {value: item.value}, item.label);
          }));

        // Otherwise standard input
        } else {
          opts.style = opts.style || {};
          opts.style.width = "215px";
          component = m("input", opts);
        }
      }

      return component;
    }

    // Handle relations
    if (prop.isToOne()) {
      rel = prop.type.relation.toCamelCase();
      w = catalog.store().components()[rel + "Relation"];

      if (w) { 
        return m(w,{
          parentViewModel: obj.viewModel,
          parentProperty: key,
          filter: obj.filter,
          isCell: opts.isCell,
          style: opts.style,
          onCreate: opts.oncreate,
          id: id,
          disabled: prop.isReadOnly()
        }); 
      }
    }

    if (prop.isToMany()) {
      w = catalog.store().components().childTable;
      if (w) { 
        return m(w, {
          parentViewModel: obj.viewModel,
          parentProperty: key
        }); 
      }
    }

    console.log("Widget for property '" + key + "' is unknown");
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

  /** @private  Helper function to resolve property dot notation */
  f.resolveAlias = function (feather, attr) {
    var prefix, suffix, ret,
      overload = feather.overloads ? feather.overloads[attr] || {} : {},
      idx = attr.indexOf(".");

    if (idx > -1) {
      prefix = attr.slice(0, idx);
      suffix = attr.slice(idx + 1, attr.length);
      feather = catalog.getFeather(feather.properties[prefix].type.relation);
      return f.resolveAlias(feather, suffix);
    }

    ret = overload.alias || feather.properties[attr].alias || attr;
    return ret.toName();
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


