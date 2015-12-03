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

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.propertyName] Filter property being modified
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Array} [options.feather] Feather
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.filterDialogViewModel = function (options) {
    options = options || {};
    var vm, model, buildInputComponent,
      resolveProperty, getDefault,
      feather = options.feather;

    options.onclickOk = function () {
      options.filter(vm.filter());
    };

    // ..........................................................
    // PUBLIC
    //

    vm = f.viewModels.tableDialogViewModel(options);
    vm.addAttr = function (attr) {
      if (!this.some(vm.hasAttr.bind(attr))) {
        this.push({
          property: attr,
          value: getDefault(attr)
        });

        return true;
      }
    };
    vm.data = function () {
      return vm.filter()[vm.propertyName()];
    };
    vm.itemPropertyChanged = function (index, value) {
      vm.itemChanged(index, "property", value);
      vm.data()[index].value = getDefault(value);
    };
    vm.filter = m.prop();
    vm.model = function () { return model; };
    vm.operators = function (attr) {
      var ops, prop, format;

      ops = {
        "=": "equals",
        "!=": "not equals",
        "~*": "matches",
        "!~*": "not matches",
        ">": "greater than",
        "<": "less than",
        ">=": "greater than or equals",
        "<=": "less than or equals"
      };

      if (attr) {
        prop = resolveProperty(feather, attr);
        format = prop.format || prop.type;

        switch (format) {
        case "integer":
        case "number":
        case "date":
        case "dateTime":
          delete ops["~*"];
          delete ops["!~*"];
          break;
        case "boolean":
          delete ops["~*"];
          delete ops["!~*"];
          delete ops[">"];
          delete ops["<"];
          delete ops[">="];
          delete ops["<="];
          break;
        case "string":
        case "password":
        case "tel":
          delete ops[">"];
          delete ops["<"];
          delete ops[">="];
          delete ops["<="];
          break;
        default:
          delete ops["~*"];
          delete ops["!~*"];
          delete ops[">"];
          delete ops["<"];
          delete ops[">="];
          delete ops["<="];
        }
      }

      return ops;
    };
    vm.propertyName = m.prop(options.propertyName || "criteria");
    vm.relations = m.prop({});
    vm.reset = function () {
      var name = vm.propertyName(),
        filter = f.copy(options.filter());
      filter[name] = filter[name] || [];
      vm.filter(filter);
      if (!filter[name].length) { vm.add(); }
      vm.selection(0);
    };
    vm.viewHeaderIds = m.prop({
      column: f.createId(),
      operator: f.createId(),
      value: f.createId()
    });
    vm.viewHeaders = function () {
      var ids = vm.viewHeaderIds();
      return [
        m("th", {style: {minWidth: "175px"}, id: ids.column }, "Column"),
        m("th", {style: {minWidth: "200px"}, id: ids.operator}, "Operator"),
        m("th", {style: {minWidth: "225px"}, id: ids.value}, "Value")
      ];
    };
    vm.viewRows = function () {
      var view;

      view = vm.items().map(function (item) {
        var row,
          operators = vm.operators(item.property);

        row = m("tr", {
          onclick: vm.selection.bind(this, item.index, true),
          style: {backgroundColor: vm.rowColor(item.index)}
        },[
          m("td", {
           style: {minWidth: "175px", maxWidth: "175px"}
          }, m("select", {
              value: item.property,
              onchange: m.withAttr(
                "value",
                vm.itemPropertyChanged.bind(this, item.index))
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", {
           style: {minWidth: "200px", maxWidth: "200px"}
          }, [
            m("select", {
              onchange: m.withAttr(
                "value",
                vm.itemChanged.bind(this, item.index, "operator"))
            }, Object.keys(operators).map(function (op) {
              return m("option", {value: op}, operators[op]);
            }), item.operator || "=")
          ]),
          m("td", {
           style: {minWidth: "225px", maxWidth: "225px"}
          }, [buildInputComponent({
            index: item.index,
            key: item.property,
            value: item.value,
            style: {maxWidth: "200px"}
          })])
        ]);

        return row;
      });

      return view;
    };

    // ..........................................................
    // PRIVATE
    //

    /** @private
      Helper function for building input elements

      @param {Object} Arguments object
      @param {Number} [obj.index] Index
      @param {String} [obj.attr] Property
      @param {Object} [obj.value] Value
    */
    buildInputComponent = function (obj) {
      var rel, w, component, prop, type, format,
        attr = obj.key,
        value = obj.value,
        index = obj.index,
        opts = {};

      prop = resolveProperty(feather, attr);
      type = prop.type;
      format = prop.format || prop.type;

      // Handle input types
      if (typeof type === "string") {
        if (type === "boolean") {
          component = f.components.checkbox({
            value: value,
            onclick: vm.itemChanged.bind(this, index, "value")
          });
        } else {
          opts.type = f.inputMap[format];
          opts.onchange = m.withAttr(
            "value",
            vm.itemChanged.bind(this, index, "value")
          );
          opts.value = value;
          component = m("input", opts);
        }

        return component;
      }

      // Handle relations
      if (!type.childOf && !type.parentOf) {
        rel = type.relation.toCamelCase();
        w = f.components[rel + "Relation"]({
          parentProperty: attr,
          isCell: true
        });

        if (w) {
          return m.component(w, {
            viewModel: vm,
            style: obj.style
          });
        }
      }

      console.log("Widget for property '" + attr + "' is unknown");
    };

    getDefault = function (attr) {
      var value,
        prop = resolveProperty(feather, attr),
        type = prop.type,
        format = prop.format;

      if (typeof type === "object") { return {id: ""}; }

      if (format && f.formats[format] &&
          f.formats[format].default) {
        value = f.formats[format].default;
      } else {
        value = f.types[type].default;
      }

      if (typeof value === "function") {
        value = value();
      }

      return value;
    };

    resolveProperty = function (feather, property) {
      var prefix, suffix, rel,
        idx = property.indexOf(".");

      if (idx > -1) {
        prefix = property.slice(0, idx);
        suffix = property.slice(idx + 1, property.length);
        rel = feather.properties[prefix].type.relation;
        feather = f.catalog.getFeather(rel);
        return resolveProperty(feather, suffix);
      }

      return feather.properties[property];
    };

    // Build internal model for processing relations where applicable
    if (feather) { 
      model = f.model({}, feather);
      Object.keys(model.data).forEach(function (key) {
        if (model.data[key].isToOne()) {
          // If property updated, forward change
          model.onChange(key, function (prop) {
            var items = vm.items();
            items.forEach(function (item) {
              var value;
              if (item.property === key) {
                value = prop.newValue();
                value = value ? {id: value.data.id()} : {id: ""};
                vm.itemChanged(item.index, "value", value);
              }
            });
          });
        }
      });
    }

    vm.state().resolve("/Display/Showing").enter(vm.reset);
    vm.reset();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  f.components.filterDialog = f.components.tableDialog;

}(f));
