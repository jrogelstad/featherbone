/*
    Framework for building object relational database apps
    Copyright (C) 2024  Featherbone LLC

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
/*jslint this, for, browser, unordered*/
/*global f, m, Qs, printJS*/
/**
    @module TableWidget
*/
let scrWidth;
let inner;
let widthNoScroll;
let widthWithScroll;

/*
    @class tableWidget
*/
const tableWidget = {};
const outer = document.createElement("div");
const COL_WIDTH_DEFAULT = String(f.TABLE_COLUMN_WIDTH_DEFAULT);
const LIMIT = 20;
const ROW_COUNT = 2;
const FETCH_MAX = 3;
const contextMenuStyle = f.prop({display: "none"});

document.onclick = function () {
    contextMenuStyle({display: "none"});
};

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

function normalizeDataList(dataList, model) {
    if (dataList) {
        // If reference a property, get the property
        if (typeof dataList === "string") {
            dataList = model.data[dataList]();

        // Must reference a simple array, transform
        } else if (typeof dataList[0] !== "object") {
            dataList = dataList.map(function (item) {
                return {value: item, label: item};
            });
        }
    }

    return dataList;
}

function createTableDataEditor(options, col) {
    let config = options.config;
    let defaultFocusId = options.defaultFocusId;
    let theModel = options.model;
    let onshifttab = options.onshifttab;
    let ontab = options.ontab;
    let theVm = options.vm;
    let zoom = options.zoom;
    let cell;
    let tdOpts;
    let inputOpts;
    let columnSpacerClass;
    let theWidget;
    let prop = f.resolveProperty(theModel, col);
    let theId = theVm.formatInputId(col);
    let item = config.columns[options.idx];
    let columnWidth = item.width || COL_WIDTH_DEFAULT;
    let theDataList = normalizeDataList(
        item.dataList || prop.dataList,
        theModel
    );
    let cfilter = item.filter;
    let style = (
        prop.style
        ? prop.style()
        : ""
    );

    columnWidth -= 6;

    inputOpts = {
        id: theId,
        key: theId,
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
    if (theVm.nextFocus() === theId && theId === defaultFocusId) {
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
        theVm.nextFocus(undefined);

    } else if (
        theVm.nextFocus() === theId &&
        theId !== defaultFocusId
    ) {
        inputOpts.oncreate = function (vnode) {
            document.getElementById(vnode.dom.id).focus();
        };
        theVm.nextFocus(undefined);
    } else if (theId === defaultFocusId) {
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
    if (options.lastFocusId === theId) {
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

    columnSpacerClass = (
        "fb-column-spacer " + tdOpts.class
    );

    theWidget = theVm.form().attrs.find(
        (item) => (
            item.attr === col && item.relationWidget
        )
    );
    if (theWidget) {
        theWidget = theWidget.relationWidget;
    }

    cell = [
        m("td", tdOpts, [
            f.createEditor({
                model: theModel,
                key: col,
                dataList: theDataList,
                filter: cfilter,
                viewModel: theVm,
                options: inputOpts,
                widget: theWidget
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
    let theVm = options.vm;
    let model = options.model;
    let config = options.config;
    let zoom = options.zoom;
    let onClick = options.onclick;
    let url;
    let cell;
    let content;
    let tdOpts;
    let tableData;
    let theProp = f.resolveProperty(options.model, col);
    let theValue = theProp();
    let format = theProp.format || theProp.type;
    let columnWidth = (
        config.columns[options.idx].width || COL_WIDTH_DEFAULT
    );
    let style = (
        theProp.style
        ? theProp.style()
        : ""
    );
    let relation;
    let id = model.id() + "-" + options.idx;
    let item = config.columns[options.idx];
    let dataList = normalizeDataList(item.dataList || theProp.dataList, model);
    let otitle = (
        theProp.title
        ? theProp.title()
        : ""
    );
    let iconStyle;
    let indentOn = (
        theVm.models().indentOn
        ? theVm.models().indentOn()
        : ""
    );
    let icon;

    columnWidth -= 6;

    tdOpts = {
        key: id + "-data",
        onclick: function (ev) {
            let optKey;
            if (ev.shiftKey) {
                optKey = "shiftKey";
            } else if (ev.ctrlKey || ev.metaKey) {
                optKey = "ctrlKey";
            }
            theVm.toggleSelection(
                model,
                theVm.formatInputId(col),
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
    if (typeof format === "object" && theProp()) {
        relation = theProp.type.relation.toCamelCase();
        if (f.types[relation] && f.types[relation].tableData) {
            tableData = f.types[relation].tableData;
        } else {
            tableData = function () {
                let rel;
                let keys;
                let type = "";

                // If relation, use feather natural key to
                // find value to display
                rel = f.catalog().getFeather(format.relation);
                keys = Object.keys(rel.properties);
                rel = (
                    keys.find((key) => rel.properties[key].isNaturalKey) ||
                    keys.find((key) => rel.properties[key].isLabelKey)
                );

                if (rel) {
                    theValue = theProp().data[rel]();
                    type = theProp().data.objectType().toSnakeCase();

                    url = (
                        window.location.protocol + "//" +
                        window.location.hostname + ":" +
                        window.location.port +
                        window.location.pathname +
                        "#!/edit/" +
                        type +
                        "/" + theProp().id()
                    );

                    return m("a", {
                        href: url,
                        onclick: function (e) {
                            theVm.canToggle(false);
                            e.preventDefault();
                            m.route.set("/edit/:feather/:key", {
                                feather: type,
                                key: theProp().id()
                            }, {
                                state: {}
                            });
                        }
                    }, theValue);
                }
            };
        }
    } else if (theProp.format && f.formats()[theProp.format].tableData) {
        tableData = f.formats()[theProp.format].tableData;
    } else if (f.types[theProp.type] && f.types[theProp.type].tableData) {
        tableData = f.types[theProp.type].tableData;
    } else {
        tableData = (obj) => obj.value;
    }

    if (dataList) {
        theValue = dataList.find((i) => i.value === theValue) || {};
        theValue = theValue.label;
    }

    content = tableData({
        value: theValue,
        options: tdOpts,
        viewModel: theVm,
        prop: theProp,
        onclick: onClick,
        title: otitle
    });

    if (indentOn && options.idx === 0) {
        iconStyle = {
            fontSize: "18px",
            verticalAlign: "text-top",
            textIndent: options.model.data[indentOn]() + "em"
        };
        if (!options.model.isTreeParent()) {
            iconStyle.color = "white";
        }
        icon = (
            options.model.collapsed()
            ? "chevron_right"
            : "expand_more"
        );
        cell = [
            m("td", tdOpts, [
                m("i", {
                    class: "material-icons",
                    key: id + "-indent",
                    onclick: options.model.toggleCollapse,
                    style: iconStyle
                }, icon),
                m("span", {
                    key: id + "-content"
                }, content)
            ])
        ];
    } else {
        cell = [m("td", tdOpts, content)];
    }

    // This exists to force exact alignment
    // with header on all browsers
    cell.push(m("td", {
        key: id + "-spcr",
        class: "fb-column-spacer",
        style: {fontSize: zoom}
    }));

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
        feather = f.catalog().getFeather(
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
            name = "keyboard_arrow_up";
        } else {
            name = "keyboard_arrow_down";
        }

        icon.push(m("i", {
            class: "material-icons-outlined fb-column-sort-icon",
            style: {
                fontSize: zoom
            }
        }, name));

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
            class: "material-icons-outlined fb-column-filter-icon",
            title: operators[
                (filter.criteria[fidx].operator || "=")
            ] + " " + filter.criteria[fidx].value,
            style: {
                fontSize: vm.zoom() * 0.80 + "%"
            }
        }, "filter_list"));
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

function createTableRow(options, pModel) {
    let theConfig = options.config;
    let theVm = options.vm;
    let theZoom = options.zoom;
    let tds;
    let row;
    let thContent;
    let onClick;
    let lock;
    let iconStyle;
    let theLastFocusId;
    let onTab;
    let onShifttab;
    let theDefaultFocusId = theVm.defaultFocus(pModel);
    let currentMode = theVm.mode().current()[0];
    let isSelected = theVm.isSelected(pModel);
    let currentState = pModel.state().current()[0];
    let data = pModel.data;
    let rowOpts = {
        key: pModel.id()
    };
    let cellOpts = {};
    let rowClass;
    let style;
    let thTitle;

    // Build row
    if (isSelected) {
        rowClass = theVm.selectedClass();
    }

    // Build view row
    if (currentMode === "/Mode/View" || !isSelected) {
        // Build cells
        tds = theVm.attrs().map(createTableDataView.bind(null, {
            config: theConfig,
            d: data,
            idx: 0,
            model: pModel,
            onclick: onClick,
            vm: theVm,
            zoom: theZoom
        }));

        rowOpts = {
            ondblclick: theVm.ondblclick.bind(null, pModel)
        };

        // Apply any style business logic
        style = pModel.style();

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

        theLastFocusId = theVm.lastFocus(pModel);
        onTab = function (e) {
            let key = e.key || e.keyIdentifier;
            if (key === "Tab" && !e.shiftKey) {
                e.preventDefault();
                document.getElementById(theDefaultFocusId).focus();
            }
        };

        onShifttab = function (e) {
            let key = e.key || e.keyIdentifier;
            if (key === "Tab" && e.shiftKey) {
                e.preventDefault();
                document.getElementById(theLastFocusId).focus();
            }
        };

        // Build cells
        tds = theVm.attrs().map(createTableDataEditor.bind(null, {
            config: theConfig,
            defaultFocusId: theDefaultFocusId,
            idx: 0,
            lastFocusId: theLastFocusId,
            model: pModel,
            onshifttab: onShifttab,
            ontab: onTab,
            vm: theVm,
            zoom: theZoom
        }));
    }

    // Front cap header navigation
    onClick = function (ev) {
        let optKey;
        if (ev.shiftKey) {
            optKey = "shiftKey";
        } else if (ev.ctrlKey || ev.metaKey) {
            optKey = "ctrlKey";
        }
        theVm.toggleSelection(
            pModel,
            theDefaultFocusId,
            optKey
        );
    };
    iconStyle = {
        fontSize: theZoom,
        minWidth: "25px"
    };

    if (currentState.slice(0, 5) === "/Busy") {
        thContent = m("div", {
            onclick: onClick,
            title: "Saving",
            class: "lds-small-dual-ring"
        });
    } else if (currentState === "/Locked") {
        lock = data.lock() || {};
        thTitle = (
            "User: " + lock.username + "\nSince: " +
            new Date(lock.created).toLocaleTimeString() +
            "\nProcess: " + lock.process
        );
        if (lock.process === "Editing") {
            thContent = m("i", {
                onclick: onClick,
                title: thTitle,
                class: "material-icons-outlined fb-table-icon"
            }, "lock_clock");
        } else {
            thContent = m("div", {
                onclick: onClick,
                title: thTitle,
                class: "lds-small-dual-ring"
            });
        }
    } else if (!pModel.isValid()) {
        thContent = m("i", {
            onclick: onClick,
            title: pModel.lastError(),
            class: "material-icons-outlined fb-table-icon fb-warning",
            style: iconStyle
        }, "report_problem");
    } else if (currentMode !== "/Mode/Edit" && isSelected) {
        thContent = m("i", {
            onclick: theVm.ondblclick.bind(null, pModel),
            class: "material-icons-outlined fb-table-icon",
            style: iconStyle
        }, "file_open");
    } else if (currentState === "/Delete") {
        thContent = m("i", {
            onclick: onClick,
            class: "material-icons-outlined fb-table-icon fb-error",
            style: iconStyle
        }, "delete");
    } else if (currentState === "/Ready/New") {
        thContent = m("i", {
            onclick: onClick,
            class: "material-icons fb-table-icon",
            style: iconStyle
        }, "add");
    } else if (pModel.canUndo()) {
        thContent = m("i", {
            onclick: onClick,
            class: "material-icons-outlined fb-table-icon",
            style: iconStyle
        }, "edit");
    } else {
        cellOpts = {
            onclick: onClick,
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
    rowOpts.key = pModel.id();
    rowOpts.oncontextmenu = function (e) {
        e.preventDefault();

        if (contextMenuStyle().display === "block") {
            contextMenuStyle({display: "none"});
        } else {
            contextMenuStyle({
                display: "block",
                left: e.pageX + "px",
                top: e.pageY + "px"
            });
        }
    };

    // Hide rows indented under collapsed parent
    if (pModel.hide && pModel.hide()) {
        rowOpts.style = rowOpts.style || {};
        rowOpts.style.display = "none";
    }

    if (data.isDeleted()) {
        row = m("del", {
            key: f.createId()
        }, m("tr", rowOpts, tds));
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
        if (
            feather.properties[prefix].format &&
            f.formats()[feather.properties[prefix].format].isMoney
        ) {
            return feather.properties[prefix];
        }
        suffix = attr.slice(idx + 1, attr.length);
        feather = f.catalog().getFeather(
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
    let theValue;
    let prop = resolveFeatherProp(options.feather, col.attr);
    let agg = vm.aggregates().find((a) => a.property === col.attr);
    let tableData;
    let content = "";
    let attr = col.attr;

    if (
        prop && prop.format === "money" &&
        !(agg && agg.method === "COUNT")
    ) {
        attr += ".amount";
    }

    if (values[attr] !== undefined && values[attr] !== null) {
        theValue = values[attr];
    } else {
        theValue = "";
    }

    if (theValue !== "") {
        if (agg && agg.method === "COUNT") {
            tableData = f.types.integer.tableData;
        } else {
            if (prop.format === "date") {
                tableData = f.formats().date.tableData;
            } else if (prop.format === "dateTime") {
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
            value: theValue
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

        if (height < f.TABLE_MIN_HEIGHT) {
            height = f.TABLE_MIN_HEIGHT;
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
        : f.catalog().getFeather(options.feather)
    );
    let modelName = feather.name.toCamelCase();
    let modelConstructor = f.catalog().store().models()[modelName];
    let offset = 0;
    let dlgSelectId = f.createId();
    let dlgSelectedId = f.createId();
    let dlgVisibleId = f.createId();
    let vm = {};
    let isEditModeEnabled = f.prop(options.isEditModeEnabled !== false);
    let fetchCount = 0;
    let pathname = "/" + location.pathname.replaceAll("/", "");

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
                    "Click Ok to download the error log."
                );
                dlg.title("Error");
                dlg.icon("error");
                dlg.buttonCancel().hide();
                dlg.onOk(doDownload.bind(null, target, resp));
                dlg.show();
            }
            vm.refresh();
        }

        function error(err) {
            if (err.response !== null) {
                dlg.message(err.message);
                dlg.title("Error");
                dlg.icon("error");
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
            let feathers = f.catalog().feathers();
            let payload;
            let query = Qs.stringify({
                subscription: {
                    id: f.createId(),
                    eventKey: f.catalog().eventKey()
                }
            });

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
                path: "/do/import/" + format + "/" + name + "/" + query,
                body: formData
            };

            f.datasource().request(payload).then(callback).catch(error);
        }

        input.setAttribute("type", "file");
        input.setAttribute("accept", ".json,.ods,.xlsx");
        input.onchange = processFile;
        input.click();
    }

    function getFilter(offset) {
        let fattrs = [];
        let criterion;
        let theValue = vm.search();
        let filter = f.copy(vm.filter());

        filter.offset = offset || 0;
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
                return formatOf(f.catalog().getFeather(rel), suffix);
            }

            prop = feather.properties[property];
            return prop.format || prop.type;
        }

        // Only search on text attributes
        if (theValue) {
            vm.attrs().forEach(function (attr) {
                let theFeather = vm.feather();
                let fmt = formatOf(theFeather, attr);
                let p = resolveFeatherProp(theFeather, attr);
                let nk;
                let props;

                if (p.isCalculated) {
                    return;
                }

                if (
                    p.type === "string" &&
                    fmt !== "date" &&
                    fmt !== "dateTime"
                ) {
                    fattrs.push(attr);
                } else if (
                    typeof fmt === "object" &&
                    fmt.relation
                ) {
                    props = f.catalog().getFeather(fmt.relation).properties;
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
                    value: theValue
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
            dlg.icon("error");
            dlg.buttonCancel().hide();
            dlg.show();
        }

        function onOk() {
            let theUrl;
            let payload;
            let theBody = {
                subscription: {
                    id: f.createId(),
                    eventKey: f.catalog().eventKey()
                }
            };
            let fspec = vm.feather();
            let plural = fspec.plural || fspec.name;

            function notCalculated(p) {
                return (
                    p.indexOf(".") !== -1 || // path ok
                    !fspec.properties[p].isCalculated
                );
            }

            function notHidden(p) {
                let prop = fspec.properties[p];
                if (
                    typeof prop.type === "object" &&
                    f.hiddenFeathers().indexOf(prop.type.relation) !== -1
                ) {
                    return false;
                }
                return true;
            }

            if (isOnlyVisible()) {
                theBody.properties = vm.config().columns.map((col) => col.attr);
                theBody.properties = theBody.properties.filter(notCalculated);
            } else {
                theBody.properties = Object.keys(
                    fspec.properties
                ).filter(notHidden).filter(notCalculated);
            }

            theBody.filter = getFilter();
            delete theBody.filter.limit;

            if (isOnlySelected()) {
                theBody.filter.criteria = [{
                    property: "id",
                    operator: "IN",
                    value: vm.selections().map((item) => item.id())
                }];
            }

            theUrl = (
                pathname + "/do/export/" +
                format() + "/" + plural
            );
            payload = {
                method: "POST",
                url: theUrl,
                body: theBody
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
        dlg.icon("file_download");
        dlg.onOk(onOk);
        dlg.style({
            width: "550px"
        });
        dlg.show();
    }

    async function doPrintList() {
        let cols = vm.config().columns;
        let theUrl;
        let payload;
        let theBody = {};
        let fspec = vm.feather();
        let pModel = f.createModel(fspec.name);
        let theCols;
        let aggs = {};
        let aggRow = {};
        let theProperties;

        function resolveColumn(attr, prop) {
            let theCol = cols.find((c) => c.attr === attr);
            if (theCol.label) {
                return theCol.label.replace(".", "");
            }
            return prop.alias();
        }

        function notCalculated(p) {
            return (
                p.indexOf(".") !== -1 || // path ok
                !fspec.properties[p].isCalculated
            );
        }

        theBody.properties = cols.map((col) => col.attr);
        theBody.properties = theBody.properties.filter(notCalculated);

        theBody.filter = getFilter();
        delete theBody.filter.limit;

        theUrl = (
            pathname + "/data/" + fspec.plural.toSpinalCase()
        );
        payload = {
            method: "POST",
            url: theUrl,
            body: theBody
        };

        let dat = await m.request(payload);

        function formatRow(row, col) {
            let theProp = f.resolveProperty(pModel, col.attr);
            let colName = resolveColumn(col.attr, theProp);
            let format = theProp.format || theProp.type;
            let content;
            let dataList = theProp.dataList;
            let tableData;
            let relation;
            let theValue = theProp();
            let agg = aggs[col.attr];
            let aggVal = theValue;

            if (theProp.format === "money") {
                agg = aggs[col.attr + ".amount"];
            }

            if (agg) {
                if (theProp.format === "money") {
                    aggVal = theProp.toJSON().amount;
                    agg.currency = theProp().currency;
                }

                if (!agg.property) {
                    agg.property = colName;
                    if (
                        agg.method === "MIN" ||
                        agg.method === "MAX"
                    ) {
                        agg.value = aggVal;
                    } else {
                        agg.value = 0;
                    }
                }

                switch (agg.method) {
                case "SUM":
                    agg.value = agg.value.plus(aggVal);
                    break;
                case "COUNT":
                    agg.value = agg.value.plus(1);
                    break;
                case "MAX":
                    if (aggVal > agg.value) {
                        agg.value = aggVal;
                    }
                    break;
                case "MIN":
                    if (aggVal < agg.value) {
                        agg.value = aggVal;
                    }
                    break;
                case "AVG":
                    agg.sum = agg.sum.plus(aggVal);
                    agg.count = agg.count.plus(1);
                    break;
                }
            }

            if (typeof format === "object" && row[colName] === null) {
                row[colName] = "";
                return;
            }

            if (typeof format === "object") {
                if (!theProp()) {
                    tableData = () => "";
                } else {
                    relation = theProp.type.relation.toCamelCase();
                    if (f.types[relation] && f.types[relation].tableData) {
                        tableData = f.types[relation].tableData;
                    } else {
                        tableData = function () {
                            let rel;
                            let keys;

                            // If relation, use feather natural key to
                            // find value to display
                            rel = f.catalog().getFeather(format.relation);
                            keys = Object.keys(rel.properties);
                            rel = (
                                keys.find(
                                    (key) => rel.properties[key].isNaturalKey
                                ) ||
                                keys.find(
                                    (key) => rel.properties[key].isLabelKey
                                )
                            );

                            if (rel) {
                                row[colName] = theProp().data[rel]();
                            }
                        };
                    }
                }
            } else if (
                theProp.format &&
                f.formats()[theProp.format].tableData
            ) {
                tableData = f.formats()[theProp.format].tableData;
            } else if (
                theProp.type !== "boolean" &&
                f.types[theProp.type] &&
                f.types[theProp.type].tableData
            ) {
                tableData = f.types[theProp.type].tableData;
            } else {
                tableData = (obj) => obj.value;
            }

            if (dataList) {
                theValue = dataList.find((i) => i.value === theValue) || {};
                theValue = theValue.label;
            }

            content = tableData({
                value: theValue,
                options: {style: {}},
                prop: () => theValue
            });

            if (typeof content === "string") {
                row[colName] = content;
                return;
            }

            if (typeof content === "boolean") {
                if (content) {
                    row[colName] = "X";
                } else {
                    row[colName] = "";
                }
            }

        }

        theCols = theBody.properties;

        vm.config().aggregates.forEach(function (agg) {
            aggs[agg.property] = {
                sum: 0,
                count: 0,
                method: agg.method
            };
        });

        dat = dat.map(function (row) {
            pModel.set(row, true, true);
            theCols.forEach(function (prop) {
                let col = cols.find((c) => c.attr === prop);
                formatRow(row, col);
            });
            return row;
        });

        theProperties = theCols.map(function (attr) {
            let theProp = f.resolveProperty(pModel, attr);
            return resolveColumn(attr, theProp);
        });

        if (vm.config().aggregates.length) {
            theProperties.forEach(function (p) {
                aggRow[p] = "";
            });
            Object.keys(aggs).forEach(function (key) {
                if (aggs[key].method === "AVG") {
                    aggs[key].value = aggs[key].sum.div(aggs[key].count);
                }
                if (aggs[key].currency) {
                    aggs[key].value = f.formats().money.tableData({
                        options: {style: {}},
                        value: {
                            currency: aggs[key].currency,
                            amount: aggs[key].value
                        }
                    });
                }
                aggRow[aggs[key].property] = aggs[key].value;
            });
            dat.push(aggRow);
        }

        printJS({
            printable: dat,
            properties: theProperties,
            header: (
                "<h1 class=\"custom-h1\">" +
                (options.printTitle || fspec.plural.toName()) +
                "</h1>"
            ),
            style: ".custom-h1 { font-family: sans-serif; }",
            documentTitle: fspec.plural.toName(),
            gridHeaderStyle: (
                "font-family: sans-serif; " +
                "border: 1px solid lightgray;"
            ),
            gridStyle: (
                "font-family: sans-serif; " +
                "border: 1px solid lightgray; " +
                "padding-left: 10px;" +
                "padding-right: 10px;"
            ),
            type: "json"
        });
    }

    function setProperties() {
        let list = vm.models();
        let attrs;
        let props = [];
        let fp = vm.feather().properties;
        let sort = vm.filter().sort || [];

        if (!vm.isLoadAllProperties() && !vm.isEditModeEnabled()) {
            attrs = vm.config().columns.map((col) => col.attr);
            attrs = attrs.concat(sort.map((s) => s.property));
            // Purge dot notation
            attrs.forEach(function (a) {
                let i = a.indexOf(".");

                if (i !== -1) {
                    a = a.slice(0, i);
                }

                if (props.indexOf(a) === -1) {
                    props.push(a);
                }
            });
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
        let theUrl;
        let payload;
        let aggregates = vm.aggregates();
        let theBody = {
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
        if (!theBody.aggregations.length) {
            return;
        }

        delete theBody.filter.limit;
        delete theBody.filter.sort;
        delete theBody.filter.offset;

        theUrl = pathname + "/do/aggregate";
        payload = {
            method: "POST",
            url: theUrl,
            body: theBody
        };

        return m.request(payload).then(callback);
    }

    function doFetch(refresh) {
        let list = vm.models();

        if (refresh) {
            doFetchAggregates();
            offset = 0;
            fetchCount = 0;
        }

        fetchCount += 1;
        setProperties();
        list.fetch(
            getFilter(offset),
            refresh !== true
        ).then(function () {
            if (
                fetchCount < FETCH_MAX &&
                list.length === offset + LIMIT
            ) {
                offset += LIMIT;
                doFetch();
            }
        });
    }

    // Dialog gets modified by actions, so reset after any useage
    function doResetDialog() {
        let dlg = vm.confirmDialog();
        let state = dlg.buttonOk().state();
        let mode = state.resolve(state.resolve("/Mode").current()[0]);

        dlg.icon("help_outline");
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
        dlg.buttons([dlg.buttonOk, dlg.buttonCancel]);
        dlg.buttonOk().title("");
        dlg.buttonOk().label("&Ok");
        dlg.buttonOk().isDisabled = function () {
            return mode.isDisabled();
        };
        dlg.buttonCancel().title("");
        dlg.buttonCancel().label("&Cancel");
        dlg.style({width: "500px"});
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
            let validator = modelConstructor.static()[action.validator];

            if (!method) {
                method = function (viewModel) {
                    let dialog = viewModel.confirmDialog();
                    dialog.message(
                        "No method \"" + action.method +
                        "\" found on model \"" + modelName + "\""
                    );
                    dialog.title("Error");
                    dialog.icon("report_problem");
                    dialog.onOk(undefined);
                    dialog.buttonCancel().hide();
                    dialog.show();
                };
            }

            action.id = action.id || f.createId();

            opts = {
                id: "nav-actions-" + action.id,
                class: "pure-menu-link fb-menu-list-item",
                title: action.title
            };

            if (validator && !validator(selections)) {
                opts.class = (
                    "pure-menu-link pure-menu-disabled " +
                    "fb-menu-list-item"
                );
            } else {
                opts.onclick = method.bind(null, vm);
            }

            if (action.hasSeparator) {
                opts.class += " fb-menu-list-separator";
            }

            if (action.icon) {
                actionIcon = [m("i", {
                    id: "nav-actions-" + action.id + "-icon",
                    class: "material-icons fb-menu-list-icon"
                }, action.icon)];
            }

            return m("li", opts, actionIcon, action.name);
        });

        o = {
            id: "nav-actions-print-list",
            class: "pure-menu-link",
            title: "Print entire list",
            onclick: doPrintList
        };

        if (menu.length) {
            o.class += " fb-menu-list-separator";
        }

        menu.push(
            m("li", o, [m("i", {
                id: "nav-actions-print-list-icon",
                class: "material-icons-outlined fb-menu-list-icon"
            }, "print")], "Print List")
        );

        menu.push(
            m("li", {
                id: "nav-actions-export",
                class: "pure-menu-link",
                title: "Export data",
                onclick: doExport
            }, [m("i", {
                id: "nav-actions-export-icon",
                class: "material-icons-outlined fb-menu-list-icon"
            }, "file_download")], "Export")
        );

        menu.push(
            m("li", {
                id: "nav-actions-import",
                class: "pure-menu-link",
                title: "Import data",
                onclick: doImport
            }, [m("i", {
                id: "nav-actions-import-icon",
                class: "material-icons-outlined fb-menu-list-icon"
            }, "file_upload")], "Import")
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
        Allow multiple selections in view mode
        @method isMultiSelectEnabled
        @param {Boolean} flag Default true
        @return {Boolean}
    */
    vm.isMultiSelectEnabled = f.prop(true);
    /**
        If false then only shown properties
        are loaded, which helps with performance.
        Otherwise load entire objects for editing
        purposes.

        @method isLoadAllProperties
        @param {Boolean} flag Default false
        @return {Boolean}
    */
    vm.isLoadAllProperties = f.prop(
        Boolean(options.loadAllProperties)
    );
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
        icon: "help_outline",
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
        icon: "error",
        title: "Error"
    }));
    vm.errorDialog().buttonCancel().hide();
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
            m.redraw.sync();
            // Set focus on the same cell we left
            document.getElementById(id).focus();
        }

        switch (key) {
        case "Up":
        case "ArrowUp":
            nav("goPrevRow");
            e.preventDefault();
            e.stopPropagation();
            break;
        case "Down":
        case "ArrowDown":
            nav("goNextRow");
            e.preventDefault();
            e.stopPropagation();
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
        evt.redraw = false;
    };

    /**
        @method onscrollFooter
        @param {Event} event
    */
    vm.onscrollFooter = function (evt) {
        let ids = vm.ids();
        let rows = document.getElementById(ids.rows);
        let footer = document.getElementById(ids.footer);

        // Sync body position with footer position
        rows.scrollLeft = footer.scrollLeft;

        // No need to redraw
        evt.redraw = false;
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
        vm.models().save(vm).catch(function (err) {
            vm.errorDialog().message(err.message);
            vm.errorDialog().show();
        });
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
                if (!model.parent()) {
                    model.checkDelete();
                }

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
    let lopts = {
        fetch: false,
        subscribe: options.subscribe,
        isEditable: vm.isEditModeEnabled(),
        filter: vm.filter()
    };
    if (!options.models) {
        let flist = f.catalog().store().lists()[feather.name.toCamelCase()];
        if (flist) {
            vm.models(flist(lopts));
        } else {
            vm.models(f.createList(feather.name, lopts));
        }
        setProperties();
        doFetch();
        doFetchAggregates();
    }
    if (vm.models().onEvent) {
        vm.models().onEvent(doFetchAggregates);
    }

    if (vm.models().state) {
        vm.models().state().resolve("/Unitialized").enter(vm.unselect);
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
                    if (!vm.isMultiSelectEnabled()) {
                        optKey = "";
                    }

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
                    if (
                        prevState === "/Ready/New" ||
                        // Hack: Dialog always remove real time
                        options.containerId
                    ) {
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

f.catalog().register("viewModels", "tableWidget", tableWidget.viewModel);

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
        @method view
        @param {Object} vnode Virtual node
        @param {ViewModels.TableWidget} vnode.viewModel
        @return {Object} View
    */
    view: function (vnode) {
        let header;
        let rows;
        let footer;
        let theVm = vnode.attrs.viewModel;
        let ids = theVm.ids();
        let theConfig = theVm.config();
        let theFilter = theVm.filter();
        let theSort = theFilter.sort || [];
        let theZoom = theVm.zoom() + "%";
        let theFeather = theVm.feather();
        let dlg = f.getComponent("Dialog");
        let aggs = theVm.aggregates();
        let tableBodyClass = "fb-table-body";

        // Build header
        header = (function () {
            let ths = theConfig.columns.map(createTableHeader.bind(null, {
                config: theConfig,
                feather: theFeather,
                filter: theFilter,
                idx: 0,
                sort: theSort,
                vm: theVm,
                zoom: theZoom
            }));

            // Front cap header navigation
            ths.unshift(m("th", {
                style: {
                    minWidth: "25px",
                    fontSize: theZoom
                }
            }));

            // End cap on header for scrollbar
            ths.push(m("th", {
                ondragover: theVm.ondragover,
                draggable: true,
                ondrop: theVm.ondrop.bind(
                    null,
                    theConfig.columns.length,
                    "column",
                    theConfig.columns
                ),
                style: {
                    minWidth: theVm.scrollbarWidth() + "px",
                    maxWidth: theVm.scrollbarWidth() + "px"
                }
            }));

            return m("tr", ths);
        }());

        // Build rows
        rows = theVm.models().map(createTableRow.bind(null, {
            config: theConfig,
            idx: 0,
            vm: theVm,
            zoom: theZoom
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
                let tfs = theConfig.columns.map(createTableFooter.bind(null, {
                    config: theConfig,
                    feather: theFeather,
                    idx: 0,
                    vm: theVm,
                    zoom: theZoom
                }));

                // Front cap header navigation
                tfs.unshift(m("th", {
                    class: "fb-column-footer",
                    style: {
                        minWidth: "25px",
                        fontSize: theZoom,
                        color: "White" // Hack to get default height
                    }
                }, "-"));

                return m("tfoot", tfs);
            }());

            footer = m("tfoot", {
                id: ids.footer,
                onscroll: theVm.onscrollFooter,
                class: "fb-table-footer"
            }, [footer]);
        }

        return m("div", {
            class: "pure-form " + theVm.class(),
            onclick: function () {
                contextMenuStyle({display: "none"});
            }
        }, [
            m(dlg, {
                viewModel: theVm.confirmDialog()
            }),
            m(dlg, {
                viewModel: theVm.errorDialog()
            }),
            m("div", {
                class: "fb-context-menu",
                style: contextMenuStyle()
            }, [
                m("ul", {
                    id: "context-actions-list",
                    class: (
                        "pure-menu-list fb-menu-list " +
                        "fb-menu-list-show"
                    )
                }, theVm.actions())
            ]),
            m("table", {
                class: "pure-table fb-table"
            }, [
                m("thead", {
                    ondragover: theVm.ondragover,
                    draggable: true,
                    id: ids.header,
                    class: "fb-table-header"
                }, [header]),
                m("tbody", {
                    id: ids.rows,
                    class: tableBodyClass,
                    onscroll: theVm.onscroll,
                    oncreate: function (vnode) {
                        // Key down handler for up down movement
                        let e = document.getElementById(vnode.dom.id);
                        e.addEventListener("keydown", theVm.onkeydown);
                        resize(theVm, vnode);
                    },
                    onupdate: resize.bind(null, theVm),
                    onremove: function (vnode) {
                        // Key down handler for up down movement
                        let e = document.getElementById(vnode.dom.id);

                        if (e) {
                            e.removeEventListener("keydown", theVm.onkeydown);
                        }
                    }
                }, rows),
                footer
            ])
        ]);
    }
};

f.catalog().register("components", "tableWidget", tableWidget.component);
