/*
    Feather definitions used by unit tests that build client models
    without a server. Shaped like /settings/catalog output: a parent with
    a natural key, number/money-like fields, an etag, a to-one relation
    with limited properties, and a child array whose rows are child
    feathers (childOf).
*/
/*jslint node*/
"use strict";

const FEATHERS = [{
    name: "TestCategory",
    plural: "TestCategories",
    description: "Category",
    properties: {
        code: {type: "string", isNaturalKey: true, isRequired: true},
        description: {type: "string"}
    }
}, {
    name: "TestItem",
    plural: "TestItems",
    description: "Parent record",
    properties: {
        etag: {type: "string", isReadOnly: true},
        name: {type: "string", isNaturalKey: true, isRequired: true},
        description: {type: "string"},
        qty: {type: "number", scale: 2, min: 0},
        price: {type: "number"},
        count: {type: "integer", max: 100},
        isActive: {type: "boolean", default: true},
        category: {
            type: {
                relation: "TestCategory",
                properties: ["code", "description"]
            }
        },
        lines: {
            type: {relation: "TestItemLine", parentOf: "parent"}
        }
    }
}, {
    name: "TestItemLine",
    plural: "TestItemLines",
    description: "Child row",
    isChild: true,
    properties: {
        parent: {
            type: {relation: "TestItem", childOf: "lines"}
        },
        sequence: {type: "integer"},
        product: {type: "string", isRequired: true},
        qty: {type: "number", scale: 2}
    }
}, {
    name: "TestAuto",
    plural: "TestAutos",
    description: "Autonumber natural key",
    properties: {
        number: {
            type: "string",
            isNaturalKey: true,
            autonumber: {prefix: "A", sequence: "a_seq", length: 3}
        },
        note: {type: "string"}
    }
}, {
    name: "TestPlain",
    plural: "TestPlains",
    description: "No natural key",
    properties: {
        note: {type: "string"}
    }
}];

function registerAll(env) {
    FEATHERS.forEach((f) => env.registerFeather(f));
}

/**
    Register the system feathers shipped in scripts/ (feathers-bootstrap
    and feathers.json: Document, Form, Currency, Contact, UserAccount...)
    the way /settings/catalog delivers them, including the parentOf side
    of child relations the server derives (e.g. Currency.conversions).
*/
function registerSystem(env) {
    const path = require("path");
    const scripts = path.join(env.ROOT, "scripts");
    const defs = require(path.join(scripts, "feathers-bootstrap.json")).concat(
        require(path.join(scripts, "feathers.json"))
    );
    const byName = {};

    defs.forEach(function (def) {
        byName[def.name] = JSON.parse(JSON.stringify(def));
        delete byName[def.name].authorizations;
    });
    // Add parentOf side of every childOf relation
    Object.keys(byName).forEach(function (name) {
        let props = byName[name].properties || {};
        Object.keys(props).forEach(function (key) {
            let type = props[key].type;
            if (type && typeof type === "object" && type.childOf) {
                let parent = byName[type.relation];
                byName[name].isChild = true;
                if (parent && !parent.properties[type.childOf]) {
                    parent.properties[type.childOf] = {
                        description: "Children",
                        type: {relation: name, parentOf: key}
                    };
                }
            }
        });
    });
    Object.keys(byName).forEach((n) => env.registerFeather(byName[n]));

    // main.js registers a data list for each isFetchOnStartup feather
    // (currencies, states, countries...); start them empty
    Object.keys(byName).forEach(function (n) {
        let def = byName[n];
        let f = globalThis.f;
        let data = f.catalog().store().data;
        let key = def.plural.toCamelCase();
        if (def.isFetchOnStartup && (!data || !data()[key])) {
            f.catalog().register("data", key, f.prop([]));
        }
    });
}

/**
    Load currency data the way main.js does for isFetchOnStartup feathers:
    USD (base currency, minor unit 2). Requires registerSystem first.
*/
function registerCurrencies(f) {
    let data = f.catalog().store().data();
    let usd;
    if (data.currencies().length) {
        return;
    }
    usd = f.createModel("Currency", {
        id: "USD",
        code: "USD",
        description: "US Dollar",
        minorUnit: 2,
        symbol: "$"
    });
    usd.state().goto("/Ready/Fetched");
    data.currencies().push(usd);
    data.baseCurrencies().push(f.createModel("BaseCurrency", {
        id: "base-usd",
        currency: {id: "USD", code: "USD"},
        effective: "2020-01-01T00:00:00.000Z"
    }));
}

// Feather with one property per editor format / relation widget
const WIDGETS = {
    name: "TestWidgets",
    plural: "TestWidgetsList",
    description: "One property per editor",
    properties: {
        name: {type: "string", isNaturalKey: true, isRequired: true},
        amount: {type: "object", format: "money"},
        site: {type: "string", format: "url"},
        // data-type editor expects the model property to be named "type"
        type: {type: "object", format: "dataType"},
        options: {type: "array"},
        address: {type: {relation: "Address"}},
        contact: {type: {relation: "Contact"}},
        link: {type: {relation: "ResourceLink"}},
        help: {type: {relation: "HelpLink"}},
        plan: {type: "object", format: "gantt"},
        when: {type: "string", format: "date"},
        at: {type: "string", format: "dateTime"},
        color: {type: "string", format: "color"},
        notes: {type: "string", format: "textArea"},
        phone: {type: "string", format: "tel"},
        email: {type: "string", format: "email"},
        secret: {type: "string", format: "password"},
        status: {
            type: "string",
            format: "enum",
            dataList: [
                {value: "A", label: "Active"},
                {value: "I", label: "Inactive"}
            ]
        },
        icon: {type: "string", format: "icon"},
        flag: {type: "boolean"},
        count: {type: "integer"},
        autonum: {type: "object", format: "autonumber"}
    }
};

module.exports = {
    FEATHERS,
    WIDGETS,
    registerAll,
    registerSystem,
    registerCurrencies
};
