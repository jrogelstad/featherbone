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

  // Calculate scroll bar width
  // http://stackoverflow.com/questions/13382516/getting-scroll-bar-width-using-javascript
  var scrWidth, inner, widthNoScroll, widthWithScroll,
    outer = document.createElement("div");

  outer.style.visibility = "hidden";
  outer.style.width = "100px";
  outer.style.msOverflowStyle = "scrollbar"; // needed for WinJS apps

  document.body.appendChild(outer);

  widthNoScroll = outer.offsetWidth;
  // force scrollbars
  outer.style.overflow = "scroll";

  // add innerdiv
  inner = document.createElement("div");
  inner.style.width = "100%";
  outer.appendChild(inner);        

  widthWithScroll = inner.offsetWidth;

  // remove divs
  outer.parentNode.removeChild(outer);
  scrWidth = widthNoScroll - widthWithScroll;

  f.viewModels.workbookViewModel = function (options) {
    var vm = {},
      selection,
      name = options.feather.toCamelCase(),
      pathName = options.feather.toSpinalCase(),
      plural = f.catalog.getFeather(options.feather).plural.toSpinalCase();

    vm.scrollbarWidth = function () {
      return scrWidth;
    };
    vm.models = f.models[name].list();
    vm.attrs = options.attrs || ["id"];
    vm.goHome = function () {
      m.route("/home");
    };
    vm.hasSelection = function () {
      return !selection;
    };
    vm.isSelected = function (model) {
      return selection === model;
    };
    vm.modelDelete = function () {
      selection.delete().then(function () {
        vm.models().remove(selection);
        m.route("/" + plural);
      });
    };
    vm.modelNew = function () {
      m.route("/" + pathName);
    };
    vm.modelOpen = function () {
      m.route("/" + pathName + "/" + selection.data.id());
    };
    vm.onscroll = function () {
      var rows = document.getElementById("rows"),
        header = document.getElementById("header");

      header.scrollLeft = rows.scrollLeft;
    };
    vm.select = function (model) {
      if (selection !== model) {
        selection = model;
      }
      return selection;
    };
    vm.selection = function () {
      return selection;
    };
    vm.selectedTab = m.prop(options.selectedTab);
    vm.config = function () {
      return options.config || {};
    };
    vm.sheets = function () {
      return Object.keys(options.config || {});
    };
    vm.tabClicked = function (sheet) {
      var sconfig = options.config[sheet],
        feather = sconfig.feather || sheet,
        route = "/" + options.name.toSpinalCase() + "/" +
          f.catalog.data()[feather].plural.toSpinalCase();

      m.route(route);
    };
    vm.toggleOpen = function (model) {
      selection = model;
      vm.modelOpen();
    };
    vm.toggleSelection = function (model) {
      if (selection === model) {
        vm.select(undefined);
        return false;
      }
      vm.select(model);
      return true;
    };

    return vm;
  };

  f.components.workbookDisplay = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = f.viewModels.workbookViewModel(options);
    };

    component.view = function (ctrl) {
      var vm = ctrl.vm;

      return m("form", {
        class: "pure-form"
      }, [
        m("div", {
            id: "toolbar"
          }, [
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: vm.goHome
          }, [m("i", {class:"fa fa-home"})], " Home"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: vm.modelNew
          }, [m("i", {class:"fa fa-plus-circle"})], " New"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: vm.modelOpen,
            disabled: vm.hasSelection()
          }, [m("i", {class:"fa fa-folder-open"})], " Open"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px" },
            onclick: vm.modelDelete,
            disabled: vm.hasSelection()
          }, [m("i", {class:"fa fa-remove"})], " Delete"),
          m("input", {
            type: "search",
            value: "Search",
            style: {
              color: "LightGrey",
              fontStyle: "italic",
              margin: "2px"
            }
          })
        ]),
        m("table", {
          class: "pure-table",
          style: {
            tableLayout: "fixed",
            width: "100%"
          }
        }, [
            m("thead", {
            id: "header",
            style: {
              display: "inline-block",
              width: "100%",
              overflow: "hidden"
            }
          }, [
            (function () {
              var ths = vm.attrs.map(function (key) {
                  return m("th", {
                    style: {
                      minWidth: "100px",
                      maxWidth: "100px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }
                  },
                    key.toProperCase(true));
                });
              // End cap on header for scrollbar
              ths.push(m("th", {
                style: {
                  minWidth: vm.scrollbarWidth() + "px",
                  maxWidth: vm.scrollbarWidth() + "px"
                }
              }));
              return m("tr", {
                style: {
                  backgroundColor: "LightGrey"
                }
              }, ths);
            }())
          ]),
          m("tbody", {
            id: "rows",
            onscroll: vm.onscroll,
            style: {
              display: "inline-block",
              width: "100%",
              overflow: "auto"
            },
            config: function (e) {
              var tb = document.getElementById("toolbar"),
                hd = document.getElementById("header"),
                ts = document.getElementById("tabs"),
                mh = window.innerHeight - tb.clientHeight - hd.clientHeight - ts.clientHeight- 12;

              // Set fields table to scroll and toolbar to stay put
              document.documentElement.style.overflow = 'hidden';
              e.style.height = mh + "px";
            }
          }, [
            vm.models().map(function (model) {
              var d = model.data,
                tds = vm.attrs.map(function (col) {
                  var value = d[col](),
                    hasLocale = value !== null &&
                      typeof value.toLocaleString === "function";
                  return m("td", {
                    style: {
                      minWidth: "100px",
                      maxWidth: "100px",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis"
                    }
                  }, hasLocale ? value.toLocaleString() : value);
                });
              return m("tr", {
                onclick: vm.toggleSelection.bind(this, model),
                ondblclick: vm.toggleOpen.bind(this, model),
                style: {
                  backgroundColor: vm.isSelected(model) ?
                      "LightBlue" : "White"
                }
              }, tds);
            })
          ])
        ]),
        m("div", {
            id: "tabs"
          }, 
          vm.sheets().map(function (sheet) {
            var  sconfig = vm.config()[sheet],
              label = sconfig.feather ?
                sheet : f.catalog.getFeather(sheet).plural;
            return m("button[type=button]", {
                class: vm.selectedTab() === sheet ?
                  "pure-button pure-button-active" : "pure-button",
                style: {
                  borderTopLeftRadius: "0px",
                  borderTopRightRadius: "0px",
                  fontSize: "85%"
                },
                onclick: vm.tabClicked.bind(this, sheet)
              }, label);
          })
        )
      ]);
    };

    return component;
  };

}(f));


