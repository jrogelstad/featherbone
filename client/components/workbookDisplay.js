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

  var EDIT_MODE = 2,
    LIST_MODE = 1;

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

  // Define workbook view model
  f.viewModels.workbookViewModel = function (options) {
    var selection,
      sheet = options.sheet,
      frmroute = "/" + options.name + "/" + options.config[sheet].form.name,
      name = options.feather.toCamelCase(),
      vm = {};
    frmroute = frmroute.toSpinalCase();

    vm.config = function () {
      return options.config || {};
    };
    vm.models = f.models[name].list();
    vm.attrs = options.config[sheet].list.attrs || ["id"];
    vm.canSave = function (model) {
      var currentState = model.state.current()[0];
      return (currentState === "/Ready/New" ||
        currentState === "/Ready/Fetched/Dirty") &&
        model.isValid();
    };
    vm.goHome = function () {
      m.route("/home");
    };
    vm.goNextRow = function () {
      var list = vm.models(),
        model = vm.selection(),
        idx = list.indexOf(model) + 1;
      if (list.length > idx) {
        vm.select(list[idx]);
      }
    };
    vm.goPrevRow = function () {
      var list = vm.models(),
        model = vm.selection(),
        idx = list.indexOf(model) - 1;
      if (idx >= 0) {
        vm.select(list[idx]);
      }
    };
    vm.focusColumn = m.prop(vm.attrs[0]);
    vm.canSave = function () {
      return vm.models().some(function (model) {
        return model.canSave();
      });
    };
    vm.hasNoSelection = function () {
      return !selection;
    };
    vm.isSelected = function (model) {
      return selection === model;
    };
    vm.modelDelete = function () {
      // Delete now in list mode
      if (vm.mode() === LIST_MODE) {
        selection.delete(true).then(function () {
          vm.models().remove(selection);
        });
        return;
      }

      // Mork for deletion in edit mode
      selection.delete();
    };
    vm.mode = m.prop(LIST_MODE);
    vm.modelNew = function () {
      m.route(frmroute);
    };
    vm.modelOpen = function () {
      m.route(frmroute + "/" + selection.data.id());
    };
    vm.nextFocus = m.prop();
    vm.onkeydown = function (e) {
      var id, 
        nav = function (name) {
          id = e.srcElement.id;
          // Navigate in desired direction
          m.startComputation();
          vm[name]();
          m.endComputation();
          // Set focus on the same cell we left
          m.startComputation();
          document.getElementById(id).focus();
          m.endComputation();
        };

      switch (e.key || e.keyIdentifier)
      {
      case "Up":
        nav("goPrevRow");
        break;
      case "Down":
        nav("goNextRow");
        break;
      }
    };
    vm.onscroll = function () {
      var rows = document.getElementById("rows"),
        header = document.getElementById("header");

      // Sync header position with table body position
      header.scrollLeft = rows.scrollLeft;
    };
    vm.scrollbarWidth = function () {
      return scrWidth;
    };
    vm.saveAll = function () {
      vm.models().forEach(function (model) {
        model.save().then(function() {
          if (model.state.current()[0] === "/Deleted") {
            vm.models().remove(model);
          }
        });
      });
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
    vm.selectedTab = m.prop(options.sheet);
    vm.sheets = function () {
      return Object.keys(options.config || {});
    };
    vm.tabClicked = function (sheet) {
      var route = "/" + options.name + "/" + sheet;
      route = route.toSpinalCase();
      m.route(route);
    };
    vm.toggleMode = function () {
      var mode = vm.mode() === LIST_MODE ? EDIT_MODE : LIST_MODE;
      vm.mode(mode);
    };
    vm.toggleOpen = function (model) {
      selection = model;
      vm.modelOpen();
    };
    vm.toggleSelection = function (model, col) {
      var mode = vm.mode(),
        isSelected = selection === model;

      // Toggle row off
      if (isSelected && mode === LIST_MODE) {
        vm.select(undefined);
        return false;
      }

      // Select new row
      vm.select(model);

      // Set next focus on clicked cell when editing
      vm.nextFocus("input" + col.toCamelCase(true));

      return true;
    };
    vm.undo = function () {
      if (selection) { selection.undo(); }
    };

    return vm;
  };

  // Define workbook component
  f.components.workbookDisplay = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = f.viewModels.workbookViewModel(options);
    };

    component.view = function (ctrl) {
      var tbodyConfig, header, rows, tabs, view,
        vm = ctrl.vm;

      // Define scrolling behavior for table body
      tbodyConfig = function (e) {
        var tb = document.getElementById("toolbar"),
          hd = document.getElementById("header"),
          ts = document.getElementById("tabs"),
          mh = window.innerHeight - tb.clientHeight - hd.clientHeight - ts.clientHeight- 12;

        // Set fields table to scroll and toolbar to stay put
        document.documentElement.style.overflow = 'hidden';
        e.style.height = mh + "px";

        // Key down handler for up down movement
        e.addEventListener('keydown', vm.onkeydown);
      };

      // Build header
      header = (function () {
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

        // Front cap header navigation
        ths.unshift(m("th", {style: {minWidth: "16px"}}));

        // End cap on header for scrollbar
        ths.push(m("th", {
          style: {
            minWidth: vm.scrollbarWidth() + "px",
            maxWidth: vm.scrollbarWidth() + "px"
          }
        }));
        return m("tr", ths);
      }());

      // Build rows
      rows = vm.models().map(function (model) {
        var tds, row, thContent, onclick,
          mode = vm.mode(),
          color = "White",
          isSelected = vm.isSelected(model),
          d = model.data,
          rowOpts = {};

        // Build view row
        if (mode === LIST_MODE || !isSelected) {
          // Build cells
          tds = vm.attrs.map(function (col) {
            var cell,
              value = d[col](),
              hasLocale = value !== null &&
                typeof value.toLocaleString === "function";

            // Build cell
            cell = m("td", {
                onclick: vm.toggleSelection.bind(this, model, col),
                style: {
                  minWidth: "100px",
                  maxWidth: "100px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }
              },
              hasLocale ? value.toLocaleString() : value);

            return cell;
          });

          // Build row
          if (isSelected) {
            color = "LightBlue";
          }

          rowOpts = {
            ondblclick: vm.toggleOpen.bind(this, model)
          };


        // Build editable row
        } else {
          // Build cells
          tds = vm.attrs.map(function (col) {
            var cell, cellOpts,
              id = "input" + col.toCamelCase(true);

            cellOpts = {
              id: id,
              onclick: vm.toggleSelection.bind(this, model, col),
              onchange: m.withAttr("value", d[col]),
              value: d[col](),
              config: function (e) {
                if (vm.nextFocus() === id) {
                  e.focus();
                  vm.nextFocus(undefined);
                }
              },
              style: {
                minWidth: "100px",
                maxWidth: "100px"
              }
            };

            // Build cell
            cell = m("td", [
              m("input", cellOpts)
            ]);

            return cell;
          });
        }

        // Front cap header navigation
        onclick = vm.toggleSelection.bind(this, model, vm.attrs[0]);
        if (model.state.current()[0] === "/Delete") {
          thContent = [m("i", {
            onclick: onclick,
            class:"fa fa-remove"
          })];
        } else if (model.canSave()) {
          thContent = [m("i", {
            onclick: onclick,
            class:"fa fa-check"
          })];
        } else {
          thContent = {
            onclick: onclick,
            style: {
              minWidth: "16px"
            }
          };
        }
        tds.unshift(m("th", thContent));

        // Build row
        rowOpts.style = { backgroundColor: color };
        row = m("tr", rowOpts, tds);

        return row;
      });

      // Build tabs
      tabs = vm.sheets().map(function (sheet) {
        var tab,
          sconfig = vm.config()[sheet],
          label = sconfig.feather ?
            sheet : f.catalog.getFeather(sheet).plural;

        // Build tab
        tab = m("button[type=button]", {
          class: vm.selectedTab() === sheet ?
            "pure-button pure-button-active" : "pure-button",
          style: {
            borderTopLeftRadius: "0px",
            borderTopRightRadius: "0px"
          },
          onclick: vm.tabClicked.bind(this, sheet)
        }, label);

        return tab;
      });

      // Finally assemble the whole view
      view = m("form", {
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
            style: {
              margin: "1px",
              display: vm.mode() === EDIT_MODE ? "none" : "inline-block"
            },
            onclick: vm.toggleMode
          }, [m("i", {class:"fa fa-pencil"})], " Edit"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.mode() === LIST_MODE ? "none" : "inline-block"
            },
            onclick: vm.toggleMode
          }, [m("i", {class:"fa fa-th-list"})], " List"),
            m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.mode() === LIST_MODE ? "none" : "inline-block"
            },
            onclick: vm.saveAll,
            disabled: !vm.canSave()
          }, [m("i", {class:"fa fa-save"})], " Save"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.mode() === EDIT_MODE ? "none" : "inline-block"
            },
            onclick: vm.modelOpen,
            disabled: vm.hasNoSelection()
          }, [m("i", {class:"fa fa-folder-open"})], " Open"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: { margin: "1px"},
            onclick: vm.modelNew
          }, [m("i", {class:"fa fa-plus-circle"})], " New"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: (vm.selection() && vm.selection().canSave()) ?
                "none" : "inline-block"
            },
            onclick: vm.modelDelete,
            disabled: vm.hasNoSelection()
          }, [m("i", {class:"fa fa-remove"})], " Delete"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: (vm.selection() && vm.selection().canSave()) ?
                "inline-block" : "none"
            },
            onclick: vm.undo
          }, [m("i", {class:"fa fa-undo"})], " Undo"),
          m("input", {
            type: "search",
            value: "Search",
            id: "search",
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
          }, [ header ]),
          m("tbody", {
            id: "rows",
            onscroll: vm.onscroll,
            style: {
              display: "inline-block",
              width: "100%",
              overflow: "auto"
            },
            config: tbodyConfig
          }, [rows])
        ]),
        m("div", {
            id: "tabs"
          }, tabs
        )
      ]);

      return view;
    };

    return component;
  };

}(f));


