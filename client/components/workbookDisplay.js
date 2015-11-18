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

  var statechart = window.statechart;

  // Calculate scroll bar width
  // http://stackoverflow.com/questions/13382516/getting-scroll-bar-width-using-javascript
  var scrWidth, inner, widthNoScroll, widthWithScroll,
    outer = document.createElement("div"),
    MODE = 0,
    SEARCH = 1;

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
    var selection, state,
      sheet = options.sheet,
      frmroute = "/" + options.name + "/" + options.config[sheet].form.name,
      name = options.feather.toCamelCase(),
      feather = f.catalog.getFeather(options.feather),
      vm = {};
    frmroute = frmroute.toSpinalCase();

    // Statechart
    state = statechart.State.define({concurrent: true}, function () {
      this.state("Mode", function () {
        this.state("View", function () {
          this.event("toggleMode", function () {
            this.goto("../Edit");
          });
          this.displayEditButton = function () {
            return "none";
          };
          this.displayListButton = function () {
            return "inline-block";
          };
          this.modelDelete = function () {
            selection.delete(true).then(function () {
              vm.models().remove(selection);
            });
          };
          this.modelNew = function () {
            m.route(frmroute);
          };
          this.selectedColor = function () {
            return "LightSkyBlue";
          };
          this.toggleSelection = function (model, col) {
            if (selection === model) {
              vm.select(undefined);
              return false;
            }

            vm.select(model);
            vm.nextFocus("input" + col.toCamelCase(true));
            return true;
          };
        });
        this.state("Edit", function () {
          this.event("toggleMode", function () {
            this.goto("../View");
          });
          this.displayEditButton = function () {
            return "inline-block";
          };
          this.displayListButton = function () {
            return "none";
          };
          this.modelDelete = function () {
            var prevState = selection.state.current()[0];
            selection.delete();
            if (prevState === "/Ready/New") {
              vm.models().remove(selection);
            }
          };
          this.modelNew = function () {
            var  model = f.models[name](),
              input = "input" + vm.defaultFocus(model).toCamelCase(true);
            vm.models().add(model);
            vm.nextFocus(input);
            vm.select(model);
          };
          this.selectedColor = function () {
            return "Azure";
          };
          this.toggleSelection = function (model, col) {
            vm.select(model);
            vm.nextFocus("input" + col.toCamelCase(true));
            return true;
          };
        });
      });
      this.state("Search", function () {
        this.state("Off", function () {
          this.enter(function () {
            vm.searchValue("Search");
          });
          this.event("searchStart", function () {
            this.goto("../On");
          });
          this.style = function () {
            return {
              color: "LightGrey",
              margin: "2px"
            };
          };
          this.value = function () {
            return "";
          };
        });
        this.state("On", function () {
          this.enter(function () {
            vm.searchValue("");
          });
          this.exit(function () {
            vm.refresh();
          });
          this.canExit = function () {
            return !vm.searchValue();
          };
          this.event("searchEnd", function () {
            this.goto("../Off");
          });
          this.style = function () {
            return {
              color: "Black",
              margin: "2px"
            };
          };
          this.value = function () {
            return vm.searchValue();
          };
        });
      });
    });

    vm.activeSheet = m.prop(options.sheet);
    vm.attrs = options.config[sheet].list.attrs || ["id"];
    vm.canSave = function () {
      return vm.models().some(function (model) {
        return model.canSave();
      });
    };
    vm.config = function () {
      return options.config || {};
    }; 
    vm.defaultFocus = function (model) {
      var col = vm.attrs.find(function (attr) {
        return !model.data[attr] || !model.data[attr].isReadOnly();
      });
      return col ? col.toCamelCase(true) : undefined;
    };
    vm.displayDeleteButton = function () {
      return (vm.model() && vm.model().canSave()) ?
        "none" : "inline-block";
    };
    vm.displayEditButton = function () {
      return vm.mode().displayEditButton();
    };
    vm.displayListButton = function () {
      return vm.mode().displayListButton();
    };
    vm.displayUndoButton = function () {
      return (vm.model() && vm.model().canSave()) ?
        "inline-block" : "none";
    };
    vm.goHome = function () {
      m.route("/home");
    };
    vm.goNextRow = function () {
      var list = vm.models(),
        model = vm.model(),
        idx = list.indexOf(model) + 1;
      if (list.length > idx) {
        vm.select(list[idx]);
      }
    };
    vm.goPrevRow = function () {
      var list = vm.models(),
        model = vm.model(),
        idx = list.indexOf(model) - 1;
      if (idx >= 0) {
        vm.select(list[idx]);
      }
    };
    vm.hasNoSelection = function () {
      return !selection;
    };
    vm.isSelected = function (model) {
      return selection === model;
    };
    vm.mode = function () {
      return state.resolve(state.current()[MODE]);
    };
    vm.model = function () {
      return selection;
    };
    vm.modelDelete = function () {
      return vm.mode().modelDelete();
    };
    vm.modelNew = function () {
      return vm.mode().modelNew();
    };
    vm.modelOpen = function () {
      m.route(frmroute + "/" + selection.data.id());
    };
    vm.models = f.models[name].list();
    vm.nextFocus = m.prop();
    vm.onkeydownCell = function (e) {
      var id, step,
        key = e.key || e.keyIdentifier,
        nav = function (name) {
          id = e.srcElement.id;
          // Counter potential data changes made by this keystroke
          if (typeof e.srcElement[step] === "function") {
            try {
              e.srcElement[step]();
            } catch (ignore) {}
          }
          // Navigate in desired direction
          m.startComputation();
          vm[name]();
          m.endComputation();
          // Set focus on the same cell we left
          m.startComputation();
          document.getElementById(id).focus();
          m.endComputation();
        };

      switch (key)
      {
      case "Up":
        step = "stepDown";
        nav("goPrevRow");
        break;
      case "Down":
        step = "stepUp";
        nav("goNextRow");
        break;
      }
    };
    vm.onkeydownSearch = function (e) {
      var key = e.key || e.keyIdentifier;
      if (key === "Enter") { vm.refresh(); }
    };
    vm.onscroll = function () {
      var rows = document.getElementById("rows"),
        header = document.getElementById("header");

      // Sync header position with table body position
      header.scrollLeft = rows.scrollLeft;
    };
    vm.refresh = function () {
      var attrs, formatOf,
        value = state.resolve(state.current()[SEARCH]).value(),
        filter = {};

      // Recursively resolve type
      formatOf = function (feather, property) {
        var prefix, suffix, rel, prop,
          idx = property.indexOf(".");

        if (idx > -1) {
          prefix = property.slice(0, idx);
          suffix = property.slice(idx + 1, property.length);
          rel = feather.properties[prefix].type.relation;
          return formatOf(f.catalog.getFeather(rel), suffix);
        }

        prop = feather.properties[property];
        return prop.format || prop.type;
      };

      // Only search on text attributes
      if (value) {
        attrs = vm.attrs.filter(function (attr) {
          return formatOf(feather, attr) === "string";
        });

        if (attrs.length) {
          filter.criteria = [{
            property: attrs,
            operator: "~*",
            value: value
          }];
        }
      }

      vm.models().fetch(filter, false);
    };
    vm.relations = m.prop({});
    vm.saveAll = function () {
      vm.models().forEach(function (model) {
        model.save().then(function() {
          if (model.state.current()[0] === "/Deleted") {
            vm.models().remove(model);
          }
        });
      });
    };
    vm.scrollbarWidth = function () {
      return scrWidth;
    };
    vm.searchClear = function () {
      vm.searchValue("");
      state.send("searchEnd");
    };
    vm.searchDisabled = function () {
      return state.current()[SEARCH] === "/Search/Off";
    };
    vm.searchEnd = function () {
      state.send("searchEnd");
    };
    vm.searchOff = function () {
      return state.current()[SEARCH] === "/Search/Off";
    };
    vm.searchStart = function () {
      state.send("searchStart");
    };
    vm.searchStyle = function () {
      return state.resolve(state.current()[SEARCH]).style();
    };
    vm.searchValue = m.prop();
    vm.select = function (model) {
      if (selection !== model) {
        vm.relations({});
        selection = model;
      }
      return selection;
    };
    vm.selectedColor = function () {
      return vm.mode().selectedColor();
    };
    vm.sheets = function () {
      return Object.keys(options.config || {});
    };
    vm.startSearch = function () {
      state.send("startSearch");
    };
    vm.tabClicked = function (sheet) {
      var route = "/" + options.name + "/" + sheet;
      route = route.toSpinalCase();
      m.route(route);
    };
    vm.toggleMode = function () {
      state.send("toggleMode");
    };
    vm.toggleOpen = function (model) {
      selection = model;
      vm.modelOpen();
    };
    vm.toggleSelection = function (model, col) {
      return vm.mode().toggleSelection(model, col);
    };
    vm.undo = function () {
      if (selection) { selection.undo(); }
    };

    state.goto();

    return vm;
  };

  // Define workbook component
  f.components.workbookDisplay = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = f.viewModels.workbookViewModel(options);
    };

    component.view = function (ctrl) {
      var tbodyConfig, header, rows, tabs, view, rel,
        vm = ctrl.vm,
        activeSheet = vm.activeSheet();

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
        e.addEventListener('keydown', vm.onkeydownCell);
      };

      // Build header
      header = (function () {
        var ths = vm.attrs.map(function (key) {
            return m("th", {
              style: {
                minWidth: "150px",
                maxWidth: "150px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }
            }, key.replace(/\./g,' _').toCamelCase().toProperCase(true));
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
          currentMode = vm.mode().current()[0],
          color = "White",
          isSelected = vm.isSelected(model),
          currentState = model.state.current()[0],
          d = model.data,
          cellOpts = {},
          rowOpts = {};

        // Build row
        if (isSelected) {
          color = vm.selectedColor();
        }

        // Build view row
        if (currentMode === "/Mode/View" || !isSelected) {
          // Build cells
          tds = vm.attrs.map(function (col) {
            var cell, content,
              prop = f.resolveProperty(model, col),
              value = prop(),
              format = prop.format || prop.type,
              tdOpts = {
                onclick: vm.toggleSelection.bind(this, model, col),
                style: {
                  minWidth: "150px",
                  maxWidth: "150px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }
              };

            // Build cell
            switch (format)
            {
            case "number":
            case "integer":
              content = value.toLocaleString();
              break;
            case "boolean":
              if (value) {
                content = m("i", {
                  onclick: onclick,
                  class: "fa fa-check"
                });
              }
              break;
            case "date":
              if (value) {
                // Turn into date adjusting time for current timezone
                value = new Date(value + f.now().slice(10));
                content = value.toLocaleDateString();
              }
              break;
            case "dateTime":
              value = value ? new Date(value) : "";
              content = value ? value.toLocaleString() : "";
              break;
            case "string":
              content = value;
              break;
            default:
              if (typeof format === "object" && d[col]()) {
                // If relation, use relation widget to find display property
                rel = f.components[format.relation.toCamelCase() + "Relation"];
                if (rel) { value = d[col]().data[rel.valueProperty()](); }
              }
              content = value;
            }

            cell = m("td", tdOpts, content);

            return cell;
          });

          rowOpts = {
            ondblclick: vm.toggleOpen.bind(this, model)
          };

        // Build editable row
        } else {
          cellOpts = {
            style: {
              borderColor: "blue",
              borderWidth: "thin",
              borderStyle: "solid"
            }
          };

          // Build cells
          tds = vm.attrs.map(function (col) {
            var cell, tdOpts, inputOpts,
              prop = f.resolveProperty(model, col),
              id = "input" + col.toCamelCase(true);

            inputOpts = {
              id: id,
              onclick: vm.toggleSelection.bind(this, model, col),
              value: prop(),
              config: function (e) {
                if (vm.nextFocus() === id) {
                  e.focus();
                  vm.nextFocus(undefined);
                }
              },
              style: {
                minWidth: "150px",
                maxWidth: "150px",
                boxShadow: "none",
                border: "none",
                padding: "0px",
                backgroundColor: color
              },
              isCell: true
            };

            if (prop.isRequired && prop.isRequired() && 
              (prop() === null || prop() === undefined)) {
              tdOpts = {
                style: {
                  borderColor: "red",
                  borderWidth: "thin",
                  borderStyle: "ridge"
                }
              };
            } else {
              tdOpts = cellOpts;
            }

            cell = m("td", tdOpts, [
              f.buildInputComponent({
                model: model,
                key: col,
                viewModel: vm,
                options: inputOpts
              })
            ]);

            return cell;
          });
        }

        // Front cap header navigation
        onclick = vm.toggleSelection.bind(this, model, vm.defaultFocus(model));
        if (currentState === "/Delete") {
          thContent = m("i", {
            onclick: onclick,
            class:"fa fa-remove"
          });
        } else if (currentState === "/Ready/New") {
          thContent = m("i", {
            onclick: onclick,
            class:"fa fa-asterisk"
          });
        } else if (model.canSave()) {
          thContent = m("i", {
            onclick: onclick,
            class:"fa fa-check"
          });
        } else {
          cellOpts = {
            onclick: onclick,
            style: {minWidth: "16px"}
          };
          if (currentMode === "/Mode/Edit" && isSelected) {
            cellOpts.style.borderColor = "blue";
            cellOpts.style.borderWidth = "thin";
            cellOpts.style.borderStyle = "solid";
          }
        }
        tds.unshift(m("th", cellOpts, thContent));

        // Build row
        rowOpts.style = { backgroundColor: color };
        row = m("tr", rowOpts, tds);

        return row;
      });

      // Build tabs
      tabs = vm.sheets().map(function (sheet) {
        var tab;

        // Build tab
        tab = m("button[type=button]", {
          class: activeSheet === sheet ?
            "pure-button pure-button-active" : "pure-button",
          style: {
            borderTopLeftRadius: "0px",
            borderTopRightRadius: "0px"
          },
          onclick: vm.tabClicked.bind(this, sheet)
        }, sheet);

        return tab;
      });

      // Finally assemble the whole view
      view = m("div", {
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
              display: vm.displayEditButton()
            },
            onclick: vm.toggleMode
          }, [m("i", {class:"fa fa-pencil"})], " Edit"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.displayListButton()
            },
            onclick: vm.toggleMode
          }, [m("i", {class:"fa fa-th-list"})], " List"),
            m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.displayEditButton()
            },
            onclick: vm.saveAll,
            disabled: !vm.canSave()
          }, [m("i", {class:"fa fa-cloud-upload"})], " Save"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.displayListButton()
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
              display: vm.displayDeleteButton()
            },
            onclick: vm.modelDelete,
            disabled: vm.hasNoSelection()
          }, [m("i", {class:"fa fa-remove"})], " Delete"),
          m("button", {
            type: "button",
            class: "pure-button",
            style: {
              margin: "1px",
              display: vm.displayUndoButton()
            },
            onclick: vm.undo
          }, [m("i", {class:"fa fa-undo"})], " Undo"),
          m("input", {
            id: "toolbarSearch",
            value: vm.searchValue(),
            style: vm.searchStyle(),
            onfocus: vm.searchStart,
            onblur: vm.searchEnd,
            oninput:  m.withAttr("value", vm.searchValue),
            onkeydown: vm.onkeydownSearch
          }),
          m("button", {
            type: "button",
            class: "pure-button",
            title: "Refresh",
            style: {
              margin: "1px"
            },
            onclick: vm.refresh
          }, [m("i", {class:"fa fa-refresh"})]),
          m("button", {
            type: "button",
            class: "pure-button",
            disabled: vm.searchDisabled(),
            title: "Clear search",
            style: {
              margin: "1px"
            },
            onclick: vm.searchClear
          }, [m("i", {class:"fa fa-eraser"})])
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


