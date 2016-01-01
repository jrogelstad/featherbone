/*global window*/
(function () {
  "use strict";

  var scrWidth, inner, widthNoScroll, widthWithScroll,
    tableWidget = {},
    m = require("mithril"),
    f = require("component-core"),
    math = require("mathjs"),
    statechart = require("statechartjs"),
    catalog = require("catalog"),
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
  tableWidget.viewModel = function (options) {
    options = options || {};
    var fromWidthIdx, dataTransfer,
      vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.attrs = function () {
      var columns = vm.config().list.columns,
        result = columns.map(function(column) {
          return column.attr;
        });
      return result || [{attr: "id"}];
    };
    vm.config = m.prop(options.config);
    vm.defaultFocus = function (model) {
      var col = vm.attrs().find(function (attr) {
        return !model.data[attr] || !model.data[attr].isReadOnly();
      });
      return col ? col.toCamelCase(true) : undefined;
    };
    vm.feather = m.prop(catalog.getFeather(options.config.feather));
    vm.filter = f.prop();
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
    vm.heightMargin = m.prop(options.heightMargin || 6);
    vm.ids = m.prop({
      header: f.createId(),
      rows: f.createId()
    });
    vm.isSelected = function (model) {
      var prop,
        selection = vm.selection();
      if (selection && model) {
        prop = selection.idProperty();
        return selection.data[prop]() === model.data[prop]();
      }
      return false;
    };
    vm.mode = function () {
      var state = vm.state();
      return state.resolve(state.current()[0]);
    };
    vm.model = function () {
      return vm.selection();
    };
    vm.modelDelete = function () {
      return vm.mode().modelDelete();
    };
    vm.modelNew = function () {
      return vm.mode().modelNew();
    };
    vm.models = m.prop();
    vm.nextFocus = m.prop();
    vm.ondblclick = function (model) {
      vm.select(model);
      if (options.ondblclick) {
        options.ondblclick();
      }
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
          column = vm.config().list.columns[fromWidthIdx];
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
    vm.outsideElementIds = m.prop(options.outsideElementIds || []);
    vm.onscroll = function () {
      var ids = vm.ids(),
        header = document.getElementById(ids.header),
        rows = document.getElementById(ids.rows);

      // Sync header position with table body position
      header.scrollLeft = rows.scrollLeft;
    };
    vm.refresh = function () {
      var fattrs, formatOf, criterion,
        value = vm.search(),
        filter= f.copy(vm.filter());

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
          return formatOf(vm.feather(), attr) === "string";
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
    vm.save = function () {
      vm.models().save();
    };
    vm.scrollbarWidth = m.prop(scrWidth);
    vm.search = options.search || m.prop("");
    vm.select = function (model) {
      if (vm.selection() !== model) {
        vm.relations({});
        vm.selection(model);
      }

      if (vm.selection()) {
        vm.state().send("selected");
      } else {
        vm.state().send("unselected");
      }

      return vm.selection();
    };
    vm.selection = m.prop();
    vm.selectedColor = function () {
      return vm.mode().selectedColor();
    };
    vm.state = m.prop();
    vm.toggleEdit = function () {
      vm.state().send("edit");
    };
    vm.toggleView = function () {
      vm.state().send("view");
    };
    vm.toggleSelection = function (model, col) {
      return vm.mode().toggleSelection(model, col);
    };
    vm.undo = function () {
      var selection = vm.selection();
      if (selection) { selection.undo(); }
    };
    vm.zoom = m.prop(100);

    // ..........................................................
    // PRIVATE
    //

    vm.outsideElementIds().push(vm.ids().header);
    vm.filter(f.copy(options.config.list.filter || {}));
    vm.models = catalog.store().models()[options.config.feather.toCamelCase()].list({
      filter: vm.filter()
    });

    // Bind refresh to filter change event
    vm.filter.state().resolve("/Ready").enter(function () {
      vm.config().list.filter = vm.filter();
      vm.refresh();
    });

    // Create workbook statechart
    vm.state(statechart.define({concurrent: true}, function () {
      this.state("Mode", function () {
        this.state("View", function () {
          this.event("edit", function () {
            this.goto("../Edit");
          });
          this.modelDelete = function () {
            var selection = vm.selection();
            selection.delete(true).then(function () {
              vm.select();
              vm.models().remove(selection);
            });
          };
          this.modelNew = m.prop(false); // Do nothing
          this.selectedColor = function () {
            return "LightSkyBlue";
          };
          this.toggleSelection = function (model, col) {
            if (vm.selection() === model) {
              vm.select(undefined);
              return false;
            }

            vm.select(model);
            vm.nextFocus("input" + col.toCamelCase(true));
            return true;
          };
        });
        this.state("Edit", function () {
          this.event("view", function () {
            this.goto("../View");
          });
          this.modelDelete = function () {
            var selection = vm.selection(),
              prevState = selection.state().current()[0];
            selection.delete();
            if (prevState === "/Ready/New") {
              vm.models().remove(selection);
            }
          };
          this.modelNew = function () {
            var  name = vm.config().feather.toCamelCase(),
              model = catalog.store().models()[name](),
              input = "input" + vm.defaultFocus(model).toCamelCase(true);
            vm.models().add(model);
            vm.nextFocus(input);
            vm.select(model);
            return true;
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
        this.state("Off");
        this.state("On", function () {
          this.event("unselected", function () {
            this.goto("../Off");
          });
          this.C(function() {
            if (vm.selection().canUndo()) { 
              return "./Dirty";
            }
            return "./Clean";
          });
          this.state("Clean");
          this.state("Dirty");
        });
      });
    }));

    // Initialize statechart
    vm.state().goto();

    return vm;
  };

  // Define table widget component
  tableWidget.component = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel;
    };

    component.view = function (ctrl) {
      var tbodyConfig, findFilterIndex,
        header, rows, view, rel,
        vm = ctrl.vm,
        ids = vm.ids(),
        config = vm.config(),
        filter = vm.filter(),
        sort = filter.sort || [],
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
        var margin = vm.heightMargin(),
          bodyHeight = math.subtract(window.innerHeight, margin),
          eids = vm.outsideElementIds();

        eids.forEach(function (id) {
          var h = document.getElementById(id).clientHeight;
          bodyHeight = math.subtract(bodyHeight, h);
        });

        e.style.height = bodyHeight + "px";

        // Set fields table to scroll and toolbar to stay put
        document.documentElement.style.overflow = 'hidden';

        // Key down handler for up down movement
        e.addEventListener("keydown", vm.onkeydownCell);
      };

      // Build header
      idx = 0;
      header = (function () {
        var ths = config.list.columns.map(function (col) {
            var hview, order, name,
              key = col.attr,
              icon = [],
              fidx = findFilterIndex(key, "sort"),
              operators = f.operators,
              columnWidth = config.list.columns[idx].width || COL_WIDTH_DEFAULT;

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
                ondrop: vm.ondrop.bind(this, idx, "column", config.list.columns),
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
              columnWidth = config.list.columns[idx].width || COL_WIDTH_DEFAULT,
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
            ondblclick: vm.ondblclick.bind(this, model)
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
              columnWidth = config.list.columns[idx].width || COL_WIDTH_DEFAULT;

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

      view = m("table", {
          class: "pure-table suite-table"
        }, [
          m("thead", {
          id: ids.header,
          class: "suite-table-header"
        }, [header]),
        m("tbody", {
          id: ids.rows,
          class: "suite-table-body",
          onscroll: vm.onscroll,
          config: tbodyConfig
        }, rows)
      ]);

      return view;
    };

    return component;
  };

  catalog.register("components", "tableWidget", tableWidget.component);
  module.exports = tableWidget;

}());
