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
/*jslint this, browser*/
import catalog from "./models/catalog.js";
import datasource from "./datasource.js";
import State from "./state.js";

const m = window.m;
const f = window.f;
const console = window.console;
const CodeMirror = window.CodeMirror;
const exclusions = [
    "id",
    "isDeleted",
    "lock",
    "created",
    "createdBy",
    "updated",
    "updatedBy",
    "objectType",
    "etag",
    "owner"
];

let styles;

// ..........................................................
// PRIVATE
//

let message;
let appState;

/** @private
  Auto-build a form definition based on feather properties.

  @param {String | Object} Feather
  @return {Object} Form definition
*/
function buildForm(feather) {
    let props;
    let keys;
    let found;
    let attrs = [];

    if (typeof feather === "string") {
        feather = catalog.getFeather(feather);
    }

    props = f.copy(feather.properties);
    keys = Object.keys(props);

    // Make sure key attributes are first
    found = keys.find((key) => props[key].isNaturalKey);
    if (found) {
        attrs.push({attr: found});
        keys.splice(keys.indexOf(found), 1);
    }

    found = keys.find((key) => props[key].isLabelKey);
    if (found) {
        attrs.push({attr: found});
        keys.splice(keys.indexOf(found), 1);
    }

    // Build config with remaining keys
    keys.forEach(function (key) {
        if (exclusions.indexOf(key) !== -1) {
            return;
        }

        if (
            props[key].type === "object" &&
            !props[key].format
        ) {
            return;
        }

        if (
            typeof props[key].type === "object" && (
                props[key].type.childOf || props[key].type.parentOf
            )
        ) {
            return;
        }

        attrs.push({attr: key});
    });

    return {attrs: attrs};
}

/** @private */
function column(item) {
    return {attr: item};
}

/** @private */
function buildRelationWidgetFromFeather(type, featherName) {
    let name = featherName + "$" + type.relation + "Relation";
    let widget = catalog.store().components()[name];

    if (widget) {
        return widget;
    }

    let relationWidget = catalog.store().components().relationWidget;
    let feather = catalog.getFeather(type.relation);
    let keys = Object.keys(feather.properties);
    let naturalKey = keys.find((key) => feather.properties[key].isNaturalKey);
    let labelKey = keys.find((key) => feather.properties[key].isLabelKey);
    let properties = f.copy(type.properties);

    if (!naturalKey) {
        console.error(
            "No natural key defined on '" + type.relation +
            "' to create relation widget"
        );
        return;
    }

    // If no explicit properties, use all non-object properties on relation
    if (!properties) {
        properties = Object.keys(feather.properties).filter(
            (key) => exclusions.indexOf(key) === -1
        );
    } else {
        properties = properties.filter((key) => key !== "id");
    }

    widget = {
        oninit: function (vnode) {
            let oninit = relationWidget.oninit.bind(this);
            let form = f.getForm({feather: type.relation});

            vnode.attrs.valueProperty = naturalKey;
            vnode.attrs.labelProperty = labelKey;
            vnode.attrs.form = form;
            vnode.attrs.list = {
                columns: properties.map(column)
            };
            oninit(vnode);
        },
        view: relationWidget.view
    };

    // Memoize
    catalog.register("components", name, widget);

    return widget;
}

function buildSelector(obj, opts) {
    let id = opts.id;
    let vm = obj.viewModel;
    let selectComponents = vm.selectComponents();
    let value = opts.prop();
    let values = obj.dataList.map((item) => item.value).join();

    value = (
        value === ""
        ? undefined
        : value
    );

    if (opts.class) {
        opts.class = "fb-input " + opts.class;
    } else {
        opts.class = "fb-input";
    }

    if (selectComponents[id]) {
        if (
            selectComponents[id].value === value &&
            selectComponents[id].readonly === opts.readonly &&
            selectComponents[id].values === values
        ) {
            return selectComponents[id].content;
        }
    } else {
        selectComponents[id] = {};
    }

    selectComponents[id].value = value;
    selectComponents[id].readonly = opts.readonly;
    selectComponents[id].values = values;
    selectComponents[id].content = m("select", {
        id: id,
        key: id,
        onchange: (e) => opts.prop(e.target.value),
        oncreate: opts.oncreate,
        onremove: opts.onremove,
        value: value,
        readonly: opts.readonly,
        disabled: opts.readonly,
        class: opts.class,
        style: opts.style
    }, obj.dataList.map(function (item) {
        return m("option", {
            value: item.value,
            key: id + "$" + item.value
        }, item.label);
    }));

    return selectComponents[id].content;
}

/** @private */
function buildRelationWidgetFromLayout(id) {
    let widget = catalog.store().components()[id];

    if (widget) {
        return widget;
    }

    let relationWidget = catalog.store().components().relationWidget;
    let layout = catalog.store().data().relationWidgets().find(
        (row) => row.id() === id
    );

    if (!layout) {
        console.error(
            "No layout found for relation widget '" + id + "'"
        );
        return;
    }

    widget = {
        oninit: function (vnode) {
            let oninit = relationWidget.oninit.bind(this);

            vnode.attrs.valueProperty = (
                layout.data.valueProperty()
            );
            vnode.attrs.labelProperty = (
                layout.data.labelProperty()
            );
            vnode.attrs.form = (
                layout.data.form()
                ? f.getForm(layout.data.form().id())
                : undefined
            );
            vnode.attrs.list = {
                columns: layout.data.searchColumns().toJSON()
            };
            oninit(vnode);
        },
        view: relationWidget.view
    };

    // Memoize
    catalog.register("components", id, widget);

    return widget;
}

/** private */
function isChild(p) {
    return p.type && typeof p.type === "object" && p.type.childOf;
}

/** private */
function isToOne(p) {
    return (
        p.type && typeof p.type === "object" &&
        !p.type.childOf && !p.type.parentOf
    );
}

/** private */
function isToMany(p) {
    return p.type && typeof p.type === "object" && p.type.parentOf;
}

// Resize according to surroundings
function resizeEditor(editor) {
    let containerHeight;
    let bottomHeight;
    let yPosition;
    let e = editor.getWrapperElement();

    yPosition = f.getElementPosition(e).y;
    containerHeight = (
        document.body.offsetHeight +
        f.getElementPosition(document.body).y
    );
    bottomHeight = (
        containerHeight - yPosition - e.offsetHeight
    );
    editor.setSize(null, window.innerHeight - yPosition - bottomHeight);
}

/**
  Return system catalog.

  @return {Object}
*/
f.catalog = function () {
    return catalog;
};

/**
  Return system datasource.

  @return {Object}
*/
f.datasource = function () {
    return datasource;
};

/**
  Return the matching currency object.

  @param {String} Currency code
  @return {Object}
*/
f.getCurrency = function (code) {
    return catalog.store().data().currencies().find(function (curr) {
        return (
            curr.data.code() === code || (
                curr.data.hasDisplayUnit() &&
                curr.data.displayUnit().data.code() === code
            )
        );
    });
};

/**
  Return a form based on a form id or a feather. If multiple forms exist,
  the first one will be used. If none exist one will be built based
  on feather definition.

  The form returned is not a form model,  but simply a regular
  javascript object.

  @param {Object} Options
  @param {String} [options.form] Form id
  @param {String} [options.feather] Feather name
  @return {Object} Form
*/
f.getForm = function (options) {
    let form;
    let forms = catalog.store().data().forms();

    // Get the form that was specified
    if (options.form) {
        form = forms.find(
            (row) => (
                row.id === options.form &&
                row.isActive
            )
        );
    }

    // If none specified, find one with a matching feather
    if (!form) {
        form = forms.find(
            (row) => (
                row.feather === options.feather &&
                row.isActive
            )
        );
    }

    // If none found, make one up based on feather definition
    if (!form) {
        form = buildForm(options.feather);
    }

    return form;
};

/**
  Object to define what input type to use for data
*/
f.inputMap = {
    integer: "number",
    number: "text",
    string: "text",
    date: "date",
    dateTime: "datetime-local",
    boolean: "checkbox",
    password: "text",
    tel: "tel",
    email: "email",
    url: "url",
    color: "color",
    textArea: undefined,
    script: undefined,
    money: "number",
    icon: "text"
};

/**
  Return an array of feathers organized as options.
  Useful for models that need to offer a selection
  of feathers.

  @return {Array}
*/
f.feathers = function () {
    let tables = catalog.store().feathers();
    let keys = Object.keys(tables).sort();

    return keys.map(function (key) {
        return {
            value: key,
            label: key
        };
    });
};

/**
  Find the top most parent model in a model heiarchy.
  For example from an order line find the parent order.

  @param {Object} Model
  @return {Object} Parent model
*/
f.findRoot = function (model) {
    let parent = model.parent();

    return (
        parent
        ? f.findRoot(parent)
        : model
    );
};

f.formats.money.fromType = function (value) {
    let style;
    let amount = value.amount || 0;
    let currency = value.currency;
    let curr = f.getCurrency(value.currency);
    let hasDisplayUnit = curr.data.hasDisplayUnit();
    let minorUnit = (
        hasDisplayUnit
        ? curr.data.displayUnit().data.minorUnit()
        : curr.data.minorUnit()
    );

    style = {
        minimumFractionDigits: minorUnit,
        maximumFractionDigits: minorUnit
    };

    if (hasDisplayUnit) {
        curr.data.conversions().some(function (conv) {
            if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
                amount = amount.div(conv.data.ratio()).round(minorUnit);
                return true;
            }
        });

        currency = curr.data.displayUnit().data.code();
    }

    return {
        amount: amount.toLocaleString(undefined, style),
        currency: currency,
        effective: (
            value.effective === null
            ? null
            : f.formats.dateTime.fromType(value.effective)
        ),
        baseAmount: (
            value.baseAmount === null
            ? null
            : f.types.number.fromType(value.baseAmount)
        )
    };
};

f.formats.money.toType = function (value) {
    value = value || f.money();
    let amount = f.types.number.toType(value.amount);
    let currency = f.formats.string.toType(value.currency);
    let curr = f.getCurrency(value.currency);

    if (curr.data.hasDisplayUnit() && currency !== curr.data.code()) {
        curr.data.conversions().some(function (conv) {
            if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
                amount = amount.times(
                    conv.data.ratio().round(curr.data.minorUnit())
                );
                return true;
            }
        });

        currency = curr.data.code();
    }

    value = {
        amount: amount,
        currency: currency,
        effective: (
            value.effective === null
            ? null
            : f.formats.dateTime.toType(value.effective)
        ),
        baseAmount: (
            value.baseAmount === null
            ? null
            : f.types.number.toType(value.baseAmount)
        )
    };

    return Object.freeze(value);
};

function byEffective(a, b) {
    let aEffect = a.data.effective();
    let bEffect = b.data.effective();

    return (
        aEffect > bEffect
        ? -1
        : 1
    );
}

f.baseCurrency = function (effective) {
    effective = (
        effective
        ? new Date(effective)
        : new Date()
    );

    let current;
    let currs = catalog.store().data().currencies();
    let baseCurrs = catalog.store().data().baseCurrencies();

    baseCurrs.sort(byEffective);
    current = baseCurrs.find(function (item) {
        return new Date(item.data.effective.toJSON()) <= effective;
    });

    // If effective date older than earliest base currency, take oldest
    if (!current) {
        current = baseCurrs[0];
    }

    current = current.data.currency().data.code();

    return currs.find(function (currency) {
        return currency.data.code() === current;
    });
};

/**
  Return a money object.

  @param {Number} Amount.
  @param {String} Currency code.
  @param {Date} Effective date.
  @param {Number} Base amount.
  @return {Object}
*/
f.money = function (amount, currency, effective, baseAmount) {
    let ret = {
        amount: amount || 0,
        currency: currency || f.baseCurrency().data.code(),
        effective: effective || null,
        baseAmount: baseAmount || null
    };

    return ret;
};

function input(type, options) {
    let prop = options.prop;
    let opts = {
        class: options.class,
        readonly: options.readonly,
        id: options.id,
        required: options.required,
        style: options.style,
        type: type,
        onchange: (e) => prop(e.target.value),
        oncreate: options.onCreate,
        onremove: options.onRemove,
        value: prop()
    };

    if (opts.class) {
        opts.class = "fb-input " + opts.class;
    } else {
        opts.class = "fb-input";
    }

    return m("input", opts);
}

f.formats.autonumber = {};

f.formats.autonumber.editor = function (options) {
    return m(catalog.store().components().autonumber, options);
};

f.formats.autonumber.tableData = function (obj) {
    let value = obj.value;
    let content = value;
    let title = value;

    if (typeof value === "object" && value !== null) {
        content = "relation: " + obj.value.relation;
        title = content;
    }

    obj.options.title = title;

    return content;
};

f.formats.color.editor = input.bind(null, "color");

f.formats.color.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            style: {
                color: obj.value
            },
            class: "fa fa-square"
        });
    }
};

f.formats.date.editor = input.bind(null, "date");

f.formats.date.tableData = function (obj) {
    if (obj.value) {
        // Turn into date adjusting time for
        // current timezone
        obj.value = new Date(obj.value + f.now().slice(10));
        return obj.value.toLocaleDateString();
    }
};

f.formats.dateTime.editor = input.bind(null, "datetime-local");

f.formats.dateTime.tableData = function (obj) {
    obj.value = (
        obj.value
        ? new Date(obj.value)
        : ""
    );

    return (
        obj.value
        ? obj.value.toLocaleString()
        : ""
    );
};

f.formats.dataType.editor = function (options) {
    return m(catalog.store().components().dataType, options);
};

f.formats.dataType.tableData = function (obj) {
    let value = obj.value;
    let content = value;
    let title = value;

    if (typeof value === "object" && value !== null) {
        content = "relation: " + obj.value.relation;
        title = content + "\n";
        if (value.childOf) {
            title += "child of: " + value.childOf;
        } else if (value.parentOf) {
            title += "parent of: " + value.parentOf;
        } else {
            title += "properties: " + value.properties.toString();
        }
    }

    obj.options.title = title;

    return content;
};

f.formats.enum.tableData = function (obj) {
    if (typeof obj.prop.dataList[0] === "object") {
        return obj.prop.dataList.find(function (item) {
            return item.value === obj.value;
        }).label;
    }

    return obj.value;
};

f.formats.icon.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            class: "fa fa-" + obj.value
        });
    }
};

f.formats.money.editor = function (options) {
    return m(catalog.store().components().moneyRelation, options);
};

f.formats.money.tableData = function (obj) {
    let value = obj.value;
    let options = obj.options;
    let curr = f.getCurrency(value.currency);
    let du;
    let symbol;
    let minorUnit = 2;
    let content;

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

    options.style.textAlign = "right";

    return symbol + content;
};

f.formats.overloadType = {};

f.formats.overloadType.editor = function (options) {
    options.isOverload = true;

    return m(catalog.store().components().dataType, options);
};

f.formats.overloadType.tableData = function (obj) {
    let value = obj.value;
    let content = value;
    let title = value;

    if (typeof value === "object" && value !== null) {
        content = "relation: " + obj.value.relation;
        title = content;
    }

    obj.options.title = title;

    return content;
};

f.formats.password.editor = input.bind(null, "password");

f.formats.tel.editor = input.bind(null, "tel");

f.formats.textArea.editor = function (options) {
    let prop = options.prop;
    let opts = {
        readonly: options.readonly,
        id: options.id,
        required: options.required,
        style: options.style,
        onchange: (e) => prop(e.target.value),
        oncreate: options.onCreate,
        onremove: options.onRemove,
        value: prop(),
        rows: options.rows || 4
    };

    return m("textarea", opts);
};

f.formats.script.editor = function (options) {
    let prop = options.prop;
    let model = options.model;
    let opts = {
        readonly: options.readonly,
        id: options.id,
        required: options.required,
        onchange: (e) => prop(e.target.value),
        value: prop()
    };

    opts.oncreate = function () {
        let editor;
        let lint;
        let state = model.state();
        let e = document.getElementById(options.id);
        let config = {
            value: prop(),
            lineNumbers: true,
            mode: {
                name: "javascript",
                json: true
            },
            theme: "neat",
            indentUnit: 4,
            extraKeys: {
                Tab: function (cm) {
                    cm.replaceSelection("    ", "end");
                }
            },
            autoFocus: false,
            gutters: ["CodeMirror-lint-markers"],
            lint: true
        };

        editor = CodeMirror.fromTextArea(e, config);
        lint = editor.state.lint;
        lint.options.globals = ["f"];
        resizeEditor(editor);

        // Populate on fetch
        state.resolve("/Ready/Fetched/Clean").enter(
            function () {
                function notify() {
                    state.send("changed");
                    m.redraw();
                    editor.off("change", notify);
                }
                editor.setValue(prop());
                editor.on("change", notify);
            }
        );

        editor.on("change", m.redraw);
        lint.options.onUpdateLinting = m.redraw;

        // Let model reference lint markings
        model.data.marked(editor.state.lint.marked);

        // Send changed text back to model
        editor.on("blur", function () {
            editor.save();
            prop(e.value);
            m.redraw();
        });

        this.editor = editor;
    };

    opts.onupdate = function () {
        resizeEditor(this.editor);
    };

    return m("textarea", opts);
};

f.formats.url.editor = input.bind(null, "url");

f.formats.url.tableData = function (obj) {
    let url = (
        obj.value.slice(0, 4) === "http"
        ? obj.value
        : "http://" + obj.value
    );

    return m("a", {
        href: url,
        target: "_blank",
        onclick: function () {
            obj.viewModel.canToggle(false);
        }
    }, obj.value);
};

f.types.array.editor = function (options) {
    return m(catalog.store().components().dataList, options);
};

f.types.array.tableData = function (obj) {
    let value = obj.value;
    let content;

    if (value && value.length) {
        if (typeof value[0] === "object") {
            content = value.map((item) => item.label).toString();
        } else {
            content = value.toString();
        }

        obj.options.title = content;
    }

    return content;
};

f.types.boolean.editor = function (options) {
    let prop = options.prop;
    let opts = {
        id: options.id,
        onCreate: options.onCreate,
        onRemove: options.onRemove,
        required: options.required,
        readonly: options.readonly,
        style: options.style,
        onclick: prop,
        value: prop()
    };

    return m(catalog.store().components().checkbox, opts);
};

f.types.boolean.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            onclick: obj.onclick,
            class: "fa fa-check"
        });
    }
};

f.types.number.editor = function (options) {
    let prop = options.prop;
    let opts = {
        class: options.class,
        readonly: options.readonly,
        id: options.id,
        required: options.required,
        style: options.style,
        type: options.type || "text",
        oncreate: options.onCreate,
        onremove: options.onRemove,
        onchange: (e) => prop(e.target.value),
        value: prop()
    };

    if (prop.min !== undefined) {
        opts.min = prop.min;
    }
    if (prop.max !== undefined) {
        opts.max = prop.max;
    }

    if (opts.class) {
        opts.class = "fb-input " + opts.class;
    } else {
        opts.class = "fb-input";
    }

    opts.class += " fb-input-number";

    return m("input", opts);
};

f.types.number.tableData = function (obj) {
    obj.options.style.textAlign = "right";

    return obj.value.toLocaleString();
};

f.types.integer.editor = function (options) {
    options.type = "number";

    return f.types.number.editor(options);
};

f.types.integer.tableData = f.types.number.tableData;

f.types.string.editor = input.bind(null, "text");

f.types.string.tableData = function (obj) {
    obj.options.title = obj.value;

    return obj.value;
};

/**
  Helper function for building input elements

  Use of this function requires that "Checkbox" has been pre-registered,
  (i.e. "required") in the application before it is called.

  @param {Object} Options object
  @param {Object} [options.model] Model
  @param {String} [options.key] Property key
  @param {Object} [options.viewModel] View Model
  @param {Array} [options.dataList] Array for input lists
*/
f.buildInputComponent = function (obj) {
    let w;
    let name;
    let featherName;
    let key = obj.key;
    let isPath = key.indexOf(".") !== -1;
    let prop = f.resolveProperty(obj.model, key);
    let components = catalog.store().components();
    let editor;

    obj.options.id = obj.options.id || key;

    // Handle input types
    if (typeof prop.type === "string" || isPath) {

        if (isPath || prop.isReadOnly()) {
            obj.options.readonly = true;
        } else {
            obj.options.readonly = false;
        }

        if (prop.isRequired()) {
            obj.options.required = true;
        }

        obj.options.prop = prop;

        if (obj.dataList) {
            return buildSelector(obj, obj.options);
        }

        if (prop.format && f.formats[prop.format].editor) {
            editor = f.formats[prop.format].editor;
        } else if (f.types[prop.type] && f.types[prop.type].editor) {
            editor = f.types[prop.type].editor;
        } else {
            editor = f.types.string.editor;
        }

        return editor({
            class: obj.options.class,
            readonly: obj.options.readonly,
            disableCurrency: obj.options.fCurrency,
            filter: obj.options.filter,
            id: obj.options.id,
            isCell: obj.options.isCell,
            onCreate: obj.options.oncreate,
            onRemove: obj.options.onremove,
            model: obj.model,
            parentProperty: key,
            parentViewModel: obj.viewModel,
            prop: prop,
            required: obj.options.required,
            style: obj.options.style || {},
            showCurrency: obj.options.showCurrency
        });
    }

    // Handle relations
    if (prop.isToOne()) {
        featherName = obj.viewModel.model().name.toCamelCase();
        name = prop.type.relation.toCamelCase() + "Relation";

        if (components[name]) {
            // Hard-coded
            w = components[name];
        } else if (obj.widget) {
            // Relation widget defined by form layout
            w = buildRelationWidgetFromLayout(obj.widget.id);
        } else {
            // Nothing specific, deduce from feather definition
            w = buildRelationWidgetFromFeather(prop.type, featherName);
        }

        if (w) {
            return m(w, {
                parentViewModel: obj.viewModel,
                parentProperty: key,
                filter: obj.filter,
                isCell: obj.options.isCell,
                style: obj.options.style,
                onCreate: obj.options.oncreate,
                onRemove: obj.options.onremove,
                id: obj.options.id,
                isReadOnly: prop.isReadOnly
            });
        }
    }

    if (prop.isToMany()) {
        w = catalog.store().components().childTable;
        if (w) {
            return m(w, {
                parentViewModel: obj.viewModel,
                parentProperty: key
            });
        }
    }

    console.log("Widget for property '" + key + "' is undefined");
};

/*
  Returns the exact x, y coordinents of an HTML element.

  Thanks to:
  http://www.kirupa.com/html5/get_element_position_using_javascript.htm
*/
f.getElementPosition = function (element) {
    let xPosition = 0;
    let yPosition = 0;

    while (element) {
        xPosition += (
            element.offsetLeft -
            element.scrollLeft +
            element.clientLeft
        );
        yPosition += (
            element.offsetTop -
            element.scrollTop +
            element.clientTop
        );
        element = element.offsetParent;
    }

    return {
        x: xPosition,
        y: yPosition
    };
};

/**
    Get a style by name. Returns an object with style elements.

    @param {String} Name
    @return {Object}
*/
f.getStyle = function (name) {
    // Reformat and memoize for fast lookup
    if (!styles) {
        styles = {};
        catalog.store().data().styles().forEach(function (style) {
            let d = style.data;

            styles[style.data.name()] = {
                color: (
                    d.hasColor()
                    ? d.color()
                    : "inherit"
                ),
                backgroundColor: (
                    d.hasBackgroundColor()
                    ? d.backgroundColor()
                    : "inherit"
                ),
                fontWeight: d.fontWeight(),
                textDecoration: "underline " + d.underline()
            };
        });
    }

    return styles[name];
};

/**
  Creates a property getter setter function with a default value.
  Includes state...
  @param {Any} Initial
  @param {Object} Formatter. Optional
  @param {Any} [formatter.default] Function or value returned
        by default.
  @param {Function} [formatter.toType] Converts input to internal type.
  @param {Function} [formatter.fromType] Formats internal
        value for output.
  @return {Function}
*/
f.prop = function (store, formatter) {
    formatter = formatter || {};

    let newValue;
    let oldValue;
    let proposed;
    let p;
    let state;
    let alias;
    let isReadOnly = false;
    let isRequired = false;

    function defaultTransform(value) {
        return value;
    }

    function revert() {
        store = oldValue;
    }

    formatter.toType = formatter.toType || defaultTransform;
    formatter.fromType = formatter.fromType || defaultTransform;

    // Define state
    state = State.define(function () {
        this.state("Ready", function () {
            this.event("change", function () {
                this.goto("../Changing");
            });
            this.event("silence", function () {
                this.goto("../Silent");
            });
            this.event("disable", function () {
                this.goto("../Disabled");
            });
        });
        this.state("Changing", function () {
            this.event("changed", function () {
                this.goto("../Ready");
            });
        });
        this.state("Silent", function () {
            this.event("report", function () {
                this.goto("../Ready");
            });
            this.event("disable", function () {
                this.goto("../Disabled");
            });
        });
        this.state("Disabled", function () {
            // Attempts to make changes from disabled mode revert back
            this.event("changed", revert);
            this.event("enable", function () {
                this.goto("../Ready");
            });
        });
    });

    // Private function that will be returned
    p = function (...args) {
        let value = args[0];

        if (args.length) {
            if (p.state().current()[0] === "/Changing") {
                return p.newValue(value);
            }

            proposed = formatter.toType(value);

            if (proposed === store) {
                return;
            }

            newValue = value;
            oldValue = store;

            p.state().send("change");
            store = (
                value === newValue
                ? proposed
                : formatter.toType(newValue)
            );
            p.state().send("changed");
            newValue = undefined;
            oldValue = undefined;
            proposed = undefined;
        }

        return formatter.fromType(store);
    };

    p.alias = function (...args) {
        if (args.length) {
            alias = args[0];
        }
        return alias;
    };

    /*
      Getter setter for the new value
      @param {Any} New value
      @return {Any}
    */
    p.newValue = function (...args) {
        if (args.length && p.state().current()[0] === "/Changing") {
            newValue = args[0];
        }

        return newValue;
    };

    p.newValue.toJSON = function () {
        return proposed;
    };

    p.oldValue = function () {
        return formatter.fromType(oldValue);
    };

    p.oldValue.toJSON = function () {
        return oldValue;
    };

    p.state = function () {
        return state;
    };

    p.toJSON = function () {
        if (
            typeof store === "object" && store !== null &&
            typeof store.toJSON === "function"
        ) {
            return store.toJSON();
        }

        return store;
    };

    p.newValue.toJSON = function () {
        if (
            typeof newValue === "object" && newValue !== null &&
            typeof newValue.toJSON === "function"
        ) {
            return newValue.toJSON();
        }

        return formatter.toType(newValue);
    };

    /**
      @param {Boolean} Is read only
      @returns {Boolean}
    */
    p.isReadOnly = function (value) {
        if (value !== undefined) {
            isReadOnly = Boolean(value);
        }
        return isReadOnly;
    };
    /**
      @param {Boolean} Is required
      @returns {Boolean}
    */
    p.isRequired = function (value) {
        if (value !== undefined) {
            isRequired = Boolean(value);
        }
        return isRequired;
    };
    p.isToOne = function () {
        return isToOne(p);
    };
    p.isToMany = function () {
        return isToMany(p);
    };
    p.isChild = function () {
        return isChild(p);
    };

    store = formatter.toType(store);
    state.goto();

    return p;
};

/** @private  Helper function to resolve property dot notation */
f.resolveAlias = function (feather, attr) {
    let prefix;
    let suffix;
    let ret;
    let overload = (
        feather.overloads
        ? feather.overloads[attr] || {}
        : {}
    );
    let idx = attr.indexOf(".");

    if (idx > -1) {
        prefix = attr.slice(0, idx);
        suffix = attr.slice(idx + 1, attr.length);
        feather = catalog.getFeather(
            feather.properties[prefix].type.relation
        );
        return f.resolveAlias(feather, suffix);
    }

    if (!feather.properties[attr]) {
        return attr.toName();
    }

    ret = overload.alias || feather.properties[attr].alias || attr;
    return ret.toName();
};

/**
    Helper function to resolve property dot notation. Traverses
    model relations to return child property if dot notation present.

        prop = f.resolveProperty(contact, "address.city");
        console.log(prop()); // "Philadephia"

    @param {Object} Model
    @param {String} Property name
    @return {Function} Property function
*/
f.resolveProperty = function (model, property) {
    let prefix;
    let suffix;
    let idx = property.indexOf(".");

    if (!model) {
        return f.prop(null);
    }

    if (idx > -1) {
        prefix = property.slice(0, idx);
        suffix = property.slice(idx + 1, property.length);
        return f.resolveProperty(model.data[prefix](), suffix);
    }

    if (!model.data[property]) {
        return f.prop("Unknown attribute '" + property + "'");
    }

    return model.data[property];
};

// Define application state
message = f.prop("");
appState = State.define(function () {
    this.state("SignedOut", function () {
        this.event("authenticate", function () {
            this.goto("../Authenticating", {
                context: {
                    username: document.getElementById(
                        "username"
                    ).value,
                    password: document.getElementById(
                        "password"
                    ).value
                }
            });
        });
        this.enter(() => m.route.set("/sign-in"));
        this.message = message;
    });
    this.state("SignedIn", function () {
        this.event("signOut", function () {
            this.goto("../SignedOut");
        });
        this.enter(() => m.route.set("/home"));
        this.message = () => "";
        this.exit(function (context) {
            datasource.request({
                method: "POST",
                path: "/sign-out"
            });
        });
    });
    this.state("Authenticating", function () {
        this.event("success", function () {
            this.goto("../SignedIn");
        });
        this.event("failed", function () {
            this.goto("../SignedOut");
        });
        this.enter(function (context) {
            datasource.request({
                method: "POST",
                path: "/sign-in",
                data: {
                    username: context.username,
                    password: context.password
                }
            }).then(function (resp) {
                message(""); 
                f.state().send("success");
            }).catch(function (err) {
                message(err.message.replace(/"/g, "")); 
                f.state().send("failed");
            });
        });
        this.message = () => "";
    });
});

/**
    Application statechart. States are `SignedIn`, `SignedOut`
    and `Authenticating.`

    @return {Object} statechart
*/
f.state = function () {
    return appState;
};

export default Object.freeze(f);