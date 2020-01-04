/*
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
*/
/*jslint this, for, browser*/
/**
    @module TableWidget
*/
let scrWidth;
let inner;
let widthNoScroll;
let widthWithScroll;

import f from "../core.js";

/*
    @class tableWidget
*/
const catalog = f.catalog();
const datasource = f.datasource();
const tableWidget = {};
const outer = document.createElement("div");
const COL_WIDTH_DEFAULT = "150";
const LIMIT = 20;
const ROW_COUNT = 2;
const FETCH_MAX = 3;
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

function handleStyle(style, tdOpts) {
    if (style) {
        style = f.getStyle(style);
        tdOpts.style.color = style.color;
        tdOpts.style.backgroundColor = style.backgroundColor;
        tdOpts.style.fontWeight = style.fontWeight;
        tdOpts.style.textDecoration = style.textDecoration;
    }
}

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
    let style = (
        prop.style
        ? prop.style()
        : ""
    );

    columnWidth -= 6;

    inputOpts = {
        id: id,
        key: id,
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
            let e = document.getElementById(vnode.dom.id);
            // Key down handler for up down movement
            if (e) {
                e.removeEventListener("keydown", onshifttab);
            }
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
            let e = document.getElementById(vnode.dom.id);

            // Key down handler for up down movement
            if (e) {
                e.removeEventListener("keydown", onshifttab);
            }
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
            let e = document.getElementById(vnode.dom.id);
            // Key down handler for up down movement
            if (e) {
                e.removeEventListener("keydown", ontab);
            }
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

    handleStyle(style, tdOpts);

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
            f.createEditor({
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
    let cell;
    let content;
    let tdOpts;
    let tableData;
    let prop = f.resolveProperty(options.model, col);
    let value = prop();
    let format = prop.format || prop.type;
    let columnWidth = (
        config.columns[options.idx].width || COL_WIDTH_DEFAULT
    );
    let style = (
        prop.style
        ? prop.style()
        : ""
    );
    let relation;
    let id = options.model.id() + "-" + options.idx;

    columnWidth -= 6;

    tdOpts = {
        key: id + "-data",
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

    handleStyle(style, tdOpts);

    // Build cell
    if (typeof format === "object" && d[col]()) {
        relation = prop.type.relation.toCamelCase();
        if (f.types[relation] && f.types[relation].tableData) {
            tableData = f.types[relation].tableData;
        } else {
            tableData = function () {
                let rel;
                let keys;

                // If relation, use feather natural key to
                // find value to display
                rel = catalog.getFeather(format.relation);
                keys = Object.keys(rel.properties);
                rel = (
                    keys.find((key) => rel.properties[key].isNaturalKey) ||
                    keys.find((key) => rel.properties[key].isLabelKey)
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

                    return m("a", {
                        href: url,
                        onclick: function (e) {
                            vm.canToggle(false);
                            e.preventDefault();
                            m.route.set("/edit/:feather/:key", {
                                feather: prop.type.relation.toSnakeCase(),
                                key: d[col]().id()
                            }, {
                                state: {}
                            });
                        }
                    }, value);
                }
            };
        }
    } else if (prop.format && f.formats()[prop.format].tableData) {
        tableData = f.formats()[prop.format].tableData;
    } else if (f.types[prop.type] && f.types[prop.type].tableData) {
        tableData = f.types[prop.type].tableData;
    } else {
        tableData = (obj) => obj.value;
    }

    content = tableData({
        value: value,
        options: tdOpts,
        viewModel: vm,
        prop: prop,
        onclick: onclick
    });

    cell = [
        m("td", tdOpts, content),
        // This exists to force exact alignment
        // with header on all browsers
        m("td", {
            key: id + "-spcr",
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
            zoom: zoom,
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
            class: "fa fa-folder-open fb-icon-button",
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
            class: "fa fa-user-lock",
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

function resolveFeatherProp(feather, attr) {
    let prefix;
    let suffix;

    let idx = attr.indexOf(".");

    if (idx > -1) {
        prefix = attr.slice(0, idx);
        if (feather.properties[prefix].format === "money") {
            return feather.properties[prefix];
        }
        suffix = attr.slice(idx + 1, attr.length);
        feather = catalog.getFeather(
            feather.properties[prefix].type.relation
        );
        return resolveFeatherProp(feather, suffix);
    }

    return feather.properties[attr];
}

function createTableFooter(options, col) {
    let fview;
    let config = options.config;
    let vm = options.vm;
    let values = vm.aggregateValues() || {};
    let zoom = options.zoom;
    let columnWidth = (
        config.columns[options.idx].width || COL_WIDTH_DEFAULT
    );
    let value;
    let prop = resolveFeatherProp(options.feather, col.attr);
    let agg = vm.aggregates().find((a) => a.property === col.attr);
    let tableData;
    let content = "";
    let attr = col.attr;

    if (
        prop.format === "money" &&
        !(agg && agg.method === "COUNT")
    ) {
        attr += ".amount";
    }

    if (values[attr] !== undefined && values[attr] !== null) {
        value = values[attr];
    } else {
        value = "";
    }

    if (value !== "") {
        if (agg && agg.method === "COUNT") {
            tableData = f.types.integer.tableData;
        } else {
            if (prop.format === "date") {
                tableData = f.formats().date.tableData;
            } else if (prop.format == "dateTime") {
                tableData = f.formats().dateTime.tableData;
            } else if (prop.type === "string") {
                tableData = f.types.string.tableData;
            } else if (prop.format === "money") {
                tableData = f.formats().money.tableData;
            } else {
                tableData = f.types.number.tableData;
            }
        }

        content = tableData({
            options: {
                title: "",
                style: {}
            },
            value: value
        });
    }

    columnWidth -= 6;

    fview = [
        m("th", {
            class: "fb-column-footer",
            style: {
                minWidth: columnWidth + "px",
                maxWidth: columnWidth + "px",
                fontSize: zoom
            }
        }, content),
        m("th", {
            class: (
                "fb-column-spacer fb-column-header-grabber " +
                "fb-column-footer"
            ),
            style: {
                fontSize: zoom
            }
        })
    ];

    options.idx += 1;

    return fview;
}

// Resize according to surroundings
function resize(vm, vnode) {
    let pageFooter;
    let yPosition;
    let e = document.getElementById(vnode.dom.id);
    let id = vm.footerId();
    let height = vm.height();
    let tableFooter = document.getElementById(vm.ids().footer);
    let tfootHeight = (
        tableFooter
        ? tableFooter.offsetHeight + 1
        : 0
    );

    if (height) {
        e.style.height = height;
        return;
    }

    if (id) {
        pageFooter = document.getElementById(id);
        e.style.height = (
            window.innerHeight -
            f.getElementPosition(e.parentElement).y -
            e.offsetTop - pageFooter.offsetHeight - tfootHeight - 1 + "px"
        );
    } else {
        yPosition = f.getElementPosition(e.offsetParent).y;
        height = window.innerHeight - yPosition - 82;

        if (height < 150) {
            height = 150;
        }

        e.style.height = height + "px";
    }
}

/**
    View model for viewing and editing model lists.
    @class TableWidget
    @constructor
    @namespace ViewModels
    @param {Object} Options
    @param {Array} [options.actions] Actions
    @param {Object|String} options.feather Feather
    @param {Object} options.config Configuration
    @param {Array} [options.models] Array of models
    @param {String} [options.height] Fixed height. If none automatic
    @param {String} [options.containerId] Container id for automatic resize
    @param {String} [options.footerId] Footer id for automatic resize
*/
tableWidget.viewModel = function (options) {
    options = options || {};
    let fromWidthIdx;
    let dataTransfer;
    let feather = (
        typeof options.feather === "object"
        ? options.feather
        : catalog.getFeather(options.feather)
    );
    let modelName = feather.name.toCamelCase();
    let modelConstructor = catalog.store().models()[modelName];
    let offset = 0;
    let dlgSelectId = f.createId();
    let dlgSelectedId = f.createId();
    let dlgVisibleId = f.createId();
    let vm = {};
    let isEditModeEnabled = f.prop(options.isEditModeEnabled !== false);
    let fetchCount = 0;

    options.config.aggregates = options.config.aggregates || [];

    function doDownload(target, source) {
        let element = document.createElement("a");

        element.setAttribute("href", source + "/" + target);
        element.setAttribute("download", source);
        element.style.display = "none";

        document.body.appendChild(element);

        element.click();

        document.body.removeChild(element);
    }

    function doImport() {
        let input = document.createElement("input");
        let dlg = vm.confirmDialog();

        function callback(resp) {
            let target = "error_log_" + f.now() + ".json";

            if (resp) {
                dlg.message(
                    "One or more errors were encountered during import. " +
                    "Would you like to download the log?"
                );
                dlg.title("Error");
                dlg.icon("window-close");
                dlg.onOk(doDownload.bind(null, target, resp));
                dlg.show();
            }
            vm.refresh();
        }

        function error(err) {
            if (err.response !== null) {
                dlg.message(err.message);
                dlg.title("Error");
                dlg.icon("window-close");
                dlg.buttonCancel().hide();
                dlg.show();
            }
        }

        function processFile() {
            let file = input.files[0];
            let formData = new FormData();
            let format = file.name.slice(
                file.name.indexOf(".") + 1,
                file.name.length
            );
            let name = file.name.slice(0, file.name.indexOf("."));
            let feathers = catalog.feathers();
            let payload;

            if (name.indexOf(" ") !== -1) {
                name = name.slice(0, name.indexOf(" "));
            }

            if (format !== "ods" && format !== "json" && format !== "xlsx") {
                error(new Error(
                    "Unrecognized file format \"" + format + "\""
                ));
                return;
            }

            if (!Object.keys(feathers).some(
                (key) => feathers[key].plural === name
            )) {
                error(new Error(
                    "Unrecognized data type name \"" + name + "\""
                ));
                return;
            }

            formData.append("import", file);
            payload = {
                method: "POST",
                path: "/do/import/" + format + "/" + name,
                body: formData
            };

            datasource.request(payload).then(callback).catch(error);
        }

        input.setAttribute("type", "file");
        input.setAttribute("accept", ".json,.ods,.xlsx");
        input.onchange = processFile;
        input.click();
    }

    function getFilter(p) {
        let fattrs = [];
        let criterion;
        let value = vm.search();
        let filter = f.copy(vm.filter());

        filter.offset = p || 0;
        filter.limit = LIMIT;

        // Recursively resolve type
        function formatOf(feather, property) {
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
        }

        // Only search on text attributes
        if (value) {
            vm.attrs().forEach(function (attr) {
                let theFeather = vm.feather();
                let fmt = formatOf(theFeather, attr);
                let nk;
                let props;

                if (fmt === "string") {
                    fattrs.push(attr);
                } else if (
                    typeof fmt === "object" &&
                    !fmt.childOf
                ) {
                    props = catalog.getFeather(fmt.relation).properties;
                    nk = Object.keys(props).find(
                        (key) => props[key].isNaturalKey
                    );
                    if (nk) {
                        fattrs.push(attr + "." + nk);
                    }
                }
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

        return filter;
    }

    function doExport() {
        let dlg = vm.confirmDialog();
        let isOnlyVisible = f.prop(true);
        let isOnlySelected = f.prop(false);
        let format = f.prop("xlsx");
        let chkbox = f.getComponent("Checkbox");

        function error(err) {
            dlg.message(err.message);
            dlg.title("Error");
            dlg.icon("window-close");
            dlg.buttonCancel().hide();
            dlg.show();
        }

        function onOk() {
            let url;
            let payload;
            let body = {};
            let plural = vm.feather().plural || vm.feather().name;

            if (isOnlyVisible()) {
                body.properties = vm.config().columns.map((col) => col.attr);
            }

            body.filter = getFilter();
            delete body.filter.limit;

            if (isOnlySelected()) {
                body.filter.criteria = [{
                    property: "id",
                    operator: "IN",
                    value: vm.selections().map((item) => item.id())
                }];
            }

            url = "/do/export/" + format() + "/" + plural;
            payload = {
                method: "POST",
                url: url,
                body: body
            };

            return m.request(payload).then(
                doDownload.bind(null, plural + "." + format())
            ).catch(error);
        }

        dlg.content = function () {
            return m("div", {
                class: "pure-form pure-form-aligned"
            }, [
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: dlgSelectId
                    }, "Format:"),
                    m("select", {
                        id: dlgSelectId,
                        onchange: (e) => format(e.target.value),
                        value: format()
                    }, [
                        m("option", {
                            value: "xlsx"
                        }, "Excel 2007+ XML Format (xlsx)"),
                        m("option", {
                            value: "ods"
                        }, "Open Document Spreadsheet (ods)"),
                        m("option", {
                            value: "json"
                        }, "JavaScript Object Notation (json)")
                    ])
                ]),
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: dlgSelectedId
                    }, "Only selected rows:"),
                    m(chkbox, {
                        onclick: function (value) {
                            isOnlySelected(value);
                        },
                        value: isOnlySelected(),
                        readonly: vm.selections().length === 0,
                        title: (
                            vm.selections().length === 0
                            ? "No selections to export"
                            : ""
                        )
                    })
                ]),
                m("div", {
                    class: "pure-control-group"
                }, [
                    m("label", {
                        for: dlgVisibleId
                    }, "Only visible columns:"),
                    m(chkbox, {
                        onclick: function (value) {
                            isOnlyVisible(value);
                        },
                        value: isOnlyVisible()
                    })
                ])
            ]);
        };

        dlg.title("Export data");
        dlg.icon("file-export");
        dlg.onOk(onOk);
        dlg.style({
            width: "550px"
        });
        dlg.show();
    }

    function setProperties() {
        let list = vm.models();
        let props;
        let fp = vm.feather().properties;

        if (!vm.isEditModeEnabled()) {
            props = vm.config().columns.map((col) => col.attr);
            // Exclude calculated columns
            props = props.filter((p) => fp[p] && !fp[p].isCalculated);
            if (props.indexOf("id") === -1) {
                props.unshift("id");
            }
            list.properties(props);
        } else {
            list.properties(undefined);
        }
    }

    function doFetchAggregates() {
        let url;
        let payload;
        let aggregates = vm.aggregates();
        let body = {
            name: vm.feather().name,
            aggregations: aggregates,
            filter: f.copy(getFilter())
        };

        // Map keys back to something readable
        function callback(resp) {
            let aggs = {};
            let i = 0;
            let props = aggregates.map((a) => a.property);
            let keys;
            let values = resp.result;

            if (values === null) {
                vm.aggregateValues({});
				return;
	        }

            // Format consistently whether one or many
            if (typeof values === "number") {
                values = {
                    f1: values
                };
            }

            keys = Object.keys(values);

            props.forEach(function (p) {
                let val = values[keys[i]] || 0;
                let prop = resolveFeatherProp(vm.feather(), p);

                if (
                    prop.format === "money" &&
                    aggregates[i].method !== "COUNT"
                ) {
                    val = f.money(val); // Hack, what if mixed currency?
                }
                aggs[p] = val;

                i += 1;
            });

            vm.aggregateValues(aggs);
        }

        // If nothing to calculate, bail
        if (!body.aggregations.length) {
            return;
        }

        delete body.filter.limit;
        delete body.filter.sort;
        delete body.filter.offset;

        url = "/do/aggregate";
        payload = {
            method: "POST",
            url: url,
            body: body
        };

        return m.request(payload).then(callback);
    }

    function doFetch(refresh) {
        if (refresh) {
            doFetchAggregates();
            offset = 0;
            fetchCount = 0;
        }

        fetchCount += 1;
        setProperties();
        vm.models().fetch(
            getFilter(offset),
            refresh !== true
        ).then(function () {
            if (fetchCount < FETCH_MAX) {
                offset += LIMIT;
                doFetch();
            }
        });
    }

    // Dialog gets modified by actions, so reset after any useage
    function doResetDialog() {
        let dlg = vm.confirmDialog();

        dlg.icon("question-circle");
        dlg.title("Confirmation");
        dlg.buttonOk().show();
        dlg.buttonCancel().show();
        dlg.buttonCancel().isPrimary(false);
        dlg.onOk(undefined);
        dlg.onCancel(undefined);
        dlg.content = function () {
            return m("div", {
                id: dlg.ids().content
            }, dlg.message());
        };
        dlg.buttons([
            dlg.buttonOk,
            dlg.buttonCancel
        ]);
    }

    function selectionChanged() {
        vm.state().send("changed");
    }

    function selectionFetched() {
        vm.state().send("fetched");
    }

    // ..........................................................
    // PUBLIC
    //

    /**
        @method actions
        @return {Array}
    */
    vm.actions = function () {
        let menu;
        let actions = options.actions || [];
        let selections = vm.selections();
        let o;

        menu = actions.map(function (action) {
            let opts;
            let actionIcon;
            let method = modelConstructor.static()[action.method];

            action.id = action.id || f.createId();

            opts = {
                id: "nav-actions-" + action.id,
                class: "pure-menu-link",
                title: action.title
            };

            if (
                action.validator &&
                !modelConstructor.static()[action.validator](selections)
            ) {
                opts.class = "pure-menu-link pure-menu-disabled";
            } else {
                opts.onclick = method.bind(null, vm);
            }

            if (action.hasSeparator) {
                opts.class += " fb-menu-list-separator";
            }

            if (action.icon) {
                actionIcon = [m("i", {
                    id: "nav-actions-" + action.id + "-icon",
                    class: "fa fa-" + action.icon + " fb-menu-list-icon"
                })];
            }

            return m("li", opts, actionIcon, action.name);
        });

        o = {
            id: "nav-actions-import",
            class: "pure-menu-link",
            title: "Import data",
            onclick: doImport
        };

        if (menu.length) {
            o.class += " fb-menu-list-separator";
        }

        menu.push(
            m("li", o, [m("i", {
                id: "nav-actions-import-icon",
                class: "fa fa-file-import fb-menu-list-icon"
            })], "Import")
        );

        menu.push(
            m("li", {
                id: "nav-actions-export",
                class: "pure-menu-link",
                title: "Export data",
                onclick: doExport
            }, [m("i", {
                id: "nav-actions-export-icon",
                class: "fa fa-file-export fb-menu-list-icon"
            })], "Export")
        );

        return menu;
    };
    /**
        @method aggregates
        @param {Array} aggregates
        @return {Array}
    */
    vm.aggregates = function (ary) {
        if (ary) {
            options.config.aggregates.length = 0;
            ary.forEach((i) => options.config.aggregates.push(i));
        }

        return options.config.aggregates;
    };
    /**
        Resolve the alias for an attribute in a column.
        @method alias.
        @param {String} attr
        @return {String}
    */
    vm.alias = function (attr) {
        return f.resolveAlias(vm.feather(), attr);
    };
    /**
        Array of displayed attributes.
        @method attrs
        @return {Array}
    */
    vm.attrs = function () {
        let columns = vm.config().columns;
        let result = columns.map(function (column) {
            return column.attr;
        });

        return result || [{
            attr: "id"
        }];
    };
    /**
        Whether can toggle row as selected.
        @method canToggle
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.canToggle = f.prop(true);
    /**
        CSS class.
        @method class
        @param {String} class
        @return {String}
    */
    vm.class = f.prop(options.class || "");
    /**
        @method isEditModeEnabled
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isEditModeEnabled = function (...args) {
        let enable = args[0];
        if (enable === false) {
            vm.toggleView();
        }

        if (enable !== undefined) {
            vm.models().isEditable(enable);
        }

        return isEditModeEnabled(...args);
    };
    /**
        Flag whether list is populated by query.
        @method isQuery
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isQuery = f.prop(true);
    /**
        Layout configuration.
        @method config
        @param {Object} object
        @return {Object}
    */
    vm.config = f.prop(options.config);
    /**
        Id of footer element below table if any. Used for rendering dimensions.
        @method footerId
        @param {String} id
        @return {String}
    */
    vm.footerId = f.prop(options.footerId);
    /**
        Dialog for confirmation messages. Content changes depending on context.
        @method confirmDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.confirmDialog = f.prop(f.createViewModel("Dialog", {
        icon: "question-circle",
        title: "Confirmation"
    }));
    vm.confirmDialog().state().resolve("/Display/Closed").enter(doResetDialog);
    /**
        Return the id of the input element which should recieve focus.
        @method defaultFocus
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
    /**
        Dialog for error messages. Content changes depending on context.
        @method errorDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.errorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "exclamation-triangle",
        title: "Error"
    }));
    /**
        @method feather
        @param {Object} feather
        @return {Object}
    */
    vm.feather = f.prop(feather);
    /**
        @method filter
        @param {Filter} filter
        @return {Filter}
    */
    vm.filter = f.prop();
    /**
        Form used for editing rows.
        @method form
        @return {Object}
    */
    vm.form = function () {
        return f.getForm({
            form: vm.config().form,
            feather: feather.name
        });
    };
    /**
        @method formatInputId
        @return {string}
    */
    vm.formatInputId = function (col) {
        return "input" + col.toCamelCase(true);
    };
    /**
        Manually set stlye height if any.
        @method height
        @param {String} height
        @return {String}
    */
    vm.height = f.prop(options.height);
    /**
        @method goNextRow
    */
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
    /**
        @method goPrevRow
    */
    vm.goPrevRow = function () {
        let list = vm.models();
        let model = vm.model();
        let idx = list.indexOf(model) - 1;

        if (idx >= 0) {
            vm.select(list[idx]);
        }
    };
    /**
        Object with table header table body ids.
        @method ids
        @param {Object} obj
        @return {Object}
    */
    vm.ids = f.prop({
        header: f.createId(),
        rows: f.createId(),
        footer: f.createId()
    });
    /**
        @method isDragging
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isDragging = f.prop(false);
    /**
        @method isScrolling
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isScrolling = f.prop(false);
    /**
        @method isSelected
        @param {Model} model
        @return {Boolean}
    */
    vm.isSelected = function (model) {
        return vm.selectionIds().indexOf(model.id()) > -1;
    };
    /**
        Return the name of the last attribute which can recive focus.
        @method lastFocus
        @param {Model} model
        @return {String}
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
    /**
        Set or return the last model that was selected in the list.
        @method lastSelected
        @param {Model} Model selected
        @return {Model} Last model selected
    */
    vm.lastSelected = f.prop();
    /**
        Current edit mode state.
        @method mode
        @return {String}
    */
    vm.mode = function () {
        let state = vm.state();
        return state.resolve(state.current()[0]);
    };
    /**
        Currently selected model.
        @method model
        @return {Model}
    */
    vm.model = function () {
        return vm.selection();
    };
    /**
        @method modelDelete
    */
    vm.modelDelete = function () {
        return vm.mode().modelDelete();
    };
    /**
        @method modelNew
    */
    vm.modelNew = function () {
        return vm.mode().modelNew();
    };
    /**
        Model list.
        @method models
        @param {List} list
        @return {List}
    */
    vm.models = f.prop(options.models);
    /**
        @method nextFocus
        @param {String} attr
        @return {String}
    */
    vm.nextFocus = f.prop();
    /**
        @method ondblclick
        @param {Model} model
    */
    vm.ondblclick = function (model) {
        vm.select(model);
        if (options.ondblclick) {
            options.ondblclick();
        }
    };
    /**
        @method ondragover
        @param {Event} event
    */
    vm.ondragover = function (ev) {
        ev.preventDefault();
    };
    /**
        @method ondragstart
        @param {Integer} index
        @param {String} type
        @param {Event} event
    */
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
    /**
        @method ondrop
        @param {Integer} toIndex
        @param {String} type
        @param {Array} ary
        @param {Event} event
    */
    vm.ondrop = function (toIdx, type, ary, ev) {
        let moved;
        let column;
        let fromIdx;
        let oldWidth;
        let newWidth;
        let widthStart;
        let typeStart = dataTransfer.typeStart;

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

        vm.isDragging(false);
    };
    /**
        @method onkeydown
        @param {Event} event
    */
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
    /**
        @method onscroll
        @param {Event} event
    */
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
                doFetch();
                return;
            }
        }

        // Sync header position with table body position
        header.scrollLeft = rows.scrollLeft;

        // No need to redraw
        vm.isScrolling(true);
    };

    /**
        @method onscrollFooter
        @param {Event} event
    */
    vm.onscrollFooter = function () {
        let ids = vm.ids();
        let rows = document.getElementById(ids.rows);
        let footer = document.getElementById(ids.footer);

        // Sync body position with footer position
        rows.scrollLeft = footer.scrollLeft;

        // No need to redraw
        vm.isScrolling(true);
    };
    /**
        Rerun query.
        @method refresh
    */
    vm.refresh = function () {
        doFetch(true);
    };
    /**
        Cache of relation widgets for editing.
        @method relations
        @param {Object} obj
        @return {Object}
    */
    vm.relations = f.prop({});
    /**
        Cache of select components for editing.
        @method selectComponents
        @param {Object} obj
        @return {Object}
    */
    vm.selectComponents = f.prop({});
    /**
        Save edited models.
        @method save
    */
    vm.save = function () {
        vm.models().save();
    };
    /**
        @method scrollbarWidth
        @param {Integr} width
        @return {Integer}
    */
    vm.scrollbarWidth = f.prop(scrWidth);
    /**
        Search string.
        @method search
        @param {String} str
        @return {String}
    */
    vm.search = options.search || f.prop("");
    /**
        Array of models to select
        @method select
        @param {Array} Models
        @return {Array} Selected models
    */
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
                ids = [];
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
                model.checkDelete();

                selections.push(model);
            }
        });

        vm.relations({});

        if (selections.length) {
            vm.state().send("selected");
        }

        return selections;
    };
    /**
        Current selection (edit mode).
        @method selection
        @return {Model}
    */
    vm.selection = function () {
        return vm.selections()[0];
    };
    /**
        Array of selected model ids.
        @method selectionIds
        @return {Array}
    */
    vm.selectionIds = function () {
        return vm.selections().map(function (selection) {
            return selection.id();
        });
    };
    /**
        Current model selections (view mode).
        @method selections
        @param {Array} Models
        @return {Array} Models
    */
    vm.selections = f.prop([]);
    /**
        CSS class of selected model.
        @method selectedClass
        @return {String}
    */
    vm.selectedClass = function () {
        return vm.mode().selectedClass();
    };
    /**
        @method state
        @param {State} state
        @return {State}
    */
    vm.state = f.prop();
    /**
        Go to edit mode.
        @method toggleEdit
    */
    vm.toggleEdit = function () {
        vm.state().send("edit");
    };
    /**
        Go to view mode.
        @method toggleView
    */
    vm.toggleView = function () {
        vm.state().send("view");
    };
    /**
        Change to either view or edit mode.
        @method toggleMode
    */
    vm.toggleMode = function () {
        vm.state().send("toggle");
    };
    /**
        @method toggleSelection
        @param {Model} model
        @param {String} id
        @return {key} key
    */
    vm.toggleSelection = function (model, id, optKey) {
        if (!vm.canToggle()) {
            return;
        }
        return vm.mode().toggleSelection(model, id, optKey);
    };
    /**
        @method undo
    */
    vm.undo = function () {
        let selection = vm.selection();

        if (selection) {
            selection.undo();
        }
    };
    /**
        @method unselect
        @param {Array} Models
    */
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
    /**
        @method zoom
        @param {Integer} percent
        @return {Integer}
    */
    vm.zoom = f.prop(100);

    // ..........................................................
    // INIT
    //

    vm.filter(f.copy(options.config.filter || {}));
    vm.aggregates(f.copy(options.config.aggregates));
    vm.aggregateValues = f.prop();
    vm.filter().limit = vm.filter().limit || LIMIT;
    if (!options.models) {
        vm.models(f.createList(
            feather.name,
            {
                fetch: false,
                subscribe: options.subscribe,
                isEditable: vm.isEditModeEnabled(),
                filter: vm.filter()
            }
        ));
        setProperties();
        doFetch();
        doFetchAggregates();
    }

    // Bind refresh to filter change event
    vm.filter.state().resolve("/Ready").enter(function () {
        vm.config().filter = vm.filter();
        vm.refresh();
    });

    // Create table widget statechart
    vm.state(f.State.define({
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
                this.enter(function () {
                    let checkUpdate = vm.models().checkUpdate;

                    if (checkUpdate) {
                        checkUpdate(false);
                    }
                });
            });
            this.state("Edit", function () {
                this.enter(function () {
                    let last;
                    let checkUpdate = vm.models().checkUpdate;

                    if (checkUpdate) {
                        checkUpdate(true);
                    }

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
                    let name = vm.feather().name;
                    let model = f.createModel(name);
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

catalog.register("viewModels", "tableWidget", tableWidget.viewModel);

/**
    @class TableWidget
    @static
    @namespace Components
*/
tableWidget.component = {

    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {ViewModels.TableWidget} vnode.viewModel
    */
    oninit: function (vnode) {
        vnode.attrs.viewModel.canToggle(true);
    },

    /**
        Block redrawing where unneccessary to improve performance.
        @method onbeforeupdate
        @param {Object} vnode Virtual node
        @param {ViewModels.TableWidget} vnode.viewModel
    */
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

    /**
        @method view
        @param {Object} vnode Virtual node
        @param {ViewModels.TableWidget} vnode.viewModel
        @return {Object} View
    */
    view: function (vnode) {
        let header;
        let rows;
        let footer;
        let vm = vnode.attrs.viewModel;
        let ids = vm.ids();
        let config = vm.config();
        let filter = vm.filter();
        let sort = filter.sort || [];
        let zoom = vm.zoom() + "%";
        let feather = vm.feather();
        let dlg = f.getComponent("Dialog");
        let aggs = vm.aggregates();
        let tableBodyClass = "fb-table-body";

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
                ondragover: vm.ondragover,
                draggable: true,
                ondrop: vm.ondrop.bind(
                    null,
                    config.columns.length,
                    "column",
                    config.columns
                ),
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

        // Build footer
        if (aggs.length) {
            tableBodyClass += " fb-table-body-with-footer";
            footer = (function () {
                let tfs = config.columns.map(createTableFooter.bind(null, {
                    config: config,
                    feather: feather,
                    idx: 0,
                    vm: vm,
                    zoom: zoom
                }));

                // Front cap header navigation
                tfs.unshift(m("th", {
                    class: "fb-column-footer",
                    style: {
                        minWidth: "25px",
                        fontSize: zoom,
                        color: "White" // Hack to get default height
                    }
                }, "-"));

                return m("tfoot", tfs);
            }());

            footer = m("tfoot", {
                id: ids.footer,
                onscroll: vm.onscrollFooter,
                class: "fb-table-footer"
            }, [footer]);
        }

        return m("div", {
            class: "pure-form " + vm.class()
        }, [
            m(dlg, {
                viewModel: vm.confirmDialog()
            }),
            m(dlg, {
                viewModel: vm.errorDialog()
            }),
            m("table", {
                class: "pure-table fb-table"
            }, [
                m("thead", {
                    ondragover: vm.ondragover,
                    draggable: true,
                    id: ids.header,
                    class: "fb-table-header"
                }, [header]),
                m("tbody", {
                    id: ids.rows,
                    class: tableBodyClass,
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

                        if (e) {
                            e.removeEventListener("keydown", vm.onkeydown);
                        }
                    }
                }, rows),
                footer
            ])
        ]);
    }
};

catalog.register("components", "tableWidget", tableWidget.component);

export default Object.freeze(tableWidget);