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
/*global window, require, module*/
/*jslint browser, this, for*/
(function () {
    "use strict";

    var scrWidth, inner, widthNoScroll, widthWithScroll,
            tableWidget = {},
            m = require("mithril"),
            stream = require("stream"),
            f = require("component-core"),
            statechart = require("statechartjs"),
            catalog = require("catalog"),
            dialog = require("dialog"),
            outer = document.createElement("div"),
            COL_WIDTH_DEFAULT = "150px",
            LIMIT = 20,
            ROW_COUNT = 2;

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
                selectionChanged, selectionFetched, fetch,
                feather = typeof options.feather === "object"
            ? options.feather
            : catalog.getFeather(options.feather),
                modelName = feather.name.toCamelCase(),
                offset = 0,
                vm = {};

        // ..........................................................
        // PUBLIC
        //

        vm.alias = function (attr) {
            return f.resolveAlias(vm.feather(), attr);
        };
        vm.attrs = function () {
            var columns = vm.config().columns,
                result = columns.map(function (column) {
                    return column.attr;
                });
            return result || [{
                attr: "id"
            }];
        };
        vm.canToggle = stream(true);
        vm.isEditModeEnabled = stream(options.isEditModeEnabled !== false);
        vm.isQuery = stream(true);
        vm.config = stream(options.config);
        vm.footerId = stream(options.footerId);
        vm.confirmDialog = stream(dialog.viewModel({
            icon: "question-circle",
            title: "Confirmation"
        }));
        /*
          Return the id of the input element which can recive focus

          @param {Object} Model to evaluate
          @return {String}
        */
        vm.defaultFocus = function (model) {
            var col = vm.attrs().find(function (attr) {
                return !model.data[attr] || !model.data[attr].isReadOnly();
            });
            return col
                ? vm.formatInputId(col)
                : undefined;
        };
        vm.errorDialog = stream(dialog.viewModel({
            icon: "exclamation-triangle",
            title: "Error"
        }));
        vm.feather = stream(feather);
        vm.filter = f.prop();
        vm.formatInputId = function (col) {
            return "input" + col.toCamelCase(true);
        };
        vm.goNextRow = function () {
            var list = vm.models(),
                ids = list.map(function (model) {
                    return model.id();
                }),
                model = vm.model(),
                idx = model
                    ? ids.indexOf(model.id()) + 1
                    : 0;
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
        vm.ids = stream({
            header: f.createId(),
            rows: f.createId()
        });
        vm.isSelected = function (model) {
            return vm.selectionIds().indexOf(model.id()) > -1;
        };
        /*
          Return the name of the last attribute which can recive focus.

          @param {Object} Model to evaluate
          @returns {String}
        */
        vm.lastFocus = function (model) {
            var col, attrs = vm.attrs().slice().reverse();

            col = attrs.find(function (attr) {
                return model.data[attr] && !model.data[attr].isReadOnly();
            });
            return col
                ? vm.formatInputId(col)
                : undefined;
        };
        /*
          Set or return the last model that was selected in the list.

          @param {Object} Model selected
          @returns {Object} Last model selected
        */
        vm.lastSelected = stream();
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
        vm.models = stream(options.models);
        vm.nextFocus = stream();
        vm.ondblclick = function (model) {
            vm.select(model);
            if (options.ondblclick) {
                options.ondblclick();
            }
        };
        vm.ondragover = function (toIdx, ev) {
            if (!isNaN(toIdx)) {
                if (fromWidthIdx > toIdx) {
                    return;
                }
            } else {
                ev = toIdx;
            }
            ev.preventDefault();
        };
        vm.ondragstart = function (idx, type, ev) {
            dataTransfer = {}; // Because ms edge only allows one value
            dataTransfer.typeStart = type;

            switch (type) {
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

            switch (typeStart) {
            case "width":
                if (fromWidthIdx <= toIdx) {
                    widthStart = dataTransfer.widthStart - 0;
                    column = vm.config().columns[fromWidthIdx];
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
        vm.onkeydown = function (e) {
            var id,
                key = e.key || e.keyIdentifier,
                nav = function (name) {
                    id = e.target.id;
                    document.getElementById(id).blur();

                    // Navigate in desired direction
                    vm[name]();
                    m.redraw();
                    // Set focus on the same cell we left
                    document.getElementById(id).focus();
                };

            switch (key) {
            case "Up":
            case "ArrowUp":
                nav("goPrevRow");
                break;
            case "Down":
            case "ArrowDown":
                nav("goNextRow");
                break;
            }
        };
        vm.onscroll = function (evt) {
            var ids = vm.ids(),
                e = evt.srcElement,
                remainScroll = e.scrollHeight - e.clientHeight - e.scrollTop,
                childHeight = e.lastChild.clientHeight,
                header = document.getElementById(ids.header),
                rows = document.getElementById(ids.rows);

            // Lazy load: fetch more rows if near bottom and more possible
            if (vm.isQuery()) {
                if (remainScroll < childHeight * ROW_COUNT && vm.models().length >= offset) {
                    offset = offset + LIMIT;
                    fetch();
                }
            }

            // Sync header position with table body position
            header.scrollLeft = rows.scrollLeft;
        };
        vm.refresh = function () {
            fetch(true);
        };
        vm.relations = stream({});
        vm.selectComponents = stream({});
        vm.save = function () {
            vm.models().save();
        };
        vm.scrollbarWidth = stream(scrWidth);
        vm.search = options.search || stream("");
        vm.select = function (models) {
            var state,
                selections = vm.selections(),
                ids = vm.selectionIds();

            if (!Array.isArray(models)) {
                if (selections.length !== 1 ||
                        selections[0].id() !== models.id()) {
                    vm.unselect(selections);
                }
                models = [models];
            }

            models.forEach(function (model) {
                if (ids.indexOf(model.id()) === -1) {
                    state = model.state().resolve("/Ready/Fetched/Dirty");
                    state.enter(selectionChanged);
                    state = model.state().resolve("/Delete");
                    state.enter(selectionChanged);
                    state = model.state().resolve("/Ready/Fetched/Clean");
                    state.enter(selectionFetched);

                    selections.push(model);
                }
            });

            vm.relations({});

            if (selections.length) {
                vm.state().send("selected");
            }

            return selections;
        };
        vm.selection = function () {
            return vm.selections()[0];
        };
        vm.selectionIds = function () {
            return vm.selections().map(function (selection) {
                return selection.id();
            });
        };
        vm.selections = stream([]);
        vm.selectedColor = function () {
            return vm.mode().selectedColor();
        };
        vm.state = stream();
        vm.toggleEdit = function () {
            vm.state().send("edit");
        };
        vm.toggleView = function () {
            vm.state().send("view");
        };
        vm.toggleMode = function () {
            vm.state().send("toggle");
        };
        vm.toggleSelection = function (model, id, optKey) {
            if (!vm.canToggle()) {
                return;
            }
            return vm.mode().toggleSelection(model, id, optKey);
        };
        vm.undo = function () {
            var selection = vm.selection();
            if (selection) {
                selection.undo();
            }
        };
        vm.unselect = function (models) {
            var idx, state,
                    ids = [],
                    selections = vm.selections(),
                    remaining = [];

            // Cache model ids if applicable
            if (models) {
                if (Array.isArray(models)) {
                    ids = models.map(function (model) {
                        return model.id();
                    });
                } else {
                    ids = [models.id()];
                    models = [models];
                }
            }

            // Make sure we're working with the exact same list of objects
            // (i.e. no mixup up of interal pointers)
            if (models) {
                models = selections.filter(function (selection) {
                    var isClearing = ids.some(function (id) {
                        return selection.id() === id;
                    });

                    if (!isClearing) {
                        remaining.push(selection);
                    }
                    return isClearing;
                });
            } else {
                models = selections.map(function (selection) {
                    return selection;
                });
            }

            // Remove old state bindings
            models.forEach(function (selection) {
                state = selection.state().resolve("/Ready/Fetched/Dirty");
                idx = state.enters.indexOf(selectionChanged);
                state.enters.splice(idx, 1);
                state = selection.state().resolve("/Delete");
                idx = state.enters.indexOf(selectionChanged);
                state.enters.splice(idx, 1);
                state = selection.state().resolve("/Ready/Fetched/Clean");
                idx = state.enters.indexOf(selectionFetched);
                state.enters.splice(idx, 1);
            });

            // Clear selections
            selections.length = 0;

            // Reapply selections we wanted to leave in tact
            if (remaining.length) {
                remaining.forEach(function (model) {
                    selections.push(model);
                });
                return;
            }

            vm.state().send("unselected");
        };
        vm.zoom = stream(100);

        // ..........................................................
        // PRIVATE
        //

        vm.filter(f.copy(options.config.filter || {}));
        vm.filter().limit = vm.filter().limit || LIMIT;
        if (!options.models) {
            vm.models = catalog.store().models()[modelName].list({
                subscribe: options.subscribe,
                filter: vm.filter()
            });
        }

        fetch = function (refresh) {
            var fattrs, formatOf, criterion,
                    value = vm.search(),
                    filter = f.copy(vm.filter());

            if (refresh) {
                offset = 0;
            }

            filter.offset = offset;

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

            vm.models().fetch(filter, refresh !== true);
        };

        selectionChanged = function () {
            vm.state().send("changed");
        };

        selectionFetched = function () {
            vm.state().send("fetched");
        };

        // Bind refresh to filter change event
        vm.filter.state().resolve("/Ready").enter(function () {
            vm.config().filter = vm.filter();
            vm.refresh();
        });

        // Create table widget statechart
        vm.state(statechart.define({
            concurrent: true
        }, function () {
            this.state("Mode", function () {
                this.state("View", function () {
                    this.event("edit", function () {
                        if (vm.isEditModeEnabled()) {
                            this.goto("../Edit");
                        }
                    });
                    this.event("toggle", function () {
                        if (vm.isEditModeEnabled()) {
                            this.goto("../Edit");
                        }
                    });
                    this.modelDelete = function () {
                        var confirmDialog = vm.confirmDialog();

                        confirmDialog.message("Are you sure you want to delete the selected rows?");
                        confirmDialog.onOk(function () {
                            var candidates = vm.selections().filter(function (selection) {
                                return selection.canDelete();
                            });

                            candidates.forEach(function (selection) {
                                return selection.delete(true)
                                    .then(function () {
                                        vm.unselect(selection);
                                        vm.models().remove(selection);
                                    })
                                    .catch(function (err) {
                                        vm.errorDialog().message(err.message);
                                        m.redraw();
                                        vm.errorDialog().show();
                                    });
                            });
                        });
                        confirmDialog.show();
                    };
                    this.modelNew = stream(false); // Do nothing
                    this.selectedColor = function () {
                        return "LightSkyBlue";
                    };
                    this.toggleSelection = function (model, id, optKey) {
                        var startIdx, endIdx, lastIdx, currentIdx,
                                i, models, modelIds, adds,
                                isSelected = vm.isSelected(model);

                        switch (optKey) {
                        case "ctrlKey":
                            if (isSelected) {
                                vm.unselect(model);
                                vm.lastSelected(undefined);
                                return;
                            }
                            vm.select([model]);
                            vm.lastSelected(model);
                            break;
                        case "shiftKey":
                            document.getSelection().removeAllRanges();
                            adds = [];
                            models = vm.models();
                            modelIds = vm.models().map(function (item) {
                                return item.id();
                            });
                            lastIdx = Math.max(modelIds.indexOf(vm.lastSelected().id()), 0);
                            currentIdx = modelIds.indexOf(model.id());

                            if (currentIdx > lastIdx) {
                                startIdx = lastIdx;
                                endIdx = currentIdx;
                            } else {
                                startIdx = currentIdx;
                                endIdx = lastIdx;
                            }

                            for (i = startIdx; i <= endIdx; i += 1) {
                                adds.push(models[i]);
                            }

                            vm.select(adds);
                            vm.lastSelected(model);
                            break;
                        default:
                            vm.unselect();
                            if (!isSelected) {
                                vm.select(model);
                                vm.lastSelected(model);
                            }
                        }

                        vm.nextFocus(id);
                        return true;
                    };
                });
                this.state("Edit", function () {
                    this.enter(function () {
                        var last;

                        if (vm.selections().length > 1) {
                            last = vm.lastSelected();
                            vm.unselect();
                            vm.select(last);
                        }
                    });
                    this.event("view", function () {
                        this.goto("../View");
                    });
                    this.event("toggle", function () {
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
                        var name = vm.feather().name.toCamelCase(),
                            model = catalog.store().models()[name](),
                            input = vm.defaultFocus(model);

                        vm.models().add(model);
                        vm.nextFocus(input);
                        vm.select(model);
                        return true;
                    };
                    this.selectedColor = function () {
                        return "Azure";
                    };
                    this.toggleSelection = function (model, id) {
                        vm.select(model);
                        vm.lastSelected(model);
                        vm.nextFocus(id);
                        return true;
                    };
                });
            });
            this.state("Selection", function () {
                this.event("selected", function () {
                    this.goto("./On", {
                        force: true
                    });
                });
                this.state("Off");
                this.state("On", function () {
                    this.event("unselected", function () {
                        this.goto("../Off");
                    });
                    this.C(function () {
                        if (vm.selection().canUndo()) {
                            return "./Dirty";
                        }
                        return "./Clean";
                    });
                    this.state("Clean", function () {
                        this.event("changed", function () {
                            this.goto("../Dirty");
                        });
                    });
                    this.state("Dirty", function () {
                        this.event("fetched", function () {
                            this.goto("../Clean");
                        });
                    });
                });
            });
        }));

        // Initialize statechart
        vm.state().goto();

        return vm;
    };

    // Define table widget component
    tableWidget.component = {

        oninit: function (vnode) {
            vnode.attrs.viewModel.canToggle(true);
        },

        view: function (vnode) {
            var findFilterIndex, header, rows, rel, resize,
                    vm = vnode.attrs.viewModel,
                    ids = vm.ids(),
                    config = vm.config(),
                    filter = vm.filter(),
                    sort = filter.sort || [],
                    idx = 0,
                    zoom = vm.zoom() + "%";

            // Resize according to surroundings
            resize = function (vnode) {
                var footer, containerHeight, bottomHeight, yPosition,
                        e = document.getElementById(vnode.dom.id),
                        id = vm.footerId();

                if (id) {
                    footer = document.getElementById(id);
                    e.style.height = window.innerHeight - f.getElementPosition(e.parentElement).y -
                            e.offsetTop - footer.offsetHeight - 1 + "px";
                } else {
                    yPosition = f.getElementPosition(e).y;
                    containerHeight = document.body.offsetHeight + f.getElementPosition(document.body).y;
                    bottomHeight = containerHeight - yPosition - e.offsetHeight;
                    e.style.height = window.innerHeight - yPosition - bottomHeight + "px";
                }
            };

            findFilterIndex = function (col, name) {
                name = name || "criteria";
                var hasCol,
                    ary = filter[name] || [],
                    i = 0;

                hasCol = function (item) {
                    if (item.property === col) {
                        return true;
                    }
                    i += 1;
                };

                if (ary.some(hasCol)) {
                    return i;
                }
                return false;
            };

            // Build header
            idx = 0;
            header = (function () {
                var ths = config.columns.map(function (col) {
                    var hview, order, name,
                            key = col.attr,
                            icon = [],
                            fidx = findFilterIndex(key, "sort"),
                            operators = f.operators,
                            columnWidth = config.columns[idx].width || COL_WIDTH_DEFAULT;

                    columnWidth = (columnWidth.replace("px", "") - 6) + "px";

                    // Add sort icons
                    if (fidx !== false) {
                        order = sort[fidx].order || "ASC";
                        if (order.toUpperCase() === "ASC") {
                            name = "fa fa-sort-asc";
                        } else {
                            name = "fa fa-sort-desc";
                        }

                        icon.push(m("i", {
                            class: name + " suite-column-sort-icon",
                            style: {
                                fontSize: zoom
                            }
                        }));

                        if (sort.length > 1) {
                            icon.push(m("span", {
                                class: "suite-column-sort-number",
                                style: {
                                    fontSize: vm.zoom() * 0.6 + "%"
                                }
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
                            style: {
                                fontSize: vm.zoom() * 0.80 + "%"
                            }
                        }));
                    }

                    hview = [
                        m("th", {
                            ondragover: vm.ondragover.bind(this, idx),
                            draggable: true,
                            ondragstart: vm.ondragstart.bind(this, idx, "column"),
                            ondrop: vm.ondrop.bind(this, idx, "column", config.columns),
                            class: "suite-column-header",
                            style: {
                                minWidth: columnWidth,
                                maxWidth: columnWidth,
                                fontSize: zoom
                            }
                        }, icon, col.label || vm.alias(key)),
                        m("th", {
                            ondragover: vm.ondragover.bind(this, idx),
                            draggable: true,
                            ondragstart: vm.ondragstart.bind(this, idx, "width"),
                            class: "suite-column-spacer suite-column-header-grabber",
                            style: {
                                fontSize: zoom
                            }
                        })
                    ];

                    idx += 1;

                    return hview;
                });

                // Front cap header navigation
                ths.unshift(m("th", {
                    style: {
                        minWidth: "25px",
                        fontSize: zoom
                    }
                }));

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
            idx = 0;
            rows = vm.models().map(function (model) {
                var tds, row, thContent, onclick, lock,
                        lastFocusId, ontab, onshifttab, url,
                        defaultFocusId = vm.defaultFocus(model),
                        currentMode = vm.mode().current()[0],
                        color = "White",
                        isSelected = vm.isSelected(model),
                        currentState = model.state().current()[0],
                        d = model.data,
                        rowOpts = {},
                        cellOpts = {};

                // Build row
                if (isSelected) {
                    color = vm.selectedColor();
                }

                // Build view row
                if (currentMode === "/Mode/View" || !isSelected) {
                    // Build cells
                    idx = 0;
                    tds = vm.attrs().map(function (col) {
                        var cell, content, curr, tdOpts,
                                symbol = "",
                                minorUnit = 2,
                                prop = f.resolveProperty(model, col),
                                value = prop(),
                                format = prop.format || prop.type,
                                columnWidth = config.columns[idx].width || COL_WIDTH_DEFAULT;

                        columnWidth = (columnWidth.replace("px", "") - 6) + "px";

                        tdOpts = {
                            onclick: function (ev) {
                                var optKey;
                                if (ev.shiftKey) {
                                    optKey = "shiftKey";
                                } else if (ev.ctrlKey) {
                                    optKey = "ctrlKey";
                                }
                                vm.toggleSelection(model, vm.formatInputId(col), optKey);
                            },
                            class: "suite-cell-view",
                            style: {
                                minWidth: columnWidth,
                                maxWidth: columnWidth,
                                fontSize: zoom
                            }
                        };

                        // Build cell
                        switch (format) {
                        case "number":
                        case "integer":
                            content = value.toLocaleString();
                            tdOpts.style.textAlign = "right";
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
                            value = value
                                ? new Date(value)
                                : "";
                            content = value
                                ? value.toLocaleString()
                                : "";
                            break;
                        case "url":
                            url = value.slice(0, 4) === "http"
                                ? value
                                : "http://" + value;
                            content = m("a", {
                                href: url,
                                target: "_blank",
                                onclick: function () {
                                    vm.canToggle(false);
                                }
                            }, value);
                            break;
                        case "string":
                            content = value;
                            break;
                        case "money":
                            curr = f.getCurrency(value.currency);
                            if (curr) {
                                if (curr.data.hasDisplayUnit()) {
                                    symbol = curr.data.displayUnit().data.symbol();
                                    minorUnit = curr.data.displayUnit().data.minorUnit();
                                } else {
                                    symbol = curr.data.symbol();
                                    minorUnit = curr.data.minorUnit();
                                }
                            }

                            content = value.amount.toLocaleString(undefined, {
                                minimumFractionDigits: minorUnit,
                                maximumFractionDigits: minorUnit
                            });

                            if (value.amount < 0) {
                                content = "(" + Math.abs(content) + ")";
                            }

                            content = symbol + content;

                            tdOpts.style.textAlign = "right";

                            break;
                        case "enum":
                            if (typeof prop.dataList[0] === "object") {
                                content = prop.dataList.find(function (item) {
                                    return item.value === value;
                                }).label;
                            }
                            break;
                        default:
                            if (typeof format === "object" && d[col]()) {
                                // If relation, use relation widget to find display
                                rel = catalog.store().components()[format.relation.toCamelCase() + "Relation"];
                                if (rel) {
                                    value = d[col]().data[rel.valueProperty()]();

                                    url = "http://" + window.location.hostname + ":" +
                                            window.location.port + "#!/edit/" +
                                            prop.type.relation.toSnakeCase() +
                                            "/" + d[col]().id();

                                    content = m("a", {
                                        href: url,
                                        onclick: function () {
                                            vm.canToggle(false);
                                        }
                                    }, value);
                                }
                            } else {
                                content = value;
                            }
                        }

                        cell = [
                            m("td", tdOpts, content),
                            // This exists to force exact alignment with header on all browsers
                            m("td", {
                                class: "suite-column-spacer",
                                style: {
                                    fontSize: zoom
                                }
                            })
                        ];

                        idx += 1;

                        return cell;
                    });

                    rowOpts = {
                        ondblclick: vm.ondblclick.bind(null, model)
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

                    lastFocusId = vm.lastFocus(model);
                    ontab = function (e) {
                        var key = e.key || e.keyIdentifier;
                        if (key === "Tab" && !e.shiftKey) {
                            e.preventDefault();
                            document.getElementById(defaultFocusId).focus();
                        }
                    };

                    onshifttab = function (e) {
                        var key = e.key || e.keyIdentifier;
                        if (key === "Tab" && e.shiftKey) {
                            e.preventDefault();
                            document.getElementById(lastFocusId).focus();
                        }
                    };

                    // Build cells
                    idx = 0;
                    tds = vm.attrs().map(function (col) {
                        var cell, tdOpts, inputOpts,
                                prop = f.resolveProperty(model, col),
                                id = vm.formatInputId(col),
                                item = config.columns[idx],
                                columnWidth = item.width || COL_WIDTH_DEFAULT,
                                dataList = item.dataList || prop.dataList,
                                cfilter = item.filter,
                                borderColor = "blue";

                        columnWidth = (columnWidth.replace("px", "") - 6) + "px";

                        inputOpts = {
                            id: id,
                            onclick: vm.toggleSelection.bind(this, model, id),
                            value: prop(),
                            style: {
                                minWidth: columnWidth,
                                maxWidth: columnWidth,
                                boxShadow: "none",
                                border: "none",
                                padding: "0px",
                                backgroundColor: color,
                                fontSize: zoom
                            },
                            isCell: true,
                            showCurrency: item.showCurrency
                        };

                        // Set up self focus
                        if (vm.nextFocus() === id && id === defaultFocusId) {
                            inputOpts.oncreate = function (vnode) {
                                var e = document.getElementById(vnode.dom.id);

                                e.addEventListener("keydown", onshifttab);
                                e.focus();
                            };
                            inputOpts.onremove = function (vnode) {
                                // Key down handler for up down movement
                                document.getElementById(vnode.dom.id)
                                    .removeEventListener("keydown", onshifttab);
                            };
                            vm.nextFocus(undefined);

                        } else if (vm.nextFocus() === id && id !== defaultFocusId) {
                            inputOpts.oncreate = function (vnode) {
                                document.getElementById(vnode.dom.id).focus();
                            };
                            vm.nextFocus(undefined);
                        } else if (id === defaultFocusId) {
                            inputOpts.oncreate = function (vnode) {
                                // Key down handler for up down movement
                                document.getElementById(vnode.dom.id)
                                    .addEventListener("keydown", onshifttab);
                            };

                            inputOpts.onremove = function (vnode) {
                                // Key down handler for up down movement
                                document.getElementById(vnode.dom.id)
                                    .removeEventListener("keydown", onshifttab);
                            };
                        }

                        // We want tab out of last cell to loop back to the first
                        if (lastFocusId === id) {
                            inputOpts.oncreate = function (vnode) {
                                // Key down handler for up down movement
                                document.getElementById(vnode.dom.id)
                                    .addEventListener("keydown", ontab);
                            };

                            inputOpts.onremove = function (vnode) {
                                // Key down handler for up down movement
                                document.getElementById(vnode.dom.id)
                                    .removeEventListener("keydown", ontab);
                            };
                        }

                        if (prop.isRequired && prop.isRequired() &&
                                (prop() === null || prop() === undefined)) {
                            borderColor = "red";
                            tdOpts = {
                                style: {
                                    borderColor: borderColor,
                                    borderWidth: "thin",
                                    borderStyle: "ridge",
                                    borderRight: "none"
                                }
                            };
                        } else {
                            tdOpts = {
                                style: {
                                    borderColor: borderColor,
                                    borderWidth: "thin",
                                    borderStyle: "solid",
                                    borderRight: "none"
                                }
                            };
                        }

                        tdOpts.style.minWidth = columnWidth;
                        tdOpts.style.maxWidth = columnWidth;
                        tdOpts.style.fontSize = zoom;

                        if (dataList) {
                            // If reference a property, get the property
                            if (typeof dataList === "string") {
                                dataList = f.resolveProperty(model, dataList)();

                            // Must referencoe a simple array, transform
                            } else if (typeof dataList[0] !== "object") {
                                dataList = dataList.map(function (item) {
                                    return {value: item, label: item};
                                });
                            }
                        }

                        cell = [
                            m("td", tdOpts, [
                                f.buildInputComponent({
                                    model: model,
                                    key: col,
                                    dataList: dataList,
                                    filter: cfilter,
                                    viewModel: vm,
                                    options: inputOpts
                                })
                            ]),
                            m("td", {
                                style: {
                                    borderStyle: "solid",
                                    borderColor: borderColor,
                                    borderWidth: "thin",
                                    fontSize: zoom
                                },
                                class: "suite-column-spacer"
                            })
                        ];

                        idx += 1;

                        return cell;
                    });
                }

                // Front cap header navigation
                onclick = vm.toggleSelection.bind(this, model, defaultFocusId);
                if (currentMode !== "/Mode/Edit" && isSelected) {
                    thContent = m("i", {
                        onclick: vm.ondblclick.bind(null, model),
                        class: "fa fa-folder-open",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else if (!model.isValid()) {
                    thContent = m("i", {
                        onclick: onclick,
                        title: model.lastError(),
                        class: "fa fa-warning",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else if (currentState === "/Locked") {
                    lock = d.lock() || {};
                    thContent = m("i", {
                        onclick: onclick,
                        title: "User: " + lock.username + "\x0ASince: " +
                                new Date(lock.created).toLocaleTimeString(),
                        class: "fa fa-lock",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else if (currentState === "/Delete") {
                    thContent = m("i", {
                        onclick: onclick,
                        class: "fa fa-remove",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else if (currentState === "/Ready/New") {
                    thContent = m("i", {
                        onclick: onclick,
                        class: "fa fa-plus",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else if (model.canUndo()) {
                    thContent = m("i", {
                        onclick: onclick,
                        class: "fa fa-pencil",
                        style: {
                            fontSize: zoom
                        }
                    });
                } else {
                    cellOpts = {
                        onclick: onclick,
                        style: {
                            minWidth: "25px",
                            fontSize: zoom
                        }
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
                rowOpts.style = {
                    backgroundColor: color
                };
                rowOpts.key = model.id();

                if (d.isDeleted()) {
                    row = m("del", m("tr", rowOpts, tds));
                } else {
                    row = m("tr", rowOpts, tds);
                }

                idx += 1;

                return row;
            });

            // Put a dummy row in to manage spacing correctly if none otherwise.
            if (!rows.length) {
                rows.push(m("tr", {
                    style: {
                        height: "50px"
                    }
                }));
            }

            return m("div", {
                class: "pure-form"
            }, [
                m(dialog.component, {
                    viewModel: vm.confirmDialog()
                }),
                m(dialog.component, {
                    viewModel: vm.errorDialog()
                }),
                m("table", {
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
                        oncreate: function (vnode) {
                            // Key down handler for up down movement
                            var e = document.getElementById(vnode.dom.id);
                            e.addEventListener("keydown", vm.onkeydown);
                            resize(vnode);
                        },
                        onupdate: resize,
                        onremove: function (vnode) {
                            // Key down handler for up down movement
                            var e = document.getElementById(vnode.dom.id);
                            e.removeEventListener("keydown", vm.onkeydown);
                        }
                    }, rows)
                ])
            ]);
        }
    };

    catalog.register("components", "tableWidget", tableWidget.component);
    module.exports = tableWidget;

}());