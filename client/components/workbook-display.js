/*global window*/
(function () {
  "use strict";

  var scrWidth, inner, widthNoScroll, widthWithScroll,
    workbookDisplay = {},
    m = require("mithril"),
    f = require("component-core"),
    math = require("mathjs"),
    button = require("button"),
    statechart = require("statechartjs"),
    catalog = require("catalog"),
    dialog = require("dialog"),
    filterDialog = require("filter-dialog"),
    searchInput = require("search-input"),
    sortDialog = require("sort-dialog"),
    sheetConfigureDialog = require("sheet-configure-dialog"),
    outer = document.createElement("div"),
    COL_WIDTH_DEFAULT = "150px";

  // Calculate scroll bar width
  // http://stackoverflow.com/questions/13382516/getting-scroll-bar-width-using-javascript
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
  workbookDisplay.viewModel = function (options) {
    var selection, state, listState, createButton, buttonHome, buttonList,
      buttonEdit, buttonSave, buttonOpen, buttonNew, buttonDelete,
      buttonUndo, buttonRefresh, buttonClear, fromWidthIdx, dataTransfer,
      searchState, frmroute, attrs, resolveProperties, inputSearch,
      dialogConfirm, dialogFilter, dialogSort, dialogSheetConfigure,
      name = options.feather.toCamelCase(),
      feather = catalog.getFeather(options.feather),
      showMenu = false,
      isDraggingTab = false,
      vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.attrs = function () {
      var columns = vm.sheet().list.columns,
        result = columns.map(function(column) {
          return column.attr;
        });
      return result || [{attr: "id"}];
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
    vm.config = m.prop(options.config); 
    vm.confirmDialog = function () { return dialogConfirm; };
    vm.defaultFocus = function (model) {
      var col = vm.attrs().find(function (attr) {
        return !model.data[attr] || !model.data[attr].isReadOnly();
      });
      return col ? col.toCamelCase(true) : undefined;
    };
    vm.configureSheet = function () {
      var dlg = vm.sheetConfigureDialog();
      dlg.show();
    };
    vm.deleteSheet = function () {
      var doDelete;

      doDelete = function () {
        var config = vm.config(),
          idx = dataTransfer.tab,
          activeSheetId = vm.sheet().id,
          deleteSheetId = config[idx].id;
        config.splice(idx, 1);
        if (activeSheetId === deleteSheetId) {
          if (idx === config.length) { idx -= 1; }
          vm.tabClicked(config[idx].name);
        }
      };

      dialogConfirm.message("Are you sure you want to delete this sheet?");
      dialogConfirm.onOk(doDelete);
      dialogConfirm.show();
    };
    vm.didLeave = m.prop(false);
    vm.filter = f.prop();
    vm.filterDialog = function () {
      return dialogFilter;
    };
    vm.goHome = function () {
      vm.didLeave(true);
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
    vm.isDraggingTab = function () {
      return isDraggingTab;
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
        vm.didLeave(true);
        m.route(frmroute + "/" + selection.data.id());
      }
    };
    vm.newSheet = function () {
      var config = vm.config(),
        newSheet = {
          form: {
            attrs: []
          },
          list: {
            columns: []
          }
        };

      config.push(newSheet);
    };
    vm.nextFocus = m.prop();
    vm.ondragend = function () {
      isDraggingTab = false;
    };
    vm.ondragover = function (toIdx, ev) {
      if (!isNaN(toIdx)) {
        if (fromWidthIdx > toIdx) { return; }
      } else { ev = toIdx; }
      ev.preventDefault();
    };
    vm.ondragstart = function (idx, type, ev) {
      dataTransfer = {}; // Because ms edge only allows one value
      dataTransfer.typeStart = type;

      switch (type)
      {
      case "width":
        fromWidthIdx = idx;
        dataTransfer.widthStart = ev.clientX;
        return;
      case "tab":
        isDraggingTab = true;
        break;
      }

      dataTransfer[type] = idx;
    };
    vm.ondrop = function (toIdx, type, ary, ev) {
      var moved, column, fromIdx, oldWidth, newWidth, widthStart,
        typeStart = dataTransfer.typeStart;

      ev.preventDefault();

      switch (typeStart)
      {
      case "width":
        if (fromWidthIdx <= toIdx) {
          widthStart = dataTransfer.widthStart - 0;
          column = vm.sheet().list.columns[fromWidthIdx];
          oldWidth = column.width || COL_WIDTH_DEFAULT;
          oldWidth = oldWidth.replace("px", "") - 0;
          newWidth = oldWidth - (widthStart - ev.clientX);
          column.width = newWidth + "px";
        }
        break;
      default:
        fromIdx = dataTransfer[type] - 0;
        if (fromIdx !== toIdx) {
          moved = ary.splice(fromIdx, 1)[0];
          ary.splice(toIdx, 0, moved);
        }
        isDraggingTab = false;
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
    vm.onmouseovermenu = function () {
      showMenu = true;
    };
    vm.onmouseoutmenu = function (ev) {
      if (!ev || !ev.toElement || !ev.toElement.id ||
          ev.toElement.id.indexOf("nav-") === -1) {
        showMenu = false;
      }
    };
    vm.onscroll = function () {
      var rows = document.getElementById("rows"),
        header = document.getElementById("header");

      // Sync header position with table body position
      header.scrollLeft = rows.scrollLeft;
    };
    vm.refresh = function () {
      var fattrs, formatOf, criterion,
        value = inputSearch.value(),
        filter = f.copy(vm.filter());

      // Recursively resolve type
      formatOf = function (feather, property) {
        var prefix, suffix, rel, prop,
          idx = property.indexOf(".");

        if (idx > -1) {
          prefix = property.slice(0, idx);
          suffix = property.slice(idx + 1, property.length);
          rel = feather.properties[prefix].type.relation;
          return formatOf(catalog.getFeather(rel), suffix);
        }

        prop = feather.properties[property];
        return prop.format || prop.type;
      };

      // Only search on text attributes
      if (value) {
        fattrs = vm.attrs().filter(function (attr) {
          return formatOf(feather, attr) === "string";
        });

        if (fattrs.length) {
          criterion = {
            property: fattrs,
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
    vm.revert = function () {
      var route,
         workbook = vm.workbook().toJSON(),
        localConfig = vm.config(),
        defaultConfig = workbook.defaultConfig,
        sheet = defaultConfig[0];
      
      localConfig.length = 0;
      defaultConfig.forEach(function (item) {
        localConfig.push(item);
      });
      workbook.localConfig = localConfig;
      f.buildRoutes(workbook);
      route = "/" + workbook.name + "/" + sheet.name;
      route = route.toSpinalCase();
      m.route(route);
    };
    vm.saveAll = function () {
      vm.models().save();
    };
    vm.scrollbarWidth = function () {
      return scrWidth;
    };
    vm.searchInput = function () { return inputSearch; };
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
    vm.share = function () {
      var doShare;

      doShare = function () {
        var workbook = vm.workbook(),
        config = f.copy(vm.config());
        workbook.data.localConfig(config);
        workbook.save();
      };

      dialogConfirm.message("Are you sure you want to share your workbook " +
        "configuration with all other users?");
      dialogConfirm.onOk(doShare);
      dialogConfirm.show();
    };
    vm.sheet = function (value) {
      var idx = 0,
        config = vm.config();
      config.some(function (item) {
        if (options.id === item.id) { return true; }
        idx += 1;
      });
      if (arguments.length) { config.splice(idx, 1, value); }
      return config[idx];
    };
    vm.sheets = function () {
      var config = vm.config();
      return config.map(function (sheet) {
        return sheet.name;
      });
    };
    vm.sheetConfigureDialog = function () {
      return dialogSheetConfigure;
    };
    vm.showMenu = function () {
      return showMenu;
    };
    vm.sortDialog = function () {
      return dialogSort;
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
      vm.select(model);
      vm.modelOpen();
    };
    vm.toggleSelection = function (model, col) {
      return vm.mode().toggleSelection(model, col);
    };
    vm.workbook= function () {
      return catalog.store().workbooks()[options.name.toCamelCase()];
    };
    vm.undo = function () {
      if (selection) { selection.undo(); }
    };
    vm.zoom = function (value) {
      var sheet = vm.sheet();
      if (arguments.length) { sheet.zoom = value; }
      return sheet.zoom;
    };

    // ..........................................................
    // PRIVATE
    //

    frmroute = "/" + options.name + "/" + vm.sheet().form.name;
    frmroute = frmroute.toSpinalCase();
    vm.filter(f.copy(vm.sheet().list.filter || {}));
    vm.models = catalog.store().models()[name].list({
      filter: vm.filter()
    });

    resolveProperties = function (feather, properties, ary, prefix) {
      prefix = prefix || "";
      var result = ary || [];
      properties.forEach(function (key) {
        var rfeather,
          prop = feather.properties[key],
          isObject = typeof prop.type === "object",
          path = prefix + key;
        if (isObject && prop.type.properties) {
          rfeather = catalog.getFeather(prop.type.relation);
          resolveProperties(rfeather, prop.type.properties, result, path + ".");
        }
        if (!isObject || (!prop.type.childOf && !prop.type.parentOf)) {
          result.push(path);
        }
      });
      return result;
    };
    attrs = resolveProperties(feather, Object.keys(feather.properties)).sort();

    dialogFilter = filterDialog.viewModel({
      attrs: attrs,
      filter: vm.filter,
      list: vm.models(),
      feather: feather,
      title: "filter",
      icon: "filter"
    });
    dialogSort = sortDialog.viewModel({
      attrs: attrs,
      filter: vm.filter,
      list: vm.models(),
      feather: feather,
      title: "sort",
      icon: "sort"
    });
    dialogSheetConfigure = sheetConfigureDialog.viewModel({
      parentViewModel: vm,
      attrs: attrs
    });
    dialogConfirm = dialog.viewModel({
      icon: "question-circle",
      title: "Confirmation"
    });

    // Create button view models
    createButton = button.viewModel;
    buttonHome = createButton({
      onclick: vm.goHome,
      title: "Home",
      hotkey: "H",
      icon: "home"
    });

    buttonList = createButton({
      onclick: vm.toggleView,
      title: "List mode",
      hotkey: "L",
      icon: "list"
    });

    buttonEdit = createButton({
      onclick: vm.toggleEdit,
      title: "Edit mode",
      hotkey: "E",
      icon: "pencil"
    });

    buttonSave = createButton({
      onclick: vm.saveAll,
      label: "&Save",
      icon: "cloud-upload"
    });

    buttonOpen = createButton({
      onclick: vm.modelOpen,
      label: "&Open",
      icon: "folder-open"
    });

    buttonNew = createButton({
      onclick: vm.modelNew,
      label: "&New",
      icon: "plus-circle"
    });

    buttonDelete = createButton({
      onclick: vm.modelDelete,
      label: "&Delete",
      icon: "remove"
    });

    buttonUndo = createButton({
      onclick: vm.undo,
      label: "&Undo",
      icon: "undo"
    });

    inputSearch = searchInput.viewModel({
      refresh: vm.refresh
    });

    buttonRefresh = createButton({
      onclick: vm.refresh,
      title: "Refresh",
      hotkey: "R",
      icon: "refresh"
    });

    buttonClear = createButton({
      onclick: vm.searchInput().clear,
      title: "Clear search",
      hotkey: "C",
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
      vm.sheet().list.filter = vm.filter();
      vm.refresh();
    });

    // Create workbook statechart
    state = statechart.define({concurrent: true}, function () {
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
            vm.didLeave(true);
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
            var  model = catalog.store().models()[name](),
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
  workbookDisplay.component = function (options) {
    var viewModel,
      component = {};

    component.controller = function () {
      viewModel = viewModel || workbookDisplay.viewModel(options);
      this.vm = viewModel;
      if (viewModel.didLeave()) {
        viewModel.didLeave(false);
        viewModel.refresh(); 
      }
    };

    component.view = function (ctrl) {
      var tbodyConfig, findFilterIndex,
        header, rows, tabs, view, rel,
        vm = ctrl.vm,
        filter = vm.filter(),
        sort = filter.sort || [],
        activeSheet = vm.sheet(),
        config = vm.config(),
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
      idx = 0;
      header = (function () {
        var ths = activeSheet.list.columns.map(function (col) {
            var hview, order, name,
              key = col.attr,
              icon = [],
              fidx = findFilterIndex(key, "sort"),
              operators = vm.filterDialog().operators(),
              columnWidth = activeSheet.list.columns[idx].width || COL_WIDTH_DEFAULT;

            columnWidth = (columnWidth.replace("px", "") - 6) + "px"; 

            // Add sort icons
            if (fidx !== false) {
              order = sort[fidx].order || "ASC";
              if (order.toUpperCase() === "ASC") {
                name = "fa fa-sort-asc";
              } else {
                name= "fa fa-sort-desc";
              }

              icon.push(m("i", {
                class: name + " suite-column-sort-icon", 
                style: {fontSize: zoom}
              }));

              if (sort.length > 1) {
                icon.push(m("span", {
                  class: "suite-column-sort-number",
                  style: {fontSize: vm.zoom() * 0.6 + "%"}
                }, fidx + 1));
              }
            }

            // Add filter icons
            fidx = findFilterIndex(key);
            if (fidx !== false) {
              icon.push(m("i", {
                class: "fa fa-filter suite-column-filter-icon", 
                title: operators[(filter.criteria[fidx].operator || "=")] +
                  " " + filter.criteria[fidx].value,
                style: {fontSize: vm.zoom() * 0.80 + "%"}
              }));
            }

            hview = [
              m("th", {
                ondragover: vm.ondragover.bind(this, idx),
                draggable: true,
                ondragstart: vm.ondragstart.bind(this, idx, "column"),
                ondrop: vm.ondrop.bind(this, idx, "column", activeSheet.list.columns),
                class: "suite-column-header",
                style: {
                  minWidth: columnWidth,
                  maxWidth: columnWidth,
                  fontSize: zoom
                }
              }, icon, col.label || key.toName()),
              m("th", {
                ondragover: vm.ondragover.bind(this, idx),
                draggable: true,
                ondragstart: vm.ondragstart.bind(this, idx, "width"),
                class: "pure-table td pure-table th suite-column-header-grabber"
              })
            ];

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
          idx = 0;
          tds = vm.attrs().map(function (col) {
            var cell, content,
              prop = f.resolveProperty(model, col),
              value = prop(),
              format = prop.format || prop.type,
              columnWidth = activeSheet.list.columns[idx].width || COL_WIDTH_DEFAULT,
              tdOpts = {
                onclick: vm.toggleSelection.bind(this, model, col),
                class: "suite-cell-view",
                style: {
                  minWidth: columnWidth,
                  maxWidth: columnWidth,
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
                rel = catalog.store().components()[format.relation.toCamelCase() + "Relation"];
                if (rel) { value = d[col]().data[rel.valueProperty()](); }
              }
              content = value;
            }

            cell = m("td", tdOpts, content);
            idx += 1;

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
          idx = 0;
          tds = vm.attrs().map(function (col) {
            var cell, tdOpts, inputOpts,
              prop = f.resolveProperty(model, col),
              id = "input" + col.toCamelCase(true),
              columnWidth = activeSheet.list.columns[idx].width || COL_WIDTH_DEFAULT;

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
                minWidth: columnWidth,
                maxWidth: columnWidth,
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

            idx += 1;

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
      idx = 0;
      tabs = vm.sheets().map(function (sheet) {
        var tab, tabOpts;

        // Build tab
        tabOpts = {
          class: "suite-sheet-tab pure-button" +
            (activeSheet.name === sheet ? " pure-button-primary" : ""),
          onclick: vm.tabClicked.bind(this, sheet)
        };

        if (vm.config().length > 1) {
          tabOpts.ondragover = vm.ondragover;
          tabOpts.draggable = true;
          tabOpts.ondragstart = vm.ondragstart.bind(this, idx, "tab");
          tabOpts.ondrop = vm.ondrop.bind(this, idx, "tab", config);
          tabOpts.ondragend = vm.ondragend;
          tabOpts.style = {webkitUserDrag: "element"};
        }

        tab = m("button[type=button]", tabOpts, sheet);
        idx += 1;

        return tab;
      });

      // New tab button
      tabs.push(m("button[type=button]", {
        class: "pure-button",
        title: "Add sheet",
        style: {
          backgroundColor: "White",
          display: vm.isDraggingTab() ? "none" : "inline-block"
        },
        onclick: vm.newSheet
      }, [m("i", {class:"fa fa-plus"})]));

      // Delete target
      tabs.push(m("div", {
        class: "pure-button",
        style: {
          backgroundColor: "White",
          display: vm.isDraggingTab() ? "inline-block" : "none"
        },
        ondragover: vm.ondragover,
        ondrop: vm.deleteSheet
      }, [m("i", {class:"fa fa-trash"})]));

      // Finally assemble the whole view
      view = m("div", {
        class: "pure-form"
      }, [
        m("div", {
            id: "toolbar",
            class: "suite-toolbar"
          }, [
          m.component(sortDialog.component({viewModel: vm.sortDialog()})),
          m.component(sortDialog.component({viewModel: vm.filterDialog()})),
          m.component(sheetConfigureDialog.component({viewModel: vm.sheetConfigureDialog()})),
          m.component(dialog.component({viewModel: vm.confirmDialog()})),
          m.component(button.component({viewModel: vm.buttonHome()})),
          m.component(button.component({viewModel: vm.buttonList()})),
          m.component(button.component({viewModel: vm.buttonEdit()})),
          m.component(button.component({viewModel: vm.buttonSave()})),
          m.component(button.component({viewModel: vm.buttonOpen()})),
          m.component(button.component({viewModel: vm.buttonNew()})),
          m.component(button.component({viewModel: vm.buttonDelete()})),
          m.component(button.component({viewModel: vm.buttonUndo()})),
          m.component(searchInput.component({viewModel: vm.searchInput()})),
          m.component(button.component({viewModel: vm.buttonRefresh()})),
          m.component(button.component({viewModel: vm.buttonClear()})),
          m("div", {
            id: "nav-div",
            class: "pure-menu custom-restricted-width suite-menu",
            onmouseover: vm.onmouseovermenu,
            onmouseout: vm.onmouseoutmenu
          }, [
            m("span", {
              id: "nav-button",
              class:"pure-button fa fa-bars suite-menu-button"
            }),
            m("ul", {
              id: "nav-menu-list",
              class: "pure-menu-list suite-menu-list",
              style: {
                display: vm.showMenu() ? "block" : "none"
              }
            }, [
              m("li", {
                id: "nav-sort",
                class: "pure-menu-link",
                title: "Change sheet sort",
                onclick: vm.sortDialog().show
              }, [m("i", {class:"fa fa-sort", style: {
                marginRight: "4px"
              }})], "Sort"),
              m("li", {
                id: "nav-filter",
                class: "pure-menu-link",
                title: "Change sheet filter",
                onclick: vm.filterDialog().show
              }, [m("i", {class:"fa fa-filter", style: {
                marginRight: "4px"
              }})], "Filter"),
              m("li", {
                id: "nav-subtotal",
                class: "pure-menu-link",
                title: "Edit subtotals"
                //onclick: vm.filterDialog().show
              }, [m("div", {style: {
                display: "inline",
                fontWeight: "bold",
                fontStyle: "Italic"
              }}, "∑")], " Totals"),
              m("li", {
                id: "nav-configure",
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
                id: "nav-share",
                class: "pure-menu-link",
                title: "Share workbook configuration",
                onclick: vm.share
              }, [m("i", {class:"fa fa-share-alt", style: {
                marginRight: "4px"
              }})], "Share"),
              m("li", {
                id: "nav-revert",
                class: "pure-menu-link",
                title: "Revert workbook configuration to original state",
                onclick: vm.revert
              }, [m("i", {class:"fa fa-reply", style: {
                marginRight: "4px"
              }})], "Revert")
            ])
          ])     
        ]),
        m("table", {
          class: "pure-table suite-table"
        }, [
            m("thead", {
            id: "header",
            class: "suite-table-header"
          }, [header]),
          m("tbody", {
            id: "rows",
            class: "suite-table-body",
            onscroll: vm.onscroll,
            config: tbodyConfig
          }, rows)
        ]),
        m("div", {id: "tabs"}, [
          tabs,
          m("i", {class: "fa fa-search-plus suite-zoom-icon suite-zoom-right-icon"}),
          m("input", {
            class: "suite-zoom-control",
            title: "Zoom " + vm.zoom() + "%",
            type: "range",
            step: "5",
            min: "50",
            max: "150",
            value: vm.zoom(),
            oninput: m.withAttr("value", vm.zoom)
          }),
          m("i", {class: "fa fa-search-minus suite-zoom-icon suite-zoom-left-icon"})
        ])
      ]);

      return view;
    };

    return component;
  };

  catalog.register("components", "workbookDisplay", workbookDisplay.component);
  module.exports = workbookDisplay;

}());


