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

/*global window, f, m, math, dialogPolyfill */
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

  // Define workbook view model
  f.viewModels.workbookViewModel = function (options) {
    var selection, state, listState, createButton, buttonHome, buttonList,
      buttonEdit, buttonSave, buttonOpen, buttonNew, buttonDelete,
      buttonUndo, buttonRefresh, buttonClear,
      searchInput, searchState, sortDialog, filterDialog,
      sheetConfigureDialog, filterOpts,
      frmroute = "/" + options.name + "/" + options.sheet.form.name,
      name = options.feather.toCamelCase(),
      feather = f.catalog.getFeather(options.feather),
      columns = options.sheet.list.columns || [{attr: "id"}],
      showMenu = false,
      vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.activeSheet = m.prop(options.sheet.name);
    vm.attrs = function () {
      return columns.map(function(column) {
        return column.attr;
      });
    };
    vm.buttonClear = function () { return buttonClear; };
    vm.buttonDelete = function () { return buttonDelete; };
    vm.buttonEdit = function () { return buttonEdit; };
    vm.buttonHome = function () { return buttonHome; };
    vm.buttonList = function () { return buttonList; };
    vm.buttonNew = function () { return buttonNew; };
    vm.buttonOpen = function () { return buttonOpen; };
    vm.buttonRefresh = function () { return buttonRefresh; };
    vm.buttonSave = function () { return buttonSave; };
    vm.buttonUndo = function () { return buttonUndo; };
    vm.config = m.prop(options.config || {}); 
    vm.defaultFocus = function (model) {
      var col = vm.attrs().find(function (attr) {
        return !model.data[attr] || !model.data[attr].isReadOnly();
      });
      return col ? col.toCamelCase(true) : undefined;
    };
    vm.configureSheet = function () {
      var dlg = vm.sheetConfigureDialog();
      dlg.sheet(vm.activeSheet());
      dlg.show();
    };
    vm.filter = f.prop(JSON.parse(JSON.stringify(options.sheet.list.filter || {})));
    vm.filterDialog = function () {
      return filterDialog;
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
    vm.isSelected = function (model) {
      return selection === model;
    };
    vm.mode = function () {
      return state.resolve(state.current()[0]);
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
      if (selection) {
        m.route(frmroute + "/" + selection.data.id());
      }
    };
    vm.models = f.models[name].list({filter: vm.filter()});
    vm.nextFocus = m.prop();
    vm.ondragover = function (ev) {
      ev.preventDefault();
    };
    vm.ondragstartColumnHeader = function (idx, ev) {
      ev.dataTransfer.setData("column", idx);
    };
    vm.ondropColumnHeader = function (toIdx, ev) {
      ev.preventDefault();
      var moved,
        fromIdx = ev.dataTransfer.getData("column"),
        config = vm.config(),
        cols = options.sheet.list.columns;

      if (fromIdx !== toIdx) {
        moved = cols.splice(fromIdx, 1)[0];
        cols.splice(toIdx, 0, moved);
      }
    };
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
    vm.onkeydownPage = function (e) {
      if (e.altKey) {
        switch (e.which)
        {
        case 72: // h (home)
          vm.goHome();
          break;
        case 77: // m (mode)
          m.startComputation();
          vm.toggleMode();
          m.endComputation();
          break;
        case 78: // n (new)
          m.startComputation();
          vm.modelNew();
          m.endComputation();
          break;
        case 79: // o (open)
          vm.modelOpen();
          break;
        case 82: // r (refresh)
          vm.refresh();
          break;
        case 83: // s (save)
          vm.saveAll();
          break;
        }
      }
    };
    vm.onmouseovermenu = function () {
      showMenu = true;
    };
    vm.onmouseoutmenu = function () {
      showMenu = false;
    };
    vm.onscroll = function () {
      var rows = document.getElementById("rows"),
        header = document.getElementById("header");

      // Sync header position with table body position
      header.scrollLeft = rows.scrollLeft;
    };
    vm.searchInput = function () { return searchInput; };
    vm.refresh = function () {
      var attrs, formatOf, criterion,
        value = searchInput.value(),
        filter = JSON.parse(JSON.stringify(vm.filter()));

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
        attrs = vm.attrs().filter(function (attr) {
          return formatOf(feather, attr) === "string";
        });

        if (attrs.length) {
          criterion = {
            property: attrs,
            operator: "~*",
            value: value
          };
          filter.criteria = filter.criteria || [];
          filter.criteria.push(criterion);
        }
      }

      vm.models().fetch(filter, false);
    };
    vm.relations = m.prop({});
    vm.saveAll = function () {
      vm.models().save();
    };
    vm.scrollbarWidth = function () {
      return scrWidth;
    };
    vm.select = function (model) {
      if (selection !== model) {
        vm.relations({});
        selection = model;
      }

      if (selection) {
        state.send("selected");
      } else {
        state.send("unselected");
      }

      return selection;
    };
    vm.selectedColor = function () {
      return vm.mode().selectedColor();
    };
    vm.sheetNew = function () {
      sheetConfigureDialog.show();
    };
    vm.sheets = function () {
      return options.config.map(function (sheet) {
        return sheet.name;
      });
    };
    vm.sheetConfigureDialog = function () {
      return sheetConfigureDialog;
    };
    vm.showMenu = function () {
      return showMenu;
    };
    vm.sortDialog = function () {
      return sortDialog;
    };
    vm.tabClicked = function (sheet) {
      var route = "/" + options.name + "/" + sheet;
      route = route.toSpinalCase();
      m.route(route);
    };
    vm.toggleEdit = function () {
      state.send("edit");
    };
    vm.toggleView = function () {
      state.send("view");
    };
    vm.toggleOpen = function (model) {
      selection = model;
      vm.modelOpen();
    };
    vm.toggleSelection = function (model, col) {
      return vm.mode().toggleSelection(model, col);
    };
    vm.workbook= function () {
      return options.name;
    };
    vm.undo = function () {
      if (selection) { selection.undo(); }
    };
    vm.zoom = m.prop(options.sheet.zoom || 100);

    // ..........................................................
    // PRIVATE
    //

    frmroute = frmroute.toSpinalCase();

    filterOpts = {
      attrs: vm.attrs(),
      filter: vm.filter,
      list: vm.models(),
      feather: feather
    };
    sortDialog = f.viewModels.sortDialogViewModel(filterOpts);
    filterDialog = f.viewModels.filterDialogViewModel(filterOpts);
    sheetConfigureDialog = f.viewModels.sheetConfigureDialogViewModel({
      workbook: vm.workbook(),
      config: vm.config
    });

    // Create button view models
    createButton = f.viewModels.buttonViewModel;
    buttonHome = createButton({
      onclick: vm.goHome,
      title: "Home (Alt+H)",
      icon: "home"
    });

    buttonList = createButton({
      onclick: vm.toggleView,
      title: "List mode (Alt+M)",
      icon: "list"
    });

    buttonEdit = createButton({
      onclick: vm.toggleEdit,
      title: "Edit mode (Alt+M)",
      icon: "pencil"
    });

    buttonSave = createButton({
      onclick: vm.saveAll,
      title: "Save (Alt+S)",
      label: "Save",
      icon: "cloud-upload"
    });

    buttonOpen = createButton({
      onclick: vm.modelOpen,
      title: "Open (Alt+O)",
      label: "Open",
      icon: "folder-open"
    });

    buttonNew = createButton({
      onclick: vm.modelNew,
      title: "New (Alt+N)",
      label: "New",
      icon: "plus-circle"
    });

    buttonDelete = createButton({
      onclick: vm.modelDelete,
      title: "Delete",
      label: "Delete",
      icon: "remove"
    });

    buttonUndo = createButton({
      onclick: vm.undo,
      title: "Undo",
      label: "Undo",
      icon: "undo"
    });

    searchInput = f.viewModels.searchInputViewModel({
      refresh: vm.refresh
    });

    buttonRefresh = createButton({
      onclick: vm.refresh,
      title: "Refresh (Alt+R)",
      icon: "refresh"
    });

    buttonClear = createButton({
      onclick: vm.searchInput().clear,
      title: "Clear search",
      icon: "eraser"
    });

    // Bind button states to list statechart events
    listState = vm.models().state();
    listState.resolve("/Fetched").enter(function () {
      if (selection && vm.model().canUndo()) {
        buttonDelete.hide();
        buttonUndo.show();
        return;
      }

      buttonDelete.show();
      buttonUndo.hide();
    });
    listState.resolve("/Fetched/Clean").enter(function () {
      buttonSave.disable();
    });
    listState.state().resolve("/Fetched/Dirty").enter(function () {
      buttonSave.enable();
    });

    // Bind button states to search statechart events
    searchState = vm.searchInput().state();
    searchState.resolve("/Search/On").enter(function () {
      buttonClear.enable();
    });
    searchState.resolve("/Search/Off").enter(function () {
      buttonClear.disable();
    });

    // Bind refresh to filter change event
    vm.filter.state().resolve("/Ready").enter(function () {
      vm.refresh();
    });

    // Create workbook statechart
    state = f.statechart.State.define({concurrent: true}, function () {
      this.state("Mode", function () {
        this.state("View", function () {
          this.enter(function () {
            buttonEdit.deactivate();
            buttonList.activate();
            buttonSave.hide();
            buttonOpen.show();
          });
          this.event("edit", function () {
            this.goto("../Edit");
          });
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
          this.enter(function () {
            buttonEdit.activate();
            buttonList.deactivate();
            buttonSave.show();
            buttonOpen.hide();
          });
          this.event("view", function () {
            this.goto("../View");
          });
          this.modelDelete = function () {
            var prevState = selection.state().current()[0];
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
      this.state("Selection", function () {
        this.event("selected", function () {
          this.goto("./On", {force: true});
        });
        this.state("Off", function () {
          this.enter(function () {
            buttonOpen.disable();
            buttonDelete.disable();
            buttonDelete.show();
            buttonUndo.hide();
          });
        });
        this.state("On", function () {
          this.enter(function () {
            buttonOpen.enable();
            buttonDelete.enable();
          });
          this.event("unselected", function () {
            this.goto("../Off");
          });
          this.C(function() {
            if (selection.canUndo()) { 
              return "./Dirty";
            }
            return "./Clean";
          });
          this.state("Clean", function () {
            this.enter(function () {
              buttonDelete.show();
              buttonUndo.hide();
            });
          });
          this.state("Dirty", function () {
            this.enter(function () {
              buttonDelete.hide();
              buttonUndo.show();
            });
          });
        });
      });
    });

    // Initialize statechart
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
      var tbodyConfig, findFilterIndex,
        header, rows, tabs, view, rel, tabStyle,
        vm = ctrl.vm,
        filter = vm.filter(),
        sort = filter.sort || [],
        button = f.components.button,
        filterDialog = f.components.filterDialog,
        sheetConfigureDialog = f.components.sheetConfigureDialog,
        activeSheet = vm.activeSheet(),
        idx = 0,
        zoom = vm.zoom() + "%";

      findFilterIndex = function (col, name) {
        name = name || "criteria";
        var hasCol,
          ary = filter[name] || [],
          i = 0;

        hasCol = function (item) {
          if (item.property === col) { return true; }
          i +=1;
        };

        if (ary.some(hasCol)) { return i; }
        return false;
      };

      // Define scrolling behavior for table body
      tbodyConfig = function (e) {
        var MARGIN = 6,
          winHeight = window.innerHeight,
          toolbarHeight = document.getElementById("toolbar").clientHeight,
          headerHeight = document.getElementById("header").clientHeight,
          tabsHeight = document.getElementById("tabs").clientHeight,
          bodyHeight = math.subtract(math.subtract(math.subtract(math.subtract(winHeight, toolbarHeight), headerHeight),tabsHeight), MARGIN);

        e.style.height = bodyHeight + "px";

        // Set fields table to scroll and toolbar to stay put
        document.documentElement.style.overflow = 'hidden';

        // Key down handler for up down movement
        e.addEventListener("keydown", vm.onkeydownCell);
      };

      // Build header
      header = (function () {
        var ths = vm.attrs().map(function (key) {
            var hview, order, name,
              icon = [],
              fidx = findFilterIndex(key, "sort"),
              operators = vm.filterDialog().operators();

            // Add sort icons
            if (fidx !== false) {
              order = sort[fidx].order || "ASC";
              if (order.toUpperCase() === "ASC") {
                name = "fa fa-sort-asc";
              } else {
                name= "fa fa-sort-desc";
              }

              icon.push(m("i", {
                class: name, 
                style: {
                  float: "right",
                  color: "grey",
                  fontSize: zoom
                }
              }));

              if (sort.length > 1) {
                icon.push(m("span", {
                   style: {
                    float: "right",
                    color: "grey",
                    fontSize: vm.zoom() * 0.6 + "%",
                    marginRight: "3px"
                  }
                }, fidx + 1));
              }
            }

            // Add filter icons
            fidx = findFilterIndex(key);
            if (fidx !== false) {
              icon.push(m("i", {
                class: "fa fa-filter", 
                title: operators[(filter.criteria[fidx].operator || "=")] +
                  " " + filter.criteria[fidx].value,
                style: {
                  float: "right",
                  color: "DarkBlue",
                  marginRight: "3px",
                  fontSize: vm.zoom() * 0.80 + "%"
                }
              }));
            }

            hview = m("th", {
              ondragover: vm.ondragover,
              draggable: true,
              ondragstart: vm.ondragstartColumnHeader.bind(this, idx),
              ondrop: vm.ondropColumnHeader.bind(this, idx),
              style: {
                minWidth: "150px",
                maxWidth: "150px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: zoom
              }
            }, icon, key.toName());

            idx += 1;

            return hview;
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
          currentState = model.state().current()[0],
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
          tds = vm.attrs().map(function (col) {
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
                  textOverflow: "ellipsis",
                  fontSize: zoom
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
          tds = vm.attrs().map(function (col) {
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
                backgroundColor: color,
                fontSize: zoom
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
        } else if (model.canUndo()) {
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
            cellOpts.style.borderLeftStyle = "none";
          }
        }
        tds.unshift(m("th", cellOpts, thContent));

        // Build row
        rowOpts.style = { backgroundColor: color };
        row = m("tr", rowOpts, tds);

        return row;
      });

      // Build tabs
      tabStyle = {
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderRightStyle: "solid",
        borderRightColor: "Silver",
        borderRightWidth: "thin",
        borderBottomStyle: "solid",
        borderBottomColor: "Silver",
        borderBottomWidth: "thin"
      };
      tabs = vm.sheets().map(function (sheet) {
        var tab;

        // Build tab
        tab = m("button[type=button]", {
          class: activeSheet === sheet ?
            "pure-button pure-button-primary" : "pure-button",
          style: tabStyle,
          onclick: vm.tabClicked.bind(this, sheet)
        }, sheet);

        return tab;
      });

      // New tab button
      tabs.push(m("button[type=button]", {
        class: "pure-button",
        style: tabStyle,
        onclick: vm.sheetNew
      }, [m("i", {class:"fa fa-plus"})]));

      // Finally assemble the whole view
      view = m("div", {
        class: "pure-form",
        config: function () {
          // Make Chrome style dialog available for all browsers
          var dialog = document.querySelector('dialog');
          if (!dialog.showModal) { dialogPolyfill.registerDialog(dialog); }

          document.addEventListener("keydown", vm.onkeydownPage, false);
        }
      }, [
        m("div", {
            id: "toolbar",
            style: {backgroundColor: "snow"}
          }, [
          m.component(filterDialog({viewModel: vm.sortDialog()})),
          m.component(filterDialog({viewModel: vm.filterDialog()})),
          m.component(sheetConfigureDialog({viewModel: vm.sheetConfigureDialog()})),
          m.component(button({viewModel: vm.buttonHome()})),
          m.component(button({viewModel: vm.buttonList()})),
          m.component(button({viewModel: vm.buttonEdit()})),
          m.component(button({viewModel: vm.buttonSave()})),
          m.component(button({viewModel: vm.buttonOpen()})),
          m.component(button({viewModel: vm.buttonNew()})),
          m.component(button({viewModel: vm.buttonDelete()})),
          m.component(button({viewModel: vm.buttonUndo()})),
          m.component(f.components.searchInput({viewModel: vm.searchInput()})),
          m.component(button({viewModel: vm.buttonRefresh()})),
          m.component(button({viewModel: vm.buttonClear()})),
          m("div", {
            class: "pure-menu custom-restricted-width",
            onmouseover: vm.onmouseovermenu,
            onmouseout: vm.onmouseoutmenu,
            style: {
              position: "absolute",
              display: "inline-block",
              top: "2px"
            }
          }, [
            m("span", {
              class:"pure-button fa fa-bars",
              style: {
                backgroundColor: "snow",
                margin: "2px",
                minHeight: "34px"
              }
            }),
            m("ul", {
              class: "pure-menu-list",
              style: {
                display: vm.showMenu() ? "block" : "none",
                backgroundColor: "white",
                position: "absolute",
                zIndex: 9999,
                border: "1px solid lightgrey"
              }
            }, [
              m("li", {
                class: "pure-menu-link",
                title: "Change sheet sort",
                onclick: vm.sortDialog().show
              }, [m("i", {class:"fa fa-sort-alpha-asc", style: {
                marginRight: "4px"
              }})], "Sort"),
              m("li", {
                class: "pure-menu-link",
                title: "Change sheet filter",
                onclick: vm.filterDialog().show
              }, [m("i", {class:"fa fa-filter", style: {
                marginRight: "4px"
              }})], "Filter"),
              m("li", {
                class: "pure-menu-link",
                title: "Edit subtotals"
                //onclick: vm.filterDialog().show
              }, [m("div", {style: {
                display: "inline",
                fontWeight: "bold",
                fontStyle: "Italic"
              }}, "∑")], " Totals"),
              m("li", {
                class: "pure-menu-link",
                style: {
                  borderTop: "solid thin lightgrey"
                },
                title: "Configure current worksheet",
                onclick: vm.configureSheet
              }, [m("i", {class:"fa fa-gear", style: {
                marginRight: "4px"
              }})], "Configure"),
              m("li", {
                class: "pure-menu-link",
                title: "Share workbook configuration"
                //onclick: rvm.onclickopen
              }, [m("i", {class:"fa fa-share-alt", style: {
                marginRight: "4px"
              }})], "Share"),
              m("li", {
                class: "pure-menu-link",
                title: "Revert workbook configuration to original state"
                //onclick: rvm.onclickopen
              }, [m("i", {class:"fa fa-reply", style: {
                marginRight: "4px"
              }})], "Revert")
            ])
          ])     
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
          }, [header]),
          m("tbody", {
            id: "rows",
            onscroll: vm.onscroll,
            style: {
              display: "inline-block",
              width: "100%",
              overflow: "auto"
            },
            config: tbodyConfig
          }, rows)
        ]),
        m("div", {
            id: "tabs"
          }, [
          tabs,
          m("i", {class: "fa fa-search-plus", style: {
            color: "LightGrey",
            marginLeft: "5px",
            marginTop: "9px",
            marginRight: "8px",
            float: "right"
          }}),
          m("input", {
            style: {
               float: "right",
               marginTop: "6px"
            },
            title: "Zoom " + vm.zoom() + "%",
            type: "range",
            step: "5",
            min: "50",
            max: "150",
            value: vm.zoom(),
            oninput: m.withAttr("value", vm.zoom)
          }),
          m("i", {class: "fa fa-search-minus", style: {
            color: "LightGrey",
            marginRight: "5px",
            marginTop: "9px",
            float: "right"
          }})
        ])
      ]);

      return view;
    };

    return component;
  };

}(f));


