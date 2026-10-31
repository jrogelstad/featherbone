/*
    Framework for building object relational database apps
    Copyright (C) 2027  Featherbone LLC

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
/*jslint node, unordered*/
/*global fetch*/
/**
    Puts the Job Shop demo data in the state the help's pictures were
    taken from. Some pictures show records the demo does not carry (a
    taxed invoice, a part-paid one, a location controlled site), or the
    screens of an edition the demo is not set to, so this makes them
    through the same routes the app uses. Run it against a throwaway copy
    of the demo, never one that is kept: it posts shipments, invoices and
    payments.

        node scripts/dev/help-shots-stage.js [options] <setup...>

        --base <url>       Instance to stage (default
                           http://localhost:<clientPort>/<database>)
        --user <name>      Sign in as (default pgUser in config.json)
        --password <pw>    (default pgPassword in config.json)

    A setup is what a shots.json "setup" names, and they build on one
    another in this order, so name the ones a run needs and leave the
    rest out:

        standard   Job Shop set to its Standard edition (the demo's own)
                   with records for the filter, tax, comment, container
                   and customs pictures. The pictures with no "setup".
        enterprise Job Shop set to its Enterprise edition, with work
                   orders released, completions posted and the issue
                   method set that the Make and Stock pictures need.
        billing    Invoices: a taxed one, a part-paid one, a prepaid one
                   applied to a shipment invoice, and an unpaid prepaid.
        locations  A second site with location control, its locations,
                   inventory and a move.

    Staging is safe to repeat: each step first looks for what it makes.
    The order numbers named below are the demo's own, and the invoice
    numbers the billing setup makes follow from them, so stage the demo
    exactly as it comes: the help text names I-00958 and I-00959.
*/
const fsp = require("fs").promises;
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const SETUPS = ["standard", "enterprise", "billing", "locations"];
const TODAY = new Date().toISOString().slice(0, 10);

let base;
let cookie = "";

function options() {
    let args = process.argv.slice(2);
    let opts = {setups: []};

    while (args.length) {
        let arg = args.shift();

        if (arg.startsWith("--")) {
            opts[arg.slice(2)] = args.shift();
        } else {
            opts.setups.push(arg);
        }
    }
    return opts;
}

async function config() {
    try {
        return JSON.parse(await fsp.readFile(
            path.join(ROOT, "server", "config.json"),
            "utf8"
        ));
    } catch (ignore) {
        return {};
    }
}

async function signIn(user, password) {
    let resp = await fetch(base + "/sign-in", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({username: user, password})
    });

    if (!resp.ok) {
        throw new Error("Could not sign in as " + user + ": " + resp.status);
    }
    cookie = resp.headers.getSetCookie().map(
        (c) => c.split(";")[0]
    ).join("; ");
}

async function api(method, route, body) {
    let resp = await fetch(base + route, {
        method,
        headers: {"Content-Type": "application/json", "Cookie": cookie},
        body: (
            body === undefined
            ? undefined
            : JSON.stringify(body)
        )
    });
    let text = await resp.text();
    let result;

    try {
        result = JSON.parse(text);
    } catch (ignore) {
        result = text;
    }
    if (!resp.ok) {
        throw new Error(
            method + " " + route + " " + resp.status + ": " +
            JSON.stringify(result).slice(0, 300)
        );
    }
    return result;
}

function spinal(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

// Every record of a feather's plural that matches {property: value}
async function find(plural, where, limit) {
    let rows = await api("POST", "/data/" + spinal(plural), {
        filter: {
            criteria: Object.keys(where).map(
                (property) => ({property, value: where[property]})
            ),
            limit: limit || 50
        }
    });

    return rows;
}

async function one(plural, where) {
    return (await find(plural, where, 1))[0];
}

async function need(plural, where) {
    let rec = await one(plural, where);

    if (!rec) {
        throw new Error(
            "No " + plural + " " + JSON.stringify(where) + ": is this the " +
            "Job Shop demo?"
        );
    }
    return rec;
}

function patch(feather, rec, ops) {
    return api("PATCH", "/data/" + spinal(feather) + "/" + rec.id, ops);
}

function replace(path, value) {
    return {op: "replace", path, value};
}

function add(path, value) {
    return {op: "add", path, value};
}

function id() {
    return crypto.randomBytes(6).toString("hex");
}

function ref(rec) {
    return {id: rec.id};
}

function money(amount) {
    return {amount, currency: "USD", effective: null, baseAmount: amount};
}

// An address is its record's own, so a copy takes a new id
function address(from) {
    let copy = {id: id()};

    [
        "type", "name", "street", "unit", "city", "state", "postalCode",
        "country", "phone"
    ].forEach(function (key) {
        if (from[key] !== undefined && from[key] !== null) {
            copy[key] = from[key];
        }
    });
    return copy;
}

function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function say(text) {
    console.log("  " + text);
}

// Looks like a product, copied so the new one needs no guessing
function productLike(src, over) {
    let copy = JSON.parse(JSON.stringify(src));

    [
        "id", "lock", "meta", "created", "updated", "createdBy", "updatedBy",
        "etag", "owner", "isDeleted"
    ].forEach(function (key) {
        delete copy[key];
    });
    return Object.assign(copy, over);
}

async function ensureTaxType(code, description) {
    let type = await one("TaxTypes", {code});

    if (!type) {
        await api("POST", "/data/tax-type", {
            code,
            description,
            reportingCode: code.slice(-2)
        });
        type = await one("TaxTypes", {code});
    }
    return type;
}

// The shipping container boxes the containers picture packs into
async function ensureBox(source, number, description, size) {
    let box = await one("Products", {number});

    if (!box) {
        await api("POST", "/data/product", productLike(source, {
            number,
            description,
            isContainer: true,
            length: size[0],
            width: size[1],
            height: size[2],
            isSold: false
        }));
        box = await one("Products", {number});
    }
    return box;
}

/*
    standard
*/
async function standard() {
    let electrical;
    let wire;
    let tax;
    let order;
    let method;
    let line;
    let source;
    let boxA;
    let boxB;
    let shipment;

    // The demo is Standard to begin with; a run after Enterprise needs
    // it set back
    await api("POST", "/job-shop/do-configure", {edition: "Standard"});
    say("edition set to Standard");

    // Filter pictures: three electrical products touched "this week", and
    // a deleted wire product for the Show Deleted filter
    electrical = await api("POST", "/data/products", {
        filter: {
            criteria: [{
                property: "number",
                operator: "~*",
                value: "^3-(120V-MALE|BATTERY|LED-DOME)"
            }],
            limit: 10
        }
    });
    await Promise.all(electrical.map((p) => patch("Product", p, [
        add("/longDescription", (p.longDescription || "") + " ")
    ])));
    say("touched " + electrical.length + " electrical products");

    wire = await one("Products", {number: "3-WIRE-14GA-WHT"});
    if (!wire) {
        source = await need("Products", {number: "3-WIRE-16GA-BLK"});
        await api("POST", "/data/product", productLike(source, {
            number: "3-WIRE-14GA-WHT",
            description: "Wire, 14 gauge, white (discontinued)"
        }));
        wire = await need("Products", {number: "3-WIRE-14GA-WHT"});
        await api("DELETE", "/data/product/" + wire.id);
        say("made a deleted wire product");
    }

    // Sell pictures: tax and a comment on the open order S-01955
    tax = await ensureTaxType("State: CA", "California state sales tax");
    order = await need("SalesOrders", {number: "S-01955"});
    if (!order.taxes.length) {
        await patch("SalesOrder", order, [
            replace("/taxable", true),
            add("/taxes/-", {
                taxType: ref(tax),
                percent: 0.06,
                amount: money(
                    Math.round(order.subtotal.amount * 0.06 * 100) / 100
                ),
                shippingTaxable: false
            })
        ]);
        say("taxed S-01955");
    }
    if (!order.comments.length) {
        await patch("SalesOrder", order, [add("/comments/-", {
            text: (
                "Supply deallocated: work order W-01762-1 was unreleased " +
                "by jtaylor, so 1 ea of 2-RR-FRAME-ASSY is no longer " +
                "allocated to this order."
            )
        })]);
        say("commented on S-01955");
    }

    // Ship pictures: customs on SH-00955 and containers on SH-00954
    shipment = await need("SalesOrderShipments", {number: "SH-00955"});
    if (!shipment.customsItems.length) {
        method = await one("ShipMethods", {code: "UPS - International"});
        if (!method) {
            await api("POST", "/data/ship-method", {
                code: "UPS - International",
                description: "UPS - International",
                international: true
            });
            method = await need("ShipMethods", {code: "UPS - International"});
        }
        line = shipment.lines[0];
        await patch("SalesOrderShipment", shipment, [
            replace("/shipMethod", ref(method)),
            replace("/contents", "merchandise"),
            replace("/nonDelivery", "return_to_sender"),
            add("/customsItems/-", {
                sku: "1-RR-RIALTO",
                skuDescription: "Roadrunner teardrop camper, luxury trim",
                quantity: 1,
                value: money(9600),
                harmonizedTariffCode: "87161000",
                countryOfOrigin: "US",
                shipmentLineId: line.id,
                description: "Teardrop camper trailer"
            })
        ]);
        say("added customs to SH-00955");
    }
    shipment = await need("SalesOrderShipments", {number: "SH-00954"});
    if (!shipment.containers.length) {
        source = await need("Products", {number: "3-WIRE-16GA-BLK"});
        boxA = await ensureBox(
            source,
            "BOX-24X12X6",
            "Box 24 x 12 x 6 in",
            [24, 12, 6]
        );
        boxB = await ensureBox(
            source,
            "BOX-12X12X12",
            "Box 12 x 12 x 12 in",
            [12, 12, 12]
        );
        await patch("SalesOrderShipment", shipment, [
            add("/containers/-", {
                owner: "jtaylor",
                number: "000003",
                container: ref(boxA),
                weight: 12,
                quantities: [{
                    item: ref(shipment.lines[0].item),
                    quantity: 1,
                    weight: 12
                }]
            }),
            add("/containers/-", {
                owner: "jtaylor",
                number: "000004",
                container: ref(boxB),
                weight: 4,
                quantities: []
            })
        ]);
        say("packed SH-00954");
    }
}

/*
    enterprise
*/
async function complete(wo, sequence, quantity, employee, close) {
    let work = await need("WorkOrders", {number: wo});
    let op = work.operations.find((o) => o.sequence === sequence);
    let done = await find("OperationCompletions", {"operation.id": op.id});
    let emp = await need("Employees", {number: employee});

    if (!done.length) {
        await api("POST", "/data/operation-completion", {
            operation: ref(op),
            quantity,
            employee: ref(emp),
            closeOperation: Boolean(close)
        });
        say("completed " + wo + " operation " + sequence);
    }
}

const RELEASED = [
    "W-01762-2", "W-01762-3", "W-01762-4", "W-01766-2", "W-01766-3",
    "W-01766-4", "W-01770-2", "W-01770-3", "W-01770-4"
];

async function enterprise() {
    let issue = ["3-CABINET-HINGE", "3-CABINET-KNOB", "3-SCREW-CS-10"];

    await api("POST", "/job-shop/do-configure", {edition: "Enterprise"});
    say("edition set to Enterprise");

    // Released work orders: the dispatch list needs a few with operations
    // to do, and the header pictures reschedule them
    await RELEASED.reduce(
        function (prev, number) {
            return prev.then(async function () {
                let work = await need("WorkOrders", {number});

                if (work.status === "P") {
                    await patch("WorkOrder", work, [replace("/status", "A")]);
                    say("released " + number);
                }
            });
        },
        Promise.resolve()
    );

    // Completions: one closed and one part done, and a whole work order
    // finished, which leaves a receipt pending
    await complete("W-01762-4", 1, 1, "001", true);
    await complete("W-01762-4", 2, 0.5, "002");
    await complete("W-01770-4", 1, 1, "003");
    await complete("W-01770-4", 2, 1, "003");
    await complete("W-01770-4", 3, 1, "003");
    await pause(2000);

    // Only manually issued materials appear on the issue form
    await Promise.all(issue.map(async function (number) {
        let item = await need("Products", {number});
        let sites = item.sites.map(function (s, i) {
            return (
                (s.site.code === "WH1" && s.issueMethod !== "M")
                ? replace("/sites/" + i + "/issueMethod", "M")
                : undefined
            );
        }).filter(Boolean);

        if (sites.length) {
            await patch("Product", item, sites);
            say("issue method on " + number);
        }
    }));
}

/*
    billing
*/
async function shipOrder(number, employee) {
    let order = await need("SalesOrders", {number});
    let data;
    let n = 0;
    let shipment;

    // The demo's open orders are dated ahead of today, and an order
    // cannot ship before its requested date
    if (order.requestedDate > TODAY) {
        await patch("SalesOrder", order, [replace("/requestedDate", TODAY)]);
    }
    data = await api("POST", "/ship/get-sales-order-ship-data", {
        id: order.id
    });
    await api("POST", "/data/sales-order-shipment", {
        salesOrder: ref(order),
        site: ref(order.site),
        shipTo: address(data.shipTo),
        shipMethod: ref(data.shipMethod),
        purchaseOrder: data.purchaseOrder || "",
        shippedBy: ref(employee),
        freightCharges: money(0),
        containers: [],
        trackingUrls: [],
        lines: data.lines.filter((l) => l.quantityDue > 0).map(function (l) {
            n += 1;
            return {
                line: n,
                item: ref(l.item),
                salesOrderLine: {id: l.id},
                quantity: l.quantityDue,
                details: []
            };
        })
    });
    shipment = await need("SalesOrderShipments", {
        "salesOrder.number": number,
        "status": "P"
    });
    await api("POST", "/ship/ship-sales-order-shipments", {
        ids: [shipment.id]
    });
    return shipment;
}

async function invoiceOrder(number, employee) {
    let shipment = await shipOrder(number, employee);
    let invoice = await api("POST", "/bill/do-create-shipment-invoice", {
        id: shipment.id
    });

    return need("ShipmentInvoices", {id: invoice});
}

async function prepay(order, amount) {
    await api("POST", "/data/prepaid-invoice", {
        invoiceDate: TODAY,
        shipDate: TODAY,
        status: "A",
        customer: ref(order.customer),
        billTo: address(order.billTo),
        shipTo: address(order.shipTo),
        terms: ref(order.terms),
        currency: ref(order.currency),
        taxable: false,
        salesOrder: ref(order),
        subtotal: money(amount),
        tax: money(0),
        freight: money(0),
        total: money(amount),
        paid: money(0),
        balance: money(amount),
        lines: [],
        taxes: [],
        payments: [],
        applications: []
    });
    return need("PrepaidInvoices", {"salesOrder.number": order.number});
}

function pay(invoice, amount, reference) {
    return api("POST", "/bill/do-apply-invoice-payment", {
        amount: money(amount),
        ids: [invoice.id],
        reference
    });
}

async function billing() {
    let employee = await need("Employees", {number: "004"});
    let order;
    let invoice;
    let prepaid;

    // Invoices are taxed from the rates for the bill to address
    if (!await one("TaxRates", {zipCode: "23324"})) {
        await api("POST", "/data/tax-rate", {
            zipCode: "23324",
            city: "Chesapeake",
            state: "VA",
            county: "Chesapeake",
            salesTaxRate: 5.3,
            rateState: 4.3,
            rateCounty: 0,
            rateCity: 1,
            rateSpecialDistrict: 0,
            reportingCodeState: "VA",
            reportingCodeCounty: "",
            reportingCodeCity: "",
            reportingCodeSpecialDistrict: "",
            postOffice: "Chesapeake",
            shippingTaxable: false,
            primaryRecord: true,
            z2tId: ""
        });
    }

    // Taxed and open: S-01955 (invoice I-00956)
    if (!await one("ShipmentInvoices", {"salesOrder.number": "S-01955"})) {
        await invoiceOrder("S-01955", employee);
        say("invoiced S-01955");
    }

    // Part paid: S-01957 (invoice I-00957)
    if (!await one("ShipmentInvoices", {"salesOrder.number": "S-01957"})) {
        invoice = await invoiceOrder("S-01957", employee);
        await pay(invoice, 4000, "CHK 20418");
        say("invoiced S-01957 and part paid it");
    }

    // Prepaid, paid, then applied to the shipment invoice: S-01956 (the
    // prepaid I-00958, the shipment invoice I-00959)
    if (!await one("ShipmentInvoices", {"salesOrder.number": "S-01956"})) {
        order = await need("SalesOrders", {number: "S-01956"});
        prepaid = await prepay(order, 3500);
        await pay(prepaid, 3500, "WIRE 7731");
        await invoiceOrder("S-01956", employee);
        say("prepaid and invoiced S-01956");
    }

    // A prepaid still unpaid, to print: S-01958 (I-00960)
    if (!await one("PrepaidInvoices", {"salesOrder.number": "S-01958"})) {
        order = await need("SalesOrders", {number: "S-01958"});
        await prepay(order, order.total.amount / 4);
        say("prepaid S-01958");
    }
}

/*
    locations
*/
const OVERFLOW_STOCK = [
    ["3-110V-OUTLET", 40, "A1S2B5", "ELASSY"],
    ["3-120V-MALE-RECEPTICAL", 25, "STOCK", "ELASSY"],
    ["3-12V-OUTLET", 30, "A1S2B5", "ELASSY"]
];

async function locations() {
    let places = {};
    let main;
    let overflow;
    let stock;
    let moves;

    await Promise.all([
        ["STOCK", "Stock location", "N"],
        ["WIP", "Work in process", "N"],
        ["A1S2B5", "Aisle 1, Shelf 2, Bin 5", "N"],
        ["ELASSY", "Electrical assembly", "N"],
        ["INSPECT", "Incoming inspection", "I"],
        ["DAMAGED", "Damaged goods hold", "B"]
    ].map(async function ([name, description, type]) {
        if (!await one("Locations", {name})) {
            await api("POST", "/data/location", {name, description, type});
        }
    }));
    await Promise.all(
        ["STOCK", "WIP", "A1S2B5", "ELASSY", "INSPECT"].map(
            async function (name) {
                places[name] = await need("Locations", {name});
            }
        )
    );

    main = await need("Sites", {code: "WH1"});
    overflow = await one("Sites", {code: "WH2"});
    if (!overflow) {
        await api("POST", "/data/site", {
            code: "WH2",
            description: "Overflow Warehouse",
            address: address(main.address),
            billTo: address(main.address),
            locationControlled: true,
            defaultLocation: ref(places.STOCK),
            defaultReceiveLocation: ref(places.INSPECT),
            defaultWipLocation: ref(places.WIP),
            defaultShipLocation: ref(places.STOCK)
        });
        overflow = await need("Sites", {code: "WH2"});
        say("made WH2");
    }

    // The product site first, then opening stock into its locations
    await OVERFLOW_STOCK.reduce(function (prev, row) {
        let [number, quantity, where, wip] = row;

        return prev.then(async function () {
            let item = await need("Products", {number});

            if (!item.sites.some((s) => s.site.code === "WH2")) {
                await patch("Product", item, [add("/sites/-", {
                    id: id(),
                    site: ref(overflow),
                    isPrimary: false,
                    reorderPoint: 0,
                    safetyStock: 0,
                    minimumOrderQuantity: 1,
                    maximumOrderQuantity: 0,
                    orderIncrement: 1,
                    abcClass: "",
                    planningPolicy: "L",
                    leadTime: 1,
                    defaultLocation: ref(places[where]),
                    wipLocation: ref(places[wip]),
                    useHardAllocations: false,
                    issueMethod: "M"
                })]);
                // The inventory record the adjustment posts to is made
                // behind the scenes
                await pause(2000);
            }
            if (!(await find("InventoryAdjustments", {
                "item.number": number,
                "site.code": "WH2"
            })).length) {
                await api("POST", "/data/inventory-adjustment", {
                    item: ref(item),
                    site: ref(overflow),
                    quantity,
                    type: "I",
                    comments: "Opening balance, overflow warehouse",
                    details: [{
                        id: id(),
                        quantity,
                        location: ref(places[where])
                    }]
                });
                say("stocked " + number);
            }
        });
    }, Promise.resolve());
    await pause(2000);

    stock = await need("Products", {number: "3-110V-OUTLET"});
    moves = await find("MoveInventories", {"item.number": stock.number});
    if (!moves.length) {
        await api("POST", "/data/move-inventory", {
            item: ref(stock),
            site: ref(overflow),
            quantity: 2,
            fromLocation: ref(places.A1S2B5),
            toLocation: ref(places.WIP),
            date: TODAY
        });
        say("moved 2 " + stock.number);
    }
}

const STEPS = {standard, enterprise, billing, locations};

async function main() {
    let opts = options();
    let conf = await config();

    base = opts.base || (
        "http://localhost:" + (conf.clientPort || 80) + "/" +
        (conf.pgDatabase || "demo")
    );
    base = base.replace(/\/$/, "");
    if (!opts.setups.length || opts.setups.some((s) => !SETUPS.includes(s))) {
        throw new Error("Name a setup: " + SETUPS.join(", "));
    }
    await signIn(opts.user || conf.pgUser, opts.password || conf.pgPassword);
    await opts.setups.reduce(function (prev, name) {
        return prev.then(function () {
            console.log(name);
            return STEPS[name]();
        });
    }, Promise.resolve());
}

main().catch(function (e) {
    console.error(e.message);
    process.exitCode = 1;
});
