/*
    Regression test harness: data builders.

    Builds a small, self-contained "camper shop" modeled on the demo
    database (site WH1, "ea" units, Shop labor, CNC table, the
    2-CABIN-CABINET-ASSY bill of material). Every record gets a unique
    RT- prefix so tests never collide with demo data or with each other,
    and the same tests run on a clone of demo or on a fresh install.
*/
/*jslint node*/
"use strict";

let counter = 0;

// Unique, short, sortable suffix for natural keys
function uniq(prefix) {
    counter += 1;
    return (
        (prefix || "RT") + "-" +
        Date.now().toString(36).toUpperCase() +
        process.pid.toString(36).toUpperCase() +
        counter
    );
}

function money(amount, currency) {
    return {amount, currency: currency || "USD"};
}

function today(offsetDays) {
    let d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
}

function ref(rec) {
    return {id: rec.id};
}

async function findOne(session, plural, property, value) {
    let rows = await session.findBy(plural, property, value);
    return rows[0];
}

// Find by natural key or create
async function ensure(session, feather, plural, key, data) {
    let found = await findOne(session, plural, key, data[key]);
    if (found) {
        return found;
    }
    return session.create(feather, data);
}

async function address(session, overrides) {
    return session.create("Address", Object.assign({
        type: "W",
        name: "Regression Test",
        street: "100 Test Way",
        city: "Springfield",
        state: "IL",
        postalCode: "62701",
        country: "United States"
    }, overrides));
}

async function currency(session, code) {
    let found = await findOne(session, "Currencies", "code", code || "USD");
    if (!found) {
        throw new Error("Currency " + (code || "USD") + " not found");
    }
    return found;
}

async function location(session, name) {
    return session.create("Location", {
        name: name || uniq("LOC"),
        description: "Regression test location"
    });
}

async function site(session) {
    let addr = await address(session);
    let stock = await location(session);
    return session.create("Site", {
        code: uniq("WH"),
        description: "Regression test warehouse",
        address: ref(addr),
        locationControlled: false,
        defaultLocation: ref(stock),
        defaultReceiveLocation: ref(stock),
        defaultShipLocation: ref(stock),
        defaultWipLocation: ref(stock)
    });
}

async function unit(session, code, description) {
    return ensure(session, "ItemUnit", "ItemUnits", "code", {
        code: code || "ea",
        description: description || "Eaches"
    });
}

async function terms(session) {
    return session.create("Terms", {
        code: uniq("NET30"),
        policy: "N",
        net: 30,
        depositRequired: false,
        depositAmount: money(0)
    });
}

async function shipMethod(session) {
    return session.create("ShipMethod", {
        code: uniq("TRUCK"),
        description: "Truck",
        international: false
    });
}

async function laborResource(session, rate) {
    return session.create("LaborResource", {
        code: uniq("SHOP"),
        description: "Shop labor",
        laborCost: money(
            rate === undefined
            ? 30
            : rate
        )
    });
}

async function machineResource(session, rate) {
    return session.create("MachineResource", {
        code: uniq("CNC"),
        description: "CNC cutting table",
        overheadCost: money(
            rate === undefined
            ? 10
            : rate
        )
    });
}

function itemSite(theSite, overrides) {
    return Object.assign({
        site: ref(theSite),
        isPrimary: true,
        planningPolicy: "M",
        issueMethod: "B",
        leadTime: 5,
        orderIncrement: 1,
        minimumOrderQuantity: 1,
        maximumOrderQuantity: 0,
        reorderPoint: 0,
        safetyStock: 0
    }, overrides);
}

// A purchased component, like demo's 3-CABINET-HINGE
async function purchasedItem(session, world, opts) {
    opts = opts || {};
    let cost = (
        opts.cost === undefined
        ? 1
        : opts.cost
    );
    return session.create("Product", {
        number: uniq(opts.prefix || "PART"),
        description: opts.description || "Purchased part",
        unit: ref(world.unit),
        site: ref(world.site),
        trace: "N",
        isFractional: Boolean(opts.isFractional),
        type: "I",
        source: "P",
        status: "A",
        isSold: Boolean(opts.isSold),
        materialCost: money(cost),
        laborCost: money(0),
        overheadCost: money(0),
        serviceCost: money(0),
        price: money(opts.price || 0),
        // Product triggers assume every child array is present
        sites: [itemSite(world.site, {planningPolicy: "L"})],
        conversions: [],
        documents: [],
        suppliers: [],
        billOfMaterialItems: [],
        operations: []
    });
}

// A manufactured item with a bill of material and routing.
// components: [{item, quantityPer, fixedQuantity}]
// operations: [{description, setupTime, runRate, labor, machine}]
async function manufacturedItem(session, world, opts) {
    opts = opts || {};
    return session.create("Product", {
        number: uniq(opts.prefix || "ASSY"),
        description: opts.description || "Manufactured assembly",
        unit: ref(world.unit),
        site: ref(world.site),
        trace: "N",
        isFractional: false,
        type: "I",
        source: "M",
        status: "A",
        isSold: Boolean(opts.isSold),
        price: money(opts.price || 0),
        eoq: 1,
        materialCost: money(0),
        laborCost: money(0),
        overheadCost: money(0),
        serviceCost: money(0),
        sites: [itemSite(world.site, {planningPolicy: "M"})],
        conversions: [],
        documents: [],
        suppliers: [],
        billOfMaterialItems: (opts.components || []).map(function (c, i) {
            return {
                sequence: i + 1,
                item: ref(c.item),
                quantityPer: c.quantityPer,
                fixedQuantity: c.fixedQuantity || 0,
                unit: ref(world.unit),
                ratio: 1,
                operation: 0
            };
        }),
        operations: (opts.operations || []).map(function (o, i) {
            let op = {
                sequence: i + 1,
                description: o.description || "Operation " + (i + 1),
                setupTime: o.setupTime || 0,
                runRate: o.runRate || 0,
                runUnit: "HU",
                queueTime: 0,
                waitTime: o.waitTime || 0,
                moveTime: 0,
                yield: 100,
                batchSize: 1,
                machineCapacity: 1,
                laborCapacity: 1,
                transferBatchPolicy: "C",
                isSubcontract: false
            };
            if (o.labor) {
                op.laborResource = ref(o.labor);
            }
            if (o.machine) {
                op.machineResource = ref(o.machine);
            }
            return op;
        })
    });
}

async function supplier(session, world) {
    return session.create("Supplier", {
        number: uniq("SUP"),
        name: "Regression Supply Co",
        isActive: true,
        terms: ref(world.terms),
        currency: ref(world.currency),
        score: 0,
        taxExempt: true
    });
}

async function customer(session, world) {
    let billTo = await address(session, {name: "Regression Customer"});
    return session.create("Customer", {
        number: uniq("CUST"),
        name: "Regression Customer",
        isActive: true,
        billTo: ref(billTo),
        billToIsShipto: true,
        shipTo: ref(billTo),
        terms: ref(world.terms),
        currency: ref(world.currency),
        site: ref(world.site),
        shipMethod: ref(world.shipMethod),
        creditStatus: "G",
        taxable: false,
        discount: 0
    });
}

// Merge values into a settings record (GET/PUT /settings/<name>)
async function settings(session, name, values) {
    let current = await session.get("/settings/" + name) || {};
    let data = Object.assign({}, current.data || {}, values);
    await session.call("PUT", "/settings/" + name, {
        etag: current.etag,
        data
    });
    return data;
}

// Settings that make flows deterministic in a test run: no printing or
// PDF generation on release/ship, inventory posts when saved.
async function configure(session) {
    await settings(session, "makeSettings", {
        printOnRelease: false,
        defaultStatus: "P"
    });
    await settings(session, "shipSettings", {
        printOnRelease: false,
        printOnShip: false,
        createLabelOnShip: false,
        useBackOrder: true
    });
    await settings(session, "buySettings", {printOnShip: false});
    await settings(session, "stockSettings", {
        postAdjustmentOnSave: true,
        postMoveOnSave: true
    });
    await settings(session, "commonSettings", {
        costDecimals: 2,
        purchasePriceDecimals: 4,
        salesPriceDecimals: 2
    });
}

// Reference data every flow needs. Cheap enough to build per test file.
async function world(session) {
    let w = {};
    w.currency = await currency(session, "USD");
    w.unit = await unit(session, "ea", "Eaches");
    w.site = await site(session);
    w.terms = await terms(session);
    w.shipMethod = await shipMethod(session);
    w.labor = await laborResource(session, 30);
    w.machine = await machineResource(session, 10);
    return w;
}

// The demo's 2-CABIN-CABINET-ASSY, rebuilt: 5 purchased components,
// 3 operations. Demo cost roll-up of that item: material 116.60,
// labor 30.00, overhead 5.00, total 151.60 (see supplychain/costing).
async function cabinetAssembly(session, w) {
    let plywood = await purchasedItem(session, w, {
        prefix: "PLYWOOD", cost: 120, isFractional: true,
        description: "Birch plywood 3/8, 4x8 sheet"
    });
    let hinge = await purchasedItem(session, w, {
        prefix: "HINGE", cost: 3.2, description: "Cabinet hinge"
    });
    let knob = await purchasedItem(session, w, {
        prefix: "KNOB", cost: 1.4, description: "Cabinet knob"
    });
    let screw = await purchasedItem(session, w, {
        prefix: "SCREW", cost: 0.02, description: "Screw #10"
    });
    let finish = await purchasedItem(session, w, {
        prefix: "FINISH", cost: 55, description: "Clear wood finish, gallon"
    });
    let assy = await manufacturedItem(session, w, {
        prefix: "CABINET",
        description: "Cabin cabinet assembly",
        components: [
            {item: plywood, quantityPer: 0.25},
            {item: hinge, quantityPer: 8},
            {item: knob, quantityPer: 4},
            {item: screw, quantityPer: 20},
            {item: finish, quantityPer: 1}
        ],
        operations: [
            {
                description: "Cut", setupTime: 0.25, runRate: 0.25,
                labor: w.labor, machine: w.machine
            },
            {description: "Assemble", runRate: 0.25, labor: w.labor},
            {
                description: "Varnish", runRate: 0.25, waitTime: 24,
                labor: w.labor
            }
        ]
    });
    return {assy, plywood, hinge, knob, screw, finish};
}

module.exports = {
    address,
    cabinetAssembly,
    configure,
    currency,
    customer,
    ensure,
    findOne,
    itemSite,
    laborResource,
    location,
    machineResource,
    manufacturedItem,
    money,
    purchasedItem,
    ref,
    settings,
    shipMethod,
    site,
    supplier,
    terms,
    today,
    uniq,
    unit,
    world
};
