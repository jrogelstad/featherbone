/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
/*jslint this, for, browser*/
let scrWidth;
let inner;
let widthNoScroll;
let widthWithScroll;

import f from "../core.js";
import catalog from "../models/catalog.js";
import dialog from "./dialog.js";
import State from "../state.js";

const tableWidget = {};
const outer = document.createElement("div");
const COL_WIDTH_DEFAULT = "150";
const LIMIT = 20;
const ROW_COUNT = 2;
const m = window.m;

// Calculate scroll bar width
// http://stackoverflow.com/questions/13382516
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

function createTableDataEditor(options, col) {
    let config = options.config;
    let defaultFocusId = options.defaultFocusId;
    let model = options.model;
    let onshifttab = options.onshifttab;
    let ontab = options.ontab;
    let vm = options.vm;
    let zoom = options.zoom;
    let cell;
    let tdOpts;
    let inputOpts;
    let columnSpacerClass;
    let widget;
    let prop = f.resolveProperty(model, col);
    let id = vm.formatInputId(col);
    let item = config.columns[options.idx];
    let columnWidth = item.width || COL_WIDTH_DEFAULT;
    let dataList = item.dataList || prop.dataList;
    let cfilter = item.filter;

    columnWidth -= 6;

    inputOpts = {
        id: id,
        onclick: vm.toggleSelection.bind(this, model, id),
        value: prop(),
        style: {
            minWidth: columnWidth + "px",
            maxWidth: columnWidth + "px",
            fontSize: zoom
        },
        isCell: true,
        showCurrency: item.showCurrency
    };

    // Set up self focus
    if (vm.nextFocus() === id && id === defaultFocusId) {
        inputOpts.oncreate = function (vnode) {
            let e = document.getElementById(vnode.dom.id);

            e.addEventListener("keydown", onshifttab);
            e.focus();
        };
        inputOpts.onremove = function (vnode) {
            // Key down handler for up down movement
            document.getElementById(
                vnode.dom.id
            ).removeEventListener("keydown", onshifttab);
        };
        vm.nextFocus(undefined);

    } else if (
        vm.nextFocus() === id &&
        id !== defaultFocusId
    ) {
        inputOpts.oncreate = function (vnode) {
            document.getElementById(vnode.dom.id).focus();
        };
        vm.nextFocus(undefined);
    } else if (id === defaultFocusId) {
        inputOpts.oncreate = function (vnode) {
            // Key down handler for up down movement
            document.getElementById(
                vnode.dom.id
            ).addEventListener("keydown", onshifttab);
        };

        inputOpts.onremove = function (vnode) {
            // Key down handler for up down movement
            document.getElementById(
                vnode.dom.id
            ).removeEventListener("keydown", onshifttab);
        };
    }

    // We want tab out of last cell to loop back to
    // the first
    if (options.lastFocusId === id) {
        inputOpts.oncreate = function (vnode) {
            // Key down handler for up down movement
            document.getElementById(
                vnode.dom.id
            ).addEventListener("keydown", ontab);
        };

        inputOpts.onremove = function (vnode) {
            // Key down handler for up down movement
            document.getElementById(
                vnode.dom.id
            ).removeEventListener("keydown", ontab);
        };
    }

    if (
        prop.isRequired && prop.isRequired() && (
            prop() === null || prop() === undefined
        )
    ) {
        tdOpts = {
            class: (
                "fb-table-cell-edit " +
                "fb-table-cell-edit-cell " +
                "fb-table-cell-edit-required"
            ),
            style: {}
        };
    } else {
        tdOpts = {
            class: (
                "fb-table-cell-edit " +
                "fb-table-cell-edit-cell"
            ),
            style: {}
        };
    }

    tdOpts.style.minWidth = columnWidth + "px";
    tdOpts.style.maxWidth = columnWidth + "px";
    tdOpts.style.fontSize = zoom;

    if (dataList) {
        // If reference a property, get the property
        if (typeof dataList === "string") {
            dataList = model.data[dataList]();

        // Must referencoe a simple array, transform
        } else if (typeof dataList[0] !== "object") {
            dataList = dataList.map(function (item) {
                return {value: item, label: item};
            });
        }
    }

    columnSpacerClass = (
        "fb-column-spacer " + tdOpts.class
    );

    widget = vm.form().attrs.find(
        (item) => (
            item.attr === col && item.relationWidget
        )
    );
    if (widget) {
        widget = widget.relationWidget;
    }

    cell = [
        m("td", tdOpts, [
            f.buildInputComponent({
                model: model,
                key: col,
                dataList: dataList,
                filter: cfilter,
                viewModel: vm,
                options: inputOpts,
                widget: widget
            })
        ]),
        m("td", {
            style: {
                fontSize: zoom
            },
            class: columnSpacerClass
        })
    ];

    options.idx += 1;

    return cell;
}

function createTableDataView(options, col) {
    let vm = options.vm;
    let model = options.model;
    let config = options.config;
    let zoom = options.zoom;
    let onclick = options.onclick;
    let d = options.d;
    let url;
    let rel;
    let cell;
    let content;
    let curr;
    let tdOpts;
    let symbol = "";
    let minorUnit = 2;
    let prop = f.resolveProperty(options.model, col);
    let value = prop();
    let format = prop.format || prop.type;
    let columnWidth = (
        config.columns[options.idx].width || COL_WIDTH_DEFAULT
    );
    let du;
    let style = (
        prop.style
        ? prop.style()
        : ""
    );

    columnWidth -= 6;

    tdOpts = {
        onclick: function (ev) {
            let optKey;
            if (ev.shiftKey) {
                optKey = "shiftKey";
            } else if (ev.ctrlKey) {
                optKey = "ctrlKey";
            }
            vm.toggleSelection(
                model,
                vm.formatInputId(col),
                optKey
            );
        },
        class: "fb-cell-view",
        style: {
            minWidth: columnWidth + "px",
            maxWidth: columnWidth + "px",
            fontSize: zoom
        }
    };

    if (style) {
        style = f.getStyle(style);
        tdOpts.style.color = style.color;
        tdOpts.style.backgroundColor = style.backgroundColor;
        tdOpts.style.fontWeight = style.fontWeight;
        tdOpts.style.textDecoration = style.textDecoration;
    }

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
            // Turn into date adjusting time for
            // current timezone
            value = new Date(value + f.now().slice(10));
            content = value.toLocaleDateString();
        }
        break;
    case "dateTime":
        value = (
            value
            ? new Date(value)
            : ""
        );
        content = (
            value
            ? value.toLocaleString()
            : ""
        );
        break;
    case "url":
        url = (
            value.slice(0, 4) === "http"
            ? value
            : "http://" + value
        );
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
                du = curr.data.displayUnit();
                symbol = du.data.symbol();
                minorUnit = du.data.minorUnit();
            } else {
                symbol = curr.data.symbol();
                minorUnit = curr.data.minorUnit();
            }
        }

        content = value.amount.toLocaleString(
            undefined,
            {
                minimumFractionDigits: minorUnit,
                maximumFractionDigits: minorUnit
            }
        );

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
        } else {
            content = value;
        }
        break;
    case "dataType":
        if (typeof value === "object") {
            content = "relation: " + value.relation;
        } else {
            content = value;
        }
        break;
    case "icon":
        if (value) {
            content = m("i", {
                class: "fa fa-" + value
            });
        }
        break;
    case "color":
        if (value) {
            content = m("i", {
                style: {
                    color: value
                },
                class: "fa fa-square"
            });
        }
        break;
    default:
        if (typeof format === "object" && d[col]()) {
            // If relation, use feather natural key to
            // find value to display
            rel = catalog.getFeather(format.relation);
            rel = Object.keys(rel.properties).find(
                (key) => rel.properties[key].isNaturalKey
            );

            if (rel) {
                value = d[col]().data[rel]();

                url = (
                    window.location.protocol + "//" +
                    window.location.hostname + ":" +
                    window.location.port + "#!/edit/" +
                    prop.type.relation.toSnakeCase() +
                    "/" + d[col]().id()
                );

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
        // This exists to force exact alignment
        // with header on all browsers
        m("td", {
            class: "fb-column-spacer",
            style: {
                fontSize: zoom
            }
        })
    ];

    options.idx += 1;

    return cell;
}

// Helper function
function resolveDescription(feather, attr) {
    let prefix;
    let suffix;
    let idx = attr.indexOf(".");

    if (idx > -1) {
        prefix = attr.slice(0, idx);
        suffix = attr.slice(idx + 1, attr.length);
        feather = catalog.getFeather(
            feather.properties[prefix].type.relation
        );
        return resolveDescription(feather, suffix);
    }

    if (!feather.properties[attr]) {
        return "Unknown attribute '" + attr + "'";
    }

    return feather.properties[attr].description;
}

function createTableHeader(options, col) {
    let config = options.config;
    let filter = options.filter;
    let vm = options.vm;
    let sort = options.sort;
    let zoom = options.zoom;
    let hview;
    let order;
    let name;
    let key = col.attr;
    let icon = [];
    let fidx;
    let operators = f.operators;
    let columnWidth = (
        config.columns[options.idx].width || COL_WIDTH_DEFAULT
    );

    function findFilterIndex(col, name) {
        name = name || "criteria";
        let hasCol;
        let ary = filter[name] || [];
        let i = 0;

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
    }

    fidx = findFilterIndex(key, "sort");

    columnWidth -= 6;

    // Add sort icons
    if (fidx !== false) {
        order = sort[fidx].order || "ASC";
        if (order.toUpperCase() === "ASC") {
            name = "fa fa-sort-up";
        } else {
            name = "fa fa-sort-down";
        }

        icon.push(m("i", {
            class: name + " fb-column-sort-icon",
            style: {
                fontSize: zoom
            }
        }));

        if (sort.length > 1) {
            icon.push(m("span", {
                class: "fb-column-sort-number",
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
            class: "fa fa-filter fb-column-filter-icon",
            title: operators[
                (filter.criteria[fidx].operator || "=")
            ] + " " + filter.criteria[fidx].value,
            style: {
                fontSize: vm.zoom() * 0.80 + "%"
            }
        }));
    }

    hview = [
        m("th", {
            ondragover: vm.ondragover,
            draggable: true,
            ondragstart: vm.ondragstart.bind(
                null,
                options.idx,
                "column"
            ),
            ondrop: vm.ondrop.bind(
                null,
                options.idx,
                "column",
                config.columns
            ),
            class: "fb-column-header",
            style: {
                minWidth: columnWidth + "px",
                maxWidth: columnWidth + "px",
                fontSize: zoom
            },
            title: resolveDescription(options.feather, key)
        }, icon, col.label || vm.alias(key)),
        m("th", {
            ondragover: vm.ondragover,
            draggable: true,
            ondragstart: vm.ondragstart.bind(
                null,
                options.idx,
                "width"
            ),
            class: "fb-column-spacer fb-column-header-grabber",
            style: {
                fontSize: zoom
            }
        })
    ];

    options.idx += 1;

    return hview;
}

function createTableRow(options, model) {
    let config = options.config;
    let vm = options.vm;
    let zoom = options.zoom;
    let tds;
    let row;
    let thContent;
    let onclick;
    let lock;
    let iconStyle;
    let lastFocusId;
    let ontab;
    let onshifttab;
    let defaultFocusId = vm.defaultFocus(model);
    let currentMode = vm.mode().current()[0];
    let isSelected = vm.isSelected(model);
    let currentState = model.state().current()[0];
    let d = model.data;
    let rowOpts = {
        key: model.id()
    };
    let cellOpts = {};
    let rowClass;
    let style;

    // Build row
    if (isSelected) {
        rowClass = vm.selectedClass();
    }

    // Build view row
    if (currentMode === "/Mode/View" || !isSelected) {
        // Build cells
        tds = vm.attrs().map(createTableDataView.bind(null, {
            config: config,
            d: d,
            idx: 0,
            model: model,
            onclick: onclick,
            vm: vm,
            zoom: zoom
        }));

        rowOpts = {
            ondblclick: vm.ondblclick.bind(null, model)
        };

        // Apply any style business logic
        style = model.style();

        if (style) {
            style = f.getStyle(style);

            rowOpts.style = {
                color: style.color,
                fontWeight: style.fontWeight,
                textDecoration: style.textDecoration
            };

            if (!isSelected) {
                rowOpts.style.backgroundColor = style.backgroundColor;
            }
        }

        // Build editable row
    } else {
        cellOpts = {
            class: "fb-table-cell-edit"
        };

        lastFocusId = vm.lastFocus(model);
        ontab = function (e) {
            let key = e.key || e.keyIdentifier;
            if (key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                document.getElementById(defaultFocusId).focus();
            }
        };

        onshifttab = function (e) {
            let key = e.key || e.keyIdentifier;
            if (key === "Tab" && e.shiftKey) {
                e.preventDefault();
                document.getElementById(lastFocusId).focus();
            }
        };

        // Build cells
        tds = vm.attrs().map(createTableDataEditor.bind(null, {
            config: config,
            defaultFocusId: defaultFocusId,
            idx: 0,
            lastFocusId: lastFocusId,
            model: model,
            onshifttab: onshifttab,
            ontab: ontab,
            vm: vm,
            zoom: zoom
        }));
    }

    // Front cap header navigation
    onclick = vm.toggleSelection.bind(
        this,
        model,
        defaultFocusId
    );
    iconStyle = {
        fontSize: zoom,
        minWidth: "25px"
    };

    if (currentMode !== "/Mode/Edit" && isSelected) {
        thContent = m("i", {
            onclick: vm.ondblclick.bind(null, model),
            class: "fa fa-folder-open",
            style: iconStyle
        });
    } else if (!model.isValid()) {
        thContent = m("i", {
            onclick: onclick,
            title: model.lastError(),
            class: "fa fa-exclamation-triangle",
            style: iconStyle
        });
    } else if (currentState === "/Locked") {
        lock = d.lock() || {};
        thContent = m("i", {
            onclick: onclick,
            title: (
                "User: " + lock.username + "\nSince: " +
                new Date(lock.created).toLocaleTimeString()
            ),
            class: "fa fa-lock",
            style: iconStyle
        });
    } else if (currentState === "/Delete") {
        thContent = m("i", {
            onclick: onclick,
            class: "fa fa-trash",
            style: iconStyle
        });
    } else if (currentState === "/Ready/New") {
        thContent = m("i", {
            onclick: onclick,
            class: "fa fa-plus",
            style: iconStyle
        });
    } else if (model.canUndo()) {
        thContent = m("i", {
            onclick: onclick,
            class: "fa fa-pencil-alt",
            style: iconStyle
        });
    } else {
        cellOpts = {
            onclick: onclick,
            style: iconStyle
        };
        if (currentMode === "/Mode/Edit" && isSelected) {
            cellOpts.class = (
                "fb-table-cell-edit fb-table-cell-edit-header"
            );
        }
    }
    tds.unshift(m("th", cellOpts, thContent));

    // Build row
    rowOpts.class = rowClass;
    rowOpts.key = model.id();

    if (d.isDeleted()) {
        row = m("del", m("tr", rowOpts, tds));
    } else {
        row = m("tr", rowOpts, tds);
    }

    options.idx += 1;

    return row;
}

// Resize according to surroundings
function resize(vm, vnode) {
    let footer;
    let containerHeight;
    let bottomHeight;
    let yPosition;
    let e = document.getElementById(vnode.dom.id);
    let id = vm.footerId();
    let height;

    if (id) {
        footer = document.getElementById(id);
        e.style.height = (
            window.innerHeight -
            f.getElementPosition(e.parentElement).y -
            e.offsetTop - footer.offsetHeight - 1 + "px"
        );
    } else {
        yPosition = f.getElementPosition(e).y;
        containerHeight = (
            document.body.offsetHeight +
            f.getElementPosition(document.body).y
        );
        bottomHeight = (
            containerHeight - yPosition - e.offsetHeight
        );
        height = window.innerHeight - yPosition - 32;

        if (height < 150) {
            height = 150;
        }

        e.style.height = height + "px";
    }
}

// Define workbook view model
tableWidget.viewModel = function (options) {
    options = options || {};
    let fromWidthIdx;
    let dataTransfer;
    let selectionChanged;
    let selectionFetched;
    let fetch;
    let feather = (
        typeof options.feather === "object"
        ? options.feather
        : catalog.getFeather(options.feather)
    );
    let modelName = feather.name.toCamelCase();
    let offset = 0;
    let vm = {};

    // ..........................................................
    // PUBLIC
    //

    vm.alias = function (attr) {
        return f.resolveAlias(vm.feather(), attr);
    };
    vm.attrs = function () {
        let columns = vm.config().columns;
        let result = columns.map(function (column) {
            return column.attr;
        });

        return result || [{
            attr: "id"
        }];
    };
    vm.canToggle = f.prop(true);
    vm.isEditModeEnabled = f.prop(options.isEditModeEnabled !== false);
    vm.isQuery = f.prop(true);
    vm.config = f.prop(options.config);
    vm.footerId = f.prop(options.footerId);
    vm.confirmDialog = f.prop(dialog.viewModel({
        icon: "question-circle",
        title: "Confirmation"
    }));
    /*
      Return the id of the input element which can recive focus

      @param {Object} Model to evaluate
      @return {String}
    */
    vm.defaultFocus = function (model) {
        let col = vm.attrs().find(function (attr) {
            return !model.data[attr] || !model.data[attr].isReadOnly();
        });

        return (
            col
            ? vm.formatInputId(col)
            : undefined
        );
    };
    vm.errorDialog = f.prop(dialog.viewModel({
        icon: "exclamation-triangle",
        title: "Error"
    }));
    vm.feather = f.prop(feather);
    vm.filter = f.prop();
    vm.form = function () {
        return f.getForm({
            form: vm.config().form,
            feather: feather.name
        });
    };
    vm.formatInputId = function (col) {
        return "input" + col.toCamelCase(true);
    };
    vm.goNextRow = function () {
        let list = vm.models();
        let ids = list.map(function (model) {
            return model.id();
        });
        let model = vm.model();
        let idx = (
            model
            ? ids.indexOf(model.id()) + 1
            : 0
        );

        if (list.length > idx) {
            vm.select(list[idx]);
        }
    };
    vm.goPrevRow = function () {
        let list = vm.models();
        let model = vm.model();
        let idx = list.indexOf(model) - 1;

        if (idx >= 0) {
            vm.select(list[idx]);
        }
    };
    vm.ids = f.prop({
        header: f.createId(),
        rows: f.createId()
    });
    vm.isDragging = f.prop(false);
    vm.isScrolling = f.prop(false);
    vm.isSelected = function (model) {
        return vm.selectionIds().indexOf(model.id()) > -1;
    };
    /*
      Return the name of the last attribute which can recive focus.

      @param {Object} Model to evaluate
      @returns {String}
    */
    vm.lastFocus = function (model) {
        let col;
        let attrs = vm.attrs().slice().reverse();

        col = attrs.find(function (attr) {
            return model.data[attr] && !model.data[attr].isReadOnly();
        });
        return (
            col
            ? vm.formatInputId(col)
            : undefined
        );
    };
    /*
      Set or return the last model that was selected in the list.

      @param {Object} Model selected
      @returns {Object} Last model selected
    */
    vm.lastSelected = f.prop();
    vm.mode = function () {
        let state = vm.state();
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
    vm.models = f.prop(options.models);
    vm.nextFocus = f.prop();
    vm.ondblclick = function (model) {
        vm.select(model);
        if (options.ondblclick) {
            options.ondblclick();
        }
    };
    vm.ondragover = function (ev) {
        ev.preventDefault();
    };
    vm.ondragstart = function (idx, type, ev) {
        vm.isDragging(true);

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
        let moved;
        let column;
        let fromIdx;
        let oldWidth;
        let newWidth;
        let widthStart;
        let typeStart = dataTransfer.typeStart;

        vm.isDragging(false);

        ev.preventDefault();

        switch (typeStart) {
        case "width":
            if (fromWidthIdx <= toIdx) {
                widthStart = dataTransfer.widthStart - 0;
                column = vm.config().columns[fromWidthIdx];
                oldWidth = column.width || COL_WIDTH_DEFAULT;
                newWidth = oldWidth - (widthStart - ev.clientX);
                column.width = newWidth;
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
        let id;
        let key = e.key || e.keyIdentifier;

        function nav(name) {
            id = e.target.id;
            document.getElementById(id).blur();

            // Navigate in desired direction
            vm[name]();
            m.redraw();
            // Set focus on the same cell we left
            document.getElementById(id).focus();
        }

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
        let ids = vm.ids();
        let e = evt.srcElement;
        let remainScroll = e.scrollHeight - e.clientHeight - e.scrollTop;
        let childHeight = e.lastChild.clientHeight;
        let header = document.getElementById(ids.header);
        let rows = document.getElementById(ids.rows);

        // Lazy load: fetch more rows if near bottom and more possible
        if (vm.isQuery()) {
            if (
                remainScroll < childHeight *
                ROW_COUNT && vm.models().length >= offset
            ) {
                offset = offset + LIMIT;
                fetch();
                return;
            }
        }

        // Sync header position with table body position
        header.scrollLeft = rows.scrollLeft;

        // No need to redraw
        vm.isScrolling(true);
    };
    vm.refresh = function () {
        fetch(true);
    };
    vm.relations = f.prop({});
    vm.selectComponents = f.prop({});
    vm.save = function () {
        vm.models().save();
    };
    vm.scrollbarWidth = f.prop(scrWidth);
    vm.search = options.search || f.prop("");
    vm.select = function (models) {
        let state;
        let selections = vm.selections();
        let ids = vm.selectionIds();

        if (!Array.isArray(models)) {
            if (
                selections.length !== 1 ||
                models === undefined ||
                selections[0].id() !== models.id()
            ) {
                vm.unselect(selections);
            }
            models = (
                models === undefined
                ? []
                : [models]
            );
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
    vm.selections = f.prop([]);
    vm.selectedClass = function () {
        return vm.mode().selectedClass();
    };
    vm.state = f.prop();
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
        let selection = vm.selection();

        if (selection) {
            selection.undo();
        }
    };
    vm.unselect = function (models) {
        let idx;
        let state;
        let ids = [];
        let selections = vm.selections();
        let remaining = [];

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
                let isClearing = ids.some(function (id) {
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
    vm.zoom = f.prop(100);

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
        let fattrs;
        let formatOf;
        let criterion;
        let value = vm.search();
        let filter = f.copy(vm.filter());

        if (refresh) {
            offset = 0;
        }

        filter.offset = offset;

        // Recursively resolve type
        formatOf = function (feather, property) {
            let prefix;
            let suffix;
            let rel;
            let prop;
            let idx = property.indexOf(".");

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
    vm.state(State.define({
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
                    let confirmDialog = vm.confirmDialog();

                    confirmDialog.message(
                        "Are you sure you want to delete the " +
                        "selected rows?"
                    );
                    confirmDialog.onOk(function () {
                        let candidates = vm.selections().filter(
                            function (selection) {
                                return selection.canDelete();
                            }
                        );

                        candidates.forEach(function (selection) {
                            return selection.delete(
                                true
                            ).then(
                                function () {
                                    vm.unselect(selection);
                                    vm.models().remove(selection);
                                }
                            ).catch(
                                function (err) {
                                    vm.errorDialog().message(err.message);
                                    m.redraw();
                                    vm.errorDialog().show();
                                }
                            );
                        });
                    });
                    confirmDialog.show();
                };
                this.modelNew = f.prop(false); // Do nothing
                this.selectedClass = function () {
                    return "fb-table-row-selected";
                };
                this.toggleSelection = function (model, id, optKey) {
                    let startIdx;
                    let endIdx;
                    let lastIdx;
                    let currentIdx;
                    let i;
                    let models;
                    let modelIds;
                    let adds;
                    let isSelected = vm.isSelected(model);

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
                        lastIdx = Math.max(modelIds.indexOf(
                            vm.lastSelected().id()
                        ), 0);
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
                    let last;

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
                    let selection = vm.selection();
                    let prevState = selection.state().current()[0];

                    selection.delete();
                    if (prevState === "/Ready/New") {
                        vm.models().remove(selection);
                    }
                };
                this.modelNew = function () {
                    let name = vm.feather().name.toCamelCase();
                    let model = catalog.store().models()[name]();
                    let input = vm.defaultFocus(model);

                    vm.models().add(model);
                    vm.nextFocus(input);
                    vm.select(model);
                    return true;
                };
                this.selectedClass = function () {
                    return "fb-table-row-editor";
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
                this.c = this.C; // Squelch jslint complaint
                this.c(function () {
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

    // Block redrawing where unneccessary to improve performance
    onbeforeupdate: function (vnode) {
        let vm = vnode.attrs.viewModel;
        let isDragging = vm.isDragging();
        let isScrolling = vm.isScrolling();

        if (isScrolling) {
            vm.isScrolling(false); // Reset
        }

        if (isDragging || isScrolling) {
            return false; // Don't redraw
        }
    },

    view: function (vnode) {
        let header;
        let rows;
        let vm = vnode.attrs.viewModel;
        let ids = vm.ids();
        let config = vm.config();
        let filter = vm.filter();
        let sort = filter.sort || [];
        let zoom = vm.zoom() + "%";
        let feather = vm.feather();

        // Build header
        header = (function () {
            let ths = config.columns.map(createTableHeader.bind(null, {
                config: config,
                feather: feather,
                filter: filter,
                idx: 0,
                sort: sort,
                vm: vm,
                zoom: zoom
            }));

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
        rows = vm.models().map(createTableRow.bind(null, {
            config: config,
            idx: 0,
            vm: vm,
            zoom: zoom
        }));

        // Put a dummy row in to manage spacing correctly if
        // none otherwise.
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
                class: "pure-table fb-table"
            }, [
                m("thead", {
                    id: ids.header,
                    class: "fb-table-header"
                }, [header]),
                m("tbody", {
                    id: ids.rows,
                    class: "fb-table-body",
                    onscroll: vm.onscroll,
                    oncreate: function (vnode) {
                        // Key down handler for up down movement
                        let e = document.getElementById(vnode.dom.id);
                        e.addEventListener("keydown", vm.onkeydown);
                        resize(vm, vnode);
                    },
                    onupdate: resize.bind(null, vm),
                    onremove: function (vnode) {
                        // Key down handler for up down movement
                        let e = document.getElementById(vnode.dom.id);
                        e.removeEventListener("keydown", vm.onkeydown);
                    }
                }, rows)
            ])
        ]);
    }
};

catalog.register("components", "tableWidget", tableWidget.component);

export default Object.freeze(tableWidget);