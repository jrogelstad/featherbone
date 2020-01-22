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
/*jslint this, browser*/
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

        attrs.push(value);
    });

    return {attrs: attrs};
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

    if (obj.dataList.length && obj.dataList[0].value) {
        obj.dataList.unshift({
            value: "",
            label: ""
        });
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

// Resize according to surroundings
/**
    @private
    @method resizeEditor
*/
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

function input(type, options) {
    let prop = options.prop;
    let opts = {
        class: options.class,
        readonly: options.readonly,
        id: options.id,
        key: options.key,
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
        let amount = f.types.number.toType(value.amount);
        let currency = f.formats().string.toType(value.currency);
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
        obj.value = new Date(obj.value + f.now().slice(10));
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

formats.icon.editor = selectEditor.bind(null, iconNames);

formats.icon.tableData = function (obj) {
    if (obj.value) {
        return m("i", {
            class: "fa fa-" + obj.value
        });
    }
};

formats.money.editor = function (options) {
    return m(catalog.store().components().moneyRelation, options);
};
formats.money.tableData = function (obj) {
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

    result = roles.map((role) => role.data.name()).sort();
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
        style: options.style,
        isCell: options.isCell
    };
    return buildSelector(obj, opts);
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
        lint.options.globals = ["f", "m"];
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

    opts.onupdate = function () {
        resizeEditor(this.editor);
    };

    return m("textarea", opts);
};

formats.url.editor = input.bind(null, "url");
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

    result = roles.filter((r) => r.data.objectType() === "UserAccount");
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
            feather = feather || catalog.getFeather("MyModel");
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

        catalog.registerModel("MyModel", createMyModel);

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
        key: options.key,
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
    let key = obj.key;
    let isPath = key.indexOf(".") !== -1;
    let prop = f.resolveProperty(obj.model, key);
    let editor;
    let rel;
    let keys;

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

        // If relation, use feather natural key to
        // find value to display
        if (prop.type && prop.type.relation) {
            rel = catalog.getFeather(prop.type.relation);
            keys = Object.keys(rel.properties);
            rel = (
                keys.find((key) => rel.properties[key].isNaturalKey) ||
                keys.find((key) => rel.properties[key].isLabelKey)
            );
            prop = prop().data[rel];
        }

        if (prop.format && f.formats()[prop.format].editor) {
            editor = f.formats()[prop.format].editor;
        } else if (f.types[prop.type] && f.types[prop.type].editor) {
            editor = f.types[prop.type].editor;
        } else {
            editor = f.types.string.editor;
        }

        return editor({
            class: obj.options.class,
            readonly: obj.options.readonly || isPath,
            disableCurrency: obj.options.fCurrency,
            filter: obj.options.filter,
            key: key,
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

        if (obj.widget) {
            // Relation widget defined by form layout
            w = buildRelationWidgetFromLayout(obj.widget.id);
        } else {
            // See if we have one defined somewhere
            w = f.findRelationWidget(prop.type.relation, true);
        }

        if (!w) {
            // Nothing specific, deduce from feather definition
            w = createRelationWidgetFromFeather(prop.type, featherName);
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
                key: key,
                isReadOnly: prop.isReadOnly
            });
        }
    }

    if (prop.isToMany()) {
        w = catalog.store().components().childTable;
        if (w) {
            return m(w, {
                parentViewModel: obj.viewModel,
                parentProperty: key,
                height: obj.options.height,
                key: key
            });
        }
    }

    console.log("Widget for property '" + key + "' is undefined");
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
