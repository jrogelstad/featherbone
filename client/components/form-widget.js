/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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

/*global window*/
(function () {
  "use strict";

  var formWidget = {},
    m = require("mithril"),
    f = require("component-core"),
    math = require("mathjs"),
    catalog = require("catalog");

  formWidget.viewModel = function (options) {
    var vm = {},
      name = options.feather.toCamelCase(),
      models = catalog.store().models();

    vm.config = m.prop(options.config);
    vm.containerId = m.prop(options.containerId);
    vm.selectedTab = m.prop(1);
    vm.isFirstLoad = m.prop(true);
    vm.model = m.prop(models[name]({id: options.id}));
    vm.outsideElementIds = m.prop(options.outsideElementIds || []);
    vm.relations = m.prop({});

    // ..........................................................
    // PRIVATE
    //

    if (options.id) { vm.model().fetch(); }

    return vm;
  };

  formWidget.component = function (options) {
    var widget = {},
      midTabClass = ["pure-button", "suite-sheet-group-tab", "suite-sheet-group-tab-form"],
      leftTabClass = f.copy(midTabClass),
      rightTabClass = f.copy(midTabClass);

    midTabClass.push("suite-sheet-group-tab-middle");
    leftTabClass.push("suite-sheet-group-tab-left");
    rightTabClass.push("suite-sheet-group-tab-right");
    widget.controller = function () {
      this.vm = options.viewModel;
    };

    widget.view = function (ctrl) {
      var focusAttr, buildFieldset,
        buildUnit, buildButtons,
        vm = ctrl.vm,
        attrs = vm.config().attrs || [],
        selectedTab = vm.selectedTab(),
        model = vm.model(),
        d = model.data,
        grids = [];

      buildButtons = function () {
        var className,
          tabs = vm.config().tabs || [],
          last = tabs.length - 1;

        tabs = tabs.map(function (tab) {
          return tab.name;
        });

        return tabs.map(function (name, idx) {
          switch (idx)
          {
          case 0:
            className = leftTabClass;
            break;
          case last:
            className = rightTabClass;
            break;
          default:
            className = midTabClass;
          }

          if (idx + 1 === selectedTab) {
            className.push("suite-sheet-group-tab-active");
          }
          return m("button", {
            class: className.join(" "),
            onclick: vm.selectedTab.bind(this, idx +1)
          }, name);
        });
      };

      // Build elements
      buildFieldset = function (attrs) {
        return attrs.map(function (item) {
          var result, labelOpts,
            key = item.attr,
            prop = d[key],
            value = prop();

          labelOpts = {
            for: key,
            class: "suite-form-label",
            style: {}
          };

          if (item.showLabel === false) {
            labelOpts.style.display = "none";
          }

          if (!prop.isReadOnly() && !focusAttr) {
            focusAttr = key;
          }

          if (prop.isRequired() && (value === null ||
            (prop.type === "string" && !value))) {
            labelOpts.style.color = "Red";
          }
          result = m("div", {
            config: function () {
              if (focusAttr === key && vm.isFirstLoad()) {
                document.getElementById(key).focus();
                vm.isFirstLoad(false);
              }
            },
            class: "pure-control-group"
          }, [
            m("label", labelOpts,
              item.label || key.toProperCase() + ":"),
            f.buildInputComponent({
              model: model,
              key: key,
              viewModel: vm
            })
          ]);
          return result;
        });
      };

      buildUnit = function (attrs, n) {
        var fieldset = buildFieldset(attrs);

        return m("div", {
          class: "pure-u-1 pure-u-md-1-" + n
        }, [
            m("div", {
            class: "pure-form pure-form-aligned"
          }, [m("fieldset", fieldset)])
        ]);
      };

      // build grid matrix from inside out
      attrs.forEach(function (item) {
        var gidx = item.grid || 0,
          uidx = item.unit || 0;
        if (!grids[gidx]) {
          grids[gidx] = [];
        }
        if (!grids[gidx][uidx]) {
          grids[gidx][uidx] = [];
        } 
        grids[gidx][uidx].push(item);
      });

      // Build pane content
      grids = grids.map(function (grid, idx) {
        var units,
          className = "suite-tabbed-panes suite-tabbed-panes-form";

        units = grid.map(function (unit) {
          return buildUnit(unit, grid.length);
        });

        if (!idx) {
          return m("div", {class: "pure-g suite-top-pane"}, units);
        }

        if (idx !== selectedTab) {
          className += " suite-tabbed-panes-hidden";
        }

        return m("div", {class: className}, [
          buildButtons(),
          m("div", {class: "pure-g suite-tabbed-pane"}, units)
        ]);
      });

      return m("div", {
        class: "suite-form-content",
        config: function (e) {
          var bodyHeight = window.innerHeight,
            eids = vm.outsideElementIds();

          eids.forEach(function (id) {
            var h = document.getElementById(id).clientHeight;
            bodyHeight = math.subtract(bodyHeight, h);
          });

          e.style.maxHeight = bodyHeight + "px";
        }
      }, grids);
    };

    return widget;
  };

  catalog.register("components", "formWidget", formWidget.component);
  module.exports = formWidget;

}());


