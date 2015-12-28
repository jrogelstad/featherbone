/*global window*/
(function () {
  "use strict";

  var workbookDisplay = {},
    m = require("mithril"),
    f = require("component-core"),
    button = require("button"),
    catalog = require("catalog"),
    dialog = require("dialog"),
    filterDialog = require("filter-dialog"),
    searchInput = require("search-input"),
    sortDialog = require("sort-dialog"),
    sheetConfigureDialog = require("sheet-configure-dialog"),
    tableWidget = require("table-widget");

  // Define workbook view model
  workbookDisplay.viewModel = function (options) {
    var listState, tableState, searchState, currentSheet, 
      dataTransfer, frmroute,
      feather = catalog.getFeather(options.feather),
      sheetId = options.id,
      isDraggingTab = false,
      vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.buttonClear = m.prop();
    vm.buttonDelete = m.prop();
    vm.buttonEdit = m.prop();
    vm.buttonHome = m.prop();
    vm.buttonList = m.prop();
    vm.buttonNew = m.prop();
    vm.buttonOpen = m.prop();
    vm.buttonRefresh = m.prop();
    vm.buttonSave = m.prop();
    vm.buttonUndo = m.prop();
    vm.config = m.prop(options.config); 
    vm.confirmDialog = m.prop(dialog.viewModel({
      icon: "question-circle",
      title: "Confirmation"
    }));
    vm.configureSheet = function () {
      var dlg = vm.sheetConfigureDialog();
      dlg.sheetId(sheetId);
      dlg.show();
    };
    vm.deleteSheet = function () {
      var doDelete,
        dialogConfirm = vm.dialogConfirm();

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
    vm.filterDialog = m.prop();
    vm.goHome = function () {
      vm.didLeave(true);
      m.route("/home");
    };
    vm.isDraggingTab = function () {
      return isDraggingTab;
    };
    vm.modelNew = function () {
      // TODO: Rewrite
    };
    vm.modelOpen = function () {
      var key,
        selection = vm.tableWidget().selection();
      if (selection) {
        vm.didLeave(true);
        key = selection.idProperty();
        m.route(frmroute + "/" + selection.data[key]());
      }
    };
    vm.newSheet = function () {
      var undo, newSheet, sheetName, formName, next,
        dialogSheetConfigure = vm.dialogSheetConfigure(),
        forms,
        id = f.createId(),
        config = vm.config(),
        sheets = vm.sheets(),
        i = 0;

      while (!sheetName) {
        i += 1;
        next = "Sheet" + i;
        if (sheets.indexOf(next) === -1) {
          sheetName = next;
        }
      }

      forms = config.map(function (sheet) {
        return sheet.form.name;
      });

      i= 0;
      while (!formName) {
        i += 1;
        next = "Form" + i;
        if (forms.indexOf(next) === -1) {
          formName = next;
        }
      }

      newSheet = {
        id: id,
        name: sheetName,
        feather: null,
        form: {
          name: formName,
          attrs: []
        },
        list: {columns: []}
      };

      undo = function () {
        config.pop();
      };

      config.push(newSheet);
      dialogSheetConfigure.sheetId(id);
      dialogSheetConfigure.onCancel(undo);
      dialogSheetConfigure.show();
    };
    vm.ondragend = function () {
      isDraggingTab = false;
    };
    vm.ondragover = function (ev) {
      ev.preventDefault();
    };
    vm.ondragstart = function (idx, type) {
      dataTransfer = {}; // Because ms edge only allows one value
      dataTransfer.typeStart = type;
      isDraggingTab = true;
      dataTransfer[type] = idx;
    };
    vm.ondrop = function (toIdx, type, ary, ev) {
      var moved, fromIdx;

      ev.preventDefault();
      fromIdx = dataTransfer[type] - 0;
      if (fromIdx !== toIdx) {
        moved = ary.splice(fromIdx, 1)[0];
        ary.splice(toIdx, 0, moved);
      }
      isDraggingTab = false;
    };
    vm.onmouseovermenu = function () {
      vm.showMenu(true);
    };
    vm.onmouseoutmenu = function (ev) {
      if (!ev || !ev.toElement || !ev.toElement.id ||
          ev.toElement.id.indexOf("nav-") === -1) {
        vm.showMenu(false);
      }
    };
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
    vm.searchInput = m.prop();
    vm.share = function () {
      var doShare,
        dialogConfirm = vm.dialogConfirm();

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
    vm.sheet = function (id, value) {
      var idx = 0,
        config = vm.config();

      if (id) {
        if (typeof id === "object") {
          value = id;
          id = sheetId;
        }
      } else {
        id = sheetId;
      }

      if (currentSheet && currentSheet.id === id &&
          !value) {
        return currentSheet;
      }

      config.some(function (item) {
        if (id === item.id) { return true; }
        idx += 1;
      });
      if (value) { config.splice(idx, 1, value); }
      currentSheet = config[idx];

      return currentSheet;
    };
    vm.sheets = function () {
      var config = vm.config();
      return config.map(function (sheet) {
        return sheet.name;
      });
    };
    vm.sheetConfigureDialog = m.prop(sheetConfigureDialog.viewModel({
      parentViewModel: vm,
      sheetId: sheetId
    }));
    vm.showFilterDialog = function () {
      if (vm.models().canFilter()) {
        vm.filterDialog().show();
      }
    };
    vm.showMenu = m.prop(false);
    vm.showSortDialog = function () {
      if (vm.models().canFilter()) {
        vm.sortDialog().show();
      }
    };
    vm.sortDialog = m.prop();
    vm.tabClicked = function (sheet) {
      var route = "/" + options.name + "/" + sheet;
      route = route.toSpinalCase();
      m.route(route);
    };
    vm.tableWidget = m.prop();
    vm.workbook= function () {
      return catalog.store().workbooks()[options.name.toCamelCase()];
    };
    vm.zoom = function (value) {
      var w = vm.tableWidget();
      if (value !== undefined) { w.zoom(value); }
      return w.zoom();
    };

    // ..........................................................
    // PRIVATE
    //

    frmroute = "/" + options.name + "/" + vm.sheet().form.name;
    frmroute = frmroute.toSpinalCase();

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
      config: vm.sheet()
    }));

    // Create dalog view models
    vm.filterDialog(filterDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather,
      title: "filter",
      icon: "filter"
    }));

    vm.sortDialog = m.prop(sortDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather,
      title: "sort",
      icon: "sort"
    }));

    // Create button view models
    vm.buttonEdit = m.prop(button.viewModel({
      onclick: vm.tableWidget().toggleEdit,
      title: "Edit mode",
      hotkey: "E",
      icon: "pencil"
    }));

    vm.buttonHome = m.prop(button.viewModel({
      onclick: vm.goHome,
      title: "Home",
      hotkey: "H",
      icon: "home"
    }));

    vm.buttonList = m.prop(button.viewModel({
      onclick: vm.tableWidget().toggleView,
      title: "List mode",
      hotkey: "L",
      icon: "list"
    }));

    vm.buttonSave(button.viewModel({
      onclick: vm.tableWidget().save,
      label: "&Save",
      icon: "cloud-upload"
    }));

    vm.buttonOpen(button.viewModel({
      onclick: vm.modelOpen,
      label: "&Open",
      icon: "folder-open"
    }));

    vm.buttonNew(button.viewModel({
      onclick: vm.modelNew,
      label: "&New",
      icon: "plus-circle"
    }));

    vm.buttonDelete(button.viewModel({
      onclick: vm.tableWidget().modelDelete,
      label: "&Delete",
      icon: "remove"
    }));

    vm.buttonUndo(button.viewModel({
      onclick: vm.tableWidget().undo,
      label: "&Undo",
      icon: "undo"
    }));

    vm.inputSearch(searchInput.viewModel({
      refresh: vm.refresh
    }));

    vm.buttonRefresh(button.viewModel({
      onclick: vm.refresh,
      title: "Refresh",
      hotkey: "R",
      icon: "refresh"
    }));

    vm.buttonClear(button.viewModel({
      onclick: vm.searchInput().clear,
      title: "Clear search",
      hotkey: "C",
      icon: "eraser"
    }));

    // Bind button states to list statechart events
    listState = vm.tableWidget().models().state();
    listState.resolve("/Fetched").enter(function () {
      if (vm.tableWidget().selection() &&
          vm.tableWidget().model().canUndo()) {
        vm.buttonDelete().hide();
        vm.buttonUndo().show();
        return;
      }

      vm.buttonDelete().show();
      vm.buttonUndo().hide();
    });
    listState.resolve("/Fetched/Clean").enter(function () {
      vm.buttonSave().disable();
    });
    listState.state().resolve("/Fetched/Dirty").enter(function () {
      vm.buttonSave().enable();
    });

    // Bind button states to search statechart events
    searchState = vm.searchInput().state();
    searchState.resolve("/Search/On").enter(function () {
      vm.buttonClear().enable();
    });
    searchState.resolve("/Search/Off").enter(function () {
      vm.buttonClear().disable();
    });

    // Bind refresh to filter change event
    vm.filter.state().resolve("/Ready").enter(function () {
      vm.sheet().list.filter = vm.filter();
      vm.refresh();
    });

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Mode/View").enter(function () {
      vm.buttonEdit().deactivate();
      vm.buttonList().activate();
      vm.buttonSave().hide();
      vm.buttonOpen().show();
    });
    tableState.resolve("/Mode/Edit").enter(function () {
      vm.buttonEdit().activate();
      vm.buttonList().deactivate();
      vm.buttonSave().show();
      vm.buttonOpen().hide();
    });
    tableState.resolve("/Selection/Off").enter(function () {
      vm.buttonOpen().disable();
      vm.buttonDelete().disable();
      vm.buttonDelete().show();
      vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
      vm.buttonOpen().enable();
      vm.buttonDelete().enable();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
      vm.buttonDelete().show();
      vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
      vm.buttonDelete().hide();
      vm.buttonUndo().show();
    });

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
      var filterMenuClass, tabs, view,
        vm = ctrl.vm,
        activeSheet = vm.sheet(),
        config = vm.config(),
        idx = 0;

      // Build tabs
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
      filterMenuClass = "pure-menu-link";
      if (!vm.models().canFilter()) {
        filterMenuClass += " pure-menu-disabled";
      }
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
                class: filterMenuClass,
                title: "Change sheet sort",
                onclick: vm.showSortDialog
              }, [m("i", {class:"fa fa-sort", style: {
                marginRight: "4px"
              }})], "Sort"),
              m("li", {
                id: "nav-filter",
                class: filterMenuClass,
                title: "Change sheet filter",
                onclick: vm.showFilterDialog
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
        m.component(button.component({viewModel: vm.tableWidget()})),
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
