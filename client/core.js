/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint this, browser, bitwise*/
/**
    @module Core
*/
import createProperty from "./property.js";
import createModel from "./models/model.js";
import createList from "./models/list.js";
import catalog from "./models/catalog.js";
import datasource from "./datasource.js";
import State from "./state.js";
import icons from "./icons.js";

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
    "etag"
];
const formats = {};

let styles;

// ..........................................................
// PRIVATE
//

let message;
let appState;

/**
    Auto-build a form definition based on feather properties.

    @private
    @method buildForm
    @param {String | Object} Feather
    @return {Object} Form definition
*/
function buildForm(feather) {
    let props;
    let keys;
    let found;
    let theAttrs = [];

    if (typeof feather === "string") {
        feather = catalog.getFeather(feather);
    }

    props = f.copy(feather.properties);
    keys = Object.keys(props);

    // Make sure key attributes are first
    found = keys.find((key) => props[key].isNaturalKey);
    if (found) {
        theAttrs.push({attr: found});
        keys.splice(keys.indexOf(found), 1);
    }

    found = keys.find((key) => props[key].isLabelKey);
    if (found) {
        theAttrs.push({attr: found});
        keys.splice(keys.indexOf(found), 1);
    }

    // Build config with remaining keys
    keys.forEach(function (key) {
        let value = {attr: key};
        let p;
        let k;

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
            p = catalog.getFeather(props[key].type.relation).properties;
            k = Object.keys(p);
            k = k.filter(function (key) {
                return (
                    exclusions.indexOf(key) === -1 &&
                    (typeof p[key] !== "object" || !p[key].type.childOf)
                );
            });
            value.columns = k.map(function (key) {
                return {attr: key};
            });
            value.height = "200px";
        }

        theAttrs.push(value);
    });

    return {attrs: theAttrs};
}

/**
    @private
    @method column
*/
function column(item) {
    return {attr: item};
}

/**
    @private
    @method createRelationWidgetFromFeather
    @return {Object}
*/
function createRelationWidgetFromFeather(type, featherName) {
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

/**
    @private
    @method buildSelector
*/
function buildSelector(obj, opts) {
    let theId = opts.id;
    let vm = obj.viewModel;
    let selectComponents = vm.selectComponents();
    let val = opts.prop();
    let values = obj.dataList.map((item) => item.value).join();

    val = (
        val === ""
        ? undefined
        : val
    );

    if (opts.class) {
        opts.class = "fb-input " + opts.class;
    } else {
        opts.class = "fb-input";
    }

    if (selectComponents[theId]) {
        if (
            selectComponents[theId].value === val &&
            selectComponents[theId].readonly === opts.readonly &&
            selectComponents[theId].values === values
        ) {
            return selectComponents[theId].content;
        }
    } else {
        selectComponents[theId] = {};
    }

    if (obj.dataList.length && obj.dataList[0].value) {
        obj.dataList.unshift({
            value: "",
            label: ""
        });
    }

    selectComponents[theId].value = val;
    selectComponents[theId].readonly = opts.readonly;
    selectComponents[theId].values = values;
    selectComponents[theId].content = m("select", {
        id: theId,
        key: theId,
        onchange: (e) => opts.prop(e.target.value),
        oncreate: opts.oncreate,
        onremove: opts.onremove,
        onfocus: opts.onfocus,
        onblur: opts.onblur,
        value: val,
        readonly: opts.readonly,
        disabled: opts.readonly,
        class: opts.class,
        style: opts.style
    }, obj.dataList.map(function (item) {
        return m("option", {
            value: item.value,
            key: theId + "$" + item.value
        }, item.label);
    }));

    return selectComponents[theId].content;
}

/**
    @private
    @method buildRelationWidgetFromLayout
*/
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

function input(pType, options) {
    let prop = options.prop;
    let opts = {
        class: options.class,
        readonly: options.readonly,
        id: options.id,
        key: options.key,
        required: options.required,
        style: options.style,
        type: pType,
        onchange: (e) => prop(e.target.value),
        oncreate: options.onCreate,
        onremove: options.onRemove,
        onfocus: options.onFocus,
        onblur: options.onBlur,
        value: prop()
    };

    if (opts.class) {
        opts.class = "fb-input " + opts.class;
    } else {
        opts.class = "fb-input";
    }

    return m("input", opts);
}

formats.string = {
    default: "",
    toType: (value) => value.toString()
};
formats.date = {
    type: "string",
    toType: function (value) {
        let month;
        let ret = "";

        if (
            value &&
            value.constructor.name === "Date"
        ) {
            month = value.getUTCMonth() + 1;
            ret += value.getUTCFullYear() + "-";
            ret += month.pad(2, "0") + "-";
            ret += value.getUTCDate().pad(2, "0");
        } else {
            ret = value;
        }
        return ret;
    },
    default: () => f.today()
};
formats.dateTime = {
    type: "string",
    default: () => f.now(),
    fromType: (value) => new Date(value).toLocalDateTime(),
    toType: function (value) {
        if (
            value &&
            value.constructor.name === "Date"
        ) {
            return new Date(value).toISOString();
        }
        return value;
    }
};
formats.password = {
    type: "string",
    default: "",
    fromType: () => "*****"
};
formats.tel = {
    type: "string",
    default: ""
};
formats.email = {
    type: "string",
    default: ""
};
formats.url = {
    type: "string",
    default: ""
};
formats.color = {
    type: "string",
    default: "#000000"
};
formats.textArea = {
    type: "string",
    default: ""
};
formats.script = {
    type: "string",
    default: ""
};
formats.money = {
    type: "object",
    default: () => f.money(),
    fromType: function (value) {
        let style;
        let amount = value.amount || 0;
        let currVal = value.currency;
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

            currVal = curr.data.displayUnit().data.code();
        }

        return {
            amount: amount.toLocaleString(undefined, style),
            currency: currVal,
            effective: (
                value.effective === null
                ? null
                : f.formats().dateTime.fromType(value.effective)
            ),
            baseAmount: (
                value.baseAmount === null
                ? null
                : f.types.number.fromType(value.baseAmount)
            )
        };
    },
    toType: function (value) {
        value = value || f.money();
        let theAmount = f.types.number.toType(value.amount);
        let theCurrency = f.formats().string.toType(value.currency);
        let curr = f.getCurrency(value.currency);

        if (curr.data.hasDisplayUnit() && theCurrency !== curr.data.code()) {
            curr.data.conversions().some(function (conv) {
                if (conv.data.toUnit().id() === curr.data.displayUnit().id()) {
                    theAmount = theAmount.times(
                        conv.data.ratio().round(curr.data.minorUnit())
                    );
                    return true;
                }
            });

            theCurrency = curr.data.code();
        }

        value = {
            amount: theAmount,
            currency: theCurrency,
            effective: (
                value.effective === null
                ? null
                : f.formats().dateTime.toType(value.effective)
            ),
            baseAmount: (
                value.baseAmount === null
                ? null
                : f.types.number.toType(value.baseAmount)
            )
        };

        return Object.freeze(value);
    }
};
formats.enum = {
    type: "string",
    default: ""
};
formats.lock = {
    type: "object"
};
formats.dataType = {
    type: "object"
};
formats.icon = {
    type: "string",
    default: ""
};

formats.autonumber = {
    type: "object"
};
formats.autonumber.editor = function (options) {
    return m(catalog.store().components().autonumber, options);
};

formats.autonumber.tableData = function (obj) {
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

formats.color.editor = input.bind(null, "color");
formats.color.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            style: {
                color: obj.value
            },
            class: "fa fa-square"
        });
    }
};

formats.date.editor = input.bind(null, "date");
formats.date.tableData = function (obj) {
    if (obj.value) {
        // Turn into date adjusting time for
        // current timezone
        obj.value = f.isoDateToDate(obj.value);
        return obj.value.toLocaleDateString();
    }
};

formats.dateTime.editor = input.bind(null, "datetime-local");
formats.dateTime.tableData = function (obj) {
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

formats.dataType.editor = function (options) {
    return m(catalog.store().components().dataType, options);
};

formats.dataType.tableData = function (obj) {
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

formats.enum.tableData = function (obj) {
    let found;
    if (typeof obj.prop.dataList[0] === "object") {
        found = obj.prop.dataList.find(function (item) {
            return item.value === obj.value;
        });
        if (found) {
            return found.label;
        } else {
            return "invalid value " + obj.value;
        }
    }

    return obj.value;
};

let gantt = {
    type: "object",
    fromType: function (val) {
        let ary = (
            (val && val.data)
            ? val.data.slice()
            : []
        );
        ary.forEach(function (i) {
            if (typeof i.start === "string") {
                i.start = f.parseDate(i.start);
            }
            if (typeof i.end === "string") {
                i.end = f.parseDate(i.end);
            }
        });

        return ary;
    },
    default: {},
    editor: function (options) {
        return m(catalog.store().components().gantt, options);
    }
};

formats.gantt = gantt;

function iconNames() {
    let result = f.copy(icons);
    result = result.map(function (icon) {
        return {
            value: icon,
            label: icon
        };
    });
    result.unshift({
        value: "",
        label: ""
    });
    return result;
}

function selectEditor(dataList, options) {
    let obj = {
        viewModel: options.parentViewModel,
        dataList: dataList()
    };
    let opts = {
        id: options.id,
        key: options.key,
        prop: options.prop,
        class: options.class,
        readonly: options.readonly,
        oncreate: options.onCreate,
        onremove: options.onRemove,
        onfocus: options.onFocus,
        onblur: options.onBlur,
        style: options.style,
        isCell: options.isCell
    };
    return buildSelector(obj, opts);
}

formats.icon.editor = selectEditor.bind(null, iconNames);

formats.icon.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            class: "fa fa-" + obj.value,
            title: obj.title
        });
    }
};

formats.money.editor = function (options) {
    return m(catalog.store().components().moneyRelation, options);
};
formats.money.tableData = function (obj) {
    let value = f.copy(f.formats().money.toType(obj.value));
    let options = obj.options;
    let curr = f.getCurrency(value.currency);
    let du;
    let symbol;
    let minorUnit = 2;
    let content;
    let isNegative = false;

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

    if (value.amount < 0) {
        isNegative = true;
        value.amount = Math.abs(value.amount);
    }

    content = value.amount.toLocaleString(
        undefined,
        {
            minimumFractionDigits: minorUnit,
            maximumFractionDigits: minorUnit
        }
    );

    content = symbol + content;

    if (isNegative) {
        content = "(" + content + ")";
        options.style.color = "red";
    }

    options.style.textAlign = "right";

    return content;
};

formats.overloadType = {
    type: "object"
};
formats.overloadType.editor = function (options) {
    options.isOverload = true;

    return m(catalog.store().components().dataType, options);
};
formats.overloadType.tableData = function (obj) {
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

formats.password.editor = input.bind(null, "password");

formats.role = {
    type: "string"
};

function roleNames() {
    let roles = catalog.store().data().roles().slice();
    let result;

    result = roles.filter((r) => !r.data.isDeleted());
    result = result.map((role) => role.data.name()).sort();
    result = result.map(function (role) {
        return {
            value: role,
            label: role
        };
    });
    result.unshift({
        value: "",
        label: ""
    });
    return result;
}

formats.role.editor = selectEditor.bind(null, roleNames);

formats.tel.editor = input.bind(null, "tel");

formats.textArea.editor = function (options) {
    let prop = options.prop;
    let opts = {
        readonly: options.readonly,
        id: options.id,
        key: options.key,
        required: options.required,
        style: options.style,
        onchange: (e) => prop(e.target.value),
        oncreate: options.onCreate,
        onremove: options.onRemove,
        onfocus: options.onFocus,
        onblur: options.onBlur,
        value: prop(),
        rows: options.rows || 4
    };

    return m("textarea", opts);
};

formats.script.editor = function (options) {
    let prop = options.prop;
    let model = options.model;
    let opts = {
        readonly: options.readonly,
        id: options.id,
        key: options.key,
        required: options.required,
        onchange: (e) => prop(e.target.value),
        value: prop(),
        onfocus: options.onFocus,
        onblur: options.onBlur
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
        lint.options.globals = ["f", "m"];

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
        lint.options.onUpdateLinting = function (annotations) {
            // Let model reference lint annoations
            model.data.annotations(annotations);
            m.redraw();
        };

        // Send changed text back to model
        editor.on("blur", function () {
            editor.save();
            prop(e.value);
            m.redraw();
        });

        this.editor = editor;
    };

    return m("textarea", opts);
};

formats.url.editor = function (options) {
    return m(catalog.store().components().urlWidget, options);
};
formats.url.tableData = function (obj) {
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

formats.userAccount = {
    type: "string"
};
function userAccountNames() {
    let roles = catalog.store().data().roles().slice();
    let result;

    result = roles.filter((r) => (
        r.data.objectType() === "UserAccount" && !r.data.isDeleted()
    ));
    result = result.map((role) => role.data.name()).sort();
    result = result.map(function (role) {
        return {
            value: role,
            label: role
        };
    });
    result.unshift({
        value: "",
        label: ""
    });
    return result;
}
formats.userAccount.editor = selectEditor.bind(null, userAccountNames);

/**
    Return system catalog.

    @method catalog
    @for f
    @return {catalog}
*/
f.catalog = function () {
    return catalog;
};

/**
    Call the constructor for a registered view model.

    @method createViewModel
    @param {String} View model class name
    @param {Object} [options] See class definition for options
    @return {Object} View model
*/
f.createViewModel = function (name, options) {
    return catalog.store().viewModels()[name.toCamelCase()](options);
};

/**
    Return system datasource.

    @method datasource
    @for f
    @return {Datasource}
*/
f.datasource = function () {
    return datasource;
};

/**
    Get a registered component.

    @method getComponent
    @param {String} Component class name
    @return {Object}
*/
f.getComponent = function (name) {
    return catalog.store().components()[name.toCamelCase()];
};

/**
    Return the matching currency object.

    @method getCurrency
    @for f
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

    @method getForm
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

    @property inputMap
    @type Object
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

    @method feathers
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

    @method findRoot
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
    Return an array of models of the feather name passed.

    @method createList
    @param {String} feather Feather name
    @param {Object} [options]
    @param {Boolean} [options.fetch] Automatically fetch on creation
    @param {Boolean} [options.subscribe] Subscribe to events
    @param {Boolean} [options.showDeleted] Show deleted
    @param {Boolean} [options.isEditable] Models are editable (default true)
    @param {Object} [options.filter] Filter
    @return {List}
*/
f.createList = (feather, options) => createList(feather)(options)();

/**
    Create a model instance with a specific feather definition. Use for
    extending the Model class.
    @example
        let createMyModel = function (data, feather) {
            // Assume here feather has been created
            feather = feather || f.catalog().getFeather("MyModel");
            let model = f.createModel(data, feather);

            // Do something interesting that a feather can't do alone
            model.onValidate(function () {
                if (
                    model.data.foo() === "" &&
                    model.data.bar() === ""
                ) {
                    throw new Error("Either foo or bar must have a value");
                };
            });
        });

        f.catalog().registerModel("MyModel", createMyModel);

        f.createModel("MyModel"); // Returns instance of MyModel
    @method createModel
    @param {Object} [data] Data
    @param {Object} feather Feather definition
    @return {Model}
*/
/**
    Create a model instance based on the name of a registered feather.
    @example
        let data = {
            firstName: "John",
            lastName: "Doe"
        }
        let model = f.createModel("Contact", data);
        model.save(); // Persists newly created contact
    @method createModel
    @param {String} feather Feather name
    @param {Object} [data] Data
    @return {Model}
*/
f.createModel = function (arg1, arg2) {
    let model;

    if (typeof arg1 === "string") {
        model = catalog.store().models()[arg1.toCamelCase()];

        if (!model) {
            throw new Error("Model " + arg1 + " not registered.");
        }
        return model(arg2);
    }

    return createModel(arg1, arg2);
};
/**
    Formats for property data types used in a
    {{#crossLink "Model"}}{{/crossLink}}.

    Formats over-ride type handling when a specific format is referenced
    on a {{#crossLink "Model"}}{{/crossLink}} property, such as an
    alternative default value, or an editor
    in the user interface. Wherever a format property is not explicitly defined
    featherbone will fall back to the default handling for the type.

    The following properties are supported on formats:
    * **type**: JSON type format applies to.
    * **default:** Default value or function.
    * **fromType:** Function to convert a JSON type to another format in the
    client. For example converting a string to a `Date` object.
    * **toType:** Function to convert a value on the client to a JSON type for
    example converting a `Date` object to a string.
    * **tableData:** Function to convert property's value to Mithril view
    content for a {{#crossLinkModule "TableWidget"}}{{/crossLinkModule}} cell.
    For example process as a hyperlink, or present selected object properties on
    an object value as a string.
    * **editor:** Function to return Mithril hyperscript used for editing the
    value in in the user interface.

    @example
        // Format a string type as an array
        let format = {
            type: "string",
            default: [],
            fromType: (value) = value.split(","),
            toType: (value) => value.toString(),
            editor: function () {
                let c = // component code here...
                let vm = // view model code here...
                return m(c, {viewModel: vm});
            }
        };

        f.formats().myFormat = format;

    @method formats
    @return {Object}
*/
f.formats = () => formats;
/**
    Return a money object.

    @method money
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

/**
    Return absolute value hash code.

    @method hash code
    @param {String} String.
    @return {Number}
*/
f.hashCode = function (s) {
    return Math.abs(
        s.split("").reduce(
            function (a, b) {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
            },
            0
        )
    );
};

f.types.address = {};
f.types.address.tableData = function (obj) {
    let value = obj.value;
    let content = "";
    let cr = "\n";
    let title = "";
    let d;

    if (value) {
        d = value.data;

        content = d.city() + ", " + d.state() + " " + d.postalCode();

        title = d.street();

        if (d.unit()) {
            title += cr + d.unit();
        }

        title += cr + d.city() + ", ";
        title += d.state() + " " + d.postalCode();
        title += cr + d.country();

        obj.options.title = title;
    }

    return content;
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

f.types.boolean.default = false;
f.types.boolean.toType = (value) => Boolean(value);
f.types.boolean.editor = function (options) {
    let prop = options.prop;
    let opts = {
        id: options.id,
        key: options.key,
        isCell: options.isCell,
        onCreate: options.onCreate,
        onRemove: options.onRemove,
        onFocus: options.onFocus,
        onBlur: options.onBlur,
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
        key: options.key,
        required: options.required,
        style: options.style,
        type: options.type || "text",
        oncreate: options.onCreate,
        onremove: options.onRemove,
        onfocus: options.onFocus,
        onblur: options.onBlur,
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
f.types.integer.toType = (value) => parseInt(value, 10);

f.types.string.editor = input.bind(null, "text");
f.types.string.tableData = function (obj) {
    obj.options.title = obj.value;

    return obj.value;
};

f.findRelationWidget = function (relation, isTop) {
    let name = relation.toCamelCase() + "Relation";
    let components = catalog.store().components();
    let ret = components[name];
    let inherits;

    if (ret || relation === "Object") {
        return ret;
    }

    inherits = catalog.getFeather(relation).inherits || "Object";
    ret = f.findRelationWidget(inherits);

    if (ret && isTop) {
        components[name] = ret; // Memoize
    }

    return ret;
};

/**
    Factory for building input elements

    @method createEditor
    @param {Object} [options] Options object
    @param {Object} [options.model] Model
    @param {String} [options.key] Property key
    @param {Object} [options.viewModel] View Model
    @param {Array} [options.dataList] Array for input lists
*/
f.createEditor = function (obj) {
    let w;
    let featherName;
    let theKey = obj.key;
    let isPath = theKey.indexOf(".") !== -1;
    let theProp = f.resolveProperty(obj.model, theKey);
    let editor;
    let rel;
    let keys;

    obj.options.id = obj.options.id || theKey;

    // Handle input types
    if (typeof theProp.type === "string" || isPath) {

        if (isPath || theProp.isReadOnly()) {
            obj.options.readonly = true;
        } else {
            obj.options.readonly = false;
        }

        if (theProp.isRequired()) {
            obj.options.required = true;
        }

        obj.options.prop = theProp;

        if (obj.dataList) {
            obj.options.onfocus = () => f.processEvents(false);
            obj.options.onblur = () => f.processEvents(true);
            return buildSelector(obj, obj.options);
        }

        // If relation, use feather natural key to
        // find value to display
        if (theProp.type && theProp.type.relation) {
            rel = catalog.getFeather(theProp.type.relation);
            keys = Object.keys(rel.properties);
            rel = (
                keys.find((theKey) => rel.properties[theKey].isNaturalKey) ||
                keys.find((theKey) => rel.properties[theKey].isLabelKey)
            );
            theProp = theProp().data[rel];
        }

        if (theProp.format && f.formats()[theProp.format].editor) {
            editor = f.formats()[theProp.format].editor;
        } else if (f.types[theProp.type] && f.types[theProp.type].editor) {
            editor = f.types[theProp.type].editor;
        } else {
            editor = f.types.string.editor;
        }

        return editor({
            class: obj.options.class,
            readonly: obj.options.readonly || isPath,
            disableCurrency: obj.options.disableCurrency,
            filter: obj.options.filter,
            key: theKey,
            id: obj.options.id,
            isCell: obj.options.isCell,
            onCreate: obj.options.oncreate,
            onRemove: obj.options.onremove,
            onFocus: () => f.processEvents(false),
            onBlur: () => f.processEvents(true),
            model: obj.model,
            parentProperty: theKey,
            parentViewModel: obj.viewModel,
            prop: theProp,
            required: obj.options.required,
            style: obj.options.style || {},
            showCurrency: obj.options.showCurrency
        });
    }

    // Handle relations
    if (theProp.isToOne()) {
        featherName = obj.viewModel.model().name.toCamelCase();

        if (obj.widget) {
            // Relation widget defined by form layout
            w = buildRelationWidgetFromLayout(obj.widget.id);
        } else {
            // See if we have one defined somewhere
            w = f.findRelationWidget(theProp.type.relation, true);
        }

        if (!w) {
            // Nothing specific, deduce from feather definition
            w = createRelationWidgetFromFeather(theProp.type, featherName);
        }

        if (w) {
            return m(w, {
                parentViewModel: obj.viewModel,
                parentProperty: theKey,
                filter: obj.filter,
                isCell: obj.options.isCell,
                style: obj.options.style,
                onCreate: obj.options.oncreate,
                onRemove: obj.options.onremove,
                onFocus: () => f.processEvents(false),
                onBlur: () => f.processEvents(true),
                id: obj.options.id,
                key: theKey,
                isReadOnly: theProp.isReadOnly
            });
        }
    }

    if (theProp.isToMany()) {
        w = catalog.store().components().childTable;
        if (w) {
            return m(w, {
                parentViewModel: obj.viewModel,
                parentProperty: theKey,
                height: obj.options.height,
                key: theKey
            });
        }
    }

    console.log("Widget for property '" + theKey + "' is undefined");
};

/**
    Build a relation widget from a feather definition

    @method createRelationWidget
    @param {Object} type Type from Property
    @param {String} feather Parent feather name
    @return {Object}
*/
f.createRelationWidget = createRelationWidgetFromFeather;

/**
  Returns the exact x, y coordinents of an HTML element.

  Thanks to:
  http://www.kirupa.com/html5/get_element_position_using_javascript.htm

  @method getElementPosition
  @param {Object} Element
  @return {Object}
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

    @method getStyle
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
    Includes state.

    @method prop
    @param {Any} store Initial
    @param {Object} [formatter] Formatter. Optional
    @param {Any} [formatter.default] Function or value returned
        by default.
    @param {Function} [formatter.toType] Converts input to internal type.
    @param {Function} [formatter.fromType] Formats internal
        value for output.
    @return {Property}
*/
f.prop = createProperty;

let holdEvents = false;
let pending = [];

/**
    Turn processing of events on or off. Used to prevent event handling and
    redrawing while user is editing records.

    @method processEvents
    @param {Boolean} flag Set false to hold events, true to process pending
*/
f.processEvents = function (flag) {
    if (flag === true) {
        holdEvents = false;
        while (pending.length) {
            f.processEvent(pending.shift());
        }
        return;
    }

    if (flag === false) {
        holdEvents = true;
    }
};

/**
    Process events sent from the server.

    @method processEvent
    @param {Object} event Server event object
*/
f.processEvent = function (obj) {
    let instance;
    let ary;
    let payload;
    let subscriptionId;
    let change;
    let patching = "/Busy/Saving/Patching";
    let data;
    let event = obj.event;
    let formsSid = obj.formsSubscrId;
    let moduleSid = obj.moduleSubscrId;

    if (holdEvents) {
        pending.push(obj);
        return;
    }

    try {
        payload = JSON.parse(event.data);
    } catch (ignore) {
        console.log(event.data);
        return;
    }
    change = payload.message.subscription.change;

    if (change === "signedOut") {
        f.state().send("signOut");
        return;
    }

    data = payload.message.data;

    if (change === "feather") {
        if (payload.message.subscription.deleted) {
            catalog.unregister("feathers", data);
            catalog.unregister("models", data.toCamelCase());
        } else {
            catalog.register("feathers", data.name, data);
            catalog.registerModel(
                data.name,
                function (d, spec) {
                    return createModel(d, spec || data);
                },
                Boolean(data.plural)
            );
        }
        return;
    }

    subscriptionId = payload.message.subscription.subscriptionid;
    ary = catalog.store().subscriptions()[subscriptionId];

    if (!ary) {
        return;
    }

    // Special application change events
    switch (subscriptionId) {
    case moduleSid:
        if (change === "create") {
            catalog.store().data().modules().push({
                value: data.name,
                label: data.name
            });
        }
        return;
    case formsSid:
        if (change === "create") {
            ary.push(data);
        } else if (change === "update") {
            instance = ary.find((item) => item.id === data.id);
            ary.splice(ary.indexOf(instance), 1, data);
        } else if (change === "delete") {
            instance = ary.find((item) => item.id === data);
            ary.splice(ary.indexOf(instance), 1);
        }

        return;
    }

    // Apply event to the catalog data;
    switch (change) {
    case "update":
        instance = ary.find(function (model) {
            return model.id() === data.id;
        });

        if (instance) {
            // Only update if not caused by this instance
            if (
                instance.state().current()[0] !== patching && (
                    !data.etag || (
                        data.etag && instance.data.etag &&
                        data.etag !== instance.data.etag()
                    )
                )
            ) {
                instance.state().goto("Ready/Fetched/ReadOnly");
                instance.set(data, true, true);
                instance.state().goto("Ready/Fetched/Clean");
                m.redraw();
            }
        }
        break;
    case "create":
        ary.add(ary.model(data));
        break;
    case "delete":
        instance = ary.find(function (model) {
            return model.id() === data;
        });

        if (instance) {
            if (ary.showDeleted()) {
                instance.data.isDeleted(true);
            } else {
                ary.remove(instance);
            }
        }
        break;
    case "lock":
        instance = ary.find(function (model) {
            return model.id() === data.id;
        });

        if (instance) {
            instance.lock(data.lock);
            m.redraw();
        }
        break;
    case "unlock":
        instance = ary.find(function (model) {
            return model.id() === data;
        });

        if (instance) {
            instance.unlock();
            m.redraw();
        }
        break;
    }

    m.redraw();
};

/**
    Helper function to resolve property dot notation.

    @method resolveAlias
    @for f
    @param {Object} Feather
    @param {String} Attribute name
    @return {String}
*/
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

    @method resolveProperty
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
f.currentUser = f.prop();
message = f.prop("");
appState = State.define(function () {
    this.state("Uninitialized", function () {
        this.event("preauthorized", function () {
            this.goto("../SignedIn");
        });
        this.event("signIn", function () {
            this.goto("../SignedOut");
        });
        this.message = () => "";
    });
    this.state("SignedOut", function () {
        this.event("authenticate", function () {
            let user = document.getElementById(
                "username"
            ).value;

            this.goto("../Authenticating", {
                context: {
                    username: user,
                    password: document.getElementById(
                        "password"
                    ).value
                }
            });
        });
        this.enter(function () {
            f.currentUser({});
            m.route.set("/sign-in");
        });
        this.message = message;
    });
    this.state("SignedIn", function () {
        this.event("signOut", function () {
            this.goto("../SignedOut");
        });
        this.message = () => "";
        this.exit(function () {
            datasource.request({
                method: "POST",
                path: "/sign-out"
            }).then(() => location.reload());
        });
    });
    this.state("Authenticating", function () {
        this.event("success", function () {
            this.goto("../SignedIn");
            m.route.set("/home");
        });
        this.event("failed", function () {
            this.goto("../SignedOut");
        });
        this.enter(function (context) {
            datasource.request({
                method: "POST",
                path: "/sign-in",
                body: {
                    username: context.username,
                    password: context.password
                }
            }).then(function (resp) {
                f.currentUser(resp);
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
appState.goto();

/**
    Application statechart. States are `SignedIn`, `SignedOut`
    and `Authenticating.`

    @method state
    @for f
    @return {Object} statechart
*/
f.state = function () {
    return appState;
};

/**
    State constructor.
    @method State
    @return {State}
*/
f.State = State;

export default Object.freeze(f);
