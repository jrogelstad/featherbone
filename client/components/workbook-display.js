/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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

  var workbookDisplay = {},
    m = require("mithril"),
    stream = require("stream"),
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
    var listState, tableState, searchState, currentSheet, feather,
      workbook = catalog.store().workbooks()[options.workbook.toCamelCase()], 
      config = workbook.getConfig(),
      sheetId = config.find(function (sheet) {
        return sheet.name.toSpinalCase() === options.key;
      }).id,
      vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.buttonClear = stream();
    vm.buttonDelete = stream();
    vm.buttonEdit = stream();
    vm.buttonHome = stream();
    vm.buttonList = stream();
    vm.buttonNew = stream();
    vm.buttonOpen = stream();
    vm.buttonRefresh = stream();
    vm.buttonSave = stream();
    vm.buttonUndo = stream();
    vm.config = stream(config); 
    vm.confirmDialog = stream(dialog.viewModel({
      icon: "question-circle",
      title: "Confirmation"
    }));
    vm.configureSheet = function () {
      var dlg = vm.sheetConfigureDialog();
      dlg.onCancel(undefined);
      dlg.sheetId(sheetId);
      dlg.show();
    };
    vm.deleteSheet = function (ev) {
      var doDelete,
        idx = ev.dataTransfer.getData("text") - 0,
        confirmDialog = vm.confirmDialog();

      doDelete = function () {
        var activeSheetId = vm.sheet().id,
          deleteSheetId = vm.config()[idx].id;
        vm.config().splice(idx, 1);
        if (activeSheetId === deleteSheetId) {
          if (idx === vm.config().length) { idx -= 1; }
          vm.tabClicked(config[idx].name);
        }
      };

      confirmDialog.message("Are you sure you want to delete this sheet?");
      confirmDialog.onOk(doDelete);
      confirmDialog.show();
    };
    vm.didLeave = stream(false);
    vm.filter = f.prop();
    vm.filterDialog = stream();
    vm.goHome = function () {
      vm.didLeave(true);
      m.route.set("/home");
    };
    vm.goSettings = function () {
      m.route.set("/settings/:settings", {
        settings: workbook.data.launchConfig().settings
      });
    };
    vm.isDraggingTab = stream(false);
    vm.hasSettings = stream(!!workbook.data.launchConfig().settings);
    vm.modelNew = function () {
      if (!vm.tableWidget().modelNew()) {
        vm.didLeave(true);
        m.route.set("/edit/:feather", {
          feather: feather.name.toSpinalCase()
        });
      }
    };
    vm.modelOpen = function () {
      var selection = vm.tableWidget().selection();
      if (selection) {
        vm.didLeave(true);
        m.route.set("/edit/:feather/:key", {
          feather: feather.name.toSpinalCase(),
          key: selection.id()
        });
      }
    };
    vm.newSheet = function () {
      var undo, newSheet, sheetName, next,
        dialogSheetConfigure = vm.sheetConfigureDialog(),
        id = f.createId(),
        sheets = vm.sheets(),
        sheet = f.copy(vm.sheet()),
        i = 0;

      while (!sheetName) {
        i += 1;
        next = "Sheet" + i;
        if (sheets.indexOf(next) === -1) {
          sheetName = next;
        }
      }

      i= 0;

      newSheet = {
        id: id,
        name: sheetName,
        feather: sheet.feather,
        list: {columns: sheet.list.columns}
      };

      undo = function () {
        vm.config().pop();
        dialogSheetConfigure.onCancel(undefined);
      };

      vm.config().push(newSheet);
      dialogSheetConfigure.sheetId(id);
      dialogSheetConfigure.onCancel(undo);
      dialogSheetConfigure.show();
    };
    vm.ondragend = function () {
      vm.isDraggingTab(false);
    };
    vm.ondragover = function (ev) {
      ev.preventDefault();
    };
    vm.ondragstart = function (idx, ev) {
      vm.isDraggingTab(true);
      ev.dataTransfer.setData("text", idx);
    };
    vm.ondrop = function (toIdx, ary, ev) {
      var moved, fromIdx;

      ev.preventDefault();
      fromIdx = ev.dataTransfer.getData("text") - 0;
      if (fromIdx !== toIdx) {
        moved = ary.splice(fromIdx, 1)[0];
        ary.splice(toIdx, 0, moved);
      }
      vm.isDraggingTab(false);
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
    vm.refresh = function () {
      vm.tableWidget().refresh(); 
    };
    vm.revert = function () {
      var workbookJSON = vm.workbook().toJSON(),
        localConfig = vm.config(),
        defaultConfig = workbookJSON.defaultConfig,
        sheet = defaultConfig[0];
      
      localConfig.length = 0;
      defaultConfig.forEach(function (item) {
        localConfig.push(item);
      });
      workbookJSON.localConfig = localConfig;
      m.route.set("/workbook/:workbook/:sheet", {
        workbook: workbookJSON.name.toSpinalCase(),
        sheet: sheet.name.toSpinalCase()
      });
    };
    vm.searchInput = stream();
    vm.share = function () {
      var doShare,
        confirmDialog = vm.confirmDialog();

      doShare = function () {
        workbook.data.localConfig(vm.config());
        workbook.save();
      };

      confirmDialog.message("Are you sure you want to share your workbook " +
        "configuration with all other users?");
      confirmDialog.onOk(doShare);
      confirmDialog.show();
    };
    vm.sheet = function (id, value) {
      var idx = 0;

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
      if (value) { vm.config().splice(idx, 1, value); }
      currentSheet = vm.config()[idx];

      return currentSheet;
    };
    vm.sheets = function () {
      return vm.config().map(function (sheet) {
        return sheet.name;
      });
    };
    vm.sheetConfigureDialog = stream();
    vm.showFilterDialog = function () {
      if (vm.tableWidget().models().canFilter()) {
        vm.filterDialog().show();
      }
    };
    vm.showMenu = stream(false);
    vm.showSortDialog = function () {
      if (vm.tableWidget().models().canFilter()) {
        vm.sortDialog().show();
      }
    };
    vm.sortDialog = stream();
    vm.tabClicked = function (sheet) {
      m.route.set("/workbook/:workbook/:sheet", {
        workbook: workbook.data.name().toSpinalCase(),
        sheet: sheet.toSpinalCase()
      });
    };
    vm.tableWidget = stream();
    vm.workbook = function () {
      return workbook;
    };
    vm.zoom = function (value) {
      var w = vm.tableWidget();
      if (value !== undefined) { w.zoom(value); }
      return w.zoom();
    };

    // ..........................................................
    // PRIVATE
    //
    feather = catalog.getFeather(vm.sheet().feather);

    // Create search widget view model
    vm.searchInput(searchInput.viewModel({
      refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
      config: vm.sheet().list,
      isEditModeEnabled: vm.sheet().isEditModeEnabled,
      feather: vm.sheet().feather,
      search: vm.searchInput().value,
      ondblclick: vm.modelOpen
    }));

    // Create dialog view models
    vm.filterDialog(filterDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather
    }));

    vm.sheetConfigureDialog(sheetConfigureDialog.viewModel({
      parentViewModel: vm,
      sheetId: sheetId
    }));

    vm.sortDialog(sortDialog.viewModel({
      filter: vm.tableWidget().filter,
      list: vm.tableWidget().models(),
      feather: feather
    }));

    // Create button view models
    vm.buttonEdit(button.viewModel({
      onclick: vm.tableWidget().toggleEdit,
      title: "Edit mode",
      hotkey: "E",
      icon: "pencil"
    }));
    if (!vm.tableWidget().isEditModeEnabled()) {
      vm.buttonEdit().disable();
    }

    vm.buttonHome(button.viewModel({
      onclick: vm.goHome,
      title: "Home",
      hotkey: "H",
      icon: "home"
    }));

    vm.buttonList(button.viewModel({
      onclick: vm.tableWidget().toggleView,
      title: "List mode",
      hotkey: "L",
      icon: "list"
    }));
    vm.buttonList().activate();

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
    vm.buttonOpen().disable();

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
    vm.buttonDelete().disable();

    vm.buttonUndo(button.viewModel({
      onclick: vm.tableWidget().undo,
      label: "&Undo",
      icon: "undo"
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
      var model = vm.tableWidget().selection();
      if (model && model.canUndo()) {
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
      var model = vm.tableWidget().selection();
      if (model && model.canDelete()) {
        vm.buttonDelete().enable();
      } else {
        vm.buttonDelete().disable();
      }
      vm.buttonOpen().enable();
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
  workbookDisplay.component =  {
    oninit: function (vnode) {
      console.log("init workbook...");
      var viewModel = workbookDisplay.viewModel(vnode.attrs);
      vnode.attrs.viewModel = viewModel;
    },

    onupdate: function (vnode) {
      var viewModel = vnode.attrs.viewModel;
      if (viewModel.didLeave()) {
        viewModel.didLeave(false);
        viewModel.refresh(); 
      }
    },

    view: function (vnode) {
      var filterMenuClass, tabs,
        vm = vnode.attrs.viewModel,
        activeSheet = vm.sheet(),
        config = vm.config(),
        idx = 0;

      // Build tabs
      tabs = vm.sheets().map(function (sheet) {
        var tab, tabOpts;

        // Build tab
        tabOpts = {
          class: "suite-sheet-tab pure-button" +
            (activeSheet.name.toName() === sheet.toName() ? " pure-button-primary" : ""),
          onclick: vm.tabClicked.bind(this, sheet)
        };

        if (vm.config().length > 1) {
          tabOpts.ondragover = vm.ondragover;
          tabOpts.draggable = true;
          tabOpts.ondragstart = vm.ondragstart.bind(this, idx);
          tabOpts.ondrop = vm.ondrop.bind(this, idx, config);
          tabOpts.ondragend = vm.ondragend;
          tabOpts.style = {webkitUserDrag: "element"};
        }

        tab = m("button[type=button]", tabOpts, sheet.toName());
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
      if (!vm.tableWidget().models().canFilter()) {
        filterMenuClass += " pure-menu-disabled";
      }
      
      return m("div", {
        class: "pure-form"
      }, [
        m(sortDialog.component, {viewModel: vm.sortDialog()}),
        m(sortDialog.component, {viewModel: vm.filterDialog()}),
        m(sheetConfigureDialog.component, {viewModel: vm.sheetConfigureDialog()}),
        m(dialog.component, {viewModel: vm.confirmDialog()}),
        m("div", {
            id: "toolbar",
            class: "suite-toolbar"
          }, [
          m(button.component, {viewModel: vm.buttonHome()}),
          m(button.component, {viewModel: vm.buttonList()}),
          m(button.component, {viewModel: vm.buttonEdit()}),
          m(button.component, {viewModel: vm.buttonSave()}),
          m(button.component, {viewModel: vm.buttonOpen()}),
          m(button.component, {viewModel: vm.buttonNew()}),
          m(button.component, {viewModel: vm.buttonDelete()}),
          m(button.component, {viewModel: vm.buttonUndo()}),
          m(searchInput.component, {viewModel: vm.searchInput()}),
          m(button.component, {viewModel: vm.buttonRefresh()}),
          m(button.component, {viewModel: vm.buttonClear()}),
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
                id: "nav-format",
                class: "pure-menu-link pure-menu-disabled",
                title: "Format sheet"
                //onclick: vm.showFormatDialog
              }, [m("i", {class:"fa fa-paint-brush", style: {
                marginRight: "4px"
              }})], "Format"),
              m("li", {
                id: "nav-subtotal",
                class: "pure-menu-link pure-menu-disabled",
                title: "Edit subtotals"
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
              }})], "Revert"),
              m("li", {
                id: "nav-settings",
                class: vm.hasSettings() ? "pure-menu-link" : "pure-menu-link pure-menu-disabled",
                style: {
                  borderTop: "solid thin lightgrey"
                },
                title: "Change module settings",
                onclick: vm.goSettings
              }, [m("i", {class:"fa fa-wrench", style: {
                marginRight: "4px"
              }})], "Settings")
            ])
          ])     
        ]),
        m(tableWidget.component, {viewModel: vm.tableWidget()}),
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
    }
  };

  catalog.register("components", "workbookDisplay", workbookDisplay.component);
  module.exports = workbookDisplay;

}());
