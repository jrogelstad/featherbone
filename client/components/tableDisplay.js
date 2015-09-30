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

  f.components.tableDisplay = function (options) {
    var component = {};

    component.controller = function () {
      var selection,
        that = this,
        feather = options.feather,
        name = feather.toCamelCase(),
        pathName = feather.toSpinalCase(),
        plural = f.catalog.getFeather(feather).plural.toSpinalCase();

      this.models = f.models[name].list();
      this.attrs = options.attrs || ["id"];
      this.goHome = function () {
        m.route("/home");
      };
      this.hasSelection = function () {
        return !selection;
      };
      this.isSelected = function (model) {
        return selection === model;
      };
      this.modelDelete = function () {
        selection.delete().then(function () {
          that.models().remove(selection);
          m.route("/" + plural);
        });
      };
      this.modelNew = function () {
        m.route("/" + pathName);
      };
      this.modelOpen = function () {
        m.route("/" + pathName + "/" + selection.data.id());
      };
      this.select = function (model) {
        if (selection !== model) {
          selection = model;
        }
        return selection;
      };
      this.selection = function () {
        return selection;
      };
      this.toggleOpen = function (model) {
        selection = model;
        that.modelOpen();
      };
      this.toggleSelection = function (model) {
        if (selection === model) {
          that.select(undefined);
          return false;
        }
        that.select(model);
        return true;
      };
    };

    component.view = function (ctrl) {
      return m("div", [
        m("button", {
          type: "button",
          onclick: ctrl.goHome
        }, "Home"),
        m("button", {
          type: "button",
          onclick: ctrl.modelNew
        }, "New"),
        m("button", {
          type: "button",
          onclick: ctrl.modelOpen,
          disabled: ctrl.hasSelection()
        }, "Open"),
        m("button", {
          type: "button",
          onclick: ctrl.modelDelete,
          disabled: ctrl.hasSelection()
        }, "Delete"),
        m("input", {
          type: "search",
          value: "Search",
          style: {
            color: "LightGrey",
            fontStyle: "italic"
          }
        }),
        m("table", [
          (function () {
            var tds = ctrl.attrs.map(function (key) {
                return m("td", key.toProperCase(true));
              });
            return m("tr", {style: {backgroundColor: "LightGrey"}}, tds);
          }()),
          ctrl.models().map(function (model) {
            var d = model.data,
              tds = ctrl.attrs.map(function (col) {
                var value = d[col](),
                  hasLocale = value !== null &&
                    typeof value.toLocaleString === "function";
                return m("td", hasLocale ? value.toLocaleString() : value);
              });
            return m("tr", {
              onclick: ctrl.toggleSelection.bind(this, model),
              ondblclick: ctrl.toggleOpen.bind(this, model),
              style: {
                backgroundColor: ctrl.isSelected(model) ? "LightBlue" : "White"
              }
            }, tds);
          })
        ])
      ]);
    };

    return component;
  };

}(f));


