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

  f.viewModels.formViewModel = function (feather, id) {
    var vm = {},
      name = feather.toCamelCase(),
      plural = f.catalog.getFeather(feather).plural.toSpinalCase();

    vm.model = f.models[name]({id: id});
    vm.attrs = {};

    if (id) { vm.model.fetch(); }

    vm.canSave = function () {
      var currentState = vm.model.state.current()[0];
      return (currentState === "/Ready/New" ||
        currentState === "/Ready/Fetched/Dirty") &&
        vm.model.isValid();
    };
    vm.doApply = function () {
      vm.model.save();
    };
    vm.doList = function () {
      m.route("/" + plural);
    };
    vm.doNew = function () {
      m.route("/" + name);
    };
    vm.doSave = function () {
      vm.model.save().then(function () {
        m.route("/" + plural);
      });
    };
    vm.doSaveAndNew = function () {
      vm.model.save().then(function () {
        m.route("/" + name);
      });
    };
    vm.isFirstLoad = m.prop(true);

    return vm;
  };

  f.components.formDisplay = function (options) {
    var widget = {},
      feather = options.feather;

    widget.controller = function () {
      this.vm = f.viewModels.formViewModel(feather, m.route.param("id"));
    };

    widget.view = function (ctrl) {
      var attrs, findComponent, focusAttr,
        model = ctrl.vm.model,
        props = f.catalog.getFeather(feather).properties,
        d = model.data,
        inputMap = {
          integer: "number",
          number: "text",
          string: "text",
          date: "date",
          dateTime: "datetime-local",
          boolean: "checkbox",
          password: "text",
          tel: "tel"
        };

      findComponent = function (prop) {
        var rel, w, opts,
          p = props[prop],
          format = p.format || p.type;

        // Handle input types
        if (typeof p.type === "string") {
          opts = {
            id: prop,
            type: inputMap[format]
          };

          if (d[prop].isReadOnly()) {
            opts.disabled = true;
          }
          if (d[prop].isRequired()) {
            opts.required = true;
          }
          if (p.type === "boolean") {
            opts.onclick = m.withAttr("checked", d[prop]);
            opts.checked = d[prop]();
          } else {
            opts.onchange = m.withAttr("value", d[prop]);
            opts.value = d[prop]();
          }

          return m("input", opts);
        }

        // Handle relations
        rel = d[prop].type.relation.toCamelCase();
        w = f.components[rel + "Relation"]({parentProperty: prop});

        if (d[prop].isToOne() && w) {
          return m.component(w, {viewModel: ctrl.vm});
        }

        console.log("Widget for property '" + prop + "' is unknown");
      };

      attrs = options.attrs.map(function (key) {
        if (!focusAttr) { focusAttr = key; }
        var color, result;
        color = (d[key].isRequired() && d[key]()) === null ? "Red" : "Black";
        result = m("div", {
          class: "pure-control-group"
        }, [
          m("label", {
            for: key,
            style: {
              color: color
            }
          }, key.toProperCase() + ":"),
          findComponent(key)
        ]);
        return result;
      });

      return m("form", {
        class: "pure-form pure-form-aligned",
        config: function () {
          if (ctrl.vm.isFirstLoad()) {
            document.getElementById(focusAttr).focus();
            ctrl.vm.isFirstLoad(false);
          }
        }
      }, [
        m("div", {id: "toolbar",
          style: {
            margin: "2px"
          }
        }, [
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: ctrl.vm.doList
          }, [m("i", {class:"fa fa-arrow-left"})], " Done"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            disabled: !ctrl.vm.canSave(),
            onclick: ctrl.vm.doApply
          }, "Apply"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            disabled: !ctrl.vm.canSave(),
            onclick: ctrl.vm.doSave
          }, [m("i", {class:"fa fa-save"})], " Save"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: ctrl.vm.canSave() ? ctrl.vm.doSaveAndNew : ctrl.vm.doNew
          }, [m("i", {class:"fa fa-asterisk"})],
          ctrl.vm.canSave() ? " Save & New" : " New")
        ]),
        m("div", {
          style: {
            overflow: "auto"
          },
          config: function (e) {
            var tb = document.getElementById("toolbar");

            // Set fields table to scroll and toolbar to stay put
            document.documentElement.style.overflow = 'hidden';
            e.style.maxHeight = (window.innerHeight - tb.clientHeight) + "px";
          }
        }, [
          m("fieldset", attrs)
        ])
      ]);
    };

    return widget;
  };

}(f));


